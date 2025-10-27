CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenant_accounts (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_api_keys_tenant_hash_idx
  ON tenant_api_keys (tenant_id, key_hash);

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT PRIMARY KEY REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
  daily_timer_limit INTEGER NOT NULL DEFAULT 1000,
  burst_timer_limit INTEGER NOT NULL DEFAULT 200,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_quota_usage (
  tenant_id TEXT NOT NULL REFERENCES tenant_accounts(tenant_id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  scheduled_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, usage_date)
);

ALTER TABLE timer_records
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS timer_command_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  timer_id UUID NOT NULL,
  command TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS timer_command_log_tenant_idx
  ON timer_command_log (tenant_id, created_at DESC);
