/**
 * SSRF mitigation for the user-supplied `model` parameter on /api/chat and
 * /api/scan (audit fix #001).
 *
 * The orchestrator model id accepts `<provider>:<model>@<baseUrl>`. Without
 * sanitization an attacker could supply
 *   `openai:gpt-4o-mini@https://attacker.example/v1`
 * and our server would happily forward its OpenAI API key (Authorization
 * header) to that host.
 *
 * This function strips any `@<baseUrl>` suffix and validates that what remains
 * looks like a sane `<provider>:<model>[:<variant>]` string. An optional
 * allowlist (`ASST_MODEL_ALLOWLIST=google:gemini-2.5-flash, openai:gpt-4o-mini`)
 * lets operators pin the public surface to exactly the models they pay for.
 *
 * Returns `undefined` when the input is missing or invalid — the agent service
 * then falls back to its server-side default. Returning `undefined` instead of
 * throwing is intentional: a malicious or mistyped `model` should silently
 * degrade, not DoS the route.
 *
 * This file is intentionally dependency-free so it can be unit tested without
 * pulling in heavy server-only dependencies. Import from ``@/lib/auth/sanitize-model``
 * in API routes.
 */

const MAX_LEN = 200;
const SHAPE_RE = /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_./-]+(?::[a-zA-Z0-9_./-]+)*$/;

export function sanitizeModelOption(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_LEN) return undefined;

  // Strip @<baseUrl> — the engine's parser splits on '@'. Even legitimate
  // public callers should never need to pick a baseUrl; that's a server-side
  // configuration, not a client capability.
  const atIdx = trimmed.indexOf("@");
  const stripped = atIdx === -1 ? trimmed : trimmed.slice(0, atIdx);

  if (!SHAPE_RE.test(stripped)) return undefined;

  // Optional allowlist gate.
  const allowlistRaw = process.env.ASST_MODEL_ALLOWLIST?.trim();
  if (allowlistRaw) {
    const allowed = new Set(
      allowlistRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (!allowed.has(stripped)) return undefined;
  }

  return stripped;
}
