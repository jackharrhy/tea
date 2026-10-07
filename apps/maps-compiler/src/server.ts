import { createServer } from "node:http";
import { createRequestListener } from "remix/node-fetch-server";
import { createCompilerApp } from "./app.js";

const host = process.env.TEA_MAPS_COMPILER_HOST ?? "127.0.0.1";
const port = Number(process.env.TEA_MAPS_COMPILER_PORT ?? 8788);
const app = createCompilerApp();
const server = createServer(
  { maxHeaderSize: 16 * 1024 },
  createRequestListener(app.fetch),
);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.listen(port, host, () => {
  const state = app.configured() ? "ready" : "unconfigured";
  process.stdout.write(
    `Tea Maps compiler service (${state}) listening on http://${host}:${port}\n`,
  );
});
