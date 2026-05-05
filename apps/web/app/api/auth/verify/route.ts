import { buildSessionCookie } from "@/lib/auth/cookie";
import { createNonceStore } from "@/lib/auth/nonce-store";
import {
  extractExpirationFromSignedMessage,
  extractNonceFromSignedMessage,
} from "@/lib/auth/siws-message";
import { signSessionJwt } from "@/lib/auth/jwt";
import { verifyEd25519WalletSignature } from "@/lib/auth/verify-signature";
import { getBalanceUnits, upsertWalletFree } from "@/lib/billing/ledger";
import { getPool } from "@/lib/db/pool";
import { apiError, apiSuccess, getRequestId } from "@/lib/api";

export async function POST(req: Request) {
  const requestId = getRequestId(req);

  try {
    const body = await req.json();
    const address = typeof body?.address === "string" ? body.address.trim() : "";
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    const signedMessage =
      typeof body?.signedMessage === "string" ? body.signedMessage : "";

    if (!address || !signature || !signedMessage) {
      return apiError(requestId, "BAD_REQUEST", "address, signature, and signedMessage are required.", 400);
    }

    const exp = extractExpirationFromSignedMessage(signedMessage);
    if (!exp || exp.getTime() < Date.now()) {
      return apiError(requestId, "BAD_REQUEST", "Signed message expired.", 400);
    }

    const nonce = extractNonceFromSignedMessage(signedMessage);
    if (!nonce) {
      return apiError(requestId, "BAD_REQUEST", "Nonce missing from signed message.", 400);
    }

    // Verify signature BEFORE consuming the nonce so a malformed/wrong
    // signature attempt does not burn an otherwise-valid challenge — better
    // UX without weakening replay protection (the nonce TTL is still ≤5 min
    // and a valid sig requires the wallet's private key).
    const sigOk = verifyEd25519WalletSignature({
      walletAddressBase58: address,
      messageUtf8: signedMessage,
      signatureBase58: signature,
    });
    if (!sigOk) {
      return apiError(requestId, "UNAUTHORIZED", "Signature verification failed.", 401);
    }

    const consumed = await createNonceStore().consume(nonce);
    if (!consumed) {
      return apiError(requestId, "BAD_REQUEST", "Invalid or reused nonce.", 400);
    }

    // The credits ledger (Postgres) is optional infrastructure. SIWS identity
    // does not depend on it — without DATABASE_URL we still mint a session,
    // we just default to tier=free / balanceUnits=0.
    const pool = getPool();
    let balanceUnits = 0;
    if (pool) {
      try {
        await upsertWalletFree(pool, address);
        balanceUnits = await getBalanceUnits(pool, address);
      } catch (dbErr) {
        // Ledger unavailable (schema not migrated, transient outage). Don't
        // block sign-in; the user can still authenticate and use free-tier.
        console.warn(
          "[auth/verify] ledger unavailable, signing in as free-tier",
          dbErr,
        );
      }
    }
    const tier: "free" | "paid" = balanceUnits > 0 ? "paid" : "free";

    const ttlDays = Number.parseInt(process.env.ASST_SESSION_TTL_DAYS?.trim() || "30", 10);
    const token = await signSessionJwt({ sub: address, tier }, Number.isFinite(ttlDays) ? ttlDays : 30);
    if (!token) {
      return apiError(
        requestId,
        "INTERNAL_ERROR",
        "Sign-in is not configured: set ASST_SESSION_SECRET (64 hex chars).",
        500,
      );
    }

    const maxAgeSec = (Number.isFinite(ttlDays) ? ttlDays : 30) * 86400;
    const res = apiSuccess(requestId, {
      wallet: address,
      tier,
      balanceUnits,
    });
    res.headers.append("Set-Cookie", buildSessionCookie(token, maxAgeSec));
    return res;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(requestId, "INTERNAL_ERROR", "Verification failed.", 500, msg);
  }
}
