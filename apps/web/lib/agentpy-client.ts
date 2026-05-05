/**
 * Signed JSON-RPC-style client for ``apps/agent-py`` (HMAC shared secret).
 *
 * The signature covers the exact UTF-8 request body bytes prefixed with
 * ``<unix_ts>.`` so FastAPI can verify without JSON re-serialization drift.
 */
import crypto from "node:crypto";
import { resolveRepoRoot } from "@/lib/paths";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for agent-py integration`);
  return v;
}

export function signAgentPyBody(bodyUtf8: string): { ts: string; sig: string } {
  const secret = requireEnv("AGENTPY_INTERNAL_SECRET");
  const ts = String(Math.floor(Date.now() / 1000));
  const msg = `${ts}.${bodyUtf8}`;
  const sig = crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");
  return { ts, sig };
}

export async function agentPyPostJson<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const base = requireEnv("AGENT_PY_URL").replace(/\/$/, "");
  const bodyUtf8 = JSON.stringify(payload);
  const { ts, sig } = signAgentPyBody(bodyUtf8);
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ASST-Timestamp": ts,
      "X-ASST-Signature": sig,
    },
    body: bodyUtf8,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`agent-py ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * HMAC over empty body (``ts.``) — used for GET /v1/runs/{id} and other idempotent reads.
 */
export async function agentPyGetJson<T>(pathWithQuery: string): Promise<T> {
  const base = requireEnv("AGENT_PY_URL").replace(/\/$/, "");
  const { ts, sig } = signAgentPyBody("");
  const res = await fetch(`${base}${pathWithQuery}`, {
    method: "GET",
    headers: {
      "X-ASST-Timestamp": ts,
      "X-ASST-Signature": sig,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`agent-py GET ${pathWithQuery} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export function defaultRepoPayload(): { repo_root: string } {
  return { repo_root: resolveRepoRoot() };
}
