-- Wave 2: persist jitter telemetry for each timer fire
ALTER TABLE timer_records
  ADD COLUMN IF NOT EXISTS jitter_ms BIGINT;
