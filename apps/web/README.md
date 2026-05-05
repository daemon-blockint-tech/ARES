# @asst/web

Next.js 15 app that serves:

1. The public **marketing site** (home page, feature pages).
2. A **dashboard** showing assurance-run evidence and findings.
3. An **API surface** (`/api/*`) that authenticates, bills (mppx), rate-limits,
   and **proxies** LLM chat and scans to **`apps/agent-py`** over HMAC-signed JSON.

Execution lives in Python (`POST /v1/chat`, `POST /v1/scan`, `GET /v1/runs/{id}`, …);
the browser never holds `AGENTPY_INTERNAL_SECRET`.

## Public-surface security model

The web app is intended to be reachable by untrusted users. Every sensitive route:

- Uses `authenticateIngress`, IP / wallet rate limits, and mppx where applicable.
- Calls `agentPyPostJson` / `agentPyGetJson` from `@/lib/agentpy-client` for agent-py.

Mutating assurance tools stay **off** unless the deployment sets `ASST_WEB_ALLOW_WRITE=1`.
That default is applied once via `@/lib/asst-allow-write` (imported from the root layout).

## Layout

```
app/
├── layout.tsx               Root layout (theme + ASST_ALLOW_WRITE default)
├── page.tsx                 Landing page
├── dashboard/               Security dashboard pages
├── components/              Presentational components
└── api/
    ├── chat/route.ts        POST /api/chat → agent-py /v1/chat
    ├── scan/route.ts        POST /api/scan → agent-py /v1/scan
    ├── findings/route.ts    Assurance findings (disk + proxies where wired)
    ├── runs/route.ts        Run summaries from manifests
    └── …
lib/
├── agentpy-client.ts        HMAC client for agent-py
├── asst-allow-write.ts      Forces ASST_ALLOW_WRITE=0 unless opted in
├── auth/sanitize-model.ts Public `model` SSRF hardening
└── data.ts                  Loaders for posture data from disk artifacts
```

## Running locally

```bash
pnpm --filter @asst/web dev       # http://localhost:3000
pnpm --filter @asst/web build     # production bundle
pnpm --filter @asst/web start     # run compiled build
```

Run **Redis + agent-py** separately (`docker compose` at repo root, or `Makefile` `py-dev`).
Web needs `AGENT_PY_URL` and `AGENTPY_INTERNAL_SECRET` (see root `.env.example`).

Environment (read from `.env.local` at repo root via `next.config.ts`):

| Variable                  | Required | Purpose                                          |
| ------------------------- | -------- | ------------------------------------------------ |
| `AGENT_PY_URL`            | yes\*    | Base URL for `apps/agent-py` (e.g. `http://127.0.0.1:8765`) |
| `AGENTPY_INTERNAL_SECRET` | yes\*    | HMAC secret shared with agent-py                 |
| `GOOGLE_API_KEY`          | yes\*    | When using Gemini default models                 |
| `ASST_WEB_API_KEY`        | yes\*\*  | Optional operator API key for automation         |
| `ASST_WEB_ALLOW_WRITE`    | no       | set to `1` ONLY on trusted private deployments   |
| `ASST_REPO_ROOT`          | no       | explicit repository root boundary                 |

\* Required for chat/scan against a live agent-py instance.  
\*\* In development, routes may allow missing key for local DX.

## Wallet-gated usage

Free tiers and paid rails are enforced in `app/api/chat` and `app/api/scan` before
calling agent-py. Keep billing logic in **apps/web** only; agent-py remains wallet-agnostic.
