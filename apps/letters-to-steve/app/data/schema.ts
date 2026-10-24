import { column as c, table, type TableRow } from "remix/data-table";

const letterStates = ["inbox", "draft", "published", "archived"] as const;

export const fontKeys = ["handwritten", "book", "plain"] as const;
export type FontKey = (typeof fontKeys)[number];

export const letters = table({
  name: "letters",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    author: c.text().notNull(),
    email: c.text().nullable(),
    body: c.text().notNull(),
    body_json: c.text().nullable(),
    font_key: c.enum(fontKeys).notNull(),
    can_publish: c.boolean().notNull(),
    state: c.enum(letterStates).notNull(),
    created_at: c.integer().notNull(),
    private_replied_at: c.integer().nullable(),
  },
});

export type Letter = TableRow<typeof letters>;

const issueStates = ["draft", "published"] as const;

export const issues = table({
  name: "issues",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    response: c.text().notNull(),
    response_json: c.text().nullable(),
    state: c.enum(issueStates).notNull(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
    published_at: c.integer().nullable(),
  },
});

export type Issue = TableRow<typeof issues>;

export const issueLetters = table({
  name: "issue_letters",
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    issue_id: c
      .integer()
      .notNull()
      .references("issues", "id", "issue_letters_issue_fk")
      .onDelete("cascade"),
    letter_id: c
      .integer()
      .notNull()
      .unique("issue_letters_letter_unique")
      .references("letters", "id", "issue_letters_letter_fk"),
    position: c.integer().notNull(),
    public_author: c.text().notNull(),
    public_body: c.text().notNull(),
    public_body_json: c.text().nullable(),
    font_key: c.enum(fontKeys).notNull(),
  },
});

export type IssueLetter = TableRow<typeof issueLetters>;

export const attachments = table({
  name: "attachments",
  columns: {
    id: c.text().primaryKey(),
    draft_token: c.text().notNull(),
    letter_id: c
      .integer()
      .nullable()
      .references("letters", "id", "attachments_letter_fk")
      .onDelete("cascade"),
    storage_key: c.text().notNull().unique(),
    mime_type: c.text().notNull(),
    byte_size: c.integer().notNull(),
    width: c.integer().notNull(),
    height: c.integer().notNull(),
    is_public: c.boolean().notNull(),
    created_at: c.integer().notNull(),
  },
});

export type Attachment = TableRow<typeof attachments>;

export const siteSettings = table({
  name: "site_settings",
  columns: {
    id: c.integer().primaryKey(),
    is_enabled: c.boolean().notNull(),
    updated_at: c.integer().notNull(),
  },
});
