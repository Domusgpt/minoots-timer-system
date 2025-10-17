ALTER TABLE timer_records
  ADD COLUMN IF NOT EXISTS temporal_graph JSONB,
  ADD COLUMN IF NOT EXISTS graph_root_id UUID,
  ADD COLUMN IF NOT EXISTS graph_node_id TEXT,
  ADD COLUMN IF NOT EXISTS jitter_policy JSONB;
