import { CommunityError } from "./data/community.ts";
type Bucket = Pick<R2Bucket, "get" | "head" | "put">;
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function objectKey(sha: string) {
  if (!/^[a-f0-9]{64}$/.test(sha))
    throw new CommunityError(409, "Invalid backup object checksum");
  return `.backups/objects/${sha}`;
}
export async function storeImmutable(
  bucket: Bucket,
  key: string,
  bytes: ArrayBuffer,
  sha: string,
  type: string,
) {
  if (!(await bucket.head(key)))
    await bucket.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: type },
      customMetadata: { backup_sha256: sha },
    });
  const stored = await bucket.get(key);
  if (
    !stored ||
    stored.customMetadata?.backup_sha256 !== sha ||
    (await sha256(await stored.arrayBuffer())) !== sha
  )
    throw new CommunityError(503, "Backup storage verification failed");
}
