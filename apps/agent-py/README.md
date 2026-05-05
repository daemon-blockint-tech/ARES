# ARES `agent-py`

Python service that replaces the legacy `@ares/engine` TypeScript stack for chat and scans.

## Hermes version pin

- **Git tag**: `v2026.4.30` ([hermes-agent](https://github.com/NousResearch/hermes-agent))
- **PyPI metadata version** in that tag: `0.12.0` (see upstream `pyproject.toml`)

The pip dependency is pinned to the **git tag**, not a non-existent `v0.12.0` git tag.

## Layout

- `src/ares_plugin/` — Hermes pip plugin (`register()`), tools, orchestrator, FastAPI app
- `migrations/supabase/` — KB-only Supabase DDL (pgvector)
- `scripts/` — ETL (`kb_ingest.py`), preference distillation, eval harness stubs

## Run (dev)

Run typecheck from **`apps/agent-py`** (`uv run mypy src`). Dev dependencies
(mypy, ruff, pytest) are in **`[dependency-groups] dev`** and are installed by
`uv sync` in this directory — if `mypy` is missing, run `uv sync` again (not from
the monorepo root unless you use `cd apps/agent-py` first).

From repo root (with Redis for Arq):

```bash
cd apps/agent-py
uv sync
export AGENTPY_INTERNAL_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export ASST_REPO_ROOT="$(git rev-parse --show-toplevel)"
uv run uvicorn ares_plugin.api.main:app --host 0.0.0.0 --port 8765 --reload
```

Docker: see `docker-compose.yml` in this directory.

## Environment

See root `.env.example` — section **Python agent service (`apps/agent-py`)**.
