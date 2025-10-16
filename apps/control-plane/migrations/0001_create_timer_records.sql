CREATE TABLE IF NOT EXISTS timer_records (
  tenant_id TEXT NOT NULL,
  id UUID NOT NULL,
  requested_by TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB,
  labels JSONB DEFAULT '{}'::jsonb,
  action_bundle JSONB,
  agent_binding JSONB,
  fired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  cancelled_by TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS timer_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
