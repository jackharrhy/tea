import { z } from "zod";
import type { Hall } from "./hall";

export function updateControlPort() {
  const api = Number(process.env.API_PORT ?? 3188);
  return Number(process.env.UPDATE_CONTROL_PORT ?? (api === 0 ? 0 : api + 1));
}
export const updateDrainReceipt = z
  .object({
    version: z.literal(1),
    state: z.literal("drained"),
  })
  .strict();

export function createUpdateControl(hall: Hall, port = updateControlPort()) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: 1024,
    fetch(req, server) {
      // This listener is never proxied by the public HTTP server or Vite.
      if (
        server.requestIP(req)?.address !== "127.0.0.1" ||
        req.headers.has("origin")
      )
        return new Response("Forbidden", { status: 403 });
      if (req.method !== "POST")
        return new Response("Method not allowed", { status: 405 });
      const path = new URL(req.url).pathname;
      if (path === "/drain") {
        const drained = hall.drainForUpdate();
        return Response.json(
          { version: 1, state: drained ? "drained" : "busy" },
          { status: drained ? 200 : 409 },
        );
      }
      if (path === "/resume") {
        hall.resumeAfterUpdate();
        return Response.json({ version: 1, state: "open" });
      }
      return new Response("Not found", { status: 404 });
    },
    error() {
      return Response.json({ version: 1, state: "unknown" }, { status: 503 });
    },
  });
}
