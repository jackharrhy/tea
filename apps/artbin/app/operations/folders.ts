import { existsSync } from "node:fs";
import { rmdir } from "node:fs/promises";

import {
  cleanFolderPath,
  cleanFolderSlug,
} from "@tea/artbin-core/detection/filenames";
import { count, eq, sql } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { nanoid } from "nanoid";
import { z } from "zod";

import { files, folders, remoteImports } from "#db";
import { db } from "#db/connection.server";
import {
  deleteFile,
  deleteFolder,
  ensureDir,
  slugToPath,
} from "#lib/files.server";
import { moveFolder, renameFolder } from "#lib/folders.server";

import type { OperationContext } from "./context.ts";
import { requireOperationAdmin } from "./context.ts";
import { OperationError } from "./errors.ts";

export const folderListInput = z
  .object({
    slug: z.string().min(1).optional(),
    includeSystem: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const folderDeleteInput = z
  .object({
    slug: z.string().min(1),
    execution: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("plan") }).strict(),
      z
        .object({
          mode: z.literal("apply"),
          confirm: z.literal(true),
          confirmationName: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();

export const folderCreateInput = z
  .object({
    folders: z
      .array(
        z
          .object({
            slug: z.string().min(1),
            name: z.string().min(1),
            parentSlug: z.string().min(1).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    execution: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("plan") }).strict(),
      z.object({ mode: z.literal("apply"), confirm: z.literal(true) }).strict(),
    ]),
  })
  .strict();

const executionInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plan") }).strict(),
  z.object({ mode: z.literal("apply"), confirm: z.literal(true) }).strict(),
]);

export const folderManageInput = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("rename"),
      slug: z.string().min(1),
      name: z.string().min(1),
      execution: executionInput,
    })
    .strict(),
  z
    .object({
      operation: z.literal("move"),
      slug: z.string().min(1),
      destinationSlug: z.string().min(1).nullable(),
      execution: executionInput,
    })
    .strict(),
]);

type FolderImpact = {
  folder: typeof folders.$inferSelect;
  descendantIds: string[];
  fileCount: number;
};

export interface FolderPlan {
  operation: "rename" | "move";
  from: { id: string; name: string; slug: string; parentSlug: string | null };
  to: { name: string; slug: string; parentSlug: string | null };
  affected: { folders: number; files: number };
  noOp: boolean;
}

function serializeFolderMutationResult<
  T extends { folder?: typeof folders.$inferSelect },
>(result: T) {
  return {
    ...result,
    folder: result.folder
      ? {
          ...result.folder,
          createdAt: result.folder.createdAt?.toISOString() ?? null,
        }
      : undefined,
  };
}

function isSystemFolder(slug: string): boolean {
  return slug.startsWith("_");
}

function summarizeFolders(allFolders: (typeof folders.$inferSelect)[]) {
  const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
  const childCounts = new Map<string, number>();
  const totals = new Map(
    allFolders.map((folder) => [
      folder.id,
      { descendantCount: 0, totalFileCount: folder.fileCount ?? 0 },
    ]),
  );
  for (const folder of allFolders) {
    if (folder.parentId && byId.has(folder.parentId)) {
      childCounts.set(
        folder.parentId,
        (childCounts.get(folder.parentId) ?? 0) + 1,
      );
    }
  }
  for (const folder of [...allFolders].toSorted(
    (a, b) => b.slug.split("/").length - a.slug.split("/").length,
  )) {
    if (!folder.parentId || !byId.has(folder.parentId)) continue;
    const child = totals.get(folder.id)!;
    const parent = totals.get(folder.parentId)!;
    parent.descendantCount += 1 + child.descendantCount;
    parent.totalFileCount += child.totalFileCount;
  }
  return allFolders
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      slug: folder.slug,
      description: folder.description,
      parentId: folder.parentId,
      parentSlug: folder.parentId
        ? (byId.get(folder.parentId)?.slug ?? null)
        : null,
      fileCount: folder.fileCount ?? 0,
      childCount: childCounts.get(folder.id) ?? 0,
      descendantCount: totals.get(folder.id)!.descendantCount,
      totalFileCount: totals.get(folder.id)!.totalFileCount,
      createdAt: folder.createdAt?.toISOString() ?? null,
    }))
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}

export async function listFoldersOperation(
  context: OperationContext,
  input: z.output<typeof folderListInput>,
) {
  const stored = await db.query.folders.findMany({ orderBy: [folders.slug] });
  const includeSystem = input.includeSystem && context.user.isAdmin;
  const visible = includeSystem
    ? stored
    : stored.filter((folder) => !isSystemFolder(folder.slug));
  const summaries = summarizeFolders(visible);
  if (!input.slug) {
    const start = input.cursor
      ? summaries.findIndex((folder) => folder.slug > input.cursor!)
      : 0;
    const pageStart = start === -1 ? summaries.length : start;
    const page = summaries.slice(pageStart, pageStart + input.limit);
    const hasMore = pageStart + page.length < summaries.length;
    return {
      folders: page,
      nextCursor: hasMore ? page.at(-1)?.slug : undefined,
    };
  }

  const slug = cleanFolderPath(input.slug);
  if (!slug || slug !== input.slug)
    throw new OperationError("Invalid folder slug", "invalid_request", 400);
  const folder = stored.find((candidate) => candidate.slug === slug);
  if (!folder || (isSystemFolder(folder.slug) && !context.user.isAdmin)) {
    throw new OperationError("Folder not found", "not_found", 404);
  }
  const detail = summarizeFolders(
    context.user.isAdmin
      ? stored
      : stored.filter((candidate) => !isSystemFolder(candidate.slug)),
  );
  const summary = detail.find((candidate) => candidate.id === folder.id)!;
  const source = await db.query.remoteImports.findFirst({
    where: eq(remoteImports.folderId, folder.id),
    orderBy: (imports, { desc }) => [desc(imports.updatedAt)],
    columns: {
      provider: true,
      externalId: true,
      sourceUrl: true,
      title: true,
      author: true,
      game: true,
    },
  });
  return {
    folder: {
      ...summary,
      children: detail.filter((candidate) => candidate.parentId === folder.id),
      source: source ?? null,
    },
  };
}

export async function deleteFolderOperation(
  context: OperationContext,
  input: z.output<typeof folderDeleteInput>,
) {
  requireOperationAdmin(context);
  if (input.slug.startsWith("_"))
    throw new OperationError("Folder not found", "not_found", 404);
  const slug = cleanFolderPath(input.slug);
  if (!slug || slug !== input.slug)
    throw new OperationError("Invalid folder slug", "invalid_request", 400);
  const impact = await getFolderImpact(slug);
  if (!impact || impact.folder.slug.startsWith("_"))
    throw new OperationError("Folder not found", "not_found", 404);

  const plan = {
    folder: {
      id: impact.folder.id,
      name: impact.folder.name,
      slug: impact.folder.slug,
    },
    affected: {
      folders: 1 + impact.descendantIds.length,
      files: impact.fileCount,
    },
  };
  if (input.execution.mode === "plan") return { applied: false as const, plan };
  if (input.execution.confirmationName !== impact.folder.name) {
    throw new OperationError(
      "Folder name confirmation did not match",
      "invalid_request",
      400,
    );
  }
  await deleteFolderTree(impact.folder.id, impact.folder.slug);
  return { applied: true as const, plan, deleted: plan.affected };
}

async function deleteFolderTree(
  folderId: string,
  folderSlug: string,
): Promise<void> {
  const [folderFiles, childFolders] = await Promise.all([
    db.query.files.findMany({ where: eq(files.folderId, folderId) }),
    db.query.folders.findMany({ where: eq(folders.parentId, folderId) }),
  ]);
  for (const file of folderFiles) await deleteFile(file.path);
  for (const child of childFolders)
    await deleteFolderTree(child.id, child.slug);
  await db.delete(files).where(eq(files.folderId, folderId));
  await db.delete(folders).where(eq(folders.id, folderId));
  await deleteFolder(folderSlug);
}

export async function createFoldersOperation(
  context: OperationContext,
  input: z.output<typeof folderCreateInput>,
) {
  requireOperationAdmin(context);
  const stored = await db.query.folders.findMany();
  const storedBySlug = new Map(stored.map((folder) => [folder.slug, folder]));
  const plannedBySlug = new Map<
    string,
    { slug: string; name: string; parentSlug: string | null; id: string }
  >();
  const existing: { slug: string; id: string }[] = [];

  for (const requested of input.folders) {
    const slug = cleanFolderPath(requested.slug);
    if (!slug || slug !== requested.slug) {
      throw new OperationError(
        `Invalid folder slug: ${requested.slug}`,
        "invalid_request",
        400,
      );
    }
    if (isSystemFolder(slug)) {
      throw new OperationError(
        "System folders cannot be created through this operation",
        "invalid_request",
        400,
      );
    }
    const name = requested.name.trim();
    if (!name)
      throw new OperationError(
        "Folder name is required",
        "invalid_request",
        400,
      );
    if (plannedBySlug.has(slug)) {
      throw new OperationError(
        `Duplicate folder slug: ${slug}`,
        "invalid_request",
        400,
      );
    }
    const found = storedBySlug.get(slug);
    if (found) {
      existing.push({ slug: found.slug, id: found.id });
      continue;
    }
    const slash = slug.lastIndexOf("/");
    const expectedParentSlug = slash === -1 ? null : slug.slice(0, slash);
    const parentSlug = requested.parentSlug ?? null;
    if (parentSlug !== expectedParentSlug) {
      throw new OperationError(
        `Parent folder for "${slug}" must be ${expectedParentSlug ? `"${expectedParentSlug}"` : "null"}`,
        "invalid_request",
        400,
      );
    }
    plannedBySlug.set(slug, { slug, name, parentSlug, id: nanoid() });
  }

  for (const planned of plannedBySlug.values()) {
    if (
      planned.parentSlug &&
      !storedBySlug.has(planned.parentSlug) &&
      !plannedBySlug.has(planned.parentSlug)
    ) {
      throw new OperationError(
        `Parent folder not found: ${planned.parentSlug}`,
        "not_found",
        404,
      );
    }
  }
  const plannedFolders = [...plannedBySlug.values()].toSorted(
    (left, right) => left.slug.split("/").length - right.slug.split("/").length,
  );

  const plan = {
    create: plannedFolders.map(({ slug, name, parentSlug }) => ({
      slug,
      name,
      parentSlug,
    })),
    existing,
  };
  if (input.execution.mode === "plan") return { applied: false as const, plan };

  const createdDirectories: string[] = [];
  try {
    for (const planned of plannedFolders) {
      const path = slugToPath(planned.slug);
      if (!existsSync(path)) {
        await ensureDir(path);
        createdDirectories.push(path);
      }
    }
    db.transaction((transaction) => {
      for (const planned of plannedFolders) {
        const parent = planned.parentSlug
          ? (storedBySlug.get(planned.parentSlug) ??
            plannedBySlug.get(planned.parentSlug))
          : null;
        transaction
          .insert(folders)
          .values({
            id: planned.id,
            name: planned.name,
            slug: planned.slug,
            parentId: parent?.id ?? null,
            ownerId: context.user.id,
          })
          .run();
      }
    });
  } catch (error) {
    for (const path of createdDirectories.toReversed())
      await rmdir(path).catch(() => undefined);
    throw error;
  }
  return {
    applied: true as const,
    plan,
    created: plannedFolders.map(({ slug, id }) => ({ slug, id })),
    existing,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function getFolderImpact(slug: string): Promise<FolderImpact | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });
  if (!folder) return null;
  const descendants = await db
    .select({ id: folders.id })
    .from(folders)
    .where(sql`${folders.slug} LIKE ${`${escapeLike(slug)}/%`} ESCAPE '\\'`);
  const [{ value: affectedFiles }] = await db
    .select({ value: count() })
    .from(files)
    .where(sql`${files.path} LIKE ${`${escapeLike(slug)}/%`} ESCAPE '\\'`);
  return {
    folder,
    descendantIds: descendants.map((item) => item.id),
    fileCount: affectedFiles,
  };
}

async function getParentSlug(parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  return (
    (
      await db.query.folders.findFirst({
        where: eq(folders.id, parentId),
        columns: { slug: true },
      })
    )?.slug ?? null
  );
}

async function ensureSlugAvailable(
  newSlug: string,
  currentSlug: string,
): Promise<void> {
  if (newSlug === currentSlug) return;
  if (
    await db.query.folders.findFirst({
      where: eq(folders.slug, newSlug),
      columns: { id: true },
    })
  ) {
    throw new OperationError(
      `A folder already exists at "${newSlug}"`,
      "conflict",
      409,
    );
  }
  if (existsSync(slugToPath(newSlug))) {
    throw new OperationError(
      `A directory already exists at "${newSlug}"`,
      "conflict",
      409,
    );
  }
}

async function planRename(
  impact: FolderImpact,
  requestedName: string,
): Promise<FolderPlan> {
  const name = requestedName.trim();
  const baseSlug = cleanFolderSlug(name);
  if (!name || !baseSlug)
    throw new OperationError(
      "A valid folder name is required",
      "invalid_request",
      400,
    );
  const parentSlug = await getParentSlug(impact.folder.parentId);
  const newSlug = parentSlug ? `${parentSlug}/${baseSlug}` : baseSlug;
  await ensureSlugAvailable(newSlug, impact.folder.slug);
  const pathChanges = newSlug !== impact.folder.slug;
  const nameChanges = name !== impact.folder.name;
  return {
    operation: "rename",
    from: {
      id: impact.folder.id,
      name: impact.folder.name,
      slug: impact.folder.slug,
      parentSlug,
    },
    to: { name, slug: newSlug, parentSlug },
    affected: {
      folders: pathChanges
        ? 1 + impact.descendantIds.length
        : nameChanges
          ? 1
          : 0,
      files: pathChanges ? impact.fileCount : 0,
    },
    noOp: !pathChanges && !nameChanges,
  };
}

async function planMove(impact: FolderImpact, destinationSlug: string | null) {
  let destination: typeof folders.$inferSelect | null = null;
  if (destinationSlug !== null) {
    if (destinationSlug.startsWith("_"))
      throw new OperationError(
        "Cannot move a public folder into a system folder",
        "invalid_request",
        400,
      );
    const clean = cleanFolderPath(destinationSlug);
    if (!clean || clean !== destinationSlug)
      throw new OperationError(
        "A valid destination folder is required",
        "invalid_request",
        400,
      );
    destination =
      (await db.query.folders.findFirst({ where: eq(folders.slug, clean) })) ??
      null;
    if (!destination)
      throw new OperationError(
        "Destination folder not found",
        "not_found",
        404,
      );
  }
  if (
    destination &&
    (destination.id === impact.folder.id ||
      impact.descendantIds.includes(destination.id))
  ) {
    throw new OperationError(
      "Cannot move a folder into itself or one of its descendants",
      "invalid_request",
      400,
    );
  }
  const newSlug = destination
    ? `${destination.slug}/${impact.folder.slug.split("/").pop()!}`
    : impact.folder.slug.split("/").pop()!;
  await ensureSlugAvailable(newSlug, impact.folder.slug);
  const noOp = impact.folder.parentId === (destination?.id ?? null);
  return {
    destinationId: destination?.id ?? null,
    plan: {
      operation: "move" as const,
      from: {
        id: impact.folder.id,
        name: impact.folder.name,
        slug: impact.folder.slug,
        parentSlug: await getParentSlug(impact.folder.parentId),
      },
      to: {
        name: impact.folder.name,
        slug: newSlug,
        parentSlug: destination?.slug ?? null,
      },
      affected: {
        folders: noOp ? 0 : 1 + impact.descendantIds.length,
        files: noOp ? 0 : impact.fileCount,
      },
      noOp,
    },
  };
}

export async function manageFolderOperation(
  context: OperationContext,
  input: z.output<typeof folderManageInput>,
) {
  requireOperationAdmin(context);
  if (input.slug.startsWith("_"))
    throw new OperationError("Folder not found", "not_found", 404);
  const slug = cleanFolderPath(input.slug);
  if (!slug || slug !== input.slug)
    throw new OperationError(
      "Invalid folder operation",
      "invalid_request",
      400,
    );
  const impact = await getFolderImpact(slug);
  if (!impact || impact.folder.slug.startsWith("_"))
    throw new OperationError("Folder not found", "not_found", 404);

  const log = createRequestLogger();
  if (input.operation === "rename") {
    const plan = await planRename(impact, input.name);
    log.set({
      folderOperation: {
        channel: context.channel,
        operation: "rename",
        userId: context.user.id,
        mode: input.execution.mode,
        from: plan.from.slug,
        to: plan.to.slug,
        affectedFolders: plan.affected.folders,
        affectedFiles: plan.affected.files,
      },
    });
    if (input.execution.mode === "plan" || plan.noOp) {
      log.set({ folderOperation: { outcome: "planned" } });
      log.emit();
      return { success: true as const, applied: false as const, plan };
    }
    const result = await renameFolder(impact.folder.id, plan.to.name);
    if (result.isErr()) {
      log.error(result.error);
      log.emit();
      throw new OperationError(result.error.message, "operation_failed", 400);
    }
    log.set({ folderOperation: { outcome: "applied" } });
    log.emit();
    return {
      success: true as const,
      applied: true as const,
      plan,
      result: serializeFolderMutationResult(result.value),
    };
  }
  const move = await planMove(impact, input.destinationSlug);
  log.set({
    folderOperation: {
      channel: context.channel,
      operation: "move",
      userId: context.user.id,
      mode: input.execution.mode,
      from: move.plan.from.slug,
      to: move.plan.to.slug,
      affectedFolders: move.plan.affected.folders,
      affectedFiles: move.plan.affected.files,
    },
  });
  if (input.execution.mode === "plan" || move.plan.noOp) {
    log.set({ folderOperation: { outcome: "planned" } });
    log.emit();
    return { success: true as const, applied: false as const, plan: move.plan };
  }
  const result = await moveFolder(impact.folder.id, move.destinationId);
  if (result.isErr()) {
    log.error(result.error);
    log.emit();
    throw new OperationError(result.error.message, "operation_failed", 400);
  }
  log.set({ folderOperation: { outcome: "applied" } });
  log.emit();
  return {
    success: true as const,
    applied: true as const,
    plan: move.plan,
    result: serializeFolderMutationResult(result.value),
  };
}
