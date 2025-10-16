CREATE TABLE IF NOT EXISTS kernel_raft_state (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    leader_id TEXT NOT NULL,
    term BIGINT NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE kernel_raft_state IS 'Tracks the active horology kernel leader for the Postgres raft coordinator';
