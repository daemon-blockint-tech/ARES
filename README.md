### ARES Solana Security Tool

**ARES Solana Security Tool** (**ASST**) — a multi-agent security stack for
teams shipping Solana (and related) software. Deployed as **Assurance Run**:
orchestrated checks + commit-bound evidence, not a one-shot "audit".

**Reference / upstream:** [github.com/ares-system/ares-system](https://github.com/ares-system/ares-system)  
*(Community mirrors and forks may use other GitHub orgs; layout and behavior are defined by this tree.)*

> **New here?** Read [`docs/REPO_MAP.md`](./docs/REPO_MAP.md), then
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), then
> [`docs/ARCHITECTURE-HIGH-LOW-LEVEL.md`](./docs/ARCHITECTURE-HIGH-LOW-LEVEL.md) (high/low-level system view),
> then [`apps/agent-py/README.md`](./apps/agent-py/README.md) (Python agent API) and
> [`apps/web/README.md`](./apps/web/README.md) (public web + dashboard).

## What ASST does

Given a Solana repository, ASST can:

1. Run a **deterministic 6-agent full scan** — Solana vulnerabilities,
   DeFi security, rug-pull risk, secret hygiene, supply chain, report synthesis.
2. Chat interactively — the orchestrator delegates to the right sub-agent.
3. Emit **assurance manifests**: signed-ish JSON bundles of tool output
   + SARIF + git metadata, reproducible across runs.
4. Integrate operator workflows via **HTTP APIs** (dashboard + `agent-py`).
5. Surface results in a **Next.js web app** — marketing pages plus a
   **security dashboard** (`/dashboard`) backed by `apps/agent-py`.

## Architecture at a glance

```
           ┌────────────────────────────────────────────────┐
           │              apps/agent-py (Hermes)           │  ← orchestrator,
           │  FastAPI · Arq worker · assurance + KB tools   │    LiteLLM, skills
           └────────────────────────────────────────────────┘
                                   ▲
               ┌───────────────────┴───────────────────┐
         ┌─────────────┐                        ┌────────────┐
         │  @asst/web  │                        │@asst/chain-│
         │  (Next.js)  │                        │ intake     │
         └─────────────┘                        └────────────┘
             public API + proxy                     Helius → PG
```

- **All agent logic** lives in `apps/agent-py/` (Python Hermes plugin).
- **Web** proxies signed requests to `agent-py`; **chain-intake** is a separate
  service (Helius → Postgres) for on-chain telemetry.
- **Public HTTP** (`@asst/web`): paid **`/api/chat`** and **`/api/scan`** paths use **mppx** (HTTP 402) after free-tier quotas; see Web UI section below.
- **Public surfaces** (web) default to read-only; mutating tools require
  explicit opt-in + per-call HITL confirmation.

## Layout

| Path | What |
| ---- | ---- |
| `apps/agent-py/` | Python agent service (Hermes + FastAPI + Arq). See [`apps/agent-py/README.md`](./apps/agent-py/README.md). |
| `apps/web/` | Next.js marketing site, dashboard, `/api/*`. See [`apps/web/README.md`](./apps/web/README.md). |
| `apps/chain-intake/` | Helius webhook receiver + backfill. See [`apps/chain-intake/README.md`](./apps/chain-intake/README.md). |
| `packages/sdk/` | **Public SDK + `ares` CLI** for shells and CI runners (`npm install -g @ares/sdk`). See [`packages/sdk/README.md`](./packages/sdk/README.md). |
| `deepagentsjs/` | Vendored LangGraph stack, examples, eval harnesses (e.g. `evals/ares-security/`, `libs/dataset/benchmark-tier-a/`). |
| `.agents/skills/` | Canonical skills directory loaded by the Python orchestrator. |
| `docs/` | PRD, walkthrough, **repo map** ([`docs/REPO_MAP.md`](./docs/REPO_MAP.md)), **architecture overview** ([`docs/ARCHITECTURE-HIGH-LOW-LEVEL.md`](./docs/ARCHITECTURE-HIGH-LOW-LEVEL.md)), whitepaper, tool catalog, references, dashboard UX, security checklists. |

## Web UI (public + dashboard)

- **Stack:** Next.js 15, Tailwind, shared layout across landing and `/dashboard/*`.
- **Theme:** global **dark / light** toggle; preference is stored in `localStorage` (`ares-theme`) and applied before first paint to avoid flash.
- **Auth:** Sign-In with Solana (SIWS) for wallet-bound identity on dashboard routes; optional operator API key for automation (see [`apps/web/README.md`](./apps/web/README.md)).
- **Billing / paid API:** `POST /api/chat` and `POST /api/scan` use **[mppx](https://mpp.dev)** — HTTP **402** challenges with `WWW-Authenticate: Payment` until a credential settles. **Free-tier quotas** (per IP / per wallet) apply before paywall. Rails are **env-gated**: Tempo (`charge` and optional `session` with a signing key), Stripe (cards), Solana, Lightning (Spark SDK). Legacy **bundle top-up** API routes return **410 Gone**; configure **`MPP_SECRET_KEY`** and at least one payment rail in production (see [`.env.example`](./.env.example)). Design background: [`docs/design/public-web-auth-billing.md`](./docs/design/public-web-auth-billing.md).

## Quick start

```bash
# From repo root
pnpm install
pnpm -r build

# Typecheck all packages that define a `typecheck` script
pnpm typecheck

# Web app
pnpm --filter @asst/web dev    # http://localhost:3000

# Python agent API (chat + scans + KB)
cd apps/agent-py && uv run ares-agent-api

# Or use Makefile / Compose shortcuts (Redis + API + worker):
# make py-dev
# docker compose up -d   # see root docker-compose.yml
```

### Developer SDK / CLI

Wire ARES into shells and CI runners with the public `ares` CLI:

```bash
npm install -g @ares/sdk

ares --help
ares config --base-url https://ares.example.com
ares login --keypair ~/.config/solana/ci.json --json
ares scan . --json
ares run <run_id> --watch
```

See [`packages/sdk/README.md`](./packages/sdk/README.md) for the full
command reference, programmatic usage (`AresClient`), CI runner examples,
and exit-code contract.

Copy [`.env.example`](./.env.example) to `.env.local` and fill in the keys you need:

- The **LLM provider** matching your chosen orchestrator model — Ollama / local-model users don't need cloud keys.
- For **production web** with paid chat/scan: **`MPP_SECRET_KEY`** (≥32 chars) and at least one of **`ASST_TEMPO_RECIPIENT`**, **`STRIPE_SECRET_KEY`**, **`LIGHTNING_MNEMONIC`**, **`ASST_SOLANA_RECIPIENT`** (see `.env.example` for Tempo session key and tuning).
- **`ASST_SESSION_SECRET`** (≥32 bytes or 64 hex chars) if you enable SIWS sessions.

## Model choice (SDK/CLI + web)

The orchestrator model is configurable, never hardcoded. Supported:

- `google:gemini-2.5-flash` — default, needs `GOOGLE_API_KEY`
- `openrouter:<model>` — needs `OPENROUTER_API_KEY`
- `openai:<model>` — OpenAI or any OpenAI-compatible endpoint
- `ollama:<model>` — local, no key required
- `local:<model>@<baseUrl>` — LM Studio etc.

Set via `--model`, `.asst/config.json`, or `$ASST_ORCHESTRATOR_MODEL`.
On **`/api/chat`** and **`/api/scan`**, client-supplied `model` values are
sanitized so callers cannot append `@<baseUrl>` (SSRF / key exfiltration).
See [`apps/agent-py/README.md`](./apps/agent-py/README.md) for runtime env vars.

## Security model

The public surface rule is: **read-only by default, mutations require HITL**.

- Mutating tools (`write_file`, `run_terminal_cmd`) are produced by a factory
  that calls a permission callback before every write/exec.
- The web uses default-deny write policy and protected API routes for production.
- The public **agent-py** surface follows the same read-only defaults; enable
  writes only in trusted deployments.

Details: [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`apps/agent-py/README.md`](./apps/agent-py/README.md).

## Documentation index

| Document | Purpose |
| -------- | ------- |
| [`docs/REPO_MAP.md`](./docs/REPO_MAP.md) | Every top-level directory, one place |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, surfaces vs engine |
| [`docs/ARCHITECTURE-HIGH-LOW-LEVEL.md`](./docs/ARCHITECTURE-HIGH-LOW-LEVEL.md) | High-level + low-level architecture (diagrams, package map) |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Dev setup, conventions, how to add things |
| [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md) | Hub: EN / ID product narrative (canonical sections in **§9–§11**) |
| [`docs/TOOLS.md`](./docs/TOOLS.md) | Tool catalog hub + language stubs |
| [`docs/REFERENCES.md`](./docs/REFERENCES.md) | Citations and standards references |
| [`docs/PRD.md`](./docs/PRD.md) | Product requirements |
| [`docs/walkthrough.md`](./docs/walkthrough.md) | Demo / walkthrough script |
| [`docs/DASHBOARD-UX.en.md`](./docs/DASHBOARD-UX.en.md) | Dashboard UX spec |
| [`docs/design/public-web-auth-billing.md`](./docs/design/public-web-auth-billing.md) | Public web, auth, billing (design) |
| [`docs/SDK-CLI.md`](./docs/SDK-CLI.md) | **Developer SDK** — `@ares/sdk`, `ares` CLI, CI/auth/architecture |
| [`deepagentsjs/docs/TOOLS-MAP.md`](./deepagentsjs/docs/TOOLS-MAP.md) | Deep Agents code ↔ product tool mapping |
| [`deepagentsjs/docs/AI-SECURITY-BENCHMARK-FRAMEWORK-ID.md`](./deepagentsjs/docs/AI-SECURITY-BENCHMARK-FRAMEWORK-ID.md) | AI security benchmark framework (ID) |

## License

See [`LICENSE`](./LICENSE).

---

*Assurance Run is a pattern you implement and extend; it is not a substitute
for professional audits or formal verification when your threat model
requires them.*
