import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { seedBuiltInTemplates } from "../src/services/email-templates";
import { createTeaExport, teaExportCounts } from "../src/migration/tea-export";
import * as schema from "../src/db/schema";

test("Tea export preserves domain data and excludes standalone credentials", () => {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  seedBuiltInTemplates(db as Parameters<typeof seedBuiltInTemplates>[0]);
  db.insert(schema.users)
    .values({
      email: "owner@example.com",
      name: "Owner",
      passwordHash: "must-not-export",
      role: "owner",
    })
    .run();
  db.insert(schema.subscribers)
    .values({
      email: "reader@example.com",
      unsubscribeToken: "preserve-live-link",
    })
    .run();
  db.insert(schema.sessions)
    .values({
      tokenHash: "session-secret",
      userId: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
    })
    .run();
  sqlite.exec("PRAGMA foreign_keys = OFF");
  db.insert(schema.events)
    .values({
      type: "subscriber.deleted",
      detail: "historical",
      subscriberId: 999,
    })
    .run();

  const bundle = createTeaExport(sqlite, "2026-11-10T00:00:00.000Z");

  expect(bundle.format).toBe("lists-tea-export");
  expect(bundle.tables.subscribers[0]).toMatchObject({
    email: "reader@example.com",
    unsubscribe_token: "preserve-live-link",
  });
  expect(bundle.tables.users[0]).toMatchObject({ email: "owner@example.com" });
  expect(JSON.stringify(bundle)).not.toContain("must-not-export");
  expect(JSON.stringify(bundle)).not.toContain("session-secret");
  expect(bundle.exclusions).toContain("sessions");
  expect(bundle.reconciliations.danglingEventReferences.subscribers).toBe(1);
  expect(bundle.tables.events[0]?.subscriber_id).toBeNull();
  expect(teaExportCounts(bundle).email_templates).toBe(1);
});
