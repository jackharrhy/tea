import type { Runtime } from "./runtime.ts";
import { chatMessageHTML, chatPresenceHTML } from "./chat-html.ts";
export function chatStream(
  request: Request,
  store: Runtime,
  actorId: number | null,
) {
  const connection = crypto.randomUUID();
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, html: string) => {
        if (!closed)
          controller.enqueue(
            encoder.encode(
              `event: ${event}\n${html
                .split("\n")
                .map((line) => "data: " + line)
                .join("\n")}\n\n`,
            ),
          );
      };
      try {
        const initial = await store.call("openChat", actorId, connection);
        let cursor = initial.cursor;
        emit("presence", chatPresenceHTML(initial.presence));
        let presenceSent = Date.now();
        while (!request.signal.aborted) {
          if (closed) break;
          const update = await store.call(
            "pollChat",
            actorId,
            connection,
            cursor,
          );
          cursor = update.cursor;
          for (const event of update.events)
            emit("message", chatMessageHTML(event));
          if (Date.now() - presenceSent >= 10000) {
            emit("presence", chatPresenceHTML(update.presence));
            presenceSent = Date.now();
          }
          if (closed || request.signal.aborted) break;
          await store.call("waitChat", cursor);
        }
      } catch {
        if (!closed)
          controller.enqueue(encoder.encode("event: unavailable\ndata: \n\n"));
      } finally {
        await store.call("closeChat", actorId, connection);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    async cancel() {
      closed = true;
      await store.call("closeChat", actorId, connection);
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
