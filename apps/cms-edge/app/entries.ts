import type { Collection, D1Database, Entry } from "./types.ts";

type Row = {
  collection: string;
  slug: string;
  draft: string | null;
  published: string | null;
  revision: number;
  published_at: string | null;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validSlug(slug: string) {
  return slug.length <= 100 && slugPattern.test(slug);
}

function read(row: Row, draft: boolean): Entry | null {
  const source = draft ? (row.draft ?? row.published) : row.published;
  if (!source) return null;
  return {
    collection: row.collection,
    slug: row.slug,
    data: JSON.parse(source) as Entry["data"],
    revision: row.revision,
    publishedAt: row.published_at,
  };
}

export async function getEntry(
  db: D1Database,
  collection: string,
  slug: string,
  draft = false,
) {
  const row = await db
    .prepare("SELECT * FROM tea_entries WHERE collection = ? AND slug = ?")
    .bind(collection, slug)
    .first<Row>();
  return row ? read(row, draft) : null;
}

export async function listEntries(
  db: D1Database,
  collection: string,
  draft = false,
) {
  const { results } = await db
    .prepare(
      "SELECT * FROM tea_entries WHERE collection = ? ORDER BY published_at DESC, slug ASC",
    )
    .bind(collection)
    .all<Row>();
  return results
    .map((row) => read(row, draft))
    .filter((entry): entry is Entry => !!entry);
}

export function parseFields(form: FormData, collection: Collection) {
  const data: Entry["data"] = {};
  for (const field of collection.fields) {
    const raw = form.get(field.name);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value)
      return { error: `${field.label} is required.` } as const;
    if (field.type === "number") {
      if (value && !Number.isFinite(Number(value)))
        return { error: `${field.label} must be a number.` } as const;
      data[field.name] = value ? Number(value) : 0;
    } else if (field.type === "boolean") {
      data[field.name] = value === "on";
    } else if (field.type === "select") {
      if (value && !field.options?.includes(value))
        return { error: `${field.label} has an invalid value.` } as const;
      data[field.name] = value;
    } else if (field.type === "url") {
      if (value && !/^https?:\/\//.test(value))
        return {
          error: `${field.label} must start with http:// or https://.`,
        } as const;
      data[field.name] = value;
    } else {
      data[field.name] = value;
    }
  }
  return { data } as const;
}

export async function saveDraft(
  db: D1Database,
  collection: Collection,
  slug: string,
  data: Entry["data"],
  expected: number,
) {
  if (!validSlug(slug))
    return {
      error: "Use a lowercase slug with letters, numbers and hyphens.",
      status: 400,
    } as const;
  const before = await db
    .prepare(
      "SELECT revision FROM tea_entries WHERE collection = ? AND slug = ?",
    )
    .bind(collection.name, slug)
    .first<{ revision: number }>();
  if ((!before && expected !== 0) || (before && before.revision !== expected))
    return {
      error: "This entry changed in another tab. Reload before saving.",
      status: 409,
    } as const;
  if (before) {
    const result = (await db
      .prepare(
        "UPDATE tea_entries SET draft = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE collection = ? AND slug = ? AND revision = ?",
      )
      .bind(JSON.stringify(data), collection.name, slug, expected)
      .run()) as { meta?: { changes?: number } };
    if (!result.meta?.changes)
      return {
        error: "This entry changed in another tab. Reload before saving.",
        status: 409,
      } as const;
  } else {
    try {
      await db
        .prepare(
          "INSERT INTO tea_entries (collection, slug, draft, revision) VALUES (?, ?, ?, 1)",
        )
        .bind(collection.name, slug, JSON.stringify(data))
        .run();
    } catch {
      return { error: "This slug already exists.", status: 409 } as const;
    }
  }
  return { revision: expected + 1 } as const;
}

export async function publishDraft(
  db: D1Database,
  collection: string,
  slug: string,
  expected: number,
) {
  const result = (await db
    .prepare(
      "UPDATE tea_entries SET published = draft, published_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE collection = ? AND slug = ? AND revision = ? AND draft IS NOT NULL",
    )
    .bind(collection, slug, expected)
    .run()) as { meta?: { changes?: number } };
  if (!result.meta?.changes)
    return {
      error: "The draft changed or is missing. Reload before publishing.",
      status: 409,
    } as const;
  return { revision: expected + 1 } as const;
}
