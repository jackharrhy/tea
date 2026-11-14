import * as http from "node:http";
import { createRequestListener } from "remix/node-fetch-server";
import { assets } from "./app/assets.ts";
import { loadSites, parseOperatorOrigin } from "./config.ts";
import { createApp } from "./app.ts";
import { createOperatorStore } from "./operator/store.ts";
import { resolve } from "node:path";
import { createLogger } from "@harrhy/logger";
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
        Boolean(process.env.TEA_AUTH_ISSUER),
      ),
    }
  : undefined;
const { createBackupService, backupConfig } =
  await import("./backup/service.ts");
const backups = createBackupService(
  resolve(process.env.TEA_DATA_DIR ?? "data"),
  [
    ...sites.map((site) => ({
      id: site.id,
      origin: site.origin,
      database: `${site.id}/tea.db`,
      trees: [`${site.id}/uploads`, `${site.id}/public`],
    })),
    ...(operator
      ? [
          {
            id: "operator",
            origin: operator.origin,
            database: "operator/operator.db",
            trees: [],
          },
        ]
      : []),
  ],
  backupConfig(),
);
const app = await createApp(sites, operator, backups.status);
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
    void backups.start();
  },
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await backups.close();
    app.close();
    await assets.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
