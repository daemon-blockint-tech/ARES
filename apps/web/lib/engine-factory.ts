/**
 * Engine factory for the Next.js web surface.
 *
 * The web app is **public**, so by default it must not expose tools that can
 * mutate the filesystem or spawn subprocesses, and it must NEVER let a remote
 * caller redirect LLM API calls to an attacker-controlled endpoint.
 *
 * All API routes call `createPublicOrchestrator()` and pass any user-supplied
 * `model` field through `sanitizeModelOption()` first.
 *
 * Audit fix #001 (SSRF / API-key exfiltration): the engine's model parser
 * accepts `<provider>:<model>@<baseUrl>` so an operator could route the
 * Authorization header (carrying the server's API key) to an arbitrary host.
 * `sanitizeModelOption` strips any `@<baseUrl>` suffix from caller input.
 *
 * Environment:
 *   ASST_WEB_ALLOW_WRITE   — explicit opt-in to mount mutating tools on the
 *                            web surface. Default: disabled.
 *   ASST_ORCHESTRATOR_MODEL — server-side default like "google:gemini-2.5-flash".
 *                            Server-side values are trusted and may include @<baseUrl>.
 *   ASST_MODEL_ALLOWLIST    — optional comma-separated list of provider:model
 *                            entries (no baseUrl) the public surface accepts
 *                            from clients. When set, anything outside the list
 *                            is replaced with the server-side default.
 */
import { Orchestrator } from "@ares/engine";
import { resolveRepoRoot } from "./paths";
import { sanitizeModelOption } from "./auth/sanitize-model";

export { sanitizeModelOption };

export interface PublicOrchestratorOptions {
  repoRoot?: string;
  /** Already passed through `sanitizeModelOption` by the route. */
  model?: string;
}

if (process.env.ASST_WEB_ALLOW_WRITE !== "1") {
  process.env.ASST_ALLOW_WRITE = "0";
}

export function createPublicOrchestrator(opts: PublicOrchestratorOptions = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  return new Orchestrator(repoRoot, { model: opts.model });
}
