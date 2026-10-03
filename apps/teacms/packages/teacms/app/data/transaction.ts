import type { DatabaseSync } from "node:sqlite";

// All callbacks are synchronous. Acquire the write lock before checking revisions
// and references, and keep history in the same commit as the content it describes.
export function transaction<T>(db: DatabaseSync, write: () => T): T {
  if (db.isTransaction) return write();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
