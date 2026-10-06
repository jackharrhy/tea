import * as http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestListener } from "remix/node-fetch-server";
import { createApp } from "../app.ts";
import { parseFixtureSites } from "./sites.ts";
import { assets } from "../app/assets.ts";
import { seedFixture } from "./fixture.ts";
import { createOperatorStore } from "../operator/store.ts";
import bcrypt from "bcryptjs";
const dir = await mkdtemp(join(tmpdir(), "teacms-browser-"));
const sites = parseFixtureSites(
  [
    {
      id: "andrew",
      template: "andrew",
      name: "Sidebar fixture",
      origin: "http://andrew.localhost:4352",
      aliases: [],
      preview: true,
    },
    {
      id: "luke",
      template: "luke",
      name: "Portfolio fixture",
      origin: "http://luke.localhost:4352",
      aliases: [],
      preview: true,
    },
  ],
  dir,
);
const operator = createOperatorStore(join(dir, "operator.db"));
operator.sqlite
  .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
  .run(
    "operator@example.test",
    await bcrypt.hash("operator-fixture-password", 4),
  );
const app = await createApp(sites, {
  origin: "http://operator.localhost:4352",
  store: operator,
});
for (const site of sites) await seedFixture(site);
const server = http.createServer(
  createRequestListener((request) => app.fetch(request)),
);
server.listen(4352, "127.0.0.1");
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    app.close();
    await assets.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
