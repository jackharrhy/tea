import type { Db } from "./db";
import { schema } from "./db";
import type { Config } from "./config";

export async function bootstrapOwner(db: Db, config: Config) {
  if (!config.ownerEmail || !config.ownerPassword) return;
  const existing = db.select().from(schema.users).all();
  if (existing.length > 0) return;
  const passwordHash = await Bun.password.hash(config.ownerPassword);
  db.insert(schema.users)
    .values({
      email: config.ownerEmail,
      name: "Owner",
      passwordHash,
      role: "owner",
    })
    .run();
  console.log(`Bootstrapped owner account: ${config.ownerEmail}`);
}
