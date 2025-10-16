CREATE TABLE IF NOT EXISTS timer_command_log (
    sequence BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    command_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timer_command_log_tenant ON timer_command_log (tenant_id, sequence);
