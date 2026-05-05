import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "BAD_GATEWAY"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  ok: false;
  requestId: string;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: string;
  };
}

export interface ApiSuccessBody<T> {
  ok: true;
  requestId: string;
  data: T;
}

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.headers.get("x-real-ip") || "unknown";
}

export function getRequestId(req: Request): string {
  return req.headers.get("x-request-id") || crypto.randomUUID();
}

/**
 * Public ingress gate for SIWS/anonymous flows.
 * - Dev without ASST_WEB_API_KEY: operator bypass (legacy DX).
 * - Prod without ASST_WEB_API_KEY: misconfiguration (fail closed).
 * - With ASST_WEB_API_KEY: matching header bypasses quota/billing for automation.
 */
export function authenticateIngress(req: Request):
  | { ok: false; response: NextResponse<ApiErrorBody> }
  | { ok: true; requestId: string; operator: boolean } {
  const requestId = getRequestId(req);
  const secret = process.env.ASST_WEB_API_KEY?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Public web: SIWS + anonymous flows do not require a shared API key.
      return { ok: true, requestId, operator: false };
    }
    return { ok: true, requestId, operator: true };
  }

  const headerKey = req.headers.get("x-api-key");
  if (headerKey && headerKey === secret) {
    return { ok: true, requestId, operator: true };
  }

  return { ok: true, requestId, operator: false };
}

export function apiSuccess<T>(
  requestId: string,
  data: T,
  init?: ResponseInit,
): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ ok: true, requestId, data }, init);
}

export function apiError(
  requestId: string,
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { ok: false, requestId, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export function requireApiKey(
  req: Request,
): { ok: true; requestId: string } | { ok: false; response: NextResponse<ApiErrorBody> } {
  const requestId = getRequestId(req);
  const expectedKey = process.env.ASST_WEB_API_KEY?.trim();

  if (!expectedKey) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        response: apiError(
          requestId,
          "INTERNAL_ERROR",
          "Server API key is not configured.",
          500,
        ),
      };
    }
    return { ok: true, requestId };
  }

  const headerValue = req.headers.get("x-api-key");
  if (headerValue !== expectedKey) {
    return {
      ok: false,
      response: apiError(requestId, "UNAUTHORIZED", "Missing or invalid API key.", 401),
    };
  }
  return { ok: true, requestId };
}

/**
 * Browser-callable dashboard / assurance APIs: align with public ingress.
 * - No `ASST_WEB_API_KEY`: allow same-origin UI (dev + prod).
 * - Key set: require `x-api-key` (automation / scripts).
 *
 * Use `requireApiKey` for routes that must fail closed when no key is configured.
 */
export function requireApiKeyOrPublic(
  req: Request,
): { ok: true; requestId: string } | { ok: false; response: NextResponse<ApiErrorBody> } {
  const requestId = getRequestId(req);
  const expectedKey = process.env.ASST_WEB_API_KEY?.trim();
  if (!expectedKey) {
    return { ok: true, requestId };
  }
  const headerValue = req.headers.get("x-api-key");
  if (headerValue !== expectedKey) {
    return {
      ok: false,
      response: apiError(requestId, "UNAUTHORIZED", "Missing or invalid API key.", 401),
    };
  }
  return { ok: true, requestId };
}

export function enforceRateLimit(
  req: Request,
  requestId: string,
  keySuffix: string,
  maxPerMinute: number,
): { ok: true } | { ok: false; response: NextResponse<ApiErrorBody> } {
  const ip = getClientIp(req);
  const now = Date.now();
  const key = `${ip}:${keySuffix}`;
  const current = rateBuckets.get(key);

  if (!current || now - current.windowStart >= 60_000) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return { ok: true };
  }

  if (current.count >= maxPerMinute) {
    return {
      ok: false,
      response: apiError(
        requestId,
        "RATE_LIMITED",
        "Rate limit exceeded for this endpoint.",
        429,
      ),
    };
  }

  current.count += 1;
  rateBuckets.set(key, current);
  return { ok: true };
}
