import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";

import {
  createEmptyTeaDatabase,
  importTeaBundle,
  type UserSubjectMapping,
} from "../src/migration/tea-import.ts";

const [bundlePath, mappingPath, destinationPath] = process.argv.slice(2);
if (!bundlePath || !mappingPath || !destinationPath) {
  throw new Error(
    "Usage: bun run import:tea -- <export.json> <subject-mapping.json> <new-destination.db>",
  );
}

const bundle: unknown = JSON.parse(readFileSync(bundlePath, "utf8"));
const mapping = JSON.parse(
  readFileSync(mappingPath, "utf8"),
) as UserSubjectMapping;
closeSync(openSync(destinationPath, "wx", 0o600));

let sqlite;
try {
  sqlite = createEmptyTeaDatabase(destinationPath);
  const counts = importTeaBundle(sqlite, bundle, mapping);
  sqlite.close();
  console.log(JSON.stringify({ destinationPath, counts }));
} catch (error) {
  sqlite?.close();
  unlinkSync(destinationPath);
  throw error;
}
