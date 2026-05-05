/**
 * /api/chat — pay-per-request LLM exchange.
 *
 * Identity-then-pay flow:
 *   1. authenticateIngress + IP rate limit (anti-abuse, free + paid alike)
 *   2. operator key (ASST_WEB_API_KEY): bypass payment + quota — internal
 *   3. SIWS session present:
 *        a. wallet rate limit
 *        b. consume "free chat per day" quota — if available, run for free
 *        c. else: mppx.session({ amount: $0.01 }) — Tempo voucher channel
 *   4. anonymous:
 *        a. consume anon-daily IP quota — if available, run for free
 *        b. else: mppx.session — same paywall
 *
 * Replaces the prepaid bundle/ledger flow. Settlement is enforced by mppx
 * before our handler runs, so there is no race where a 200 ships without
 * actual payment (audit finding #004).
 *
 * Tempo session intent is used here because chat is high-frequency and
 * sub-cent; off-chain vouchers eliminate the per-request blockchain hop.
 * Stripe / Lightning / Solana methods only support `charge`, so a client
 * that doesn't speak Tempo session will see a 402 advertising those rails
 * via /api/chat/charge (sibling route).
 */
import {
  apiError,
  apiSuccess,
  authenticateIngress,
  enforceRateLimit,
  getClientIp,
} from "@/lib/api";
import { readWalletSession } from "@/lib/auth/read-session";
import { consumeAnonChatQuota, consumeWalletFreeChat } from "@/lib/billing/quota";
import { agentPyPostJson, defaultRepoPayload } from "@/lib/agentpy-client";
import { getPool } from "@/lib/db/pool";
import { sanitizeModelOption } from "@/lib/auth/sanitize-model";
import { chatPaymentEntries, getMppx } from "@/lib/payments/mppx";
import { enforceWalletRateLimit } from "@/lib/ratelimit/wallet";

interface ChatBody {
  prompt?: unknown;
  model?: unknown;
}

async function runChat(prompt: string, model: string | undefined): Promise<unknown> {
  const res = await agentPyPostJson<{ reply: string }>("/v1/chat", {
    prompt,
    model,
    ...defaultRepoPayload(),
  });
  return res.reply;
}

export async function POST(req: Request) {
  const ingress = authenticateIngress(req);
  if (!ingress.ok) return ingress.response;
  const { requestId, operator } = ingress;

  const rate = enforceRateLimit(
    req,
    requestId,
    operator ? "op:chat" : "pub:chat",
    operator ? 120 : 30,
  );
  if (!rate.ok) return rate.response;

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return apiError(requestId, "BAD_REQUEST", "JSON body required.", 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    return apiError(requestId, "BAD_REQUEST", "Prompt is required.", 400);
  }
  if (prompt.length > 32_000) {
    return apiError(requestId, "BAD_REQUEST", "Prompt exceeds 32k char limit.", 400);
  }

  // SSRF mitigation (audit #001): never let user pick @<baseUrl>.
  const model = sanitizeModelOption(typeof body.model === "string" ? body.model : undefined);

  const ip = getClientIp(req);

  // Operator bypass — automation and ops scripts only.
  if (operator) {
    try {
      const result = await runChat(prompt, model);
      return apiSuccess(requestId, { response: result, billing: "operator" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[/api/chat] operator path error:", error);
      return apiError(requestId, "INTERNAL_ERROR", "ARES engine failure.", 500, msg);
    }
  }

  const session = await readWalletSession(req);
  const pool = getPool();

  // SIWS path — wallet-bound free quota first, then 402.
  if (session) {
    const wl = await enforceWalletRateLimit(session.sub);
    if (!wl.ok) {
      return apiError(
        requestId,
        "RATE_LIMITED",
        `Wallet rate limit exceeded. Retry after ${wl.retrySec}s.`,
        429,
      );
    }

    const freeOk = await consumeWalletFreeChat(pool, session.sub, ip);
    if (freeOk) {
      try {
        const result = await runChat(prompt, model);
        return apiSuccess(requestId, { response: result, billing: "free_wallet" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[/api/chat] free-wallet path error:", error);
        return apiError(requestId, "INTERNAL_ERROR", "ARES engine failure.", 500, msg);
      }
    }
    // Free quota exhausted → fall through to mppx.session 402.
  } else {
    // Anonymous path — IP-scoped daily preview, then 402.
    const anonOk = await consumeAnonChatQuota(pool, ip);
    if (anonOk) {
      try {
        const result = await runChat(prompt, model);
        return apiSuccess(requestId, { response: result, billing: "free_anon" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[/api/chat] anon path error:", error);
        return apiError(requestId, "INTERNAL_ERROR", "ARES engine failure.", 500, msg);
      }
    }
    // Anon preview exhausted → 402 (clients can sign in or pay directly).
  }

  // mppx pay-per-request gate. Tempo session is the cheapest rail; if it
  // isn't configured (no signing key), we fall back to whatever charge rails
  // are available so the route still works.
  const { mppx } = getMppx();
  const entries = chatPaymentEntries();
  if (entries.length === 0) {
    return apiError(
      requestId,
      "INTERNAL_ERROR",
      "No payment methods configured. Set ASST_TEMPO_RECIPIENT, STRIPE_SECRET_KEY, LIGHTNING_MNEMONIC, or ASST_SOLANA_RECIPIENT.",
      503,
    );
  }
  const result = await mppx.compose(...entries)(req);

  if (result.status === 402) {
    // mppx returns a fully-formed 402 Response (WWW-Authenticate header set).
    // We pass it through verbatim — clients understand the protocol envelope.
    return result.challenge;
  }

  // Payment verified. Run the handler and attach the receipt.
  try {
    const out = await runChat(prompt, model);
    const ok = apiSuccess(requestId, { response: out, billing: "mppx_session" });
    return result.withReceipt(ok);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[/api/chat] paid path error:", error);
    // Important: payment was already settled by mppx. The handler can still
    // fail — that's an operational refund concern, surfaced in logs.
    return apiError(
      requestId,
      "INTERNAL_ERROR",
      "ARES engine failed after payment. Contact support with this requestId for refund.",
      500,
      msg,
    );
  }
}
