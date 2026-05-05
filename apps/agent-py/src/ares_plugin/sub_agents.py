"""Sub-agent configs (prompts + tool allowlists) — ported from the legacy TS engine."""

from __future__ import annotations

from dataclasses import dataclass

KB_ACCESS_SECTION = """
## Knowledge base (Track A) — mandatory workflow
Before asserting a vulnerability against real-world precedent:
1. Call ``kb_lookup_attack_vector`` for the closest attack class.
2. Call ``kb_find_exemplars`` with a short representative code snippet + language.
3. Call ``kb_search_cve`` for related CVE/CWE descriptions.
4. If no rows return, write explicitly **"no matching CVE precedent found"** — never invent CVE IDs.
5. After you cite KB rows in reasoning, call ``kb_log_retrieval`` with run/finding identifiers when provided in the task envelope.
"""


@dataclass(frozen=True)
class SubAgentSpec:
    name: str
    description: str
    primary_model: str
    system_prompt: str
    tool_names: tuple[str, ...]


def _skills_hint(skill_names: tuple[str, ...]) -> str:
    return "Pinned skills: " + ", ".join(skill_names)


SUB_AGENTS: dict[str, SubAgentSpec] = {
    "solana_vulnerability_analyst": SubAgentSpec(
        name="solana_vulnerability_analyst",
        description="Analyzes Solana program code for vulnerabilities.",
        primary_model="google:gemini-2.0-flash",
        system_prompt=(
            "You are the Solana Vulnerability Analyst sub-agent. "
            "Analyze Solana programs for security issues using tools.\n"
            + KB_ACCESS_SECTION
            + "\n"
            + _skills_hint(
                (
                    "solana-defi-vulnerability-analyst-agent",
                    "sealevel-attacks-solana",
                    "neodyme-solana-security-workshop",
                )
            )
        ),
        tool_names=(
            "read_file",
            "solana_rpc_read",
            "anchor_source_scanner",
            "secret_scanner",
            "run_semgrep",
            "kb_lookup_attack_vector",
            "kb_find_exemplars",
            "kb_search_cve",
            "kb_log_retrieval",
        ),
    ),
    "defi_security_auditor": SubAgentSpec(
        name="defi_security_auditor",
        description="Audits DeFi protocols for admin takeover and upgrade risks.",
        primary_model="google:gemini-2.0-flash",
        system_prompt="You are the DeFi Security Auditor sub-agent. Focus on privileged roles, upgrades, and CPI risk.\n"
        + _skills_hint(("defi-security-audit-agent", "defi-admin-takeover-mitigation-lessons", "flash-loan-exploit-investigator-agent")),
        tool_names=("read_file", "solana_rpc_read", "cpi_graph_mapper", "program_upgrade_monitor", "account_state_snapshot"),
    ),
    "rug_pull_detector": SubAgentSpec(
        name="rug_pull_detector",
        description="Detects rug pull style patterns.",
        primary_model="openrouter:nvidia/nemotron-nano-9b-v2:free",
        system_prompt="You are the Rug Pull Detector sub-agent.\n"
        + _skills_hint(("rug-pull-pattern-detection-agent", "honeypot-detection-techniques")),
        tool_names=("solana_rpc_read", "account_state_snapshot", "token_concentration_analyzer"),
    ),
    "secret_hygiene_scanner": SubAgentSpec(
        name="secret_hygiene_scanner",
        description="Scans for secrets and env hygiene issues.",
        primary_model="openrouter:nvidia/nemotron-nano-9b-v2:free",
        system_prompt="You are the Secret & Hygiene Scanner sub-agent.\n"
        + _skills_hint(("on-chain-investigator-agent", "osec-solana-auditor-introduction")),
        tool_names=("secret_scanner", "env_hygiene_check", "git_diff_summary"),
    ),
    "supply_chain_analyst": SubAgentSpec(
        name="supply_chain_analyst",
        description="Supply chain and static analysis manifests.",
        primary_model="openrouter:openai/gpt-oss-20b:free",
        system_prompt="You are the Supply Chain Analyst sub-agent.\n"
        + _skills_hint(("blockchain-intelligence-fundamentals", "blockchain-analytics-operations")),
        tool_names=("run_semgrep", "merge_findings", "write_assurance_manifest", "git_diff_summary"),
    ),
    "report_synthesizer": SubAgentSpec(
        name="report_synthesizer",
        description="Synthesizes findings into an executive-style report.",
        primary_model="google:gemini-2.5-flash",
        system_prompt=(
            "You are the Report Synthesizer sub-agent. "
            "Turn raw scanner output into a structured assessment. "
            "Do not claim CVE IDs unless they appeared in upstream tool JSON.\n"
            + _skills_hint(("blockchain-intelligence-playbook", "cmichel-smart-contract-auditor-guide"))
            + "\nYou may call KB tools to sanity-check cited weaknesses."
        ),
        tool_names=(
            "unified_posture_report",
            "generate_pdf_report",
            "kb_search_cve",
            "kb_find_exemplars",
            "kb_lookup_attack_vector",
            "kb_log_retrieval",
        ),
    ),
}

SUB_AGENT_PUBLIC_LIST = [
    {"name": s.name, "description": s.description, "primaryModel": s.primary_model}
    for s in SUB_AGENTS.values()
]
