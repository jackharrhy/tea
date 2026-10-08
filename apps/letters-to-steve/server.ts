import * as http from "node:http";
import { createRequestListener } from "remix/node-fetch-server";

import { database, router } from "./app/router.ts";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44110;
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null;
const trustProxy = process.env.TRUST_PROXY === "true";

const server = http.createServer(
  createRequestListener(
    async (request) => {
      try {
        return await router.fetch(request);
      } catch (error) {
        if (!(request.signal.aborted && error === request.signal.reason)) {
          console.error(error);
        }
        return new Response("Internal Server Error", { status: 500 });
      }
    },
    { trustProxy },
  ),
);

server.listen(port, () => {
  if (process.env.REMIX_NODE_HMR) {
    import("remix/node-hmr/runtime").then((nodeHmr) =>
      nodeHmr.emitServerReady(),
    );
  }

  console.log(`Server listening on http://localhost:${hmrProxyPort ?? port}`);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.closeAllConnections();
  server.close(() => {
    void database.close().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
