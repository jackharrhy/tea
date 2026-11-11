import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequestListener } from "remix/node-fetch-server";
import { gardenConfig } from "./app/config.ts";
import { createGarden } from "./app/router.tsx";

const config = gardenConfig();
const { router, content, reloadBrowser } = createGarden(config);
content.read();
const watchers: fs.FSWatcher[] = [];
if (config.development) {
  for (const directory of [config.directory, config.assetsDirectory]) {
    if (fs.existsSync(directory))
      watchers.push(
        fs.watch(directory, { recursive: true }, () => content.invalidate()),
      );
  }
  for (const directory of ["./app/ui/public/", "./public/"]) {
    watchers.push(
      fs.watch(
        fileURLToPath(new URL(directory, import.meta.url)),
        { recursive: true },
        reloadBrowser,
      ),
    );
  }
}
const server = http.createServer(
  createRequestListener(
    async (request) => {
      try {
        return await router.fetch(request);
      } catch (error) {
        console.error(error);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
    { trustProxy: process.env.TRUST_PROXY === "true" },
  ),
);
const port = Number(process.env.PORT || 4322);
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`Garden: http://localhost:${port}`),
);
function shutdown() {
  for (const watcher of watchers) watcher.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
