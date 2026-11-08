import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const issuer = "https://auth.jackharrhy.dev";
const Manifest = z.record(
  z.string(),
  z.object({
    issuer: z.literal(issuer),
    legacyUserId: z.union([z.string(), z.number()]),
    subject: z.string().min(1),
  }),
);

export function migrateIdentity(databasePath: string, manifestPath: string) {
  if (!existsSync(databasePath))
    throw new Error("Maps database does not exist");
  const entries = Manifest.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  const mapping = new Map<string, string>();
  const subjects = new Set<string>();
  for (const entry of Object.values(entries)) {
    const previous = String(entry.legacyUserId);
    if (mapping.has(previous) || subjects.has(entry.subject))
      throw new Error("Reviewed identity mapping is not one-to-one");
    mapping.set(previous, entry.subject);
    subjects.add(entry.subject);
  }

  const sql = new DatabaseSync(databasePath);
  try {
    sql.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    const columns = sql.prepare("PRAGMA table_info(users)").all();
    if (
      !columns.some((column) => column.name === "fourm_sub") ||
      columns.some((column) => column.name === "auth_subject")
    )
      throw new Error("Expected unmigrated Maps identity column");
    const users = sql.prepare("SELECT id, fourm_sub FROM users").all() as {
      id: string;
      fourm_sub: string;
    }[];
    const replacements = users.map((user) => {
      const subject = mapping.get(user.fourm_sub);
      if (!subject)
        throw new Error(
          "Unreviewed Maps identity; reconcile it before migration",
        );
      return { id: user.id, subject };
    });
    if (new Set(replacements.map((user) => user.subject)).size !== users.length)
      throw new Error("Multiple Maps accounts would share an identity");
    const update = sql.prepare("UPDATE users SET fourm_sub=? WHERE id=?");
    for (const user of users)
      update.run(`maps-migration-${randomUUID()}`, user.id);
    for (const user of replacements) update.run(user.subject, user.id);
    sql.exec(`
      ALTER TABLE users RENAME COLUMN fourm_sub TO auth_subject;
      DELETE FROM sessions;
      DELETE FROM automation_sessions;
      DELETE FROM automation_grants;
      DROP TABLE oauth_transactions;
      CREATE TABLE oauth_transactions (
        state_hash TEXT PRIMARY KEY, transaction_json TEXT NOT NULL,
        return_to TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
    `);
    if (sql.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Maps identity migration left broken references");
    sql.exec("COMMIT");
    return { users: users.length, mapped: replacements.length };
  } catch (error) {
    sql.exec("ROLLBACK");
    throw error;
  } finally {
    sql.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2)
    throw new Error("Usage: migrate-identity.ts DATABASE MANIFEST");
  const result = migrateIdentity(args[0]!, args[1]!);
  console.log(JSON.stringify(result));
}
