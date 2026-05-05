-- ARES Knowledge Base (Track A) — dedicated Supabase project
-- Run once per database (requires sufficient privileges; Supabase SQL editor: OK).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS kb_vuln_records (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  cwe_ids TEXT[],
  severity TEXT,
  embedding vector(1536),
  meta JSONB DEFAULT '{}'::jsonb,
  embedding_model_version TEXT DEFAULT 'text-embedding-3-small',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_vuln_embedding ON kb_vuln_records
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_kb_vuln_trgm ON kb_vuln_records USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS kb_audit_exemplars (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  language TEXT,
  body TEXT,
  quality_score DOUBLE PRECISION DEFAULT 1.0,
  embedding vector(1536),
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_exemplar_embedding ON kb_audit_exemplars
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS kb_code_corpus (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  language TEXT,
  path TEXT,
  content TEXT,
  excerpt TEXT,
  embedding vector(1536),
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_code_embedding ON kb_code_corpus
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS kb_feedback (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  rating SMALLINT NOT NULL,
  comment TEXT,
  retrieved_kb_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_feedback_run ON kb_feedback (run_id);

CREATE TABLE IF NOT EXISTS kb_preference_pairs (
  id BIGSERIAL PRIMARY KEY,
  prompt TEXT NOT NULL,
  chosen TEXT NOT NULL,
  rejected TEXT NOT NULL,
  judge_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
