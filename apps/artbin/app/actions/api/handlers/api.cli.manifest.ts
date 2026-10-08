import type * as Route from "./types.ts";
import { createRequestLogger } from "evlog";
import { requireSessionUser } from "#lib/session-auth.server";
import { db } from "#db/connection.server";
import { files } from "#db";
import { inArray } from "drizzle-orm";

interface ManifestInput {
  parentFolder: string;
  files: { path: string; sha256: string; size: number }[];
}

export async function action({ request }: Route.ActionArgs) {
  const log = createRequestLogger();
  await requireSessionUser(request);

  const body = (await request.json()) as ManifestInput;
  log.set({
    manifest: { parentFolder: body.parentFolder, fileCount: body.files.length },
  });

  const parentFolder = body.parentFolder;

  // Build all full paths
  const allPaths = body.files.map((f) => `${parentFolder}/${f.path}`);

  const foundFiles = new Map<string, { sha256: string | null; size: number }>();
  // Large imports must not exceed SQLite's parameter limit.
  for (let index = 0; index < allPaths.length; index += 500) {
    const found = await db.query.files.findMany({
      where: inArray(files.path, allPaths.slice(index, index + 500)),
      columns: { path: true, sha256: true, size: true },
    });
    for (const file of found) foundFiles.set(file.path, file);
  }
  const matches = (file: ManifestInput["files"][number]) => {
    const found = foundFiles.get(`${parentFolder}/${file.path}`);
    return found?.sha256 === file.sha256 && found.size === file.size;
  };

  // Split into new vs existing
  const newFiles = body.files.filter((f) => !matches(f)).map((f) => f.path);
  const existingFiles = body.files.filter(matches).map((f) => f.path);

  log.set({
    manifest: {
      newCount: newFiles.length,
      existingCount: existingFiles.length,
    },
  });
  log.emit();
  return Response.json({ newFiles, existingFiles });
}
