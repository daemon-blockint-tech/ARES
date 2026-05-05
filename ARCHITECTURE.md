# ASST — Architecture

**Version 0.3** · canonical system design for the multi-agent stack.

> Short version: **apps/agent-py** is the orchestration plane; Next.js is a
> thin HTTP surface. Read [`apps/agent-py/README.md`](./apps/agent-py/README.md)
> and [`docs/REPO_MAP.md`](./docs/REPO_MAP.md) for navigation.

## 1. System diagram

```
                               ┌───────────────────────────────────────┐
                               │           apps/agent-py               │
                               │  Hermes plugin · LiteLLM · FastAPI    │
                               │  Arq worker · assurance + KB tools    │
                               │  JSONL history under <repo>/.asst/    │
                               └───────────────────────────────────────┘
                                                ▲
           ┌───────────────────────┬────────────┴────────────┬──────────────────────┐
           │                       │                         │                      │
    ┌────────────┐          ┌────────────┐                                        ┌────────────┐
    │ operators  │          │ @asst/web  │                                        │@asst/chain-│
    │ scripts/CI │          │ Next.js    │                                        │ intake     │
    │            │          │ /api/*     │                                        │ Helius → PG│
    │            │          │ proxies    │                                        │ → manifest │
    └────────────┘          └────────────┘                                        └────────────┘
```

## 2. Boundaries

- **`apps/agent-py`** holds orchestration, Hermes tool registration, KB
  integration, and scan workers. **`apps/web`** stays billing/auth/UI and
  signs JSON bodies to the Python service.
- **Tools** are Python async functions registered on the Hermes plugin
  (`ares_plugin/tools/*`). Read-only vs mutating behavior follows the same
  product rules as before (`ASST_ALLOW_WRITE`, `ASST_WEB_ALLOW_WRITE`).
- **Models** route through LiteLLM using `provider:model` ids (see
  `ares_plugin/llm.py`).

### 2.1 Phase 0 defaults (migration plan)

- **Queue:** Arq (Redis) · **HTTP:** FastAPI · **Python env:** uv (`Makefile` targets `py-dev`, `py-test`, `py-build`).
- **Hermes:** consumed as a **plugin bundle** (`ares_plugin` entry point); upstream pin is the git tag declared in `apps/agent-py/pyproject.toml` (release lineage maps to Hermes `0.12.x` metadata).
- **Default LLM:** operators set `ASST_ORCHESTRATOR_MODEL` / provider keys; LiteLLM resolves providers (`ares_plugin/llm.py`).
- **KB Track A:** Supabase + pgvector; optional Track B (DPO/RL) is gated on feedback volume — see `docs/runbooks/phase-10b-rl-dpo.md`.

## 3. Data flow — deterministic full scan

```
 user ──▶ web ──▶ POST /v1/scan ──▶ Arq worker ──▶ AresOrchestrator.run_full_scan
                                    │
                                    ├─ runs each sub-agent in order
                                    │    (each agent uses its skill-filtered
                                    │     system prompt + readonly tools)
                                    │
                                    ├─ writes transcripts to .asst/*.jsonl
                                    │
                                    └─▶ returns FullScanResult
                                          └─ persisted SARIF + JSON under
                                             <repoRoot>/assurance/ (if present)
```

## 4. Data flow — interactive chat

```
 user prompt ──▶ POST /v1/chat ──▶ AresOrchestrator.chat
                       │
                       ├─ loads recent history from JSONL
                       ├─ calls LLM with system prompt + sub-agent registry
                       ├─ delegates to sub-agents (Hermes / LiteLLM tool loop)
                       └─ returns reply text; persisted under .asst/
```

## 5. Security model

- **Public surface** = web → agent-py. Default posture is read-only tools.
- **Trusted operators** enable mutating tools only with explicit env + policy.
- **ASST_ALLOW_WRITE=0** forces refusal regardless of the permission hook.
- **ASST_WEB_ALLOW_WRITE=1** is the explicit opt-in for trusted private
  deployments (e.g. a CI runner for your own repo).

### 5.1 Sandbox backends

Mutating tools should run inside **Docker** (per-scan isolation) in
production. The Python port mirrors the same env knobs
(`ASST_SANDBOX_BACKEND`, `ASST_SANDBOX_DOCKER_*`, `ASST_CMD_*`) — see
`apps/agent-py/README.md` for the current matrix.

## 6. Persistence

Chat transcripts and operator-visible artifacts live under
`<repoRoot>/.asst/` (JSONL + `last-scan.json` + `runs/<run_id>.json` for queued
Arq scans). Supabase (optional) stores KB rows, `kb_feedback`, and
`kb_retrieval_logs`.

## 7. Skills

- Canonical location: `.agents/skills/<skill-name>/SKILL.md`.
- Loaded by the Python orchestrator on agent boot (Hermes skills middleware
  where configured).
- Each sub-agent filters skills relevant to its role.
- **Planned** (B2): TF-IDF retrieval to keep context budgets small.

## 8. Extensibility

- **New assurance tool** → implement in `apps/agent-py/src/ares_plugin/tools/`
  and register via the Hermes plugin.
- **New sub-agent** → extend `ares_plugin/sub_agents.py` + orchestrator routing.
- **New HTTP surface** → prefer `apps/web` route proxies with HMAC to `agent-py`.

## 9. Related documents

- **Repository map (every top-level dir):** [`docs/REPO_MAP.md`](./docs/REPO_MAP.md)
- **Product narrative (canonical EN + ID):** [`docs/WHITEPAPER.en.md`](./docs/WHITEPAPER.en.md) ·
  [`docs/WHITEPAPER.id.md`](./docs/WHITEPAPER.id.md) · hub
  [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md)
- **Product + quick links:** [`README.md`](./README.md)
- **Requirements:** [`docs/PRD.md`](./docs/PRD.md)
- **Walkthrough / demo script:** [`docs/walkthrough.md`](./docs/walkthrough.md)
- **Tool catalog (hub + EN/ID stubs):** [`docs/TOOLS.md`](./docs/TOOLS.md)
- **References (hub + citations):** [`docs/REFERENCES.md`](./docs/REFERENCES.md)
- **Dashboard UX + digest payload:** [`docs/DASHBOARD-UX.en.md`](./docs/DASHBOARD-UX.en.md) ·
  [`docs/DASHBOARD-UX.id.md`](./docs/DASHBOARD-UX.id.md)
- **Public web (auth / billing design):** [`docs/design/public-web-auth-billing.md`](./docs/design/public-web-auth-billing.md)
- **Tools / code map (Deep Agents ↔ WHITEPAPER §10):** [`deepagentsjs/docs/TOOLS-MAP.md`](./deepagentsjs/docs/TOOLS-MAP.md)

---

*Internal documentation. Not a security audit or legal advice.*
