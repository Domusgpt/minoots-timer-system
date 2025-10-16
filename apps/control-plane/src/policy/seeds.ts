import crypto from 'node:crypto';

import { Pool } from 'pg';

import { logger } from '../telemetry/logger';

export interface PolicySeedConfig {
  tenantId: string;
  tenantName: string;
  apiKey: string;
  apiKeyName: string;
  roles: string[];
  dailyTimerLimit: number;
  burstTimerLimit: number;
  active?: boolean;
}

const DEFAULT_SEEDS: PolicySeedConfig[] = [
  {
    tenantId: 'tenant-local',
    tenantName: 'Local Development',
    apiKey: 'local-dev-key',
    apiKeyName: 'Local Development Console',
    roles: ['timer.read', 'timer.write', 'timer.cancel', 'tenant.admin'],
    dailyTimerLimit: 500,
    burstTimerLimit: 25,
    active: true,
  },
];

const parseSeedConfig = (raw: unknown): PolicySeedConfig[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seeds: PolicySeedConfig[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || !entry) {
      continue;
    }
    const value = entry as Record<string, unknown>;
    const tenantId = typeof value.tenantId === 'string' ? value.tenantId : undefined;
    const apiKey = typeof value.apiKey === 'string' ? value.apiKey : undefined;
    if (!tenantId || !apiKey) {
      continue;
    }
    const tenantName = typeof value.tenantName === 'string' && value.tenantName.length > 0
      ? value.tenantName
      : tenantId;
    const apiKeyName = typeof value.apiKeyName === 'string' && value.apiKeyName.length > 0
      ? value.apiKeyName
      : `${tenantName} key`;
    const roles = Array.isArray(value.roles)
      ? (value.roles.filter((role): role is string => typeof role === 'string' && role.length > 0))
      : ['timer.read'];
    const dailyTimerLimit = Number.isFinite(value.dailyTimerLimit as number)
      ? Number(value.dailyTimerLimit)
      : 500;
    const burstTimerLimit = Number.isFinite(value.burstTimerLimit as number)
      ? Number(value.burstTimerLimit)
      : 25;
    const active = value.active === undefined ? true : Boolean(value.active);

    seeds.push({
      tenantId,
      tenantName,
      apiKey,
      apiKeyName,
      roles: roles.length > 0 ? roles : ['timer.read'],
      dailyTimerLimit,
      burstTimerLimit,
      active,
    });
  }
  return seeds;
};

export const loadPolicySeeds = (): PolicySeedConfig[] => {
  const raw = process.env.CONTROL_PLANE_SEED_API_KEYS;
  if (!raw) {
    return DEFAULT_SEEDS;
  }
  try {
    const parsed = JSON.parse(raw);
    const seeds = parseSeedConfig(parsed);
    if (seeds.length === 0) {
      logger.warn('CONTROL_PLANE_SEED_API_KEYS did not contain any valid entries; falling back to defaults');
      return DEFAULT_SEEDS;
    }
    return seeds;
  } catch (error) {
    logger.warn({ error }, 'Failed to parse CONTROL_PLANE_SEED_API_KEYS; falling back to defaults');
    return DEFAULT_SEEDS;
  }
};

export const ensurePolicySeeds = async (pool: Pool, seeds: PolicySeedConfig[] = loadPolicySeeds()): Promise<void> => {
  const tenantQuota = new Map<string, { name: string; daily: number; burst: number }>();
  for (const seed of seeds) {
    const existing = tenantQuota.get(seed.tenantId);
    const daily = seed.dailyTimerLimit;
    const burst = seed.burstTimerLimit;
    if (!existing) {
      tenantQuota.set(seed.tenantId, {
        name: seed.tenantName,
        daily,
        burst,
      });
    } else {
      tenantQuota.set(seed.tenantId, {
        name: existing.name,
        daily: Math.max(existing.daily, daily),
        burst: Math.max(existing.burst, burst),
      });
    }
  }

  for (const [tenantId, info] of tenantQuota.entries()) {
    await pool.query(
      `INSERT INTO tenant_accounts (tenant_id, name)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, info.name],
    );

    await pool.query(
      `INSERT INTO tenant_quotas (tenant_id, daily_timer_limit, burst_timer_limit)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE
         SET daily_timer_limit = EXCLUDED.daily_timer_limit,
             burst_timer_limit = EXCLUDED.burst_timer_limit,
             updated_at = NOW()`,
      [tenantId, info.daily, info.burst],
    );
  }

  for (const seed of seeds) {
    const hash = crypto.createHash('sha256').update(seed.apiKey).digest('hex');
    await pool.query(
      `INSERT INTO tenant_api_keys (tenant_id, key_hash, name, roles, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, key_hash) DO UPDATE
         SET name = EXCLUDED.name,
             roles = EXCLUDED.roles,
             active = EXCLUDED.active`,
      [seed.tenantId, hash, seed.apiKeyName, seed.roles, seed.active ?? true],
    );
  }

  logger.info({ tenants: Array.from(tenantQuota.keys()) }, 'Ensured policy seed data');
};

export const getDefaultSeedApiKey = (tenantId: string): string | null => {
  const seeds = loadPolicySeeds();
  const seed = seeds.find((entry) => entry.tenantId === tenantId);
  return seed?.apiKey ?? null;
};
