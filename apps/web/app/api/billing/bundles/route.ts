/**
 * DEPRECATED — replaced by mppx (audit fix #002).
 *
 * Prepaid bundle purchases were the source of the "1-lamport for 1100 units"
 * bundle-fraud vulnerability. Public-web billing now happens inline on each
 * /api/chat and /api/scan request via mppx, with no balance to top up.
 *
 * This endpoint is kept as a stable 410 so dashboards built against the old
 * shape surface a clear deprecation message instead of a confusing 404.
 */
import { apiError, getRequestId } from "@/lib/api";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  return apiError(
    requestId,
    "NOT_FOUND",
    "Bundle top-ups are deprecated. /api/chat and /api/scan now charge per-request via mppx.",
    410,
  );
}
