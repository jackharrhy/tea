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
import { createBackupService } from "../backup/service.ts";
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
const backupDir = await mkdtemp(join(tmpdir(), "teacms-browser-backups-"));
const operator = createOperatorStore(join(dir, "operator/operator.db"));
const backups = createBackupService(
  dir,
  [
    ...sites.map((site) => ({
      id: site.id,
      database: `${site.id}/tea.db`,
      trees: [`${site.id}/uploads`, `${site.id}/public`],
    })),
    { id: "operator", database: "operator/operator.db", trees: [] },
  ],
  {
    directory: backupDir,
    intervalSeconds: 86400,
    retention: 7,
    reserveBytes: 1048576,
  },
);
operator.sqlite
  .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
  .run(
    "operator@example.test",
    await bcrypt.hash("operator-fixture-password", 4),
  );
const app = await createApp(
  sites,
  {
    origin: "http://operator.localhost:4352",
    store: operator,
  },
  backups.status,
);
for (const site of sites) await seedFixture(site);
await backups.start();
const server = http.createServer(
  createRequestListener((request) => app.fetch(request)),
);
server.listen(4352, "127.0.0.1");
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await backups.close();
    app.close();
    await assets.close();
    await rm(dir, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
