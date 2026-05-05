import bs58 from "bs58";
import { loadSolanaKeypair, type LoadedKeypair } from "./auth/keypair.js";
import {
  AresApiError,
  AresPaymentRequiredError,
  type ApiResponse,
  type ChallengeResponse,
  type ChatResponse,
  type FindingsListResponse,
  type MeResponse,
  type RunRow,
  type RunsListResponse,
  type ScanResponse,
  type VerifyResponse,
} from "./types.js";

const SESSION_COOKIE = "asst_session";

/**
 * Public ARES web API client. Talks to `<baseUrl>/api/*` and tracks the
 * SIWS session cookie (`asst_session`) in-memory. Persistent storage is
 * the CLI's responsibility (see `src/config.ts`).
 *
 * Designed to be drop-in usable from Node, Deno, Bun, Cloudflare Workers,
 * and the browser — only requires global `fetch`.
 *
 * @example
 * ```ts
 * import { AresClient } from "@ares/sdk";
 * const client = new AresClient({ baseUrl: "https://ares.example.com" });
 * await client.signInWithKeypair({ keypairPath: "~/.config/solana/id.json" });
 * const reply = await client.chat("Audit my repo");
 * ```
 */
export interface AresClientOptions {
  /** Base URL of the ARES web app. Default: `process.env.ARES_BASE_URL` or `http://127.0.0.1:3000`. */
  baseUrl?: string;
  /** Operator API key — sets `x-api-key` and bypasses payment + free quotas. */
  apiKey?: string;
  /** Provide a pre-existing session JWT (e.g. read from disk) to skip sign-in. */
  sessionToken?: string;
  /** Optional fetch override (testing, custom CA, etc.). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Sent as `User-Agent` to help server-side metrics. Default: `@ares/sdk/<version>`. */
  userAgent?: string;
  /** Per-request timeout in ms. Default 60_000. */
  timeoutMs?: number;
}

export interface ChatOptions {
  /** Optional model override (e.g. `openrouter:deepseek/deepseek-r1`). */
  model?: string;
}

export interface ScanOptions {
  /** Workspace-relative path or "." for the whole repo. Default ".". */
  target?: string;
  model?: string;
}

export interface SignInWithKeypairOptions {
  /** Path to a Solana CLI JSON keypair. Defaults to `~/.config/solana/id.json`. */
  keypairPath?: string;
  /** Pre-loaded keypair (lets callers control how keys are stored in memory). */
  keypair?: LoadedKeypair;
}

export class AresClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  /** In-memory cookie jar; primary entry is `asst_session`. */
  private cookies: Record<string, string> = {};

  constructor(opts: AresClientOptions = {}) {
    const envBase = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.ARES_BASE_URL?.trim();
    this.baseUrl = (opts.baseUrl ?? envBase ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ?? `@ares/sdk/0.1.0`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    if (opts.sessionToken) {
      this.cookies[SESSION_COOKIE] = opts.sessionToken;
    }
  }

  /** Set/replace cookies from an external source (e.g. persisted CLI config). */
  public setCookies(cookies: Record<string, string>): void {
    this.cookies = { ...cookies };
  }

  /** Snapshot of current cookies (useful for persisting after sign-in). */
  public getCookies(): Record<string, string> {
    return { ...this.cookies };
  }

  /** Returns the current session JWT if signed in, else undefined. */
  public getSessionToken(): string | undefined {
    return this.cookies[SESSION_COOKIE];
  }

  // ---------- AUTH ----------

  /** Anonymous-allowed SIWS challenge. */
  public async authChallenge(): Promise<ChallengeResponse> {
    return this.request<ChallengeResponse>("POST", "/api/auth/challenge");
  }

  /**
   * Sign in via SIWS using a Solana keypair. The signed message is
   * verified server-side; on success the session cookie is captured into
   * the in-memory jar.
   */
  public async signInWithKeypair(opts: SignInWithKeypairOptions = {}): Promise<MeResponse> {
    const kp = opts.keypair ?? loadSolanaKeypair(opts.keypairPath ?? defaultKeypairPath());
    const challenge = await this.authChallenge();
    const sigBytes = kp.signMessage(new TextEncoder().encode(challenge.message));
    const signature = bs58.encode(sigBytes);
    await this.request<VerifyResponse>("POST", "/api/auth/verify", {
      json: {
        address: kp.publicKeyBase58,
        signature,
        signedMessage: challenge.message,
      },
    });
    return this.me();
  }

  public async signOut(): Promise<void> {
    try {
      await this.request<{ loggedOut: true }>("POST", "/api/auth/logout");
    } finally {
      delete this.cookies[SESSION_COOKIE];
    }
  }

  public async me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/api/auth/me");
  }

  // ---------- PRODUCT ----------

  public async chat(prompt: string, opts: ChatOptions = {}): Promise<ChatResponse> {
    const body: Record<string, unknown> = { prompt };
    if (opts.model !== undefined) body.model = opts.model;
    return this.request<ChatResponse>("POST", "/api/chat", { json: body });
  }

  public async scan(opts: ScanOptions = {}): Promise<ScanResponse> {
    const body: Record<string, unknown> = { target: opts.target ?? "." };
    if (opts.model !== undefined) body.model = opts.model;
    return this.request<ScanResponse>("POST", "/api/scan", { json: body });
  }

  public async runs(): Promise<RunsListResponse> {
    return this.request<RunsListResponse>("GET", "/api/runs");
  }

  public async getRun(runId: string): Promise<RunRow> {
    if (!runId) throw new TypeError("runId is required");
    return this.request<RunRow>("GET", `/api/runs/${encodeURIComponent(runId)}`);
  }

  public async findings(): Promise<FindingsListResponse> {
    return this.request<FindingsListResponse>("GET", "/api/findings");
  }

  // ---------- INTERNAL ----------

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    init: { json?: unknown } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      accept: "application/json",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const cookieHeader = buildCookieHeader(this.cookies);
    if (cookieHeader) headers["cookie"] = cookieHeader;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      const reqInit: RequestInit = { method, headers, signal: ac.signal };
      if (body !== undefined) reqInit.body = body;
      res = await this.fetchImpl(url, reqInit);
    } catch (err) {
      throw new AresApiError({
        code: "BAD_GATEWAY",
        message: `Network error contacting ${url}: ${(err as Error).message}`,
        status: 0,
      });
    } finally {
      clearTimeout(t);
    }

    // Capture Set-Cookie (Node fetch returns it via .headers.getSetCookie() on 18+).
    const setCookies = readSetCookies(res);
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      if (!value || value === "") {
        delete this.cookies[name];
      } else {
        this.cookies[name] = value;
      }
    }

    if (res.status === 402) {
      const text = await res.text().catch(() => "");
      throw new AresPaymentRequiredError({
        message: "Payment required (402). Run `ares config --base-url` against an instance with credit, or sign in with a wallet that has free quota.",
        status: 402,
        ...(res.headers.get("www-authenticate")
          ? { wwwAuthenticate: res.headers.get("www-authenticate") as string }
          : {}),
        raw: text,
      });
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new AresApiError({
        code: res.ok ? "INTERNAL_ERROR" : "BAD_GATEWAY",
        message: `Non-JSON response from ${url} (status ${res.status})`,
        status: res.status,
      });
    }

    const body2 = parsed as ApiResponse<T>;
    if (body2 && typeof body2 === "object" && body2.ok === true) {
      return body2.data;
    }
    if (body2 && typeof body2 === "object" && body2.ok === false) {
      throw new AresApiError({
        code: body2.error.code,
        message: body2.error.message,
        status: res.status,
        ...(body2.requestId !== undefined ? { requestId: body2.requestId } : {}),
        ...(body2.error.details !== undefined ? { details: body2.error.details } : {}),
        raw: body2,
      });
    }
    throw new AresApiError({
      code: "INTERNAL_ERROR",
      message: `Unexpected response shape from ${url}`,
      status: res.status,
      raw: parsed,
    });
  }
}

function defaultKeypairPath(): string {
  // Lazy import to avoid pulling node:os into browser bundles when
  // keypair flow is not used.
  const { defaultSolanaKeypairPath } = require("./auth/keypair.js") as {
    defaultSolanaKeypairPath: () => string;
  };
  return defaultSolanaKeypairPath();
}

function buildCookieHeader(cookies: Record<string, string>): string | undefined {
  const entries = Object.entries(cookies).filter(([, v]) => v && v.length > 0);
  if (entries.length === 0) return undefined;
  return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}

function readSetCookies(res: Response): string[] {
  // Node 18.17+ / undici, Bun, Deno
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  // Fallback: single Set-Cookie via .get(); some impls fold them with comma.
  // Splitting on ", " is fragile (cookies have Expires=...) but acceptable
  // for our SIWS path which only sets one cookie per response.
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}
