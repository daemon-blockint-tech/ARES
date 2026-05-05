# Phase 10B — DPO / RL fine-tuning (optional)

This track is **out of scope** until **Track A** has accumulated enough labeled
feedback (plan gate: on the order of **≥ 1000** events in `kb_feedback`).

When ready, the pipeline should:

1. Export trajectories and `kb_preference_pairs` (or equivalent) to **ShareGPT**-style JSONL.
2. Run supervised fine-tuning (e.g. Qwen2.5-7B/32B) on instruction data, then **DPO** on collected pairs.
3. Serve with **vLLM** (or fallback to a commercial API) and A/B evaluate against the baseline model.

Operational scripts live under `apps/agent-py/scripts/` (`preference_distill.py` seeds preference pairs from feedback). Extend this runbook with infrastructure-specific steps when Phase 10B starts.
