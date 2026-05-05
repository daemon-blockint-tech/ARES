import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";

import { loadSolanaKeypair, KeypairLoadError } from "../auth/keypair.js";

test("loadSolanaKeypair: round-trips secretKey from solana CLI format", () => {
  const dir = mkdtempSync(join(tmpdir(), "ares-sdk-kp-"));
  const kp = nacl.sign.keyPair();
  const path = join(dir, "id.json");
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));

  const loaded = loadSolanaKeypair(path);
  assert.equal(loaded.publicKeyBase58, bs58.encode(kp.publicKey));

  const msg = new TextEncoder().encode("hello");
  const sig = loaded.signMessage(msg);
  assert.ok(nacl.sign.detached.verify(msg, sig, kp.publicKey));
});

test("loadSolanaKeypair: throws KeypairLoadError on missing file", () => {
  assert.throws(
    () => loadSolanaKeypair("/definitely/does/not/exist.json"),
    KeypairLoadError,
  );
});

test("loadSolanaKeypair: throws on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ares-sdk-kp-bad-"));
  const path = join(dir, "id.json");
  writeFileSync(path, "not-json");
  assert.throws(() => loadSolanaKeypair(path), KeypairLoadError);
});

test("loadSolanaKeypair: rejects wrong-length array", () => {
  const dir = mkdtempSync(join(tmpdir(), "ares-sdk-kp-len-"));
  const path = join(dir, "id.json");
  writeFileSync(path, JSON.stringify([1, 2, 3]));
  assert.throws(() => loadSolanaKeypair(path), KeypairLoadError);
});
