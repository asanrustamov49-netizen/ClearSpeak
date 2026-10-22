import { errorResponse, readJsonBody, UpstreamError } from "@/lib/http";
import { streamCoachReply } from "@/lib/omniroute";
import type { ChatStreamEvent } from "@/lib/types";
import { parseChatRequest } from "@/lib/validation";

/** Minimum gap between provisional text updates sent to the browser. */
const DELTA_INTERVAL_MS = 80;

/**
 * Streams the reply as NDJSON: `delta` events with the provisional reply text, then one `final`
 * event with the validated structured reply, or an `error` event. Validation errors before the
 * stream starts are regular JSON error responses.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseChatRequest(body.value);
  if (!parsed.ok) return errorResponse(400, "invalid_request", parsed.message);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client disconnected; nothing to do.
        }
      };

      let lastSentAt = 0;
      let pending: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (pending !== null) {
          send({ type: "delta", reply: pending });
          pending = null;
          lastSentAt = Date.now();
        }
      };

      try {
        const reply = await streamCoachReply(parsed.value, request.signal, {
          onReply: (text) => {
            pending = text;
            const wait = DELTA_INTERVAL_MS - (Date.now() - lastSentAt);
            if (wait <= 0) flush();
            else timer ??= setTimeout(flush, wait);
          },
          onReset: () => {
            if (timer) clearTimeout(timer);
            timer = null;
            pending = null;
            send({ type: "reset" });
          },
        });
        if (timer) clearTimeout(timer);
        send({ type: "final", data: reply });
      } catch (error) {
        if (timer) clearTimeout(timer);
        if (error instanceof UpstreamError) {
          send({ type: "error", error: { code: error.code, message: error.message } });
        } else if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[api/chat] unexpected error", error instanceof Error ? error.name : typeof error);
          send({ type: "error", error: { code: "internal", message: "Внутренняя ошибка сервера. Повторите попытку." } });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
