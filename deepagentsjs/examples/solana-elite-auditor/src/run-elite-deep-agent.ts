/**
 * Single-shot Deep Agent run (Gemini + filesystem middleware from deepagents).
 * For full sub-agent swarm + skills retrieval, prefer: pnpm elite:orchestrator
 */
import "dotenv/config";
import { resolve } from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createEliteSolanaDeepAgent } from "./create-elite-deep-agent.js";
import { buildEliteAuditUserMessage } from "./elite-bootstrap-prompt.js";

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const extra = process.argv.slice(3).join(" ");

async function main() {
  if (!process.env.GOOGLE_API_KEY) {
    console.error(
      "GOOGLE_API_KEY is required for elite:deep (ChatGoogleGenerativeAI). " +
        "For full scans use apps/agent-py (POST /v1/scan) with your orchestrator model env vars.",
    );
    process.exit(1);
  }
  const agent = createEliteSolanaDeepAgent(repoRoot);
  const text = buildEliteAuditUserMessage(repoRoot, extra || undefined);
  const result = await agent.invoke({
    messages: [new HumanMessage(text)],
  });
  const last = result.messages?.at(-1);
  const content =
    typeof last?.content === "string"
      ? last.content
      : JSON.stringify(last?.content ?? result);
  console.log(content);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
