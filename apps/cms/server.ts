import * as http from "node:http";
import { createRequestListener } from "remix/node-fetch-server";
import { assets } from "./app/assets.ts";
import { loadSites, parseOperatorOrigin } from "./config.ts";
import { createApp } from "./app.ts";
import { createOperatorStore } from "./operator/store.ts";
import { resolve } from "node:path";
import { createLogger } from "@tea/logger";
const sites = await loadSites();
const operatorOrigin = parseOperatorOrigin(
  process.env.TEA_OPERATOR_ORIGIN,
  sites,
);
const operator = operatorOrigin
  ? {
      origin: operatorOrigin,
      store: createOperatorStore(
        resolve(process.env.TEA_DATA_DIR ?? "data", "operator", "operator.db"),
      ),
    }
  : undefined;
const app = await createApp(sites, operator);
const logger = createLogger({
  service: "cms",
  environment: process.env.NODE_ENV,
});
const server = http.createServer(
  createRequestListener((request) =>
    logger.request(request, async (log) => {
      try {
        return await app.fetch(request);
      } catch (error) {
        log.fail(error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }),
  ),
);
server.listen(
  Number(process.env.PORT ?? 4351),
  process.env.HOST ?? "127.0.0.1",
  () => {
    for (const site of sites)
      console.log(
        `${site.id}: ${site.origin}${site.preview ? " (preview)" : ""}`,
      );
    if (operator) console.log(`operator: ${operator.origin}`);
  },
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    app.close();
    await assets.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
