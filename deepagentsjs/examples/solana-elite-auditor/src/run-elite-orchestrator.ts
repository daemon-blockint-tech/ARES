/**
 * The legacy TypeScript `@ares/engine` orchestrator was retired in favor of
 * ``apps/agent-py`` (Hermes + FastAPI). Use the HTTP API from the monorepo
 * root or run ``uvicorn ares_plugin.api.main:app`` locally.
 */
console.error(
  "elite:orchestrator — @ares/engine was removed. Use apps/agent-py (POST /v1/scan, POST /v1/chat) instead.",
);
process.exit(1);
