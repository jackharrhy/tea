import { bearer } from "./auth.ts";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import type { Bindings, Runtime } from "./runtime.ts";
import { hash } from "./runtime.ts";

export async function archiveRestoreAuthority(request: Request, env: Bindings) {
  const principal = await bearer(request, env, "archive-restore");
  if (!principal.roles.has("admin"))
    throw new CommunityError(403, "Explicit archive admin grant required");
}
export async function archiveObject(
  request: Request,
  env: Bindings,
  path: string,
) {
  await archiveRestoreAuthority(request, env);
  if (
    path.length > 255 ||
    path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
  )
    throw new CommunityError(422, "Invalid archive object path");
  const expected = request.headers.get("X-Content-SHA256");
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new CommunityError(422, "An object checksum is required");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new CommunityError(
      413,
      "Archive object exceeds the existing 10 MB upload limit",
    );
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected !== actual)
    throw new CommunityError(422, "Archive object checksum mismatch");
  const existing = await env.MEDIA.head(path);
  if (existing) {
    if (existing.customMetadata?.archive_sha256 !== actual)
      throw new CommunityError(
        409,
        "An unrelated object already occupies this path",
      );
  } else
    await env.MEDIA.put(path, bytes, {
      httpMetadata: {
        contentType:
          request.headers.get("Content-Type") ?? "application/octet-stream",
      },
      customMetadata: { archive_sha256: actual },
    });
  return Response.json({ ok: true, sha256: actual });
}
export async function restoreArchive(
  request: Request,
  env: Bindings,
  store: Runtime,
) {
  await archiveRestoreAuthority(request, env);
  const body = (await request.json()) as {
    tables?: Record<string, Row[]>;
    objects?: { storage_path: string; sha256: string; size_bytes: number }[];
  };
  if (
    !body.tables ||
    typeof body.tables !== "object" ||
    Array.isArray(body.tables) ||
    Object.values(body.tables).some((rows) => !Array.isArray(rows))
  )
    throw new CommunityError(422, "Invalid archive tables");
  for (const media of body.tables.media ?? []) {
    const descriptor = body.objects?.find(
      (object) => object.storage_path === media.storage_path,
    );
    const object = await env.MEDIA.head(String(media.storage_path));
    if (
      !descriptor ||
      !object ||
      object.size !== media.size_bytes ||
      descriptor.size_bytes !== media.size_bytes ||
      object.customMetadata?.archive_sha256 !== descriptor.sha256
    )
      throw new CommunityError(
        409,
        "Upload and verify every archive object before committing metadata",
      );
  }
  return Response.json(
    await store.call(
      "restore",
      body.tables,
      await hash(JSON.stringify(body.tables)),
    ),
  );
}
