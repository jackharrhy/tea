import { CommunityError } from "./data/community.ts";
import { validateRecoveryState } from "./data/recovery.ts";
import type { RecoveryState } from "./data/recovery.ts";
import { canonicalTables } from "./canonical-tables.ts";
import { sha256, objectKey, storeImmutable } from "./backup-objects.ts";
type Bucket = Pick<R2Bucket, "get" | "head" | "put" | "list">;
type HeadersMetadata = Omit<R2HTTPMetadata, "cacheExpiry"> & {
  cacheExpiry?: string;
};
interface StoredFile {
  key: string;
  size: number;
  sha256: string;
  uploaded: string;
  httpEtag: string;
  httpMetadata: HeadersMetadata;
  customMetadata: Record<string, string>;
}
export interface NativeBackup {
  version: 1;
  kind: "native-recovery";
  name: string;
  recovery: RecoveryState;
  files: StoredFile[];
}
function keyFor(name: string) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(name))
    throw new CommunityError(422, "Invalid backup name");
  return `.backups/native/${name}.json`;
}
function encodedMetadata(object: R2Object): HeadersMetadata {
  const { cacheExpiry, ...rest } = object.httpMetadata ?? {};
  return Object.fromEntries(
    Object.entries({
      ...rest,
      ...(cacheExpiry ? { cacheExpiry: cacheExpiry.toISOString() } : {}),
    }).filter(([, value]) => value !== undefined && value !== null),
  ) as HeadersMetadata;
}
function stable(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
function recoveryFingerprint(state: RecoveryState) {
  return (
    canonicalTables(state.tables) +
    JSON.stringify([state.columns, state.sequences, state.exclusions])
  );
}
async function liveFiles(bucket: Bucket) {
  const files: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    files.push(
      ...page.objects.filter((file) => !file.key.startsWith(".backups/")),
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return files.toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
export async function readNativeBackup(
  bucket: Bucket,
  name: string,
): Promise<NativeBackup | null> {
  const object = await bucket.get(keyFor(name));
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  if ((await sha256(bytes)) !== object.customMetadata?.backup_sha256)
    throw new CommunityError(409, "Native backup manifest checksum mismatch");
  let backup: NativeBackup;
  try {
    backup = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CommunityError(409, "Invalid native backup manifest");
  }
  if (
    !backup ||
    backup.version !== 1 ||
    backup.kind !== "native-recovery" ||
    backup.name !== name ||
    !Array.isArray(backup.files) ||
    !backup.recovery?.columns
  )
    throw new CommunityError(409, "Invalid native backup manifest");
  validateRecoveryState(backup.recovery, backup.recovery.columns);
  const keys = new Set<string>();
  for (const file of backup.files) {
    if (
      !file ||
      typeof file.key !== "string" ||
      !file.key ||
      file.key.startsWith(".backups/") ||
      keys.has(file.key) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.uploaded !== "string" ||
      !Number.isFinite(Date.parse(file.uploaded)) ||
      typeof file.httpEtag !== "string" ||
      !file.httpMetadata ||
      typeof file.httpMetadata !== "object" ||
      Array.isArray(file.httpMetadata) ||
      Object.entries(file.httpMetadata).some(
        ([key, value]) =>
          ![
            "contentType",
            "contentLanguage",
            "contentDisposition",
            "contentEncoding",
            "cacheControl",
            "cacheExpiry",
          ].includes(key) || typeof value !== "string",
      ) ||
      (file.httpMetadata.cacheExpiry !== undefined &&
        !Number.isFinite(Date.parse(file.httpMetadata.cacheExpiry))) ||
      !file.customMetadata ||
      typeof file.customMetadata !== "object" ||
      Array.isArray(file.customMetadata) ||
      Object.values(file.customMetadata).some(
        (value) => typeof value !== "string",
      )
    )
      throw new CommunityError(409, "Invalid native backup file inventory");
    keys.add(file.key);
    const stored = await bucket.get(objectKey(file.sha256));
    if (
      !stored ||
      stored.size !== file.size ||
      (await sha256(await stored.arrayBuffer())) !== file.sha256
    )
      throw new CommunityError(409, "Native backup file verification failed");
  }
  return backup;
}
export async function captureNativeBackup(
  bucket: Bucket,
  name: string,
  readRecovery: () => Promise<RecoveryState>,
) {
  const existing = await readNativeBackup(bucket, name);
  if (existing) return existing;
  const recovery = await readRecovery();
  validateRecoveryState(recovery, recovery.columns);
  const listed = await liveFiles(bucket),
    files: StoredFile[] = [],
    observed = new Map<string, string>();
  for (const listedFile of listed) {
    const source = await bucket.get(listedFile.key);
    if (
      !source ||
      source.etag !== listedFile.etag ||
      source.size !== listedFile.size
    )
      throw new CommunityError(409, "Storage changed during native backup");
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength !== source.size)
      throw new CommunityError(
        409,
        "Storage size changed during native backup",
      );
    const sha = await sha256(bytes),
      httpMetadata = encodedMetadata(source),
      customMetadata = { ...source.customMetadata };
    await storeImmutable(
      bucket,
      objectKey(sha),
      bytes,
      sha,
      "application/octet-stream",
    );
    files.push({
      key: source.key,
      size: source.size,
      sha256: sha,
      uploaded: source.uploaded.toISOString(),
      httpEtag: source.httpEtag,
      httpMetadata,
      customMetadata,
    });
    observed.set(
      source.key,
      stable({
        etag: source.etag,
        size: source.size,
        uploaded: source.uploaded.toISOString(),
        httpMetadata: stable(httpMetadata),
        customMetadata: stable(customMetadata),
      }),
    );
  }
  if (
    recoveryFingerprint(recovery) !== recoveryFingerprint(await readRecovery())
  )
    throw new CommunityError(
      409,
      "Application state changed during native backup",
    );
  const after = await liveFiles(bucket);
  if (
    JSON.stringify(after.map((file) => file.key)) !==
    JSON.stringify(listed.map((file) => file.key))
  )
    throw new CommunityError(
      409,
      "Storage inventory changed during native backup",
    );
  for (const file of after) {
    const current = await bucket.head(file.key);
    if (
      !current ||
      observed.get(file.key) !==
        stable({
          etag: current.etag,
          size: current.size,
          uploaded: current.uploaded.toISOString(),
          httpMetadata: stable(encodedMetadata(current)),
          customMetadata: stable({ ...current.customMetadata }),
        })
    )
      throw new CommunityError(409, "Storage changed during native backup");
  }
  const backup: NativeBackup = {
    version: 1,
    kind: "native-recovery",
    name,
    recovery,
    files,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(backup)).buffer;
  await storeImmutable(
    bucket,
    keyFor(name),
    bytes,
    await sha256(bytes),
    "application/json",
  );
  const verified = await readNativeBackup(bucket, name);
  if (!verified)
    throw new CommunityError(503, "Native backup unavailable after capture");
  return verified;
}
export async function restoreNativeBackup<T>(
  bucket: Bucket,
  name: string,
  restoreState: (state: RecoveryState) => Promise<T>,
) {
  const backup = await readNativeBackup(bucket, name);
  if (!backup) throw new CommunityError(404, "Native backup not found");
  const expected = new Map(backup.files.map((file) => [file.key, file]));
  const current = await liveFiles(bucket);
  if (current.some((file) => !expected.has(file.key)))
    throw new CommunityError(409, "Restore target contains unrelated files");
  for (const file of backup.files) {
    const data = await bucket.get(objectKey(file.sha256));
    if (!data) throw new CommunityError(409, "Native backup file missing");
    const bytes = await data.arrayBuffer();
    if ((await sha256(bytes)) !== file.sha256)
      throw new CommunityError(409, "Native backup file verification failed");
    const httpMetadata: R2HTTPMetadata = {
      ...file.httpMetadata,
      ...(file.httpMetadata.cacheExpiry
        ? { cacheExpiry: new Date(file.httpMetadata.cacheExpiry) }
        : {}),
    } as R2HTTPMetadata;
    const customMetadata = {
      ...file.customMetadata,
      fourm_etag: file.customMetadata.fourm_etag ?? file.httpEtag,
      fourm_last_modified:
        file.customMetadata.fourm_last_modified ??
        new Date(file.uploaded).toUTCString(),
    };
    if (!(await bucket.head(file.key)))
      await bucket.put(file.key, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata,
        customMetadata,
      });
    const restored = await bucket.get(file.key);
    if (
      !restored ||
      (await sha256(await restored.arrayBuffer())) !== file.sha256 ||
      stable(encodedMetadata(restored)) !== stable(file.httpMetadata) ||
      ![stable(file.customMetadata), stable(customMetadata)].includes(
        stable({ ...restored.customMetadata }),
      ) ||
      (restored.customMetadata?.fourm_etag ?? restored.httpEtag) !==
        (file.customMetadata.fourm_etag ?? file.httpEtag) ||
      new Date(
        restored.customMetadata?.fourm_last_modified ?? restored.uploaded,
      ).toUTCString() !==
        new Date(
          file.customMetadata.fourm_last_modified ?? file.uploaded,
        ).toUTCString()
    )
      throw new CommunityError(
        409,
        "Restore target file differs from snapshot",
      );
  }
  const actual = await liveFiles(bucket);
  if (
    JSON.stringify(actual.map((file) => file.key)) !==
    JSON.stringify([...expected.keys()].toSorted())
  )
    throw new CommunityError(409, "Restore target changed while copying files");
  return {
    state: await restoreState(backup.recovery),
    files: backup.files.length,
  };
}
