import test from "node:test";
import assert from "node:assert/strict";

// Import from the dependency-free modules so this test suite does not pull in
// `@ares/engine` (which doesn't resolve cleanly under the tsx test loader).
import { sanitizeModelOption } from "../auth/sanitize-model.js";
import { getJwtSecretBytes, WeakJwtSecretError } from "../auth/session-secret.js";
import {
  __resetMppxForTests,
  chatPaymentEntries,
  getMppx,
  scanPaymentEntries,
} from "../payments/mppx.js";

// ─────────────────────────────────────────────────────────────
// engine-factory: sanitizeModelOption (audit fix #001 — SSRF)
// ─────────────────────────────────────────────────────────────

test("sanitizeModelOption: returns undefined for non-strings", () => {
  assert.equal(sanitizeModelOption(undefined), undefined);
  assert.equal(sanitizeModelOption(""), undefined);
  assert.equal(sanitizeModelOption("   "), undefined);
});

test("sanitizeModelOption: passes through plain provider:model", () => {
  assert.equal(sanitizeModelOption("google:gemini-2.5-flash"), "google:gemini-2.5-flash");
  assert.equal(sanitizeModelOption("openai:gpt-4o-mini"), "openai:gpt-4o-mini");
  assert.equal(
    sanitizeModelOption("openrouter:nvidia/nemotron-nano-9b-v2:free"),
    "openrouter:nvidia/nemotron-nano-9b-v2:free",
  );
});

test("sanitizeModelOption: strips @<baseUrl> SSRF payload", () => {
  assert.equal(
    sanitizeModelOption("openai:gpt-4o-mini@http://attacker.example/v1"),
    "openai:gpt-4o-mini",
  );
  assert.equal(
    sanitizeModelOption("openai:gpt-4o-mini@https://evil.invalid/relay"),
    "openai:gpt-4o-mini",
  );
});

test("sanitizeModelOption: rejects malformed input", () => {
  assert.equal(sanitizeModelOption("just-a-word"), undefined);
  assert.equal(sanitizeModelOption("provider:"), undefined);
  assert.equal(sanitizeModelOption(":model"), undefined);
  assert.equal(sanitizeModelOption("p:m;rm -rf"), undefined);
  // overlong
  assert.equal(sanitizeModelOption("a:" + "x".repeat(300)), undefined);
});

test("sanitizeModelOption: enforces ASST_MODEL_ALLOWLIST when set", () => {
  const prev = process.env.ASST_MODEL_ALLOWLIST;
  process.env.ASST_MODEL_ALLOWLIST = "google:gemini-2.5-flash, openai:gpt-4o-mini";
  try {
    assert.equal(
      sanitizeModelOption("google:gemini-2.5-flash"),
      "google:gemini-2.5-flash",
    );
    assert.equal(sanitizeModelOption("openai:gpt-4o-mini"), "openai:gpt-4o-mini");
    // Not allowlisted → undefined (server falls back to default)
    assert.equal(sanitizeModelOption("anthropic:claude-3-5-sonnet"), undefined);
    // SSRF after allowlist → still undefined
    assert.equal(sanitizeModelOption("google:gemini-2.5-flash@http://x"), "google:gemini-2.5-flash");
  } finally {
    if (prev === undefined) delete process.env.ASST_MODEL_ALLOWLIST;
    else process.env.ASST_MODEL_ALLOWLIST = prev;
  }
});

// ─────────────────────────────────────────────────────────────
// session-secret: weak-secret rejection (audit fix #007)
// ─────────────────────────────────────────────────────────────

test("getJwtSecretBytes: returns null when env unset", () => {
  const prev = process.env.ASST_SESSION_SECRET;
  delete process.env.ASST_SESSION_SECRET;
  try {
    assert.equal(getJwtSecretBytes(), null);
  } finally {
    if (prev !== undefined) process.env.ASST_SESSION_SECRET = prev;
  }
});

test("getJwtSecretBytes: throws WeakJwtSecretError on short secret", () => {
  const prev = process.env.ASST_SESSION_SECRET;
  process.env.ASST_SESSION_SECRET = "shortsecret";
  try {
    assert.throws(() => getJwtSecretBytes(), WeakJwtSecretError);
  } finally {
    if (prev === undefined) delete process.env.ASST_SESSION_SECRET;
    else process.env.ASST_SESSION_SECRET = prev;
  }
});

test("getJwtSecretBytes: decodes 64-hex string to 32 bytes", () => {
  const prev = process.env.ASST_SESSION_SECRET;
  process.env.ASST_SESSION_SECRET = "a".repeat(64);
  try {
    const bytes = getJwtSecretBytes();
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes!.length, 32);
  } finally {
    if (prev === undefined) delete process.env.ASST_SESSION_SECRET;
    else process.env.ASST_SESSION_SECRET = prev;
  }
});

test("getJwtSecretBytes: accepts ≥32-char arbitrary string", () => {
  const prev = process.env.ASST_SESSION_SECRET;
  const secret = "x".repeat(40);
  process.env.ASST_SESSION_SECRET = secret;
  try {
    const bytes = getJwtSecretBytes();
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes!.length, secret.length);
  } finally {
    if (prev === undefined) delete process.env.ASST_SESSION_SECRET;
    else process.env.ASST_SESSION_SECRET = prev;
  }
});

// ─────────────────────────────────────────────────────────────
// mppx: env-driven method registration
// ─────────────────────────────────────────────────────────────

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetMppxForTests();
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetMppxForTests();
  }
}

test("mppx: dev with no methods registers zero rails (NODE_ENV != production)", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: undefined,
      STRIPE_SECRET_KEY: undefined,
      LIGHTNING_MNEMONIC: undefined,
      ASST_SOLANA_RECIPIENT: undefined,
    },
    () => {
      const { mppx, enabledMethods } = getMppx();
      assert.ok(mppx);
      assert.deepEqual(enabledMethods, []);
    },
  );
});

test("mppx: production with no methods throws", () => {
  withEnv(
    {
      NODE_ENV: "production",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: undefined,
      STRIPE_SECRET_KEY: undefined,
      LIGHTNING_MNEMONIC: undefined,
      ASST_SOLANA_RECIPIENT: undefined,
    },
    () => {
      assert.throws(() => getMppx(), /No mppx payment methods configured/);
    },
  );
});

test("mppx: tempo recipient alone registers charge-only rail", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_TESTNET: "true",
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY: undefined,
    },
    () => {
      const { enabledMethods } = getMppx();
      assert.ok(enabledMethods.includes("tempo.charge"));
      assert.equal(enabledMethods.includes("tempo.session"), false);
    },
  );
});

test("mppx: tempo recipient + private key registers charge + session", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_TESTNET: "true",
      // Anvil dev key 0 — public, well-known testing key. Never put in prod env.
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    () => {
      const { enabledMethods } = getMppx();
      assert.ok(enabledMethods.includes("tempo.charge"));
      assert.ok(enabledMethods.includes("tempo.session"));
    },
  );
});

test("mppx: malformed tempo recipient is rejected with warning", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "not-an-eth-address",
    },
    () => {
      const { enabledMethods, warnings } = getMppx();
      assert.equal(enabledMethods.some((m) => m.startsWith("tempo")), false);
      assert.ok(warnings.some((w) => w.includes("ASST_TEMPO_RECIPIENT")));
    },
  );
});

test("mppx: malformed tempo private key falls back to charge-only with warning", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY: "0xshort",
    },
    () => {
      const { enabledMethods, warnings } = getMppx();
      assert.ok(enabledMethods.includes("tempo.charge"));
      assert.equal(enabledMethods.includes("tempo.session"), false);
      assert.ok(
        warnings.some((w) => w.includes("ASST_TEMPO_ACCOUNT_PRIVATE_KEY")),
      );
    },
  );
});

test("mppx: production rejects too-short MPP_SECRET_KEY", () => {
  withEnv(
    {
      NODE_ENV: "production",
      MPP_SECRET_KEY: "short",
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    },
    () => {
      assert.throws(() => getMppx(), /MPP_SECRET_KEY/);
    },
  );
});

// ─────────────────────────────────────────────────────────────
// payment entries: chat + scan compose tuple builders
// ─────────────────────────────────────────────────────────────

test("chatPaymentEntries: prefers tempo/session when configured", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    () => {
      const entries = chatPaymentEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0]![0], "tempo/session");
      const opts = entries[0]![1] as { amount: string; currency: string };
      assert.equal(opts.amount, "0.01");
      assert.equal(opts.currency, "usd");
    },
  );
});

test("chatPaymentEntries: falls back to charge rails without session", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY: undefined,
    },
    () => {
      const entries = chatPaymentEntries();
      const keys = entries.map(([k]) => k);
      assert.deepEqual(keys, ["tempo/charge"]);
    },
  );
});

test("scanPaymentEntries: only includes registered methods", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      ASST_TEMPO_TESTNET: "true",
      ASST_TEMPO_ACCOUNT_PRIVATE_KEY: undefined,
      STRIPE_SECRET_KEY: undefined,
      LIGHTNING_MNEMONIC: undefined,
      ASST_SOLANA_RECIPIENT: undefined,
    },
    () => {
      const entries = scanPaymentEntries();
      const keys = entries.map(([k]) => k);
      assert.deepEqual(keys, ["tempo/charge"]);
    },
  );
});

test("scanPaymentEntries: returns empty when no methods are registered", () => {
  withEnv(
    {
      NODE_ENV: "development",
      MPP_SECRET_KEY: "x".repeat(40),
      ASST_TEMPO_RECIPIENT: undefined,
      STRIPE_SECRET_KEY: undefined,
      LIGHTNING_MNEMONIC: undefined,
      ASST_SOLANA_RECIPIENT: undefined,
    },
    () => {
      const entries = scanPaymentEntries();
      assert.deepEqual(entries, []);
    },
  );
});
