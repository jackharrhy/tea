import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Link = { id: number; subject: string };
type Manifest = { operator: Link[]; sites: Record<string, Link[]> };

function links(value: unknown): Link[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Every target needs reviewed links");
  const ids = new Set<number>();
  const subjects = new Set<string>();
  return value.map((row) => {
    if (!row || typeof row !== "object") throw new Error("Invalid link");
    const { id, subject } = row as Record<string, unknown>;
    if (
      !Number.isSafeInteger(id) ||
      Number(id) <= 0 ||
      typeof subject !== "string" ||
      !subject ||
      subject.length > 512
    )
      throw new Error("Invalid local ID or subject");
    if (ids.has(Number(id)) || subjects.has(subject))
      throw new Error("Duplicate local ID or subject");
    ids.add(Number(id));
    subjects.add(subject);
    return { id: Number(id), subject };
  });
}

function manifest(value: unknown): Manifest {
  if (!value || typeof value !== "object") throw new Error("Invalid manifest");
  const root = value as Record<string, unknown>;
  if (
    !root.sites ||
    typeof root.sites !== "object" ||
    Array.isArray(root.sites)
  )
    throw new Error("Site links are required");
  const sites = Object.fromEntries(
    Object.entries(root.sites).map(([site, rows]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(site)) throw new Error("Invalid site ID");
      return [site, links(rows)];
    }),
  );
  if (!Object.keys(sites).length) throw new Error("Site links are required");
  return { operator: links(root.operator), sites };
}

function check(database: DatabaseSync, rows: Link[]) {
  const columns = database.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "auth_subject"))
    throw new Error("Apply the Central Auth schema migration first");
  for (const { id, subject } of rows) {
    const row = database
      .prepare("SELECT auth_subject FROM users WHERE id=?")
      .get(id);
    if (!row) throw new Error(`Unknown local user ID ${id}`);
    if (row.auth_subject !== null && row.auth_subject !== subject)
      throw new Error(`Local user ID ${id} already has another subject`);
    const owner = database
      .prepare("SELECT id FROM users WHERE auth_subject=?")
      .get(subject);
    if (owner && Number(owner.id) !== id)
      throw new Error("Subject already belongs to another local user");
  }
}

export function applyReviewedLinks(
  targets: { name: string; path: string; rows: Link[] }[],
  apply: boolean,
) {
  const databases: DatabaseSync[] = [];
  try {
    for (const target of targets) {
      if (!existsSync(target.path))
        throw new Error(`Missing ${target.name} database`);
      const database = new DatabaseSync(target.path);
      databases.push(database);
      check(database, target.rows);
    }
    if (apply)
      for (const [index, database] of databases.entries()) {
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const { id, subject } of targets[index].rows)
            database
              .prepare("UPDATE users SET auth_subject=? WHERE id=?")
              .run(subject, id);
          check(database, targets[index].rows);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }
    return targets.map((target) => ({
      target: target.name,
      links: target.rows.length,
    }));
  } finally {
    for (const database of databases) database.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  const input = process.argv[2];
  if (
    !input ||
    ![3, 4].includes(process.argv.length) ||
    (process.argv[3] && process.argv[3] !== "--apply")
  )
    throw new Error(
      "Usage: node --import remix/node-tsx scripts/link-central-auth.ts /private/reviewed-links.json [--apply]",
    );
  if (statSync(input).mode & 0o077)
    throw new Error("The reviewed manifest must be private (mode 0600)");
  const reviewed = manifest(JSON.parse(readFileSync(input, "utf8")));
  const root = resolve(process.env.TEA_DATA_DIR ?? "data");
  const targets = [
    {
      name: "operator",
      path: join(root, "operator", "operator.db"),
      rows: reviewed.operator,
    },
    ...Object.entries(reviewed.sites).map(([site, rows]) => ({
      name: site,
      path: join(root, site, "tea.db"),
      rows,
    })),
  ];
  const counts = applyReviewedLinks(targets, process.argv[3] === "--apply");
  console.log(
    JSON.stringify({ applied: process.argv[3] === "--apply", counts }),
  );
}
