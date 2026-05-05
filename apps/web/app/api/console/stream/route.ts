import { NextRequest, NextResponse } from "next/server";
import { agentPyPostJson, defaultRepoPayload } from "@/lib/agentpy-client";
import { enforceRateLimit, requireApiKey } from "@/lib/api";

export async function GET(req: NextRequest) {
  const auth = requireApiKey(req);
  if (!auth.ok) return auth.response;
  const { requestId } = auth;
  const rate = enforceRateLimit(req, requestId, "console-stream", 30);
  if (!rate.ok) return rate.response;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (data: unknown) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const writeRaw = async (chunk: string) => {
    await writer.write(encoder.encode(chunk));
  };

  (async () => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      writer.close().catch(() => {});
    };

    req.signal.addEventListener("abort", cleanup);

    try {
      await writeRaw(": sse-open\n\n");

      const hist = await agentPyPostJson<{ messages: { role: string; content: string; timestamp: string }[] }>(
        "/v1/history",
        { limit: 20, ...defaultRepoPayload() },
      );
      const history = hist.messages || [];
      const chronological = [...history].reverse();

      for (const msg of chronological) {
        await send({
          type: "log",
          source: msg.role === "user" ? "Operator" : "ARES",
          level: msg.role === "user" ? "info" : "security",
          message: msg.content,
          timestamp: msg.timestamp,
        });
        await new Promise((r) => setTimeout(r, 100));
      }

      interval = setInterval(async () => {
        try {
          await send({
            type: "heartbeat",
            requestId,
            timestamp: new Date().toISOString(),
          });
        } catch {
          if (interval) clearInterval(interval);
        }
      }, 30000);
    } catch (err) {
      console.error("SSE Error:", err);
      try {
        await send({
          type: "error",
          requestId,
          message: "Failed to open persistence stream.",
        });
      } catch {
        /* stream already closed */
      }
      cleanup();
    }
  })();

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
