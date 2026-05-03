import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";

import { getPool } from "./db.js";
import { parseWebhookBody, upsertParsedTransactions } from "./ingest.js";

const webhookSecret = process.env.WEBHOOK_SHARED_SECRET?.trim();
if (process.env.NODE_ENV === "production" && !webhookSecret) {
  throw new Error("WEBHOOK_SHARED_SECRET is required in production");
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

function logInfo(event: string, meta: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", event, ...meta, at: new Date().toISOString() }));
}

function logError(event: string, meta: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", event, ...meta, at: new Date().toISOString() }));
}

/**
 * Constant-time secret comparison. Audit fix #008: the previous `===` check
 * leaked length and prefix bits via response timing. We also no longer accept
 * the secret via the `?secret=` query parameter, which previously leaked
 * into access logs and proxy logs.
 */
function checkBearerSecret(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue?.startsWith("Bearer ")) return false;
  const supplied = headerValue.slice(7);
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // timingSafeEqual throws on length mismatch; equalize first.
    return timingSafeEqual(b, b) && false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Helius Enhanced / Raw webhooks POST a JSON array of transactions.
 *
 * Note (audit #002): bundle-credit attribution from on-chain memos is no
 * longer applied here. Public-web billing is handled by mppx in apps/web,
 * which settles each /api/chat or /api/scan request inline. This webhook
 * only persists parsed transactions for analytics, scan-target discovery,
 * and trigger evaluation.
 *
 * @see https://www.helius.dev/docs/webhooks
 */
app.post("/webhooks/helius", async (c) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  const secret = webhookSecret;
  if (secret) {
    if (!checkBearerSecret(c.req.header("authorization"), secret)) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  let txs;
  try {
    txs = parseWebhookBody(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 400);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const { inserted, skipped, triggersInserted, triggerCounts } =
      await upsertParsedTransactions(client, txs, "webhook");

    logInfo("webhook_ingested", {
      requestId,
      received: txs.length,
      inserted,
      skipped,
      triggersInserted,
    });
    return c.json({
      ok: true,
      requestId,
      received: txs.length,
      inserted,
      skipped_duplicates: skipped,
      triggers: {
        inserted: triggersInserted,
        counts: triggerCounts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("webhook_ingest_failed", { requestId, message });
    return c.json({ error: "internal error", requestId }, 500);
  } finally {
    client.release();
  }
});

const port = Number(process.env.PORT ?? "8787");
serve({ fetch: app.fetch, port });
logInfo("server_started", { port, endpoint: "/webhooks/helius" });
