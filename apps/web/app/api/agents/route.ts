import { SUB_AGENT_PUBLIC_LIST } from "@/lib/sub-agent-public-manifest";
import { apiError, apiSuccess, requireApiKeyOrPublic } from "@/lib/api";

export async function GET(req: Request) {
  const auth = requireApiKeyOrPublic(req);
  if (!auth.ok) return auth.response;
  const { requestId } = auth;

  try {
    const agents = SUB_AGENT_PUBLIC_LIST.map((config, index) => ({
      id: `a-${index + 1}`,
      name: config.name
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      type:
        config.name.includes("scanner") ||
        config.name.includes("detector") ||
        config.name.includes("analyst")
          ? "behavioral_scanner"
          : "protocol_auditor",
      status: "idle",
      lastRun: null,
      successRate: null,
      currentTask: config.description,
      model: config.primaryModel,
    }));

    return apiSuccess(requestId, { agents });
  } catch (error: any) {
    return apiError(requestId, "INTERNAL_ERROR", "Failed to load agents.", 500, error.message);
  }
}
