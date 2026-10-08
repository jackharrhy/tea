import { cleanFolderPath } from "@artbin/core/detection/filenames";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { files, folders } from "#db";
import { db } from "#db/connection.server";
import { relocateFile } from "#lib/file-relocation.server";
import {
  deleteFile,
  deleteFileRecord,
  finalizeFolders,
  ingestFile,
} from "#lib/files.server";

import type { OperationContext } from "./context.ts";
import { requireOperationAdmin } from "./context.ts";
import { OperationError } from "./errors.ts";

const MAX_MCP_UPLOAD_BYTES = 5 * 1024 * 1024;

export const assetListInput = z
  .object({
    folderSlug: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const assetUploadInput = z
  .object({
    folderSlug: z.string().min(1),
    fileName: z.string().min(1),
    contentBase64: z.string().min(1),
    confirm: z.literal(true),
  })
  .strict();

export const assetDeleteInput = z
  .object({
    fileId: z.string().min(1),
    execution: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("plan") }).strict(),
      z
        .object({
          mode: z.literal("apply"),
          confirm: z.literal(true),
          confirmationName: z.string(),
        })
        .strict(),
    ]),
  })
  .strict();

export const assetMoveInput = z
  .object({
    fileId: z.string().min(1),
    destinationSlug: z.string().min(1),
    execution: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("plan") }).strict(),
      z.object({ mode: z.literal("apply"), confirm: z.literal(true) }).strict(),
    ]),
  })
  .strict();

function serializeAsset(file: typeof files.$inferSelect, folderSlug: string) {
  return {
    id: file.id,
    name: file.name,
    path: file.path,
    folderSlug,
    kind: file.kind,
    mimeType: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    status: file.status,
    createdAt: file.createdAt?.toISOString() ?? null,
  };
}

export async function listAssetsOperation(
  context: OperationContext,
  input: z.output<typeof assetListInput>,
) {
  requireOperationAdmin(context);
  const storedFolders = await db.query.folders.findMany({
    columns: { id: true, slug: true },
  });
  const slugById = new Map(
    storedFolders.map((folder) => [folder.id, folder.slug]),
  );
  let assets = (await db.query.files.findMany({ orderBy: [files.path] }))
    .filter((file) => !input.kind || file.kind === input.kind)
    .filter(
      (file) =>
        !input.folderSlug || slugById.get(file.folderId) === input.folderSlug,
    )
    .map((file) => serializeAsset(file, slugById.get(file.folderId) ?? ""));
  if (input.cursor)
    assets = assets.filter((asset) => asset.path > input.cursor!);
  const page = assets.slice(0, input.limit);
  return {
    assets: page,
    nextCursor: page.length < assets.length ? page.at(-1)?.path : undefined,
  };
}

export async function uploadAssetOperation(
  context: OperationContext,
  input: z.output<typeof assetUploadInput>,
) {
  requireOperationAdmin(context);
  const slug = cleanFolderPath(input.folderSlug);
  if (!slug || slug !== input.folderSlug || slug.startsWith("_")) {
    throw new OperationError("Invalid folder slug", "invalid_request", 400);
  }
  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });
  if (!folder) throw new OperationError("Folder not found", "not_found", 404);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.contentBase64,
    )
  ) {
    throw new OperationError(
      "contentBase64 is invalid",
      "invalid_request",
      400,
    );
  }
  const buffer = Buffer.from(input.contentBase64, "base64");
  if (buffer.length > MAX_MCP_UPLOAD_BYTES) {
    throw new OperationError(
      "MCP uploads are limited to 5 MiB",
      "invalid_request",
      413,
    );
  }
  const ingested = await ingestFile({
    buffer,
    fileName: input.fileName,
    folderSlug: folder.slug,
    folderId: folder.id,
    source: "mcp-upload",
    uploaderId: context.user.id,
    overwrite: false,
  });
  if (ingested.isErr()) {
    throw new OperationError(ingested.error.message, "operation_failed", 400);
  }
  const stored = await db.query.files.findFirst({
    where: eq(files.id, ingested.value.fileId),
  });
  if (!stored) throw new Error("Uploaded asset record was not found");
  await finalizeFolders([folder.id]);
  return { asset: serializeAsset(stored, folder.slug) };
}

export async function deleteAssetOperation(
  context: OperationContext,
  input: z.output<typeof assetDeleteInput>,
) {
  requireOperationAdmin(context);
  const file = await db.query.files.findFirst({
    where: eq(files.id, input.fileId),
  });
  if (!file) throw new OperationError("Asset not found", "not_found", 404);
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, file.folderId),
  });
  if (!folder || folder.slug.startsWith("_"))
    throw new OperationError("Asset not found", "not_found", 404);
  const plan = { asset: serializeAsset(file, folder.slug) };
  if (input.execution.mode === "plan") return { applied: false as const, plan };
  if (input.execution.confirmationName !== file.name) {
    throw new OperationError(
      "Asset name confirmation did not match",
      "invalid_request",
      400,
    );
  }
  await deleteFile(file.path);
  const deleted = await deleteFileRecord(file.id);
  if (deleted.isErr())
    throw new OperationError(deleted.error.message, "operation_failed", 400);
  await finalizeFolders([folder.id]);
  return {
    applied: true as const,
    plan,
    deleted: { id: file.id, path: file.path },
  };
}

export async function moveAssetOperation(
  context: OperationContext,
  input: z.output<typeof assetMoveInput>,
) {
  requireOperationAdmin(context);
  const file = await db.query.files.findFirst({
    where: eq(files.id, input.fileId),
  });
  if (!file) throw new OperationError("Asset not found", "not_found", 404);
  const source = await db.query.folders.findFirst({
    where: eq(folders.id, file.folderId),
  });
  const destinationSlug = cleanFolderPath(input.destinationSlug);
  if (
    !source ||
    source.slug.startsWith("_") ||
    destinationSlug !== input.destinationSlug
  ) {
    throw new OperationError("Asset not found", "not_found", 404);
  }
  const destination = await db.query.folders.findFirst({
    where: and(
      eq(folders.slug, destinationSlug),
      ne(folders.slug, "_provided"),
    ),
  });
  if (!destination || destination.slug.startsWith("_")) {
    throw new OperationError("Destination folder not found", "not_found", 404);
  }
  const toPath = `${destination.slug}/${file.name}`;
  const collision = await db.query.files.findFirst({
    where: eq(files.path, toPath),
  });
  if (collision && collision.id !== file.id) {
    throw new OperationError(
      "An asset already exists at the destination",
      "conflict",
      409,
    );
  }
  const plan = {
    asset: serializeAsset(file, source.slug),
    destination: { id: destination.id, slug: destination.slug, path: toPath },
    noOp: file.folderId === destination.id,
  };
  if (input.execution.mode === "plan" || plan.noOp) {
    return { applied: false as const, plan };
  }
  relocateFile(file, { folderId: destination.id, path: toPath });
  await finalizeFolders([source.id, destination.id]);
  const moved = await db.query.files.findFirst({
    where: eq(files.id, file.id),
  });
  if (!moved) throw new Error("Moved asset record was not found");
  return {
    applied: true as const,
    plan,
    asset: serializeAsset(moved, destination.slug),
  };
}
