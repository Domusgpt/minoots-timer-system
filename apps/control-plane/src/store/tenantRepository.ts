import { Pool, PoolClient } from 'pg';

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  keyHash: string;
  roles: string[];
  active: boolean;
}

export interface QuotaRecord {
  tenantId: string;
  dailyTimerLimit: number;
  burstTimerLimit: number;
}

export const findApiKeyByHash = async (pool: Pool, keyHash: string): Promise<ApiKeyRecord | null> => {
  const result = await pool.query(
    `SELECT id, tenant_id, key_hash, roles, active FROM tenant_api_keys WHERE key_hash = $1 LIMIT 1`,
    [keyHash],
  );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    keyHash: row.key_hash,
    roles: row.roles ?? [],
    active: row.active,
  };
};

export const updateApiKeyLastUsed = async (pool: Pool, id: string): Promise<void> => {
  await pool.query(`UPDATE tenant_api_keys SET last_used_at = NOW() WHERE id = $1`, [id]);
};

export const getQuotaForTenant = async (pool: Pool, tenantId: string): Promise<QuotaRecord> => {
  const result = await pool.query(
    `SELECT tenant_id, daily_timer_limit, burst_timer_limit FROM tenant_quotas WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (result.rowCount === 0) {
    return {
      tenantId,
      dailyTimerLimit: 1000,
      burstTimerLimit: 200,
    };
  }
  const row = result.rows[0];
  return {
    tenantId: row.tenant_id,
    dailyTimerLimit: Number(row.daily_timer_limit),
    burstTimerLimit: Number(row.burst_timer_limit),
  };
};

export const withTenantQuotaTx = async <T>(pool: Pool, handler: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const selectQuotaUsageForUpdate = async (
  client: PoolClient,
  tenantId: string,
  usageDate: string,
): Promise<number> => {
  const result = await client.query(
    `SELECT scheduled_count FROM tenant_quota_usage WHERE tenant_id = $1 AND usage_date = $2 FOR UPDATE`,
    [tenantId, usageDate],
  );
  if (result.rowCount === 0) {
    await client.query(
      `INSERT INTO tenant_quota_usage (tenant_id, usage_date, scheduled_count) VALUES ($1, $2, 0)`,
      [tenantId, usageDate],
    );
    return 0;
  }
  return Number(result.rows[0].scheduled_count);
};

export const updateQuotaUsage = async (
  client: PoolClient,
  tenantId: string,
  usageDate: string,
  newCount: number,
): Promise<void> => {
  await client.query(
    `UPDATE tenant_quota_usage SET scheduled_count = $3 WHERE tenant_id = $1 AND usage_date = $2`,
    [tenantId, usageDate, newCount],
  );
};

export const countActiveTimers = async (client: PoolClient, tenantId: string): Promise<number> => {
  const result = await client.query(
    `SELECT COUNT(1) AS cnt FROM timer_records WHERE tenant_id = $1 AND status IN ('scheduled', 'armed')`,
    [tenantId],
  );
  return Number(result.rows[0].cnt ?? 0);
};
