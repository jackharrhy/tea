import { DatabaseSync } from "node:sqlite";

export function createDiagnosticsStore({
  path,
  revision,
  maxGroups = 10000,
  now = () => new Date(),
}: {
  path: string;
  revision: string;
  maxGroups?: number;
  now?: () => Date;
}) {
  if (!Number.isSafeInteger(maxGroups) || maxGroups < 1 || maxGroups > 10000)
    throw new RangeError("Invalid aggregate limit");
  if (!/^[\w.-]{1,64}$/.test(revision))
    throw new Error("Invalid build revision");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA journal_size_limit = 1048576;
      CREATE TABLE IF NOT EXISTS diagnostics (
        day TEXT NOT NULL, revision TEXT NOT NULL, dimensions TEXT NOT NULL,
        count INTEGER NOT NULL CHECK(count > 0),
        PRIMARY KEY(day, revision, dimensions)
      ) WITHOUT ROWID;
    `);
  } catch (error) {
    db.close();
    throw error;
  }
  const expired = db.prepare("DELETE FROM diagnostics WHERE day < ?");
  const update = db.prepare(
    "UPDATE diagnostics SET count = count + 1 WHERE day = ? AND revision = ? AND dimensions = ?",
  );
  const insert = db.prepare("INSERT INTO diagnostics VALUES (?, ?, ?, 1)");
  const count = db.prepare("SELECT count(*) count FROM diagnostics");
  function prune() {
    const cutoff = new Date(now());
    cutoff.setUTCDate(cutoff.getUTCDate() - 6);
    expired.run(cutoff.toISOString().slice(0, 10));
  }
  const timer = setInterval(() => {
    try {
      prune();
    } catch {}
  }, 3600000);
  timer.unref();
  let closed = false;
  return {
    add(event: Readonly<Record<string, string | number>>) {
      prune();
      const day = now().toISOString().slice(0, 10);
      const key = JSON.stringify(event, Object.keys(event).toSorted());
      if (update.run(day, revision, key).changes) return true;
      if (Number(count.get()?.count ?? maxGroups) >= maxGroups) return false;
      insert.run(day, revision, key);
      return true;
    },
    prune,
    close() {
      if (!closed) {
        closed = true;
        clearInterval(timer);
        db.close();
      }
    },
  };
}
