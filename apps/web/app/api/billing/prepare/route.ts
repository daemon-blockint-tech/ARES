/**
 * DEPRECATED — replaced by mppx (audit fix #002).
 *
 * The previous flow generated a memo `ASST:<wallet>:<bundleId>:<nonce>` for
 * users to attach to a USDC transfer. Memo + treasury attribution had a
 * bundle-fraud bug (any positive lamports/tokens credited the full bundle).
 *
 * Pay-per-request via mppx removes this attack surface entirely.
 */
import { apiError, getRequestId } from "@/lib/api";

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  return apiError(
    requestId,
    "NOT_FOUND",
    "Bundle top-ups are deprecated. /api/chat and /api/scan now charge per-request via mppx.",
    410,
  );
}
