"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type MeState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "signedIn"; wallet: string; tier: string; balanceUnits: number };

type SignInError =
  | { kind: "cancelled" }
  | { kind: "config"; message: string }
  | { kind: "generic"; message: string };

/**
 * Detect whether a thrown error is a user-rejection from the wallet adapter.
 * Phantom and most adapters surface this with a `code` of 4001 or message
 * containing "User rejected"/"User declined".
 */
function isUserRejection(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: number | string }).code;
  if (code === 4001 || code === "4001") return true;
  const name = (e as { name?: string }).name;
  if (name === "WalletSignMessageError" || name === "WalletConnectionError") {
    // These wrap underlying user-rejection in many adapters.
    const msg = (e as { message?: string }).message?.toLowerCase() ?? "";
    if (msg.includes("reject") || msg.includes("declined") || msg.includes("cancel")) {
      return true;
    }
  }
  const msg = (e as { message?: string }).message?.toLowerCase() ?? "";
  return (
    msg.includes("user rejected") ||
    msg.includes("user declined") ||
    msg.includes("user cancel")
  );
}

export function WalletSessionControls() {
  const router = useRouter();
  const { publicKey, signMessage, connected, disconnect, disconnecting } = useWallet();
  const [me, setMe] = useState<MeState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<SignInError | null>(null);

  /** Fetch /api/auth/me. Stable reference so it can be used as an effect dep. */
  const refreshSession = useCallback(async (): Promise<MeState> => {
    try {
      const r = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        data?: {
          authenticated?: boolean;
          wallet?: string;
          tier?: string;
          balanceUnits?: number;
        };
      };
      if (!j.ok || !j.data?.authenticated || typeof j.data.wallet !== "string") {
        const next: MeState = { status: "guest" };
        setMe(next);
        return next;
      }
      const next: MeState = {
        status: "signedIn",
        wallet: j.data.wallet,
        tier: typeof j.data.tier === "string" ? j.data.tier : "free",
        balanceUnits:
          typeof j.data.balanceUnits === "number" ? j.data.balanceUnits : 0,
      };
      setMe(next);
      return next;
    } catch {
      const next: MeState = { status: "guest" };
      setMe(next);
      return next;
    }
  }, []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refreshSession();
      if (cancelled) return;
      // No-op; refreshSession already wrote to state. Guard kept for clarity.
      void next;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  // Keep cookie session aligned with the connected wallet.
  // - If user disconnects the wallet but a session cookie still exists for
  //   that wallet, drop the cookie so the UI doesn't show a stale signed-in
  //   state for a wallet they can no longer sign with.
  const lastConnectedRef = useRef<string | null>(null);
  useEffect(() => {
    const pk = publicKey?.toBase58() ?? null;
    const wasConnected = lastConnectedRef.current;
    lastConnectedRef.current = pk;

    if (
      !connected &&
      !disconnecting &&
      wasConnected &&
      me.status === "signedIn" &&
      me.wallet === wasConnected
    ) {
      // User disconnected wallet from Phantom/etc. — clear server cookie
      // silently so UI matches reality. Do not call disconnect() again.
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
        .then(() => refreshSession())
        .then(() => router.refresh());
    }
  }, [connected, disconnecting, publicKey, me, refreshSession, router]);

  const signIn = useCallback(async () => {
    setErr(null);
    if (!publicKey || !signMessage) {
      setErr({ kind: "generic", message: "Connect a wallet first." });
      return;
    }
    setBusy(true);
    try {
      const ch = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "include",
      });
      const cj = (await ch.json()) as {
        ok?: boolean;
        data?: { message?: string };
        error?: { message?: string; code?: string };
      };
      if (!cj.ok || !cj.data?.message) {
        throw new Error(cj.error?.message || "Could not start sign-in.");
      }
      const message = cj.data.message;
      const encoded = new TextEncoder().encode(message);

      let sigBytes: Uint8Array;
      try {
        sigBytes = await signMessage(encoded);
      } catch (signErr) {
        if (isUserRejection(signErr)) {
          setErr({ kind: "cancelled" });
          return;
        }
        throw signErr;
      }
      const sig58 = bs58.encode(sigBytes);

      const vr = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: publicKey.toBase58(),
          signature: sig58,
          signedMessage: message,
        }),
      });
      const vj = (await vr.json()) as {
        ok?: boolean;
        error?: { message?: string; code?: string };
      };
      if (!vj.ok) {
        const code = vj.error?.code;
        const msg = vj.error?.message || "Sign-in failed.";
        if (code === "INTERNAL_ERROR" && /ASST_SESSION_SECRET/i.test(msg)) {
          setErr({
            kind: "config",
            message:
              "Server is missing ASST_SESSION_SECRET — ask your admin to configure it.",
          });
          return;
        }
        throw new Error(msg);
      }
      await refreshSession();
      router.refresh();
    } catch (e: unknown) {
      if (isUserRejection(e)) {
        setErr({ kind: "cancelled" });
        return;
      }
      setErr({
        kind: "generic",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [publicKey, signMessage, refreshSession, router]);

  const signOut = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      try {
        await disconnect();
      } catch {
        // ignore — adapter sometimes throws if already disconnected
      }
      await refreshSession();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [disconnect, refreshSession, router]);

  function shortPk(s: string) {
    if (s.length <= 12) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  const pk58 = publicKey?.toBase58();
  const needsSignIn =
    connected && !!pk58 && (me.status !== "signedIn" || me.wallet !== pk58);

  if (me.status === "loading") {
    return (
      <div className="text-xs text-muted-foreground whitespace-nowrap">Session…</div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 max-w-[min(100vw-2rem,320px)]">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/dashboard/profile"
          className="p-2 text-muted-foreground hover:text-foreground transition-all hover:bg-secondary/50 rounded-lg border border-transparent hover:border-border"
          aria-label="Profile"
        >
          <User className="w-5 h-5" />
        </Link>
        <div aria-busy={busy} className={busy ? "pointer-events-none opacity-60" : undefined}>
          <WalletMultiButton />
        </div>
        {needsSignIn ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void signIn()}
            className="text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Signing…" : "Sign in"}
          </button>
        ) : null}
        {me.status === "signedIn" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void signOut()}
            className="text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50"
          >
            Sign out
          </button>
        ) : null}
      </div>
      {me.status === "signedIn" ? (
        <div className="text-[11px] text-muted-foreground font-mono text-right leading-snug">
          <span>{shortPk(me.wallet)}</span>
          <span className="mx-1">·</span>
          <span>{me.balanceUnits} units</span>
          <span className="mx-1">·</span>
          <span>{me.tier}</span>
        </div>
      ) : connected ? (
        <p className="text-[11px] text-muted-foreground text-right leading-snug">
          Click <span className="text-foreground font-medium">Sign in</span> to attach your session cookie.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground text-right leading-snug">
          Connect a wallet, then sign in to attach your session cookie.
        </p>
      )}
      {err ? (
        <p
          className={`text-[11px] text-right max-w-[260px] leading-snug ${
            err.kind === "cancelled"
              ? "text-muted-foreground"
              : "text-destructive"
          }`}
          role={err.kind === "cancelled" ? "status" : "alert"}
        >
          {err.kind === "cancelled"
            ? "Sign-in cancelled in wallet."
            : err.message}
        </p>
      ) : null}
    </div>
  );
}
