import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Load a Solana keypair from the standard Solana CLI JSON format
 * (a 64-byte little-endian array of unsigned ints — secretKey first 32
 * is seed, last 32 is public key).
 *
 * Default location matches solana-keygen: `~/.config/solana/id.json`.
 *
 * Never logs the secret. Throws a typed error if the file is malformed.
 */
export class KeypairLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeypairLoadError";
  }
}

export interface LoadedKeypair {
  publicKeyBase58: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  signMessage(message: Uint8Array): Uint8Array;
}

export function defaultSolanaKeypairPath(): string {
  return join(homedir(), ".config", "solana", "id.json");
}

export function loadSolanaKeypair(path: string): LoadedKeypair {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new KeypairLoadError(
        `Keypair file not found: ${path}. Generate one with: solana-keygen new --no-bip39-passphrase -o ${path}`,
      );
    }
    throw new KeypairLoadError(
      `Failed to read keypair at ${path}: ${(err as Error).message}`,
    );
  }

  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new KeypairLoadError(
      `Keypair at ${path} is not valid JSON. Expected a Solana CLI keypair (array of 64 bytes).`,
    );
  }

  if (!Array.isArray(arr) || arr.length !== 64 || !arr.every((n) => typeof n === "number")) {
    throw new KeypairLoadError(
      `Keypair at ${path} must be a JSON array of 64 unsigned ints (Solana CLI format).`,
    );
  }
  const secretKey = Uint8Array.from(arr as number[]);
  let kp;
  try {
    kp = nacl.sign.keyPair.fromSecretKey(secretKey);
  } catch (err) {
    throw new KeypairLoadError(
      `Keypair at ${path} could not be parsed as ed25519: ${(err as Error).message}`,
    );
  }

  const publicKeyBase58 = bs58.encode(kp.publicKey);
  const sk = kp.secretKey;
  const pk = kp.publicKey;
  return {
    publicKeyBase58,
    publicKey: pk,
    secretKey: sk,
    signMessage(message) {
      return nacl.sign.detached(message, sk);
    },
  };
}
