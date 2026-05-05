# `apps/` — deployable surfaces

Each directory here is a deployable product. **Agent orchestration** lives in
`apps/agent-py` (Hermes + FastAPI + Arq); Next.js routes are thin HTTP proxies
where appropriate.

| App                  | Package name          | Purpose                                                                       |
| -------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `web/`               | `@asst/web`           | Next.js dashboard + public API routes.                                       |
| `agent-py/`          | `ares-agent-py`       | Python agent service: chat, scans, KB tools, feedback → Supabase.            |
| `chain-intake/`      | `@asst/chain-intake`  | Helius webhook receiver → Postgres. Feeds the assurance manifest pipeline.   |

## Rules for new apps

1. Do not fork assurance/orchestration logic into multiple languages; extend
   `apps/agent-py` and register tools on the Hermes plugin.
2. Server-side surfaces that will be **publicly reachable** must keep mutating
   tools off by default (`ASST_WEB_ALLOW_WRITE`, billing gates, etc.).
3. Keep app-specific state inside the app (e.g. Next.js route handlers stay in
   `apps/web/app/api/`).
4. Add a top-level `README.md` inside the app that answers: what does this do,
   how do I run it locally, what environment does it need.
