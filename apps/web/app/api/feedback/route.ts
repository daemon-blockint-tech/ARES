import { apiError, apiSuccess, authenticateIngress, enforceRateLimit } from "@/lib/api";
import { agentPyPostJson, defaultRepoPayload } from "@/lib/agentpy-client";

interface Body {
  run_id?: unknown;
  finding_id?: unknown;
  rating?: unknown;
  comment?: unknown;
  retrieved_kb_ids?: unknown;
}

export async function POST(req: Request) {
  const ingress = authenticateIngress(req);
  if (!ingress.ok) return ingress.response;
  const { requestId, operator } = ingress;

  const rate = enforceRateLimit(req, requestId, operator ? "op:feedback" : "pub:feedback", operator ? 120 : 40);
  if (!rate.ok) return rate.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return apiError(requestId, "BAD_REQUEST", "JSON body required.", 400);
  }

  const run_id = typeof body.run_id === "string" ? body.run_id : "";
  const finding_id = typeof body.finding_id === "string" ? body.finding_id : "";
  const rating = typeof body.rating === "number" ? body.rating : Number.NaN;
  if (!run_id || !finding_id || ![-1, 0, 1].includes(rating)) {
    return apiError(requestId, "BAD_REQUEST", "run_id, finding_id, and rating ∈ {-1,0,1} are required.", 400);
  }

  try {
    const out = await agentPyPostJson<{ status: string }>("/v1/feedback", {
      ...defaultRepoPayload(),
      run_id,
      finding_id,
      rating,
      comment: typeof body.comment === "string" ? body.comment : undefined,
      retrieved_kb_ids: Array.isArray(body.retrieved_kb_ids) ? body.retrieved_kb_ids : undefined,
    });
    return apiSuccess(requestId, out);
  } catch (e: any) {
    return apiError(requestId, "BAD_GATEWAY", "agent-py feedback failed.", 502, e?.message || String(e));
  }
}
