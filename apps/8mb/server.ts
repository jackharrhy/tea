import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequestListener } from "remix/node-fetch-server";
import { createEditorRouter } from "./app/router.tsx";
import { createDiagnosticsStore } from "./app/diagnostics/store.ts";
import { createDiagnosticsRouter } from "./app/diagnostics/router.ts";

const dist = join(import.meta.dirname, "dist");
const dataFile =
  process.env.DIAGNOSTICS_DB_FILE ?? "/app/data/diagnostics.sqlite";
const diagnostics = createDiagnosticsRouter({
  origin: process.env.APP_ORIGIN ?? "https://jackharrhy.dev",
  openStore: () => {
    mkdirSync(dirname(dataFile), { recursive: true });
    return createDiagnosticsStore({
      path: dataFile,
      revision: process.env.APP_REVISION ?? "local",
    });
  },
});
if (!diagnostics.initialize())
  console.warn("8mb diagnostics storage unavailable; editor remains ready");
const editor = createEditorRouter(dist);

async function fetch(request: Request) {
  const path = new URL(request.url).pathname;
  const response =
    path === "/8mb/api/diagnostics"
      ? await diagnostics.router.fetch(request)
      : await editor.fetch(request);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Cache-Control",
    path === "/8mb/api/diagnostics"
      ? "no-store"
      : path.startsWith("/8mb/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
  );
  return response;
}

const server = createServer(createRequestListener(fetch));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT ?? 5188), "0.0.0.0", () => {
  const address = server.address();
  console.log(`8mb ready ${typeof address === "object" ? address?.port : ""}`);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => {
      diagnostics.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
