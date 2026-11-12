import type { Database, Row } from "./community.ts";

// Existing pages exceed the runtime's single-SQL-value budget. The portable
// archive and HTTP contract still expose the original unmodified content field.
function chunks(value: string) {
  if (new TextEncoder().encode(value).byteLength <= 1_000_000) return [];
  const result: string[] = [];
  let part = "",
    count = 0;
  for (const character of value) {
    part += character;
    if (++count === 200_000) {
      result.push(part);
      part = "";
      count = 0;
    }
  }
  if (part) result.push(part);
  return result;
}

export function pageContent(db: Database) {
  db.all(`CREATE TABLE IF NOT EXISTS page_content_chunks (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, content TEXT NOT NULL,
    PRIMARY KEY(page_id,position)
  );`);

  return {
    chunks,
    write(id: number, parts: string[]) {
      db.all("DELETE FROM page_content_chunks WHERE page_id=?", id);
      parts.forEach((part, position) =>
        db.all(
          "INSERT INTO page_content_chunks VALUES(?,?,?)",
          id,
          position,
          part,
        ),
      );
    },
    read(row: Row) {
      const parts = db.all(
        "SELECT content FROM page_content_chunks WHERE page_id=? ORDER BY position",
        row.id,
      );
      return parts.length
        ? { ...row, content: parts.map((part) => part.content).join("") }
        : row;
    },
  };
}
