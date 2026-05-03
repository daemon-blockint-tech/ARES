/**
 * JWT signing secret resolver.
 *
 * Audit fix #007: previously this accepted any non-empty string, including a
 * single byte, so a misconfigured deployment would happily sign session JWTs
 * with a trivially guessable secret. We now require:
 *
 *   - 64-char hex (preferred) — exactly 32 bytes of entropy. Decoded.
 *   - any other string ≥32 chars — passed through as UTF-8 bytes.
 *
 * Anything shorter throws at first-call. Returning `null` is reserved for
 * "not configured at all" (e.g. local dev where the SIWS flow is disabled).
 *
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const MIN_SECRET_BYTES = 32;

export class WeakJwtSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakJwtSecretError";
  }
}

export function getJwtSecretBytes(): Uint8Array | null {
  const raw = process.env.ASST_SESSION_SECRET?.trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Uint8Array.from(Buffer.from(raw, "hex"));
  }

  if (raw.length < MIN_SECRET_BYTES) {
    throw new WeakJwtSecretError(
      `ASST_SESSION_SECRET is too short (${raw.length} chars). ` +
        `Provide either 64 hex chars or ≥${MIN_SECRET_BYTES} arbitrary chars. ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  return new TextEncoder().encode(raw);
}
