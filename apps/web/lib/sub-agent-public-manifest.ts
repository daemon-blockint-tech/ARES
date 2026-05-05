/**
 * Public sub-agent list for HTTP/UI (no LangChain / Hermes imports).
 * Keep in sync with ``apps/agent-py/src/ares_plugin/sub_agents.py``.
 */
export type SubAgentPublicEntry = {
  name: string;
  description: string;
  primaryModel: string;
};

export const SUB_AGENT_PUBLIC_LIST: readonly SubAgentPublicEntry[] = [
  {
    name: "solana_vulnerability_analyst",
    description:
      "Analyzes Solana program code for vulnerabilities: Anchor constraints, PDA seeds, signer checks, CPI boundaries, oracle dependencies.",
    primaryModel: "google:gemini-2.0-flash",
  },
  {
    name: "defi_security_auditor",
    description:
      "Audits DeFi protocols for admin takeover vectors, upgrade authority risks, flash loan patterns, governance centralization.",
    primaryModel: "google:gemini-2.0-flash",
  },
  {
    name: "rug_pull_detector",
    description:
      "Detects rug pull patterns: liquidity lock verification, LP distribution, transfer restrictions, dev wallet clustering.",
    primaryModel: "openrouter:nvidia/nemotron-nano-9b-v2:free",
  },
  {
    name: "secret_hygiene_scanner",
    description:
      "Scans repositories for hardcoded secrets, environment hygiene issues, and git history leaks.",
    primaryModel: "openrouter:nvidia/nemotron-nano-9b-v2:free",
  },
  {
    name: "supply_chain_analyst",
    description:
      "Analyzes dependency supply chain: npm audit, static analysis, SARIF output, vulnerability manifests.",
    primaryModel: "openrouter:openai/gpt-oss-20b:free",
  },
  {
    name: "report_synthesizer",
    description:
      "Synthesizes findings from all sub-agents into a professional security report with severity ratings and remediation advice.",
    primaryModel: "google:gemini-2.5-flash",
  },
];
