import { sourceMediaMetadata, mediaContentType } from "./media-headers.ts";
import { bearer } from "./auth.ts";
import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";
import type { Bindings, Runtime } from "./runtime.ts";
import { hash, runtime } from "./runtime.ts";

async function archiveRestoreAuthority(request: Request, env: Bindings) {
  const principal = await bearer(request, env, "archive-restore");
  if (!principal.roles.has("admin"))
    throw new CommunityError(403, "Explicit archive admin grant required");
  await runtime(env).call(
    "assertArchiveRestoreAuthority",
    env.AUTH_ISSUER,
    principal.subject,
  );
}
export async function archiveObject(
  request: Request,
  env: Bindings,
  path: string,
) {
  await archiveRestoreAuthority(request, env);
  if (
    path === ".backups" ||
    path.startsWith(".backups/") ||
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
  const sourceMetadata = sourceMediaMetadata({
    last_modified: request.headers.get("X-Source-Last-Modified") ?? undefined,
    etag: request.headers.get("X-Source-ETag") ?? undefined,
    mtime_ns: request.headers.get("X-Source-Mtime-Ns") ?? undefined,
  });
  await runtime(env).call("reserveArchiveObject", path);
  const existing = await env.MEDIA.head(path);
  if (existing && existing.customMetadata?.archive_sha256 !== actual)
    throw new CommunityError(
      409,
      "An unrelated object already occupies this path",
    );
  if (
    !existing ||
    Object.entries(sourceMetadata).some(
      ([key, value]) => existing.customMetadata?.[key] !== value,
    )
  ) {
    const written = await env.MEDIA.put(path, bytes, {
      onlyIf: existing
        ? { etagMatches: existing.etag }
        : { etagDoesNotMatch: "*" },
      httpMetadata: {
        ...existing?.httpMetadata,
        contentType:
          request.headers.get("Content-Type") ?? "application/octet-stream",
      },
      customMetadata: {
        ...existing?.customMetadata,
        archive_sha256: actual,
        ...sourceMetadata,
      },
    });
    if (!written) {
      const observed = await env.MEDIA.head(path);
      if (
        observed?.customMetadata?.archive_sha256 !== actual ||
        Object.entries(sourceMetadata).some(
          ([key, value]) => observed.customMetadata?.[key] !== value,
        )
      )
        throw new CommunityError(
          409,
          "Archive object changed during staging; retry the verified archive",
        );
    }
  }
  await runtime(env).call("releasePublishedArchiveObject", path);
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
    objects?: {
      storage_path: string;
      sha256: string;
      size_bytes: number;
      last_modified?: string;
      etag?: string;
      mtime_ns?: string;
    }[];
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
    const object = await env.MEDIA.head(String(media.storage_path)).catch(
      () => {
        throw new CommunityError(
          503,
          "Staged media verification could not finish",
        );
      },
    );
    if (
      !descriptor ||
      !object ||
      object.size !== media.size_bytes ||
      descriptor.size_bytes !== media.size_bytes ||
      object.customMetadata?.archive_sha256 !== descriptor.sha256 ||
      Object.entries(sourceMediaMetadata(descriptor)).some(
        ([key, value]) => object.customMetadata?.[key] !== value,
      )
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

export async function archiveMediaMetadata(env: Bindings, items: Row[]) {
  const result = [];
  for (const item of items) {
    const path = String(item.storage_path),
      object = await env.MEDIA.head(path);
    if (!object)
      throw new CommunityError(
        409,
        "Media disappeared while preparing the archive",
      );
    result.push({
      storage_path: path,
      last_modified: new Date(
        object.customMetadata?.fourm_last_modified ?? object.uploaded,
      ).toUTCString(),
      etag: object.customMetadata?.fourm_etag ?? object.httpEtag,
      ...(object.customMetadata?.fourm_mtime_ns
        ? { mtime_ns: object.customMetadata.fourm_mtime_ns }
        : {}),
      content_type: mediaContentType(path),
    });
  }
  return result;
}
