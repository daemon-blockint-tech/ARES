-- Optional audit trail for kb_log_retrieval tool (separate from user thumbs in kb_feedback).

CREATE TABLE IF NOT EXISTS kb_retrieval_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  kb_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_retrieval_logs_run ON kb_retrieval_logs (run_id);
