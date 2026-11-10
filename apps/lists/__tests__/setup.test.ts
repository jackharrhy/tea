import { test, expect } from "bun:test";
import { createTestDb } from "./helpers";
import * as schema from "../src/db/schema";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { seedBuiltInTemplates } from "../src/services/email-templates";
import { createDb } from "../src/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("test DB initializes with all tables", () => {
  const db = createTestDb();
  const lists = db.select().from(schema.lists).all();
  expect(lists).toEqual([]);
  const subscribers = db.select().from(schema.subscribers).all();
  expect(subscribers).toEqual([]);
  const campaigns = db.select().from(schema.campaigns).all();
  expect(campaigns).toEqual([]);
  const messages = db.select().from(schema.messages).all();
  expect(messages).toEqual([]);
});

test("file database tolerates short-lived concurrent writers", () => {
  const directory = mkdtempSync(join(tmpdir(), "lists-sqlite-"));
  try {
    const db = createDb(join(directory, "lists.db"));
    expect(db.$client.query("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(db.$client.query("PRAGMA busy_timeout").get()).toEqual({
      timeout: 5000,
    });
    db.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("built-in newsletter uses the quiet default design", () => {
  const db = createTestDb();
  const template = db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, "newsletter"))
    .get()!;

  expect(template.htmlSource).toContain(
    "font-size:16px;font-weight:600;line-height:22px",
  );
  expect(template.htmlSource).toContain(
    "Manage preferences</a>&nbsp;&nbsp;&nbsp;<a",
  );
  expect(template.htmlSource).not.toContain("text-transform:uppercase");
  expect(template.htmlSource).not.toContain(" · ");
});

test("built-in newsletter seeding never overwrites an existing template", () => {
  const db = createTestDb();
  const template = db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.slug, "newsletter"))
    .get()!;
  db.update(schema.emailTemplates)
    .set({
      htmlSource: "<p>Production template</p>",
      compiledHtml: "<p>Production template</p>",
    })
    .where(eq(schema.emailTemplates.id, template.id))
    .run();

  const preserved = seedBuiltInTemplates(db);
  expect(preserved.htmlSource).toBe("<p>Production template</p>");
});

test("mutable-template migration preserves the selected template source", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE email_templates (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, description TEXT, status TEXT, built_in INTEGER, current_version_id INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE email_template_versions (id INTEGER PRIMARY KEY, template_id INTEGER REFERENCES email_templates(id), version INTEGER, source_format TEXT, subject_source TEXT, html_source TEXT, text_source TEXT, compiled_html TEXT, sections TEXT, partials TEXT, created_by INTEGER, created_at TEXT);
    CREATE TABLE campaigns (id INTEGER PRIMARY KEY, template_version_id INTEGER REFERENCES email_template_versions(id));
    INSERT INTO email_templates VALUES (1, 'letter', 'Letter', NULL, 'active', 0, NULL, 'created', 'updated');
    INSERT INTO email_template_versions VALUES (7, 1, 3, 'html', 'Hello', '<p>Hello</p>', 'Hello', '<p>Hello</p>', '[]', '{}', NULL, 'created');
    UPDATE email_templates SET current_version_id = 7 WHERE id = 1;
    INSERT INTO email_templates VALUES (2, 'draft', 'Draft', NULL, 'draft', 0, NULL, 'created', 'updated');
    INSERT INTO email_template_versions VALUES (8, 2, 1, 'text', NULL, NULL, 'First', NULL, '[]', '{}', NULL, 'created');
    INSERT INTO email_template_versions VALUES (9, 2, 2, 'text', NULL, NULL, 'Latest', NULL, '[]', '{}', NULL, 'created');
    INSERT INTO campaigns VALUES (1, 7);
  `);
  const migration = await Bun.file(
    "drizzle/0023_mutable-email-templates.sql",
  ).text();
  for (const statement of migration.split("--> statement-breakpoint"))
    sqlite.exec(statement);
  const template = sqlite
    .query(
      "SELECT source_format, subject_source, html_source, text_source FROM email_templates WHERE id = 1",
    )
    .get() as Record<string, string>;
  expect(template).toEqual({
    source_format: "html",
    subject_source: "Hello",
    html_source: "<p>Hello</p>",
    text_source: "Hello",
  });
  expect(
    sqlite.query("SELECT text_source FROM email_templates WHERE id = 2").get(),
  ).toEqual({ text_source: "Latest" });
  expect(
    sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_template_versions'",
      )
      .get(),
  ).toBeNull();
  expect(
    sqlite
      .query("PRAGMA table_info(campaigns)")
      .all()
      .map((column: any) => column.name),
  ).toEqual(["id"]);
});
