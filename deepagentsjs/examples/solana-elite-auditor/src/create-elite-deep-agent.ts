/**
 * Deep Agents harness without the retired `@ares/engine` tool belt.
 * For full tool parity use ``apps/agent-py`` + Hermes ``ares`` plugin.
 */
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createDeepAgent, type SubAgent } from "deepagents";

const ELITE_SYSTEM = `You are the ARES Elite Solana Auditor (Deep Agent harness, tools-lite).
Use filesystem tools to inspect Anchor/Rust sources. Full RPC + SARIF tooling lives in apps/agent-py.`;

export function createEliteSolanaDeepAgent(repoRoot: string) {
  const model = new ChatGoogleGenerativeAI({
    model: process.env.ASST_ELITE_DEEP_MODEL ?? "gemini-2.5-flash",
    temperature: 0.1,
  });

  const reader: SubAgent = {
    name: "repo-reader",
    description: "Reads and summarizes program sources under the repo root.",
    systemPrompt: "Use read_file and list_dir to inspect programs/, src/, Anchor.toml.",
    tools: [],
  };

  return createDeepAgent({
    name: "elite-solana-auditor",
    model,
    systemPrompt: `${ELITE_SYSTEM}\n\nRepo root: ${repoRoot}`,
    tools: [],
    subagents: [reader],
  });
}
