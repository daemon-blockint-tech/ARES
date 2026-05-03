/**
 * Memo-attribution helpers — analytics-only.
 *
 * The full `applyBillingDeposits` flow that previously credited prepaid
 * bundles based on `ASST:<wallet>:<bundleId>:<nonce>` memos was removed
 * (audit fix #002 — bundle-credit fraud: the function only checked that
 * `lamports > 0` or `tokenAmount > 0`, allowing 1 lamport to credit a full
 * `growth` bundle of 1100 units).
 *
 * Public-web billing is now handled inline by mppx on /api/chat and /api/scan.
 * These helpers are kept because they're useful for off-chain analytics:
 * surfacing which wallets are sending memos, dedupe of marketing-attribution
 * deposits, etc. They are no longer wired into the webhook hot path.
 */

/**
 * Parses memo format: ASST:<userWallet>:<bundleId>:<clientNonce>
 */
export function parseAsstMemo(memo: string): {
  userWallet: string;
  bundleId: string;
  clientNonce: string;
} | null {
  const prefix = "ASST:";
  const trimmed = memo.trim();
  const idx = trimmed.indexOf(prefix);
  const slice = idx >= 0 ? trimmed.slice(idx) : trimmed;
  if (!slice.startsWith(prefix)) return null;
  const rest = slice.slice(prefix.length);
  const parts = rest.split(":");
  if (parts.length < 3) return null;
  const userWallet = parts[0];
  const bundleId = parts[1];
  const clientNonce = parts.slice(2).join(":");
  if (!userWallet || !bundleId || !clientNonce) return null;
  return { userWallet, bundleId, clientNonce };
}

function collectStrings(obj: unknown, out: Set<string>): void {
  if (typeof obj === "string") {
    out.add(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectStrings(x, out);
    return;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) collectStrings(v, out);
  }
}

export function findAsstMemoInTx(tx: unknown): string | null {
  const strings = new Set<string>();
  collectStrings(tx, strings);
  for (const s of strings) {
    const i = s.indexOf("ASST:");
    if (i >= 0) {
      const tail = s.slice(i).replace(/\s+/g, " ").trim();
      const token = tail.split(/[\s"',}\]]/)[0];
      if (token?.startsWith("ASST:")) return token;
    }
  }
  return null;
}
