# Elite Solana Auditor (ARES / ASST + Deep Agents)

This example packages **two** ways to run an “elite” Solana-oriented assurance pass over a repository:

| Entry | Command | When to use |
|--------|---------|-------------|
| **Orchestrator (retired here)** | `pnpm elite:orchestrator -- <repo>` | Exits with a pointer to **`apps/agent-py`** (`POST /v1/scan`, `POST /v1/chat`) for the full multi-agent + SARIF + PDF parity path. |
| **Deep Agent harness** | `pnpm elite:deep -- <repo>` | **deepagents** + Gemini filesystem shell for quick repo reads — **not** a substitute for the Python assurance toolbelt. |

Both paths share the same **bootstrap intent** (`src/elite-bootstrap-prompt.ts`): protocol-specific Solana reasoning, evidence-first findings, and explicit handoff to reporting/PDF when data exists.

## Product workflow (operator-facing)

Aligned with the same narrative you would use in a commercial scanner ([Trident Arena](https://tridentarena.xyz/#benchmarks)–style “connect → analyze → report → ship”):

1. **Connect your Solana program** — Point the runner at the Git root (local clone). Set `SOLANA_RPC_URL` if on-chain tools should run.
2. **AI analyzes your code** — Orchestrator delegates to `solana_vulnerability_analyst`, `defi_security_auditor`, `rug_pull_detector`, `secret_hygiene_scanner`, `supply_chain_analyst`, then `report_synthesizer`.
3. **Get your report** — Structured posture (`unified_posture_report`) and optional **PDF** (`generate_pdf_report`) under `.asst/reports/` (or engine fallbacks).
4. **Ship safer, faster** — Triage by severity; use human audit for novel logic and Token-2022 edge cases (see limitations in `ELITE-SOLANA-AUDITOR.md`).

## Setup

From **`deepagentsjs/`** (this monorepo):

```bash
pnpm install
pnpm --filter @asst/solana-elite-auditor elite:orchestrator -- /path/to/anchor/repo
```

**Production scans:** configure models and secrets in `apps/agent-py` + root `.env.local` (`AGENT_PY_URL`, provider keys, etc.).

**Deep harness env:** `GOOGLE_API_KEY` required; optional `ASST_ELITE_DEEP_MODEL` (default `gemini-2.5-flash`).

```bash
pnpm --filter @asst/solana-elite-auditor elite:deep -- /path/to/anchor/repo
```

## How this relates to the ARES whitepaper

The IEEE-style ARES draft you maintain (multi-agent coordination, spatio-temporal memory, dataset/LoRA themes) is the **research story**; this folder is a **Deep Agents** engineering sketch — production orchestration lives in **`apps/agent-py`**.

## References (defensive / research)

- [Agentic Property-Based Testing](https://github.com/mmaaz-git/agentic-pbt) — agent-driven properties + Hypothesis; use as **follow-up testing** ideas, not a substitute for review.
- [Anthropic — AI for critical infrastructure defense](https://red.anthropic.com/2026/critical-infrastructure-defense/) — defensive emulation and lab partnerships.
- [Anthropic — LLM cyber toolkits (Incalmo)](https://red.anthropic.com/2025/cyber-toolkits/) — toolkits lowering friction for **both** attack and defense; motivates strong guardrails and scoped tools.
- [Anthropic — LLM-discovered 0-days](https://red.anthropic.com/2026/zero-days/) — validation burden and disclosure velocity; keep **human review** in the loop.
- [SCONE-bench](https://github.com/safety-research/SCONE-bench) — smart-contract exploitation benchmark context (methodology discipline).
- [Trail of Bits pajaMAS](https://github.com/trailofbits/pajaMAS) — MAS hijacking demos; informs **tool and prompt injection** awareness for agentic audits.
- [Solana security resource list (solsec)](https://github.com/sannykim/solsec)
- [Solanaizer sample](https://github.com/solanaizer/solanaizer-sample-project) — CI-oriented AI audit patterns.
- [Awesome Solana AI](https://github.com/Ackee-Blockchain/awesome-solana-ai) — ecosystem map.

## Competitive notes (non-exhaustive)

| Offering | Positioning |
|----------|-------------|
| [Hashlock AI Audit](https://aiaudit.hashlock.com/) | Upload / URL / GitHub triage; good for quick Solidity-oriented scans. |
| [Trident Arena](https://tridentarena.xyz/#benchmarks) | Multi-agent Solana focus; benchmark-oriented marketing. |
| **ARES / ASST** | **Repo-bound manifests**, merged SARIF lanes, **agent-py** tool contracts, optional **Deep Agents** harness, and integration with the rest of the ARES monorepo (web + chain-intake). |

## Benchmark framework (Trident-style)

Untuk kurasi 20–30 kasus terverifikasi, metrik Precision/Recall/Speed, dan template tabel TP/FP/Detection rate, lihat [`docs/AI-SECURITY-BENCHMARK-FRAMEWORK-ID.md`](../../docs/AI-SECURITY-BENCHMARK-FRAMEWORK-ID.md) (Bahasa Indonesia, default ekosistem Solana).

## Files

| File | Role |
|------|------|
| `ELITE-SOLANA-AUDITOR.md` | Auditor rubric (Sealevel-specific). |
| `SFC-CONTROL-MAP.md` | Maps Security Alliance–style control themes to assurance activities. |
| `AGENTS.md` | Long-lived context for agents / memory middleware. |
