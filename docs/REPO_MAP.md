# Repo map

Every top-level directory, in one place, with a one-line description and a
pointer to its own `README.md` when one exists.

> **If you're new here, read this file first, then `ARCHITECTURE.md`, then
> `apps/agent-py/README.md`.**

```
ASST/
├── apps/                        Deployable surfaces (web, agent-py, chain intake)
│   ├── web/                     @asst/web — Next.js dashboard + public API
│   ├── agent-py/                Python Hermes plugin + FastAPI + Arq worker
│   └── chain-intake/            @asst/chain-intake — Helius → Postgres → manifest
│
├── packages/                    Reusable libraries (workspace:*)
│   └── sdk/                     @ares/sdk — `ares` CLI + TypeScript client (public `/api/*`)
│
├── deepagentsjs/                Vendored LangGraph engine + examples (pattern reference)
│   ├── libs/                    deepagents core, providers, graph backends
│   ├── examples/                Runnable demos incl. assurance-run manifest pipeline
│   └── …                        See deepagentsjs/README.md
│
├── docs/                        PRD, dashboard UX notes, narrative docs (EN + ID)
├── .agents/skills/              CANONICAL skills directory (loaded by agent-py orchestrator).
├── scripts/                     Ad-hoc automation (Colosseum Copilot scan, etc.)
├── analysis/                    Optional positioning / revenue-forecast notebooks
├── assurance/                   (gitignored) generated run manifests & SARIF output
├── .asst/                       (gitignored) local runtime state (sqlite, reports)
├── .superstack/                 Internal planning notes (not product code)
├── .github/                     CI workflows
│
├── README.md                    You-are-here overview
├── REPO_MAP.md                  This file
├── ARCHITECTURE.md              System design (points to WHITEPAPER § 9)
├── CONTRIBUTING.md              Dev workflow, conventions, how to add things
├── WHITEPAPER.md / .en / .id    Product narrative (English + Bahasa Indonesia)
├── TOOLS.md / REFERENCES.md     Tool catalog + citations
├── COMPETITORS.md / PRD.md      Market + product spec
├── WALKTHROUGH.md               End-to-end demo script
├── .env.example                 Template for root env vars (copy to .env.local)
├── pnpm-workspace.yaml          pnpm workspace config (packages/* + apps/*)
└── package.json                 Root — runs `pnpm -r build|dev`
```

## Where does X live?

| Question                                                     | Answer                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| "Where is the orchestrator?"                                 | `apps/agent-py/src/ares_plugin/orchestrator.py`          |
| "Where are the 6 sub-agents defined?"                        | `apps/agent-py/src/ares_plugin/sub_agents.py`            |
| "Where do I add a new assurance tool?"                       | `apps/agent-py/src/ares_plugin/tools/assurance.py`       |
| "Where are KB tools?"                                        | `apps/agent-py/src/ares_plugin/tools/kb_tools.py`        |
| "Where is the model routing (LiteLLM)?"                      | `apps/agent-py/src/ares_plugin/llm.py`                   |
| "Where do skills get loaded from?"                           | `.agents/skills` (Hermes / filesystem middleware)        |
| "Where is chat/scan persistence (JSONL)?"                    | `apps/agent-py/src/ares_plugin/persistence.py`          |
| "Where is the web API for /api/chat?"                        | `apps/web/app/api/chat/route.ts`                         |
| "Where is the Developer SDK / `ares` CLI?"                   | `packages/sdk/` + narrative doc `docs/SDK-CLI.md`        |
| "Where does the web proxy to Python?"                        | `apps/web/lib/agentpy-client.ts`                         |
| "Where is the FastAPI surface?"                              | `apps/agent-py/src/ares_plugin/api/main.py`              |
| "Where does Helius push webhook data?"                       | `apps/chain-intake/src/server.ts`                        |
| "Where is the assurance manifest writer?"                    | `deepagentsjs/examples/assurance-run/write-run-manifest.ts` |
| "Where are skills authored?"                                 | `.agents/skills/<skill-name>/SKILL.md`                   |

## What is ignored from git?

See `.gitignore`. Notable:

- `dist/`, `*.tsbuildinfo`, `apps/web/.next/` — build output
- `.asst/`, `var/` — local runtime state
- `assurance/` — per-run manifests (uploaded as CI artifacts instead)
- `.env`, `.env.local`, `.env.*` — local credentials
- `*.pdf` except `docs/**/*.pdf`
