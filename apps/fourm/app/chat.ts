import type { Runtime } from "./runtime.ts";
import { CommunityError } from "./data/community.ts";

export function chatStream(request: Request, store: Runtime, actorId: number) {
  let cursor = Number(
    request.headers.get("Last-Event-ID") ??
      new URL(request.url).searchParams.get("after") ??
      0,
  );
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new CommunityError(422, "Invalid message cursor");
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!request.signal.aborted) {
          if (closed) break;
          const messages = await store.call("chat", actorId, cursor);
          for (const message of messages) {
            cursor = Number(message.id);
            controller.enqueue(
              encoder.encode(
                `id: ${cursor}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`,
              ),
            );
          }
          if (messages.length === 200) continue;
          const present = await store.call("presence", actorId);
          controller.enqueue(
            encoder.encode(
              `event: presence\ndata: ${JSON.stringify(present)}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode(": keepalive\n\n"));
          await new Promise((accept) => setTimeout(accept, 2000));
        }
      } catch {
        if (!closed)
          controller.enqueue(
            encoder.encode("event: unavailable\ndata: {}\n\n"),
          );
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
