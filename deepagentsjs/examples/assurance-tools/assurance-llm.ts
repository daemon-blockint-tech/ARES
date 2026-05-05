/**
 * OpenRouter + dotenv helpers for assurance-run smoke scripts.
 * (Legacy `@ares/engine` re-exports were removed — tools live in `apps/agent-py`.)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadDeepagentsEnv(): void {
  config({ path: path.resolve(__dirname, "../../.env") });
}

export function tryCreateAssuranceOpenRouterModel(opts?: {
  maxTokens?: number;
}): ChatOpenAI | null {
  if (!process.env.OPENROUTER_API_KEY) {
    return null;
  }
  return new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5",
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    maxTokens: opts?.maxTokens,
  });
}
