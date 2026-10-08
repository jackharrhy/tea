import * as http from "node:http";
import * as crypto from "node:crypto";
import { createCookie } from "remix/cookie";
import { createRequestListener } from "remix/node-fetch-server";
import { createFsSessionStorage } from "remix/session-storage/fs";

import { assets } from "./app/assets.ts";
import { loadConfig } from "./app/config.ts";
import { ContentStore } from "./app/data/content-store.ts";
import { GitStore } from "./app/data/git-store.ts";
import { attachSockets } from "./app/middleware/websocket-server.ts";
import { createRouter } from "./app/router.tsx";

const config = loadConfig();
const store = new ContentStore({ dir: config.contentDir });
await store.ensureDir();

let gitStore: GitStore | undefined;
if (config.git) {
  gitStore = new GitStore({
    repoDir: config.git.repoDir,
    authorName: config.git.authorName,
    authorEmail: config.git.authorEmail,
    push: config.git.push,
  });
  await gitStore.assertRepo();
}

const sessionCookie = createCookie("marky.session", {
  secrets: [
    config.auth.mode === "discord"
      ? config.auth.sessionSecret
      : crypto.randomBytes(32).toString("hex"),
  ],
  httpOnly: true,
  sameSite: "Lax",
  secure:
    config.auth.mode === "discord" &&
    config.auth.baseUrl.startsWith("https://"),
  maxAge: 60 * 60 * 24 * 7,
  path: "/",
});
const sessionStorage = createFsSessionStorage(
  process.env.MARKY_SESSION_DIR || "./tmp/sessions",
);
const router = createRouter({ config, sessionStorage, sessionCookie });
const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await router.fetch(request);
    } catch (error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
);
const sockets = attachSockets(server, {
  store,
  config,
  gitStore,
  sessionStorage,
  sessionCookie,
});
server.listen(config.port, "0.0.0.0", () => {
  console.log(`marky is running on http://localhost:${config.port}`);
  console.log(`marky: serving content from ${config.contentDir}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  sockets.close();
  await sockets.room.dispose();
  server.close();
  server.closeAllConnections();
  await assets.close();
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
