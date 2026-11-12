import { createRouter, createController } from "remix/router";
import { route, post } from "remix/routes";
import { readRequestBody } from "@harrhy/request-body";
import { validateDiagnostic } from "../ui/public/diagnostics.mjs";
import type { createDiagnosticsStore } from "./store.ts";

const routes = route({ diagnostics: post("/8mb/api/diagnostics") });
const response = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });
export function createDiagnosticsRouter({
  origin,
  openStore,
  maxPerMinute = 120,
  now = Date.now,
}: {
  origin: string;
  openStore: () => ReturnType<typeof createDiagnosticsStore>;
  maxPerMinute?: number;
  now?: () => number;
}) {
  if (
    !Number.isSafeInteger(maxPerMinute) ||
    maxPerMinute < 1 ||
    maxPerMinute > 120
  )
    throw new RangeError("Invalid request budget");
  const allowedOrigin = new URL(origin).origin;
  let store: ReturnType<typeof createDiagnosticsStore> | undefined;
  let count = 0,
    windowStart = now();
  function releaseStore() {
    const current = store;
    store = undefined;
    try {
      current?.close();
    } catch {
      // Keep optional diagnostics from preventing editor shutdown.
    }
  }
  function initialize() {
    try {
      store ??= openStore();
      store.prune();
      return true;
    } catch {
      releaseStore();
      return false;
    }
  }
  const router = createRouter();
  router.map(
    routes,
    createController(routes, {
      actions: {
        async diagnostics({ request }) {
          const reject = (status: number) => {
            void request.body?.cancel().catch(() => {});
            return response(status);
          };
          if (now() - windowStart >= 60000) {
            windowStart = now();
            count = 0;
          }
          if (++count > maxPerMinute) return reject(429);
          if (request.headers.get("origin") !== allowedOrigin)
            return reject(403);
          if (
            request.headers.get("content-type")?.split(";")[0]?.trim() !==
            "application/json"
          )
            return reject(415);
          const body = await readRequestBody(request, {
            maxBytes: 2048,
            timeoutMs: 2000,
          });
          if (!body.ok)
            return response(
              body.error === "too_large"
                ? 413
                : body.error === "unreadable"
                  ? 408
                  : 400,
            );
          let data: unknown;
          try {
            data = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(body.bytes),
            );
          } catch {
            return response(400);
          }
          if (!validateDiagnostic(data)) return response(400);
          try {
            store ??= openStore();
            return response(
              store.add(data as Record<string, string | number>) ? 204 : 429,
            );
          } catch {
            releaseStore();
            return response(503);
          }
        },
      },
    }),
  );
  return {
    router,
    initialize,
    close: releaseStore,
  };
}
