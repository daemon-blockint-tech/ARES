# Contributing

Read [`docs/REPO_MAP.md`](./docs/REPO_MAP.md) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) first. For a shorter overview and
links, see [`README.md`](./README.md). This document covers the day-to-day
mechanics: setup, conventions, and recipes for the most common changes.

## 1. Dev setup

Requirements:

- **Node.js 20+**
- **pnpm 9+** (`npm install -g pnpm` if you don't have it)
- **Python 3.10+** (only if you invoke `semgrep` locally)
- **Git**
- Windows: PowerShell 7 or `cmd.exe`. macOS / Linux: any POSIX shell.

Initial install:

```bash
pnpm install
pnpm -r build
```

Copy the env template:

```bash
cp .env.example .env.local
# fill in GOOGLE_API_KEY (or OPENROUTER_API_KEY, or neither if using Ollama)
```

Sanity check:

```bash
pnpm --filter @asst/web test
cd apps/agent-py && uv run pytest -q
```

## 2. Workspace structure — recap

- `apps/agent-py/` — Hermes plugin + FastAPI + Arq worker; **orchestration and
  assurance tools** for chat and scans.
- `apps/<surface>/` — deployable surfaces. They must not reimplement agent
  logic; they proxy to `agent-py` or add product-only code (auth, billing, UI).
- `.agents/skills/` — the canonical skills directory. **Do not** duplicate
  skills into `.claude/`, `.cursor/`, `.codebuddy/`, etc.

## 3. Running things

| Target                 | Command                                                      |
| ---------------------- | ------------------------------------------------------------ |
| Build everything       | `pnpm -r build`                                              |
| Typecheck (workspaces) | `pnpm typecheck`                                             |
| Web dev server         | `pnpm --filter @asst/web dev`                                |
| Chain intake           | `pnpm --filter @asst/chain-intake start`                     |
| Agent-py tests         | `cd apps/agent-py && uv run pytest -q`                      |
| Web tests              | `pnpm --filter @asst/web test`                               |

## 4. Code conventions

- **TypeScript, strict mode.** No `// @ts-ignore` unless there is a comment
  explaining why and a plan to remove it.
- **ES modules.** Extensions in relative imports: `./foo.js` (not `./foo`).
- **Zod** for anything crossing a trust boundary (tool inputs, HTTP routes).
- **LangChain tools** are the canonical interface for agent-callable logic.
  Prefer `tool(fn, { name, description, schema })` over ad-hoc classes.
- **Naming:**
  - kebab-case filenames (`anchor-source-scanner.ts`)
  - PascalCase for classes + Zod schemas (`Orchestrator`, `FindingSchema`)
  - camelCase for functions/variables
- **Comments** explain *why*, not *what*. No narrator comments.

## 5. Common recipes

### Add a new assurance tool

1. Implement the tool in `apps/agent-py/src/ares_plugin/tools/assurance.py`
   (or a sibling module) and register it with the Hermes plugin context.
2. Mirror the JSON schema in `openai_tools_definitions()` when the tool is
   exposed to the LiteLLM tool loop.
3. Document behavior in `apps/agent-py/README.md` if operators need new env
   vars or CLIs.

### Add a new sub-agent

1. Extend `apps/agent-py/src/ares_plugin/sub_agents.py` (or the orchestrator
   routing table) with prompt, tool allowlist, and skills references.
2. Keep public manifests in `apps/web/lib/sub-agent-public-manifest.ts` in sync
   for `/api/agents`.

### Add a new skill

1. Create `.agents/skills/<your-skill>/SKILL.md`.
2. Format: YAML-style frontmatter (optional) + prose content that describes
   when to use it and what to do.
3. Any agent whose `relevantSkills` matcher hits will load it at boot.
4. **Do not** create copies under `.claude/`, `.cursor/`, `.codebuddy/`, etc.
   Those directories were consolidated into `.agents/skills/`.

### Add a new model provider

1. Extend `apps/agent-py/src/ares_plugin/llm.py` (LiteLLM routing) and defaults
   in `apps/agent-py/src/ares_plugin/config.py`.
2. Add the required provider API key to `.env.example`.
3. Document in `apps/agent-py/README.md` and `apps/web/README.md`.

### Add a new web API route

1. Create `apps/web/app/api/<name>/route.ts`.
2. Prefer thin proxies to `apps/agent-py` via `agentPyPostJson` from
   `@/lib/agentpy-client` for agent-adjacent behavior.
3. Validate input with Zod.
4. Return `NextResponse.json(...)` or a stream.

## 6. Commit + PR etiquette

- **Atomic commits.** One logical change per commit.
- **Subject line:** `<scope>: <imperative present>` — e.g.
  `engine: split mutating tools into tools/mutating.ts`.
- **Reference the todo id** when the work traces back to one (e.g.
  `(closes A7)` in the body).
- Before opening a PR:
  - `pnpm -r build` (everything compiles)
  - `pnpm typecheck` when your package defines a `typecheck` script
  - `pnpm --filter @asst/web test` (unit tests pass)
  - Update any affected `README.md`.

## 7. Security-review checklist

Before shipping any change that touches **tools**, **API routes**, or
**env vars**:

- [ ] Does the change expose a mutating action on a public surface? If yes,
      does it honor `ASST_ALLOW_WRITE` / `ASST_WEB_ALLOW_WRITE` +
      `permissionFn`?
- [ ] Are new env vars documented in `.env.example` and in the relevant
      `README.md`?
- [ ] Is user input validated with Zod (or an equivalent schema check)?
- [ ] Does the change leak absolute paths, keys, or `.env*` contents in
      logs / findings / transcripts?
- [ ] Are any new external binaries (`semgrep`, `git`, `solana` CLI, …)
      documented and fail-fast when missing?

## 8. What NOT to commit

- `dist/`, `apps/web/.next/`, `*.tsbuildinfo` — build output
- `.asst/` — runtime sqlite + config
- `assurance/` — generated run manifests (upload as CI artifact instead)
- `.env`, `.env.local`, `.env.*` — credentials
- Ad-hoc `test_*.log`, `inspect_*.ts`, `test_*.ts` scratch files at repo or
  package roots

These are already covered by `.gitignore`; don't override.

## 9. Questions?

Open a GitHub issue (or a draft PR) — don't wait for "perfect" context, the
earlier the feedback loop starts the better.
