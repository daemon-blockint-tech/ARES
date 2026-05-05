/**
 * /api/scan — pay-per-run security scan.
 *
 * Identity-then-pay:
 *   1. authenticateIngress + IP rate limit
 *   2. operator key bypass (internal automation)
 *   3. SIWS session required for non-operator (anonymous scans are NOT free)
 *   4. wallet rate limit
 *   5. consume "free scan per month" wallet quota — if available, run for free
 *   6. else: mppx.charge({ amount: $0.10 }) — one-time payment, all 5 methods
 *
 * The scan itself runs as a background promise; we return `queued` once
 * payment settles and the run kicks off. Audit finding #004 (race between
 * 200 and actual scan completion) is no longer a billing concern because
 * mppx settles BEFORE this code runs — the only remaining concern is
 * operational (a scan starts and crashes mid-run), which is logged and
 * eligible for manual refund. That's acceptable for the price point.
 */
import {
  apiError,
  apiSuccess,
  authenticateIngress,
  enforceRateLimit,
  getClientIp,
} from "@/lib/api";
import { readWalletSession } from "@/lib/auth/read-session";
import { consumeWalletFreeScan } from "@/lib/billing/quota";
import { agentPyPostJson, defaultRepoPayload } from "@/lib/agentpy-client";
import { getPool } from "@/lib/db/pool";
import { sanitizeModelOption } from "@/lib/auth/sanitize-model";
import { getMppx, scanPaymentEntries } from "@/lib/payments/mppx";
import { enforceWalletRateLimit } from "@/lib/ratelimit/wallet";

interface ScanBody {
  target?: unknown;
  model?: unknown;
}

const TARGET_MAX_LEN = 256;
// Conservative: only allow paths or simple identifiers. No URLs, no shell
// metachars. Matches the docs' assumption that `target` is a workspace-relative
// path or "." for the whole repo.
const TARGET_RE = /^[A-Za-z0-9_./@-]+$/;

function validateTarget(raw: string | undefined): string | null {
  if (raw === undefined) return ".";
  if (raw.length === 0 || raw.length > TARGET_MAX_LEN) return null;
  if (!TARGET_RE.test(raw)) return null;
  // No path traversal — allow ./ but block ../
  if (raw.includes("..")) return null;
  return raw;
}

async function enqueueScan(
  target: string,
  model: string | undefined,
): Promise<{ run_id: string } | null> {
  try {
    return await agentPyPostJson<{ run_id: string }>("/v1/scan", {
      target,
      model,
      ...defaultRepoPayload(),
    });
  } catch (err) {
    console.error("[/api/scan] agent-py enqueue failed:", err);
    return null;
  }
}

export async function POST(req: Request) {
  const ingress = authenticateIngress(req);
  if (!ingress.ok) return ingress.response;
  const { requestId, operator } = ingress;

  const rate = enforceRateLimit(
    req,
    requestId,
    operator ? "op:scan" : "pub:scan",
    operator ? 60 : 10,
  );
  if (!rate.ok) return rate.response;

  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return apiError(requestId, "BAD_REQUEST", "JSON body required.", 400);
  }

  const targetRaw = typeof body.target === "string" ? body.target : undefined;
  const target = validateTarget(targetRaw);
  if (target === null) {
    return apiError(
      requestId,
      "BAD_REQUEST",
      "Invalid `target`: expected a workspace-relative path or '.' (no '..', no shell metachars, ≤256 chars).",
      400,
    );
  }

  const model = sanitizeModelOption(typeof body.model === "string" ? body.model : undefined);

  const ip = getClientIp(req);

  if (operator) {
    const q = await enqueueScan(target, model);
    return apiSuccess(requestId, {
      status: "queued",
      target,
      run_id: q?.run_id ?? null,
      timestamp: new Date().toISOString(),
      billing: "operator",
    });
  }

  const session = await readWalletSession(req);
  if (!session) {
    return apiError(
      requestId,
      "FORBIDDEN",
      "Scans require a Solana wallet session. Sign in via /api/auth/challenge first.",
      403,
    );
  }

  const wl = await enforceWalletRateLimit(session.sub);
  if (!wl.ok) {
    return apiError(
      requestId,
      "RATE_LIMITED",
      `Wallet rate limit exceeded. Retry after ${wl.retrySec}s.`,
      429,
    );
  }

  const pool = getPool();

  // Try free monthly quota first — paid customers and free-tier alike.
  const freeOk = await consumeWalletFreeScan(pool, session.sub, ip);
  if (freeOk) {
    const q = await enqueueScan(target, model);
    return apiSuccess(requestId, {
      status: "queued",
      target,
      run_id: q?.run_id ?? null,
      timestamp: new Date().toISOString(),
      billing: "free_wallet",
    });
  }

  // Free quota exhausted → mppx multi-method charge gate. Each registered
  // method (Tempo, Stripe, Lightning, Solana) is presented as a parallel
  // 402 offer; the client picks whichever rail it can pay.
  const { mppx } = getMppx();
  const entries = scanPaymentEntries();
  if (entries.length === 0) {
    // Dev mode with no payment env configured — surface a clear error
    // rather than crashing inside Mppx.compose.
    return apiError(
      requestId,
      "INTERNAL_ERROR",
      "No payment methods configured. Set ASST_TEMPO_RECIPIENT, STRIPE_SECRET_KEY, LIGHTNING_MNEMONIC, or ASST_SOLANA_RECIPIENT.",
      503,
    );
  }
  const result = await mppx.compose(...entries)(req);

  if (result.status === 402) {
    return result.challenge;
  }

  const q = await enqueueScan(target, model);
  const ok = apiSuccess(requestId, {
    status: "queued",
    target,
    run_id: q?.run_id ?? null,
    timestamp: new Date().toISOString(),
    billing: "mppx_charge",
  });
  return result.withReceipt(ok);
}
