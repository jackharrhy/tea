import * as http from "node:http";

import { createRequestListener } from "remix/node-fetch-server";

import { assetServer } from "./app/assets.ts";
import { router } from "./app/router.ts";
import { startBackgroundJobs, stopBackgroundJobs } from "./app/startup.ts";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 5175;
const host = process.env.HOST ?? "127.0.0.1";
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null;

await startBackgroundJobs();

const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await router.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      if (!(request.signal.aborted && error === request.signal.reason)) {
        console.error(error);
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
);

server.listen(port, host, () => {
  if (process.env.REMIX_NODE_HMR) {
    import("remix/node-hmr/runtime").then((nodeHmr) =>
      nodeHmr.emitServerReady(),
    );
  }

  console.log(`artbin listening on http://${host}:${hmrProxyPort ?? port}`);
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  stopBackgroundJobs();
  server.close();
  server.closeAllConnections();
  await assetServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
