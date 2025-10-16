CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS kernel_raft_log (
  log_index BIGINT PRIMARY KEY,
  entry JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER kernel_raft_log_touch_timestamp
  BEFORE UPDATE ON kernel_raft_log
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS kernel_raft_metadata (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  vote JSONB,
  committed JSONB,
  last_purged_log JSONB,
  state_machine JSONB,
  snapshot_meta JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER kernel_raft_metadata_touch_timestamp
  BEFORE UPDATE ON kernel_raft_metadata
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_timestamp();
