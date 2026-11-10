import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/db/schema";
import { seedBuiltInTemplates } from "../src/services/email-templates";

export function createTestDb() {
  const db = drizzle(":memory:", { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  seedBuiltInTemplates(db as ReturnType<typeof createTestDb>);
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;

export function seedList(
  db: TestDb,
  overrides: Partial<typeof schema.lists.$inferInsert> = {},
) {
  return db
    .insert(schema.lists)
    .values({
      slug: "test-list",
      name: "Test List",
      description: "A test list",
      fromDomain: "example.com",
      ...overrides,
    })
    .returning()
    .get();
}

export function seedSubscriber(
  db: TestDb,
  overrides: Partial<typeof schema.subscribers.$inferInsert> = {},
) {
  return db
    .insert(schema.subscribers)
    .values({
      email: "test@example.com",
      unsubscribeToken: crypto.randomUUID(),
      ...overrides,
    })
    .returning()
    .get();
}
