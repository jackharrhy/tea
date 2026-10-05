import * as http from "node:http";
import { createRequestListener } from "remix/node-fetch-server";
import { assets } from "@tea/cms-core/assets.ts";
import { loadSites, parseOperatorOrigin } from "./config.ts";
import { createApp } from "./app.ts";
import { OperatorStore } from "@tea/cms-operator/store.ts";
import { resolve } from "node:path";
const sites = await loadSites();
const operatorOrigin = parseOperatorOrigin(
  process.env.TEA_OPERATOR_ORIGIN,
  sites,
);
const operator = operatorOrigin
  ? {
      origin: operatorOrigin,
      store: new OperatorStore(
        resolve(process.env.TEA_DATA_DIR ?? "data", "operator", "operator.db"),
      ),
    }
  : undefined;
const app = await createApp(sites, operator);
const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await app.fetch(request);
    } catch (error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
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
