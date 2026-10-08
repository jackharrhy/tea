import { and, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { openLazyFile } from "remix/fs";
import { createFileResponse } from "remix/response/file";

import { fileKinds, files, fileTags, folders, tags } from "#db";
import { db } from "#db/connection.server";
import { getFilePath } from "#lib/files.server";
import {
  requireServiceScope,
  serviceScopes,
  type ServiceScope,
} from "#lib/service-auth.server";
import { inspectWADFile, isWADFilename } from "#lib/wad-assets.server";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_FILTER_LENGTH = 160;
const MAX_CURSOR_LENGTH = 1_024;
const MAX_WAD_INSPECTION_SIZE = 256 * 1_024 * 1_024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const assetProjection = {
  id: files.id,
  path: files.path,
  name: files.name,
  kind: files.kind,
  mimeType: files.mimeType,
  size: files.size,
  width: files.width,
  height: files.height,
  sha256: files.sha256,
  createdAt: files.createdAt,
  folderId: folders.id,
  folderName: folders.name,
  folderSlug: folders.slug,
};

type AssetRow =
  Awaited<ReturnType<typeof findApprovedAsset>> extends infer result
    ? NonNullable<result>
    : never;

interface Cursor {
  createdAt: number;
  id: string;
}

export async function searchAssets(request: Request): Promise<Response> {
  const auth = await authorize(request, serviceScopes.assetsRead);
  if (auth) return auth;

  const parsed = parseSearch(new URL(request.url));
  if (parsed instanceof Response) return parsed;

  const predicates = [approvedWithDigest(), isNotNull(files.createdAt)];
  if (parsed.query) {
    predicates.push(
      sql`${files.name} like ${`%${escapeLike(parsed.query)}%`} escape ${"\\"}`,
    );
  }
  if (parsed.kind) predicates.push(eq(files.kind, parsed.kind));
  if (parsed.folderId) predicates.push(eq(files.folderId, parsed.folderId));
  if (parsed.tag) {
    predicates.push(
      sql`exists (
        select 1 from ${fileTags}
        inner join ${tags} on ${tags.id} = ${fileTags.tagId}
        where ${fileTags.fileId} = ${files.id} and ${tags.slug} = ${parsed.tag}
      )`,
    );
  }
  if (parsed.cursor) {
    const cursorDate = new Date(parsed.cursor.createdAt);
    predicates.push(
      or(
        lt(files.createdAt, cursorDate),
        and(eq(files.createdAt, cursorDate), lt(files.id, parsed.cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select(assetProjection)
    .from(files)
    .innerJoin(folders, eq(folders.id, files.folderId))
    .where(and(...predicates))
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(parsed.limit + 1);
  const page = rows.slice(0, parsed.limit) as AssetRow[];
  const assetTags = await tagsByFileId(page.map((file) => file.id));
  const last = page.at(-1);

  return json({
    assets: page.map((file) =>
      serializeAsset(file, assetTags.get(file.id) ?? []),
    ),
    nextCursor:
      rows.length > parsed.limit && last?.createdAt
        ? encodeCursor({ createdAt: last.createdAt.getTime(), id: last.id })
        : null,
  });
}

export async function assetMetadata(
  request: Request,
  assetId: string,
): Promise<Response> {
  const auth = await authorize(request, serviceScopes.assetsRead);
  if (auth) return auth;
  const file = await findApprovedAsset(assetId);
  if (!file) return assetNotFound();
  const assetTags = await tagsByFileId([file.id]);
  return json({ asset: serializeAsset(file, assetTags.get(file.id) ?? []) });
}

export async function assetContent(
  request: Request,
  assetId: string,
): Promise<Response> {
  const auth = await authorize(request, serviceScopes.assetsContent);
  if (auth) return auth;

  const expected = new URL(request.url).searchParams
    .get("sha256")
    ?.toLowerCase();
  if (!expected || !SHA256_PATTERN.test(expected)) {
    return apiError(
      400,
      "invalid_request",
      "sha256 must be a 64-character hexadecimal digest",
    );
  }
  const file = await findApprovedAsset(assetId);
  if (!file) return assetNotFound();
  if (file.sha256 !== expected) {
    return apiError(
      409,
      "asset_hash_changed",
      "The approved asset digest has changed",
      {
        expectedSha256: expected,
        currentSha256: file.sha256,
      },
    );
  }

  const lazyFile = openLazyFile(getFilePath(file.path), {
    name: file.name,
    type: file.mimeType,
  });
  try {
    const response = await createFileResponse(lazyFile, request, {
      cacheControl: "private, max-age=31536000, immutable",
      etag: "strong",
      digest: async () => file.sha256,
      acceptRanges: true,
    });
    response.headers.set(
      "Digest",
      `sha-256=${Buffer.from(file.sha256, "hex").toString("base64")}`,
    );
    response.headers.set("X-Artbin-Asset-Id", file.id);
    response.headers.set("X-Artbin-SHA256", file.sha256);
    return response;
  } catch {
    return apiError(
      503,
      "asset_unavailable",
      "The indexed asset bytes are temporarily unavailable",
    );
  }
}

export async function wadMetadata(
  request: Request,
  assetId: string,
): Promise<Response> {
  const auth = await authorize(request, serviceScopes.assetsRead);
  if (auth) return auth;
  const file = await findApprovedAsset(assetId);
  if (!file) return assetNotFound();
  if (!isWADFilename(file.name)) {
    return apiError(422, "unsupported_asset", "The asset is not a WAD file");
  }
  if (file.size > MAX_WAD_INSPECTION_SIZE) {
    return apiError(
      413,
      "asset_too_large",
      "WAD inspection is limited to 256 MiB",
    );
  }

  try {
    const contents = await inspectWADFile(file.path, file.sha256);
    if (!contents)
      return apiError(
        422,
        "invalid_wad",
        "The asset is not a valid WAD2 or WAD3 file",
      );
    const assetTags = await tagsByFileId([file.id]);
    return json({
      asset: serializeAsset(file, assetTags.get(file.id) ?? []),
      wad: {
        version: contents.version,
        lumpCount: contents.lumpCount,
        textures: contents.textures.map((texture) => ({
          index: texture.index,
          name: texture.name,
          width: texture.width,
          height: texture.height,
          transparent: texture.isTransparent,
        })),
      },
    });
  } catch {
    return apiError(
      422,
      "invalid_wad",
      "The asset is not a valid WAD2 or WAD3 file",
    );
  }
}

async function authorize(
  request: Request,
  scope: ServiceScope,
): Promise<Response | null> {
  const result = await requireServiceScope(request, scope);
  return result instanceof Response ? result : null;
}

async function findApprovedAsset(assetId: string) {
  const [file] = await db
    .select(assetProjection)
    .from(files)
    .innerJoin(folders, eq(folders.id, files.folderId))
    .where(and(eq(files.id, assetId), approvedWithDigest()))
    .limit(1);
  return file ?? null;
}

function approvedWithDigest() {
  return and(
    eq(files.status, "approved"),
    isNotNull(files.sha256),
    sql`length(${files.sha256}) = 64`,
    sql`${files.sha256} not glob '*[^0-9a-f]*'`,
  )!;
}

async function tagsByFileId(fileIds: string[]) {
  const result = new Map<
    string,
    Array<{ id: string; name: string; slug: string }>
  >();
  if (fileIds.length === 0) return result;
  const rows = await db
    .select({
      fileId: fileTags.fileId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(fileTags)
    .innerJoin(tags, eq(tags.id, fileTags.tagId))
    .where(inArray(fileTags.fileId, fileIds))
    .orderBy(tags.name);
  for (const row of rows) {
    const list = result.get(row.fileId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug });
    result.set(row.fileId, list);
  }
  return result;
}

function serializeAsset(
  file: AssetRow,
  assetTags: Array<{ id: string; name: string; slug: string }>,
) {
  return {
    id: file.id,
    name: file.name,
    path: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    width: file.width,
    height: file.height,
    folder: { id: file.folderId, name: file.folderName, slug: file.folderSlug },
    tags: assetTags,
  };
}

function parseSearch(url: URL):
  | {
      query: string | null;
      kind: (typeof fileKinds)[number] | null;
      folderId: string | null;
      tag: string | null;
      cursor: Cursor | null;
      limit: number;
    }
  | Response {
  const query = url.searchParams.get("q")?.trim() || null;
  if (query && query.length > MAX_QUERY_LENGTH) {
    return apiError(
      400,
      "invalid_request",
      `q must be at most ${MAX_QUERY_LENGTH} characters`,
    );
  }
  const rawKind = url.searchParams.get("kind")?.trim() || null;
  if (rawKind && !fileKinds.includes(rawKind as (typeof fileKinds)[number])) {
    return apiError(400, "invalid_request", "kind is not supported");
  }
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit && !/^\d+$/.test(rawLimit)) {
    return apiError(
      400,
      "invalid_request",
      "limit must be an integer between 1 and 100",
    );
  }
  const limit = rawLimit ? Number(rawLimit) : DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return apiError(
      400,
      "invalid_request",
      "limit must be an integer between 1 and 100",
    );
  }
  const rawCursor = url.searchParams.get("cursor");
  if (rawCursor && rawCursor.length > MAX_CURSOR_LENGTH) {
    return apiError(400, "invalid_cursor", "cursor is invalid");
  }
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor)
    return apiError(400, "invalid_cursor", "cursor is invalid");
  const folderId = url.searchParams.get("folderId")?.trim() || null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  if (
    (folderId && folderId.length > MAX_FILTER_LENGTH) ||
    (tag && tag.length > MAX_FILTER_LENGTH)
  ) {
    return apiError(
      400,
      "invalid_request",
      "folderId and tag must be at most 160 characters",
    );
  }
  return {
    query,
    kind: rawKind as (typeof fileKinds)[number] | null,
    folderId,
    tag,
    cursor,
    limit,
  };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<Cursor>;
    return typeof parsed.id === "string" &&
      parsed.id &&
      Number.isSafeInteger(parsed.createdAt)
      ? { id: parsed.id, createdAt: parsed.createdAt! }
      : null;
  } catch {
    return null;
  }
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function assetNotFound(): Response {
  return apiError(404, "asset_not_found", "Approved asset not found");
}

function json(value: unknown): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "private, no-cache" },
  });
}

function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
