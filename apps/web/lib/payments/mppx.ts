/**
 * Central mppx configuration for the public web surface.
 *
 * This module replaces the prepaid-bundle credit-ledger flow that previously
 * gated /api/chat and /api/scan. Instead of holding a balance in Postgres,
 * we serve an HTTP 402 challenge per paid request and let the client present
 * a Credential via mppx — settled before our route handler runs.
 *
 * Methods registered, gated by env presence:
 *   - tempo.charge — receive-only, only ASST_TEMPO_RECIPIENT required
 *   - tempo.session — additionally requires ASST_TEMPO_ACCOUNT_PRIVATE_KEY
 *                     because session vouchers settle on-chain via a server
 *                     signature
 *   - stripe.charge — cards (Visa, MC, Amex, etc.)
 *   - spark.charge — Lightning Bitcoin
 *   - solana.charge — native SOL or SPL tokens (USDC by default)
 *
 * Env contract:
 *   MPP_SECRET_KEY                       — required (≥32 chars). HMAC for Challenge binding.
 *   ASST_TEMPO_RECIPIENT                 — recipient EVM address. Required for Tempo.
 *   ASST_TEMPO_ACCOUNT_PRIVATE_KEY       — 0x-hex private key, enables Tempo session.
 *                                          Optional. Without it, only charge is offered.
 *   ASST_TEMPO_CURRENCY                  — token contract. Defaults to PathUSD.
 *   ASST_TEMPO_TESTNET                   — "true" (default) or "false" for mainnet.
 *   STRIPE_SECRET_KEY                    — sk_live_... or sk_test_..., enables Stripe.
 *   LIGHTNING_MNEMONIC                   — Spark wallet mnemonic, enables Lightning.
 *   ASST_SOLANA_RECIPIENT                — base58 wallet, enables Solana.
 *   ASST_SOLANA_CURRENCY                 — SPL mint (USDC default) or omit for SOL.
 *   ASST_SOLANA_DECIMALS                 — defaults to 6 for USDC.
 *   ASST_SOLANA_NETWORK                  — "mainnet-beta" | "devnet" | "localnet".
 *
 * In NODE_ENV=production, at least one method MUST be configured; otherwise
 * the module throws at first import. In development, an unconfigured server
 * falls through to a synthetic in-memory secret and zero registered methods,
 * which means /api/chat and /api/scan will always 402 — explicit, not silent.
 */

import crypto from "node:crypto";
import { Mppx, tempo, stripe as stripeMethod } from "mppx/server";

/**
 * Pricing schedule. Keep in sync with copy in app/dashboard/billing UI.
 */
export const MPPX_PRICING = {
  chat: {
    amount: "0.01",
    currency: "usd",
    decimals: 2,
    description: "ARES /api/chat — single LLM exchange",
    unitType: "request" as const,
  },
  scan: {
    amount: "0.10",
    currency: "usd",
    decimals: 2,
    description: "ARES /api/scan — full security scan run",
  },
} as const;

/**
 * Result envelope returned by every mppx route handler. Either the request
 * had no/invalid Payment credential and we hand back the 402 challenge to
 * the client, or settlement happened and we get a `withReceipt` wrapper to
 * stamp the success response with a `Payment-Receipt` header.
 */
export type MppxResult =
  | { status: 402; challenge: Response; withReceipt?: never }
  | { status: 200; challenge?: never; withReceipt: (response: Response) => Response };

/**
 * Narrow structural interface over what we actually call on the Mppx instance.
 *
 * The full `Mppx<methods>` generic depends on `FlattenMethods<methods>` to
 * infer the precise tuple of registered methods so it can synthesize
 * shorthand keys like `mppx.charge` or `mppx.session`. Because we register
 * methods conditionally based on env vars, TypeScript can never narrow
 * `methods` to a literal tuple, so those shorthands collapse to `never`.
 *
 * Rather than fight inference, we route every paid endpoint through
 * `mppx.compose(['name/intent', opts], ...)` — which works at runtime for
 * any number of methods (1..N) and makes the mixed-method case (multiple
 * `charge` rails) trivial. The string-keyed compose entry form is permitted
 * by the runtime regardless of how methods were inferred.
 */
export interface MppxGateway {
  compose: (
    ...entries: ReadonlyArray<readonly [string, unknown]>
  ) => (request: Request) => Promise<MppxResult>;
}

/**
 * Returns the mppx HMAC secret. In production we require a real one; in dev
 * we derive a stable per-process value so hot reloads don't invalidate
 * Challenges mid-session.
 */
function resolveMppxSecret(): string {
  const raw = process.env.MPP_SECRET_KEY?.trim();
  if (raw && raw.length >= 32) return raw;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MPP_SECRET_KEY is required in production and must be at least 32 chars. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Dev: deterministic-per-host fallback so reloads share state
  const seed = `asst-dev-mpp-${process.env.HOSTNAME ?? "local"}`;
  return crypto.createHash("sha256").update(seed).digest("base64");
}

interface BuildResult {
  mppx: MppxGateway;
  enabledMethods: string[];
  warnings: string[];
}

/**
 * Constructs Mppx with whichever methods env permits. Missing optional
 * SDKs (Lightning, Solana) are tolerated with a warning so the rest of
 * the routes can keep working.
 *
 * `methods` is typed as `unknown[]` because each registration helper
 * returns a different shape (tempo() returns a tuple of two methods,
 * stripe.charge() returns a single method, etc.) and we need a single
 * mutable accumulator. The cast at `Mppx.create({ methods })` is sound
 * because the runtime only inspects each entry's `name`/`intent` shape,
 * which all of these helpers produce.
 */
function build(): BuildResult {
  // Validate the secret key first — independent of method registration so a
  // misconfigured production env throws on the secret, not on a downstream
  // method's signing requirement.
  const secretKey = resolveMppxSecret();

  const methods: unknown[] = [];
  const enabledMethods: string[] = [];
  const warnings: string[] = [];

  // Tempo — first-class, the only method that supports session intent today.
  // We register `tempo.charge` whenever a recipient is set; full `tempo()`
  // (charge + session) is only registered when a signing private key is
  // also provided, because session vouchers settle on-chain via a server
  // signature on channel close.
  const tempoRecipient = process.env.ASST_TEMPO_RECIPIENT?.trim();
  const tempoAccountKey = process.env.ASST_TEMPO_ACCOUNT_PRIVATE_KEY?.trim();
  if (tempoRecipient) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(tempoRecipient)) {
      warnings.push(
        "ASST_TEMPO_RECIPIENT is not a valid 0x-prefixed 40-hex EVM address; skipping Tempo.",
      );
    } else {
      const baseParams = {
        testnet: process.env.ASST_TEMPO_TESTNET !== "false",
        currency: (process.env.ASST_TEMPO_CURRENCY?.trim() ??
          "0x20c0000000000000000000000000000000000000") as `0x${string}`,
        recipient: tempoRecipient as `0x${string}`,
      } as const;

      if (tempoAccountKey) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(tempoAccountKey)) {
          warnings.push(
            "ASST_TEMPO_ACCOUNT_PRIVATE_KEY is not a valid 0x-prefixed 64-hex private key; falling back to charge-only.",
          );
          methods.push(tempo.charge(baseParams));
          enabledMethods.push("tempo.charge");
        } else {
          try {
            // Lazy require viem so envs that never enable session don't pay
            // its bundle cost. viem is already a transitive dep of mppx.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { privateKeyToAccount } = require("viem/accounts");
            const account = privateKeyToAccount(tempoAccountKey as `0x${string}`);
            methods.push(tempo({ ...baseParams, account }));
            enabledMethods.push("tempo.charge");
            enabledMethods.push("tempo.session");
          } catch (err) {
            warnings.push(
              `ASST_TEMPO_ACCOUNT_PRIVATE_KEY set but failed to derive account: ${err instanceof Error ? err.message : String(err)}; falling back to charge-only.`,
            );
            methods.push(tempo.charge(baseParams));
            enabledMethods.push("tempo.charge");
          }
        }
      } else {
        // Receive-only — no signing key, no session. This is the safest
        // default for testnet and many production setups.
        methods.push(tempo.charge(baseParams));
        enabledMethods.push("tempo.charge");
      }
    }
  }

  // Stripe — cards only by default; networkId 'internal' for non-acquirer issuance.
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    if (process.env.NODE_ENV === "production" && stripeKey.startsWith("sk_test_")) {
      warnings.push(
        "STRIPE_SECRET_KEY is a test key in production. Switch to sk_live_* before exposing /api/* publicly.",
      );
    }
    try {
      // Lazy require to avoid bundling Stripe into routes that don't pay.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const StripeCtor = require("stripe");
      const stripeClient = new StripeCtor.default(stripeKey);
      methods.push(
        stripeMethod.charge({
          client: stripeClient,
          networkId: "internal",
          paymentMethodTypes: ["card"],
        }),
      );
      enabledMethods.push("stripe.charge");
    } catch (err) {
      warnings.push(
        `Stripe SDK present but failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Lightning (optional dep). The package is installed lazily so envs without
  // a wallet mnemonic don't pull in BTC infra. Note: `@buildonspark/lightning-mpp-sdk@0.1.4`
  // declares `peerDependencies: { mppx: "^0.3.15" }`, but we run mppx ^0.6.14;
  // any internal API drift surfaces as a throw from `spark.charge(...)` and is
  // converted to a warning here so the rest of the rails keep working.
  const lnMnemonic = process.env.LIGHTNING_MNEMONIC?.trim();
  if (lnMnemonic) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spark } = require("@buildonspark/lightning-mpp-sdk/server");
      methods.push(spark.charge({ mnemonic: lnMnemonic }));
      enabledMethods.push("lightning.charge");
    } catch (err) {
      warnings.push(
        `LIGHTNING_MNEMONIC set but @buildonspark/lightning-mpp-sdk could not be loaded (missing dep or peer-mppx mismatch): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Solana (optional dep) — supports either SOL or any SPL token.
  const solRecipient = process.env.ASST_SOLANA_RECIPIENT?.trim();
  if (solRecipient) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { solana } = require("@solana/mpp/server");
      const network =
        process.env.ASST_SOLANA_NETWORK?.trim() ||
        (process.env.NODE_ENV === "production" ? "mainnet-beta" : "devnet");
      const decimals = process.env.ASST_SOLANA_DECIMALS
        ? Number(process.env.ASST_SOLANA_DECIMALS)
        : 6;
      methods.push(
        solana.charge({
          recipient: solRecipient,
          currency: process.env.ASST_SOLANA_CURRENCY?.trim() || undefined,
          decimals,
          network,
        }),
      );
      enabledMethods.push(`solana.charge:${network}`);
    } catch (err) {
      warnings.push(
        `ASST_SOLANA_RECIPIENT set but @solana/mpp could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (methods.length === 0 && process.env.NODE_ENV === "production") {
    throw new Error(
      "No mppx payment methods configured. Set at least one of " +
        "ASST_TEMPO_RECIPIENT, STRIPE_SECRET_KEY, LIGHTNING_MNEMONIC, ASST_SOLANA_RECIPIENT.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see BuildResult comment.
  const instance = Mppx.create({ secretKey, methods: methods as any });

  return {
    mppx: instance as unknown as MppxGateway,
    enabledMethods,
    warnings,
  };
}

let cached: BuildResult | null = null;

export function getMppx(): BuildResult {
  if (cached) return cached;
  cached = build();
  if (cached.warnings.length > 0) {
    for (const w of cached.warnings) console.warn(`[mppx] ${w}`);
  }
  if (process.env.NODE_ENV !== "test") {
    console.info(
      `[mppx] enabled methods: ${cached.enabledMethods.join(", ") || "(none — dev mode, all paid routes will 402)"}`,
    );
  }
  return cached;
}

/**
 * Returns the `mppx.compose` entries appropriate for /api/chat.
 *
 * Chat is high-frequency and sub-cent — the preferred rail is Tempo session
 * (off-chain vouchers, no per-request blockchain hop). When session isn't
 * configured (no ASST_TEMPO_ACCOUNT_PRIVATE_KEY), we fall back to whatever
 * charge rails are available so the route still works, accepting the
 * higher per-request cost. Operators get a one-line warning at boot if
 * they're paying for chat via charge instead of session.
 */
export function chatPaymentEntries(): ReadonlyArray<readonly [string, unknown]> {
  const { enabledMethods } = getMppx();
  if (enabledMethods.includes("tempo.session")) {
    return [["tempo/session", MPPX_PRICING.chat] as const];
  }
  // Session unavailable — fall back to all charge rails. Same compose entry
  // shape as scan, but with chat pricing.
  return chargeEntriesFor(MPPX_PRICING.chat, enabledMethods);
}

/**
 * Returns the `mppx.compose` entries for /api/scan based on which methods
 * are actually registered in this process. Each entry is a `[methodKey,
 * options]` tuple where `methodKey` is `${name}/${intent}` — e.g.
 * `'tempo/charge'`, `'stripe/charge'`. mppx will present all entries
 * concurrently in the 402 challenge so the client picks whichever rail
 * it can pay.
 */
export function scanPaymentEntries(): ReadonlyArray<readonly [string, unknown]> {
  const { enabledMethods } = getMppx();
  return chargeEntriesFor(MPPX_PRICING.scan, enabledMethods);
}

function chargeEntriesFor(
  pricing: typeof MPPX_PRICING.chat | typeof MPPX_PRICING.scan,
  enabledMethods: string[],
): ReadonlyArray<readonly [string, unknown]> {
  const entries: Array<readonly [string, unknown]> = [];

  if (enabledMethods.includes("tempo.charge")) {
    entries.push(["tempo/charge", pricing] as const);
  }
  if (enabledMethods.includes("stripe.charge")) {
    entries.push(["stripe/charge", pricing] as const);
  }
  if (enabledMethods.includes("lightning.charge")) {
    // Spark publishes its method under name `spark`.
    entries.push(["spark/charge", pricing] as const);
  }
  if (enabledMethods.some((m) => m.startsWith("solana.charge"))) {
    entries.push(["solana/charge", pricing] as const);
  }

  return entries;
}

/**
 * Test seam — clears the cached singleton so per-test env mutation works.
 * Not exported in production builds via tree-shaking; keep importer-side.
 */
export function __resetMppxForTests(): void {
  cached = null;
}
