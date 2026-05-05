/**
 * Public types for the ARES SDK.
 *
 * These mirror the wire format of the public web API (apps/web/app/api/*),
 * not the internal agent-py HTTP surface (which is HMAC-gated and not meant
 * to be called directly from end-user code).
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "BAD_GATEWAY"
  | "INTERNAL_ERROR"
  | "PAYMENT_REQUIRED";

export interface ApiErrorBody {
  ok: false;
  requestId: string;
  error: { code: ApiErrorCode; message: string; details?: string };
}

export interface ApiSuccessBody<T> {
  ok: true;
  requestId: string;
  data: T;
}

export type ApiResponse<T> = ApiSuccessBody<T> | ApiErrorBody;

export interface MeResponse {
  authenticated: boolean;
  wallet?: string;
  tier?: "free" | "paid";
  balanceUnits?: number;
  isAdmin?: boolean;
}

export interface ChatResponse {
  response: unknown;
  billing: "operator" | "free_wallet" | "free_anon" | "mppx_session";
}

export interface ScanResponse {
  status: "queued" | "running" | "complete" | "failed";
  target: string;
  run_id: string | null;
  timestamp: string;
  billing: "operator" | "free_wallet" | "mppx_charge";
}

export interface RunRow {
  id: string;
  status: string;
  target?: string;
  model?: string | null;
  created_at?: string;
  finished_at?: string | null;
  [key: string]: unknown;
}

export interface RunsListResponse {
  total: number;
  runs: RunRow[];
}

export interface FindingRow {
  id: string;
  rule_id?: string;
  severity?: string;
  message?: string;
  file?: string;
  line?: number;
  run_id?: string;
  [key: string]: unknown;
}

export interface FindingsListResponse {
  findings: FindingRow[];
}

export interface ChallengeResponse {
  nonce: string;
  domain: string;
  statement: string;
  issuedAt: string;
  expiresAt: string;
  message: string;
}

export interface VerifyResponse {
  wallet: string;
  tier: "free" | "paid";
  balanceUnits: number;
}

/** Thrown when the server responds with `ok: false` (any 4xx/5xx). */
export class AresApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly requestId: string | undefined;
  public readonly details: string | undefined;
  public readonly raw: unknown;

  constructor(args: {
    code: ApiErrorCode;
    message: string;
    status: number;
    requestId?: string;
    details?: string;
    raw?: unknown;
  }) {
    super(args.message);
    this.name = "AresApiError";
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId;
    this.details = args.details;
    this.raw = args.raw;
  }
}

/** Thrown when the server returns HTTP 402 Payment Required (mppx paywall). */
export class AresPaymentRequiredError extends AresApiError {
  public readonly wwwAuthenticate: string | undefined;
  constructor(args: {
    message: string;
    status: number;
    requestId?: string;
    wwwAuthenticate?: string;
    raw?: unknown;
  }) {
    super({
      code: "PAYMENT_REQUIRED",
      message: args.message,
      status: args.status,
      ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
      ...(args.raw !== undefined ? { raw: args.raw } : {}),
    });
    this.name = "AresPaymentRequiredError";
    this.wwwAuthenticate = args.wwwAuthenticate;
  }
}
