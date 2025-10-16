import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { AuthContext, Permission, PolicyApiKey, PolicyConfig, QuotaLimits, TenantPolicy } from '../types/auth';
import { logger } from '../telemetry/logger';

type AuthorizeOptions = {
  apiKey?: string;
  bearerToken?: string;
  tenantId: string;
  requestId: string;
  traceId?: string;
};

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'apps/control-plane/config/policies.example.json');

export class PolicyEngine {
  private readonly config: PolicyConfig;
  private readonly tenantIndex: Map<string, TenantPolicy> = new Map();

  constructor(config?: PolicyConfig) {
    if (config) {
      this.config = config;
    } else {
      this.config = loadConfigFromEnv();
    }
    for (const tenant of this.config.tenants) {
      this.tenantIndex.set(tenant.tenantId, tenant);
    }
  }

  get signingSecret(): string {
    return this.config.signingSecret;
  }

  authorize(options: AuthorizeOptions): AuthContext {
    const tenantPolicy = this.tenantIndex.get(options.tenantId);
    if (!tenantPolicy) {
      throw new PolicyError(`Tenant ${options.tenantId} is not registered`);
    }

    const apiKey = normalizeApiKey(options.apiKey ?? options.bearerToken);
    if (!apiKey) {
      throw new PolicyError('Missing API key credentials');
    }

    const keyPolicy = tenantPolicy.apiKeys.find((candidate) => verifySecret(candidate, apiKey));
    if (!keyPolicy) {
      throw new PolicyError('Invalid API key for tenant');
    }

    const quotas = resolveQuotaLimits(this.config.defaultQuotas, tenantPolicy.quotas, keyPolicy.quotas);

    return {
      tenantId: options.tenantId,
      principalId: keyPolicy.principalId,
      roles: keyPolicy.roles.slice(),
      permissions: keyPolicy.permissions.slice(),
      keyId: keyPolicy.keyId,
      quotas,
      requestId: options.requestId,
      traceId: options.traceId,
    };
  }

  ensurePermission(context: AuthContext, permission: Permission) {
    if (!context.permissions.includes(permission)) {
      throw new PolicyError(`Permission ${permission} is not granted for this credential`);
    }
  }
}

export class PolicyError extends Error {}

const normalizeApiKey = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7);
  }
  return value;
};

const verifySecret = (policy: PolicyApiKey, provided: string): boolean => {
  const providedHash = hashSecret(provided);
  return crypto.timingSafeEqual(Buffer.from(policy.hashedSecret, 'hex'), Buffer.from(providedHash, 'hex'));
};

const hashSecret = (secret: string): string => {
  return crypto.createHash('sha256').update(secret).digest('hex');
};

const loadConfigFromEnv = (): PolicyConfig => {
  const inline = process.env.POLICY_CONFIG_JSON;
  if (inline) {
    return parseConfig(inline, 'POLICY_CONFIG_JSON');
  }

  const configPath = process.env.POLICY_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    logger.warn({ configPath }, 'Policy configuration file missing, falling back to permissive defaults');
    return buildPermissiveDefaults();
  }

  const contents = fs.readFileSync(configPath, 'utf8');
  return parseConfig(contents, configPath);
};

const parseConfig = (raw: string, source: string): PolicyConfig => {
  try {
    const parsed = JSON.parse(raw) as PolicyConfig;
    validateConfig(parsed);
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse policy configuration from ${source}: ${String(error)}`);
  }
};

const validateConfig = (config: PolicyConfig) => {
  if (!config.signingSecret || config.signingSecret.length < 16) {
    throw new Error('signingSecret must be at least 16 characters');
  }
  if (!config.defaultQuotas) {
    throw new Error('defaultQuotas must be provided');
  }
  if (!Array.isArray(config.tenants) || config.tenants.length === 0) {
    throw new Error('At least one tenant policy must be configured');
  }
};

const buildPermissiveDefaults = (): PolicyConfig => {
  const fallbackSecret = crypto.randomBytes(32).toString('hex');
  return {
    signingSecret: fallbackSecret,
    defaultQuotas: {
      maxActiveTimers: 100,
      schedulePerMinute: 60,
      cancelPerMinute: 120,
    },
    tenants: [
      {
        tenantId: 'development',
        apiKeys: [
          {
            keyId: 'dev-local',
            hashedSecret: hashSecret('local-dev-key'),
            principalId: 'developer',
            roles: ['developer'],
            permissions: ['timers:create', 'timers:read', 'timers:cancel', 'timers:stream'],
          },
        ],
      },
    ],
  };
};

const resolveQuotaLimits = (
  defaults: QuotaLimits,
  tenantOverrides?: Partial<QuotaLimits>,
  keyOverrides?: Partial<QuotaLimits>,
): QuotaLimits => {
  return {
    maxActiveTimers: keyOverrides?.maxActiveTimers ?? tenantOverrides?.maxActiveTimers ?? defaults.maxActiveTimers,
    schedulePerMinute:
      keyOverrides?.schedulePerMinute ?? tenantOverrides?.schedulePerMinute ?? defaults.schedulePerMinute,
    cancelPerMinute: keyOverrides?.cancelPerMinute ?? tenantOverrides?.cancelPerMinute ?? defaults.cancelPerMinute,
  };
};

export const hashPolicySecret = hashSecret;
