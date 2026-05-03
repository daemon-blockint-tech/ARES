# Build context — ASST / ARES

> Generated/updated by **review-and-iterate** (2026-05-03). Deep-merged with the 2026-04-12 entry below.

## Stack (observed, 2026-05-03)

- **Monorepo:** pnpm workspace at the repo root.
  - `packages/engine` (`@ares/engine`) — multi-agent orchestrator, sub-agents, tools, sandbox backends, skills retrieval, SQLite persistence (~4.7 kLoC TS).
  - `apps/web` — Next.js 15 / React 19 dashboard, SIWS auth, billing, scan/chat APIs.
  - `apps/mcp-server` — stdio MCP server exposing engine + assurance tools.
  - `apps/chain-intake` — Hono webhook for Helius enhanced txs, billing deposit attribution, Postgres ingestion.
  - `apps/cli`, `apps/wallet-bot` — secondary surfaces (not deep-reviewed in this pass).
- **On-chain:** still no Anchor/`programs/*.rs` in this repo. Solana-related logic is **off-chain** (SIWS, treasury memo parsing, RPC reads).
- **Persistence:** PostgreSQL (web/billing/chain-intake) + better-sqlite3 (engine local state).
- **LLM providers:** Google, OpenRouter, OpenAI/OpenAI-compatible, Ollama, "local". Model id format `<provider>:<model>[@<baseUrl>]` parsed by `packages/engine/src/config/model-factory.ts`.

## Review summary (`review.*`, 2026-05-03)

| Field | Value |
|-------|-------|
| `review.security_score` | **D** |
| `review.quality_score` | **B-** |
| `review.ready_for_mainnet` | **false** |

### Why the grade dropped from C → D since 2026-04-12

The earlier review covered a docs-only repo with vendored `deepagentsjs/`. This pass covers a much larger surface area — public web routes, MCP server, on-chain webhook, and a billing system — and surfaces **6 critical (P0)** issues that any one of which is sufficient to block production.

The most damaging are:

1. **SSRF + LLM-API-key exfiltration** via user-controlled `model` baseUrl on `/api/chat` and `/api/scan`.
2. **Bundle credit fraud** — chain-intake credits the full bundle for any positive payment amount, no price check.
3. **SIWS phishing** — `/api/auth/verify` does not validate the signed `Domain:` line against the request host.
4. **Public scan billing race** — `runFullScan` is fire-and-forget, but the user is debited before the scan completes.
5. **MCP arbitrary file r/w** — `asst_merge_sarif` / `asst_write_assurance_manifest` accept unbounded filesystem paths.
6. **JWT secret has no minimum entropy** — any non-empty `ASST_SESSION_SECRET` is accepted, including `"abc"`.

Quality is held at **B-** because the codebase is otherwise idiomatic (well-typed, modular, includes some boundary tests), but security-critical paths lack tests and the test pyramid is thin (5 engine tests, 4 web tests, 2 chain-intake tests).

### `review.findings` (structured, severity-ordered)

```json
[
  {
    "severity": "critical",
    "category": "Security/SSRF",
    "id": "ASST-2026-05-03-001",
    "description": "Public /api/chat and /api/scan accept body.model and pass it to parseModelId, which lets attackers supply @<baseUrl> for openai/ollama/local providers. The server then sends an OpenAI-style request including the configured OPENAI_API_KEY in Authorization to that arbitrary URL.",
    "file": "apps/web/app/api/chat/route.ts:40-43, apps/web/app/api/scan/route.ts:40-43, packages/engine/src/config/model-factory.ts:142-201",
    "fix": "In createPublicOrchestrator, refuse user-controlled model identifiers OR strip @<baseUrl>. Maintain a server-side allowlist of model ids. Never forward a server-managed apiKey to a baseUrl that isn't on the allowlist."
  },
  {
    "severity": "critical",
    "category": "Security/Billing",
    "id": "ASST-2026-05-03-002",
    "description": "applyBillingDeposits credits BUNDLE_UNITS[bundleId] for any positive transfer amount to treasury — no price check. A 1-lamport SOL transfer with memo ASST:<self>:growth:nonce yields 1,100 units (priced at $10 USDC).",
    "file": "apps/chain-intake/src/credits-on-deposit.ts:124-158, apps/chain-intake/src/bundle-units.ts",
    "fix": "Compare lamports against a SOL-priced lookup or USDC token amount against TOPUP_BUNDLES[bundleId].usdc with a small tolerance (e.g. ±0.5%). Reject underpayments; for overpayments either credit pro-rata or reject."
  },
  {
    "severity": "critical",
    "category": "Security/Auth",
    "id": "ASST-2026-05-03-003",
    "description": "SIWS verify route validates signature/nonce/expiry but never validates the `Domain:` line in the signed message against the request host. A signature obtained on another origin can be replayed here.",
    "file": "apps/web/app/api/auth/verify/route.ts:42-49",
    "fix": "Extract Domain from signedMessage, compare against ASST_PUBLIC_HOSTS allowlist (or req.headers.get('host')), reject mismatches with 401. Also pin Statement, URI, and Issued-At drift bound."
  },
  {
    "severity": "critical",
    "category": "Correctness/Billing",
    "id": "ASST-2026-05-03-004",
    "description": "/api/scan invokeScan calls ares.runFullScan(...).catch(...) without await and returns 200 immediately. Caller settles the debit because res.status === 200, charging users for scans that may fail. There is also no run-id, no result persistence, and no polling endpoint.",
    "file": "apps/web/app/api/scan/route.ts:47-76, 124-130",
    "fix": "(a) Persist a run row before returning, return runId; (b) only settle the debit on the worker side after a successful runFullScan resolution; (c) on failure refund and emit a webhook/alert."
  },
  {
    "severity": "critical",
    "category": "Security/MCP",
    "id": "ASST-2026-05-03-005",
    "description": "asst_merge_sarif accepts arbitrary inputPaths[] and outputPath. It reads each input and writes merged JSON to outputPath. No path normalization, no root containment.",
    "file": "apps/mcp-server/src/server.ts:170-202",
    "fix": "Resolve inputPaths/outputPath against an MCP-side ASST_MCP_REPO_ROOT, reject anything that escapes via path.relative+startsWith('..'). Also bound the number/size of inputs."
  },
  {
    "severity": "critical",
    "category": "Security/MCP",
    "id": "ASST-2026-05-03-006",
    "description": "asst_write_assurance_manifest accepts repoRoot/outDir/deepagentsjsRoot and feeds them to execFileAsync('pnpm', args, {cwd: ...}). Path-traversal and process-launch surface is entirely client-controlled.",
    "file": "apps/mcp-server/src/server.ts:280-330",
    "fix": "Pin repoRoot/deepagentsjsRoot to the MCP server's repo root; only let the client choose outDir relative to repoRoot, and reject relative segments containing '..'. Whitelist script args."
  },
  {
    "severity": "high",
    "category": "Security/Crypto",
    "id": "ASST-2026-05-03-007",
    "description": "JWT secret has no minimum length/entropy. Any non-empty ASST_SESSION_SECRET is accepted; 3-character secrets (e.g. 'abc') are trivially brute-forceable. JWTs are signed via jose with HS256.",
    "file": "apps/web/lib/auth/session-secret.ts:1-8",
    "fix": "Require ≥32 raw bytes (or 64 hex chars). Throw at boot if too short. Document generation: `openssl rand -hex 32`."
  },
  {
    "severity": "high",
    "category": "Security/Webhook",
    "id": "ASST-2026-05-03-008",
    "description": "Helius webhook secret comparison uses string equality (timing-leaky) and accepts the secret in `?secret=` query param, which leaks into edge/proxy access logs.",
    "file": "apps/chain-intake/src/server.ts:32-39",
    "fix": "Use crypto.timingSafeEqual on Buffer.from. Drop the query-string fallback. Optionally verify Helius's HMAC signature header instead of a shared bearer."
  },
  {
    "severity": "high",
    "category": "Security/Sandboxing",
    "id": "ASST-2026-05-03-009",
    "description": "readFileTool resolves its root from process.env.ASST_REPO_ROOT — NOT from the Orchestrator(repoRoot) constructor argument. If the env var is unset, the tool falls back to process.cwd(); on Vercel serverless this is `/var/task` (entire deployment readable), and a misconfigured systemd unit could yield `/`.",
    "file": "packages/engine/src/tools/readonly.ts:13-21, apps/web/lib/engine-factory.ts:30-34",
    "fix": "Either (a) make readFileTool a closure bound to the orchestrator's repoRoot, or (b) have engine-factory.ts set process.env.ASST_REPO_ROOT = resolveRepoRoot() at module load if unset. Add a warn log when the fallback path is used."
  },
  {
    "severity": "high",
    "category": "Security/Input",
    "id": "ASST-2026-05-03-010",
    "description": "Public /api/scan accepts arbitrary body.target and forwards it into the orchestrator prompt. Free-tier scans can be spent on arbitrary target strings.",
    "file": "apps/web/app/api/scan/route.ts:36-39, 62",
    "fix": "Constrain target to a registered project id or a short slug; map to a server-side path. Reject paths containing '..' or absolute paths."
  },
  {
    "severity": "high",
    "category": "Reliability",
    "id": "ASST-2026-05-03-011",
    "description": "rateBuckets in apps/web/lib/api.ts is module-scoped, in-memory only. In multi-replica deployments per-IP limits become N× the configured rate. The Map also never evicts (memory leak)."
  ,
    "file": "apps/web/lib/api.ts:27, 146-177",
    "fix": "Use Redis-backed enforceIpRateLimit at the route level too (already exists for middleware). Add periodic eviction OR an LRU bound. Also use crypto.timingSafeEqual for ASST_WEB_API_KEY comparisons."
  },
  {
    "severity": "high",
    "category": "Security/MCP",
    "id": "ASST-2026-05-03-012",
    "description": "asst_solana_rpc_read accepts arbitrary JSON-RPC method names. If the configured SOLANA_RPC_URL allows it, sendTransaction / requestAirdrop could be invoked despite the 'read-only' label.",
    "file": "apps/mcp-server/src/server.ts:244-278",
    "fix": "Whitelist methods: getAccountInfo, getMultipleAccounts, getProgramAccounts, getSignaturesForAddress, getTransaction, getBalance, getTokenAccountsByOwner, getSlot, getBlockHeight, getEpochInfo, getInflationReward."
  },
  {
    "severity": "medium",
    "category": "Reliability",
    "id": "ASST-2026-05-03-013",
    "description": "Edge middleware fails open on Redis errors — any Redis outage silently lifts site-wide rate limits.",
    "file": "apps/web/middleware.ts:66-68",
    "fix": "Emit a metric/alert; degrade to a strict in-memory fallback (e.g. 10 req/min) instead of bypass. Add a SIGKILL-on-prolonged-failure circuit breaker for chronic outages."
  },
  {
    "severity": "medium",
    "category": "Security/Headers",
    "id": "ASST-2026-05-03-014",
    "description": "next.config.ts sets no security headers (no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS). Dashboard pages are clickjackable; XSS surface is wide-open.",
    "file": "apps/web/next.config.ts",
    "fix": "Add a headers() block with at minimum X-Frame-Options=DENY (or CSP frame-ancestors 'none'), X-Content-Type-Options=nosniff, Referrer-Policy=strict-origin-when-cross-origin, and an HSTS header in production."
  },
  {
    "severity": "medium",
    "category": "Security/Replay",
    "id": "ASST-2026-05-03-015",
    "description": "Deposit attribution does not track clientNonce. Uniqueness is only enforced on related_tx_sig, which is fine, but a wallet can re-use the same clientNonce across deposits with no signal. Combined with the price-validation gap (#002), this enables silent multi-credit fraud.",
    "file": "apps/chain-intake/src/credits-on-deposit.ts:160-194, apps/chain-intake/sql/003_billing.sql",
    "fix": "Add a unique index on (wallet, client_nonce) in credits_ledger.meta or a sibling table; reject duplicates."
  },
  {
    "severity": "medium",
    "category": "Reliability",
    "id": "ASST-2026-05-03-016",
    "description": "Nonce store falls back to in-memory Map when no Redis is configured. In multi-replica deployments, a SIWS challenge issued by replica A is not visible to replica B during verify, breaking sign-in for legitimate users (NOT a security issue — fails closed).",
    "file": "apps/web/lib/auth/nonce-store.ts",
    "fix": "Require Upstash Redis (or any shared store) in production. Throw at boot if NODE_ENV=production and no UPSTASH_* envs are set."
  },
  {
    "severity": "medium",
    "category": "DevX",
    "id": "ASST-2026-05-03-017",
    "description": "packages/engine/package.json pins typescript@^6.0.2 while apps/web pins ^5.7.0. As of 2026-05-03 TS 6.x is not stably released; pnpm install pulls a beta or fails depending on the registry.",
    "file": "packages/engine/package.json:39",
    "fix": "Align both packages to the latest stable TypeScript (5.x as of writing). When TS 6 ships GA, bump together with a verified upgrade pass."
  },
  {
    "severity": "low",
    "category": "Hardening",
    "id": "ASST-2026-05-03-018",
    "description": "findAsstMemoInTx walks every string in the tx object and matches the first ASST: substring. Already mitigated by the from===userWallet/treasury check, but defense in depth would only scan log messages and parsed memo instruction data.",
    "file": "apps/chain-intake/src/credits-on-deposit.ts:31-57"
  },
  {
    "severity": "low",
    "category": "Hardening",
    "id": "ASST-2026-05-03-019",
    "description": "Skills retrieval cache (.asst/skills-index.json) is JSON.parse'd and partially trusted. On a multi-tenant box a tenant could craft a poisoned cache pointing to off-root SKILL.md.",
    "file": "packages/engine/src/skills/retrieval.ts",
    "fix": "After parse, validate every entry.path resolves under skillsRoot."
  },
  {
    "severity": "low",
    "category": "Tests",
    "id": "ASST-2026-05-03-020",
    "description": "Engine has 5 tests for ~4.7 kLoC. No coverage of orchestrator routing, persistence, sub-agents, model-factory, mutating tools, or the docker sandbox. Web has 4 tests; billing routes (the most security-sensitive paths) have zero integration tests."
  ,
    "file": "packages/engine/src/__tests__, apps/web/lib/__tests__",
    "fix": "Add: (a) parseModelId fuzz tests with adversarial baseUrls, (b) /api/scan + /api/chat route tests for debit/refund/settle paths, (c) credits-on-deposit fixtures covering underpayment + nonce reuse."
  }
]
```

## Recommended fix order (one weekend → ship-blocker)

1. **Day 1 — kill exfil/fraud paths**
   - #001 SSRF: hardcode model allowlist in `createPublicOrchestrator`.
   - #002 Bundle fraud: add price check in `applyBillingDeposits`.
   - #003 SIWS domain: validate Domain line; pin via env `ASST_PUBLIC_HOST`.
   - #004 Scan race: persist run id, debit on settle from worker.
   - #005/#006 MCP path: bind every MCP tool to a single repo root.
   - #007 JWT length: require ≥32 bytes at boot.
2. **Day 2 — defense in depth**
   - #008–#012, #014 (timing-safe compares, security headers, RPC method allowlist, readFileTool root binding, target validation).
3. **Pre-launch — reliability + tests**
   - #013, #015–#017, #020.

## Pipeline (carry-over from 2026-04-12, still accurate)

```json
{
  "pipeline": {
    "ingestion_method": "webhook",
    "data_types": [
      "transactions",
      "program-logs",
      "account-state",
      "token-transfers"
    ],
    "storage": "postgresql",
    "backfill_implemented": true
  }
}
```

| Field | Value | Notes |
|-------|-------|-------|
| `pipeline.ingestion_method` | `webhook` | Helius webhook → HTTPS receiver in `apps/chain-intake`; idempotent writes by `(signature, slot)`. |
| `pipeline.data_types` | see JSON | Covers program-level alerts, state snapshots, and SPL movements. |
| `pipeline.storage` | `postgresql` | Query-friendly history + indexes; Redis optional for hot state / dedup. |
| `pipeline.backfill_implemented` | `true` | `pnpm run backfill` cursor table `pipeline_backfill_cursor`. |

> **Cross-DB FK note:** `credits_ledger.related_run_id` is `TEXT` because run ids live in SQLite (engine) while billing lives in Postgres. Document this and add a periodic reconciliation job that flags stale unsettled debits.

## Phase verdict

`ready_for_mainnet: false` — **must close all P0 (#001–#006) and P1 #007 before any public traffic touches a real treasury address**. The web SSRF/key-exfil and the bundle-fraud bug are independently sufficient reasons to block launch.

After P0/P1 fixes, recommended next phase skills:
- **`solana-vulnerability-scanner`** if/when on-chain `programs/` are added.
- **`qedgen`** for formal verification of the billing state machine (debit/settle/refund invariants are exactly the kind of conservation/one-shot properties machine-checked proofs catch best).
- **`deploy-to-mainnet`** for production deployment checklist (only after the verdict flips to true).

---

## Carry-over context (2026-04-12)

> The original `deepagentsjs/`-only review. Still relevant for upstream supply-chain hygiene.

- **Stack at 2026-04-12:** No on-chain code. `deepagentsjs/` TypeScript monorepo (LangGraph / LangChain Deep Agents), pnpm, Vitest, GitHub Actions.
- **Score at 2026-04-12:** Security **C**, Quality **B**, ready_for_mainnet **false**.
- **Findings carried forward:** `deepagentsjs/` pnpm overrides for `axios` and `langsmith` should remain pinned and re-audited on every dependency bump (`pnpm audit` was clean as of that date).
- **Manifest linkage:** `deepagentsjs/examples/assurance-run` records optional `chain_intelligence` on the v1 manifest.
