import { sha256, objectKey, storeImmutable } from "./backup-objects.ts";
import { canonicalTables } from "./canonical-tables.ts";
export { canonicalTables } from "./canonical-tables.ts";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import { coreTables } from "./data/schema.ts";
import { mediaContentType } from "./media-headers.ts";

type Bucket = Pick<R2Bucket, "get" | "head" | "put">;
type Tables = Record<string, Row[]>;
interface SnapshotObject {
  storage_path: string;
  size_bytes: number;
  sha256: string;
  file: string;
  mime_type: string;
  content_type: string;
  last_modified: string;
  etag: string;
  mtime_ns?: string;
}
export interface BackupSnapshot {
  version: 1;
  name: string;
  tables: Tables;
  objects: SnapshotObject[];
}

function manifestKey(name: string) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(name))
    throw new CommunityError(422, "Invalid backup name");
  return `.backups/manifests/${name}.json`;
}
function metadata(object: R2Object, path: string) {
  return {
    content_type: mediaContentType(path),
    last_modified: new Date(
      object.customMetadata?.fourm_last_modified ?? object.uploaded,
    ).toUTCString(),
    etag: object.customMetadata?.fourm_etag ?? object.httpEtag,
    ...(object.customMetadata?.fourm_mtime_ns
      ? { mtime_ns: object.customMetadata.fourm_mtime_ns }
      : {}),
  };
}
export async function readBackupSnapshot(
  bucket: Bucket,
  name: string,
): Promise<BackupSnapshot | null> {
  const stored = await bucket.get(manifestKey(name));
  if (!stored) return null;
  const bytes = await stored.arrayBuffer();
  if ((await sha256(bytes)) !== stored.customMetadata?.backup_sha256)
    throw new CommunityError(409, "Backup manifest checksum mismatch");
  let snapshot: BackupSnapshot;
  try {
    snapshot = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CommunityError(409, "Invalid backup manifest");
  }
  if (
    snapshot?.version !== 1 ||
    snapshot.name !== name ||
    !snapshot.tables ||
    Array.isArray(snapshot.tables) ||
    !Array.isArray(snapshot.objects) ||
    Object.keys(snapshot.tables).length !== coreTables.length ||
    coreTables.some(
      (table) =>
        !Array.isArray(snapshot.tables[table]) ||
        snapshot.tables[table].some(
          (row) => !row || typeof row !== "object" || Array.isArray(row),
        ),
    )
  )
    throw new CommunityError(409, "Invalid backup manifest");
  const paths = new Set<string>();
  for (const item of snapshot.objects) {
    if (
      !item ||
      typeof item.storage_path !== "string" ||
      paths.has(item.storage_path) ||
      !Number.isSafeInteger(item.size_bytes) ||
      item.size_bytes < 0 ||
      item.file !== `objects/${item.sha256}`
    )
      throw new CommunityError(409, "Invalid backup object inventory");
    paths.add(item.storage_path);
    const object = await bucket.get(objectKey(item.sha256));
    if (
      !object ||
      object.size !== item.size_bytes ||
      (await sha256(await object.arrayBuffer())) !== item.sha256
    )
      throw new CommunityError(409, "Backup object verification failed");
  }
  if (
    snapshot.tables.media.length !== paths.size ||
    new Set(snapshot.tables.media.map((row) => row.storage_path)).size !==
      paths.size ||
    snapshot.tables.media.some(
      (row) =>
        !snapshot.objects.some(
          (object) =>
            object.storage_path === row.storage_path &&
            object.size_bytes === row.size_bytes,
        ),
    )
  )
    throw new CommunityError(409, "Backup media inventory mismatch");
  return snapshot;
}
export async function captureBackupSnapshot(
  bucket: Bucket,
  name: string,
  readTables: () => Promise<Tables>,
) {
  const existing = await readBackupSnapshot(bucket, name);
  if (existing)
    return {
      snapshot: existing,
      dbSize: new TextEncoder().encode(JSON.stringify(existing.tables))
        .byteLength,
      files: existing.objects.length,
    };
  const tables = await readTables();
  if (
    Object.keys(tables).length !== coreTables.length ||
    coreTables.some((table) => !Array.isArray(tables[table]))
  )
    throw new CommunityError(409, "Incomplete backup tables");
  const snapshot: BackupSnapshot = { version: 1, name, tables, objects: [] };
  const observations: { path: string; etag: string; metadata: string }[] = [];
  for (const media of tables.media) {
    const path = String(media.storage_path),
      source = await bucket.get(path);
    if (!source || source.size !== media.size_bytes)
      throw new CommunityError(409, "Media changed during backup");
    const bytes = await source.arrayBuffer(),
      sha = await sha256(bytes);
    if (bytes.byteLength !== media.size_bytes)
      throw new CommunityError(409, "Media size changed during backup");
    const details = metadata(source, path);
    observations.push({
      path,
      etag: source.etag,
      metadata: JSON.stringify(details),
    });
    await storeImmutable(
      bucket,
      objectKey(sha),
      bytes,
      sha,
      "application/octet-stream",
    );
    snapshot.objects.push({
      storage_path: path,
      size_bytes: bytes.byteLength,
      sha256: sha,
      file: `objects/${sha}`,
      mime_type: String(media.mime_type),
      ...details,
    });
  }
  if (canonicalTables(tables) !== canonicalTables(await readTables()))
    throw new CommunityError(
      409,
      "Community changed during backup; retry the pending run",
    );
  for (const before of observations) {
    const after = await bucket.head(before.path);
    if (
      !after ||
      after.etag !== before.etag ||
      JSON.stringify(metadata(after, before.path)) !== before.metadata
    )
      throw new CommunityError(
        409,
        "Media changed during backup; retry the pending run",
      );
  }
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
  await storeImmutable(
    bucket,
    manifestKey(name),
    bytes,
    await sha256(bytes),
    "application/json",
  );
  const verified = await readBackupSnapshot(bucket, name);
  if (!verified)
    throw new CommunityError(503, "Backup manifest is unavailable");
  return {
    snapshot: verified,
    dbSize: new TextEncoder().encode(JSON.stringify(verified.tables))
      .byteLength,
    files: verified.objects.length,
  };
}
