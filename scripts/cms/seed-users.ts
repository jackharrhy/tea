import { join } from "node:path";
import bcrypt from "bcryptjs";
import { loadSites } from "../../apps/cms/config.ts";
import { createApp } from "../../apps/cms/app.ts";
import { openDatabase } from "@tea/cms-core/data/database.ts";
import { assets } from "@tea/cms-core/assets.ts";
const site = (await loadSites()).find((s) => s.id === process.argv[2]);
const email = process.env.TEA_ADMIN_EMAIL?.trim().toLowerCase(),
  password = process.env.TEA_ADMIN_PASSWORD;
if (!site || !email || !password || password.length < 12)
  throw new Error(
    "Usage: set TEA_ADMIN_EMAIL and TEA_ADMIN_PASSWORD (12+ characters), then npm run cms:seed-users -- site-id",
  );
const app = await createApp([site]);
app.close();
const { sqlite } = await openDatabase(join(site.dataDir, "tea.db"));
try {
  if (sqlite.prepare("SELECT id FROM users WHERE lower(email)=?").get(email))
    throw new Error("User exists; credentials were not changed.");
  sqlite
    .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
    .run(email, await bcrypt.hash(password, 12));
  console.log(`Editor created for ${site.id}.`);
} finally {
  sqlite.close();
  await assets.close();
}
