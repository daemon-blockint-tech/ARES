# Runbook: `apps/agent-py` (FastAPI + Arq + Redis)

## Overview

The Python service owns chat, full-repo scans, KB tools, and Supabase feedback. Next.js (`apps/web`) proxies signed JSON to `AGENT_PY_URL`.

## Runtime dependencies

- **Redis** — Arq job queue (`AGENTPY_REDIS_URL` / default `redis://127.0.0.1:6379/0`).
- **Optional Supabase** — KB tables + `kb_feedback` / `kb_retrieval_logs` (`AGENTPY_SUPABASE_URL`, `AGENTPY_SUPABASE_SERVICE_ROLE_KEY`). Apply `apps/agent-py/migrations/supabase/*.sql` in the KB project.
- **LLM keys** — e.g. `GOOGLE_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY` depending on models (via LiteLLM).

## Local compose

From `apps/agent-py/`:

```bash
docker compose up --build
```

This starts API + worker + Redis. Point `apps/web` at `http://127.0.0.1:8765` with matching `AGENTPY_INTERNAL_SECRET`.

## Secrets (production)

| Variable | Purpose |
|----------|---------|
| `AGENTPY_INTERNAL_SECRET` | Shared HMAC with Next.js (`AGENTPY_INTERNAL_SECRET` / web `AGENTPY_INTERNAL_SECRET`). |
| `AGENTPY_REDIS_URL` | Arq broker. |
| `AGENTPY_SUPABASE_*` | KB + feedback persistence. |
| `OPENAI_API_KEY` | Embeddings for `scripts/kb_ingest.py` and optional chat models. |

## Health

- `GET /healthz` — liveness.
- `GET /metrics` — Prometheus scrape.

## Supabase KB (one-time)

1. In [Supabase Dashboard](https://supabase.com/dashboard): **New project** (dedicated KB project recommended).
2. **SQL Editor** → paste and run `apps/agent-py/migrations/supabase/001_kb.sql`, then `002_kb_retrieval_logs.sql` (order matters).
3. **Project Settings → API**: copy **Project URL** and **service_role** key (server-only; never expose to browsers).
4. In repo root `.env.local` (and/or agent-py env):

   - `AGENTPY_SUPABASE_URL=https://<ref>.supabase.co`
   - `AGENTPY_SUPABASE_SERVICE_ROLE_KEY=<service_role_jwt>`

## KB ingest (CVE CSV)

Run from monorepo root (CSV path default matches repo layout):

```bash
cd apps/agent-py
# Optional: source root env (OPENAI_API_KEY, AGENTPY_SUPABASE_*)
set -a && [ -f ../../.env.local ] && . ../../.env.local && set +a
uv run python scripts/kb_ingest.py status
uv run python scripts/kb_ingest.py cve --csv ../../dataset/cve-and-cwe-dataset-1999-2025/CVE_CWE_2025.csv
```

Resume is controlled by `.asst/kb_ingest_cve.checkpoint` (next row index).

After dashboard feedback exists:

```bash
uv run python scripts/preference_distill.py --limit 50
```
