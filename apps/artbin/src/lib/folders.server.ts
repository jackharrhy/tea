import { join } from "path";
import { nanoid } from "nanoid";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { cleanFolderSlug } from "@tea/artbin-core/detection/filenames";
import { db as appDb, type AppDb } from "#db/connection.server";
import { folders, type Folder } from "#db";
import { ensureDir as ensureUploadsDir, UPLOADS_DIR } from "./files.server.ts";
import { generateFolderPreview } from "./folder-preview.server.ts";
import {
  relocateFolder,
  type FolderRelocationDeps,
} from "./folder-relocation.server.ts";
import { getAncestorFolderIds } from "./file-queries.server.ts";
import { createRequestLogger } from "evlog";

export interface CreateFolderInput {
  name: string;
  slug: string;
  parentId: string | null;
  ownerId: string;
}

export interface CreateFolderDeps {
  db?: AppDb;
  uploadsDir?: string;
  createId?: () => string;
  ensureDir?: (path: string) => Promise<void>;
}

export interface CreatedFolder {
  id: string;
  name: string;
  slug: string;
}

export type MoveFolderDeps = FolderRelocationDeps;

export interface MoveFolderOutput {
  folder?: Folder;
  movedFolders: number;
  movedFiles: number;
}

export interface CreateFolderAndMoveDeps extends MoveFolderDeps {
  createId?: () => string;
}

export { cleanFolderSlug };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function createFolder(
  input: CreateFolderInput,
  deps: CreateFolderDeps = {},
) {
  const database = deps.db ?? appDb;
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const createId = deps.createId ?? nanoid;
  const ensureDir = deps.ensureDir ?? ensureUploadsDir;

  const name = input.name.trim();
  const cleanSlug = cleanFolderSlug(input.slug);

  if (!name || !cleanSlug) {
    return Result.err(new Error("Name and slug are required"));
  }

  let fullSlug = cleanSlug;
  if (input.parentId) {
    const parentFolder = await database.query.folders.findFirst({
      where: eq(folders.id, input.parentId),
    });

    if (!parentFolder) {
      return Result.err(new Error("Parent folder not found"));
    }

    fullSlug = `${parentFolder.slug}/${cleanSlug}`;
  }

  const existing = await database.query.folders.findFirst({
    where: eq(folders.slug, fullSlug),
  });

  if (existing) {
    return Result.err(new Error(`Folder "${fullSlug}" already exists`));
  }

  try {
    const folderId = createId();
    await ensureDir(join(uploadsDir, fullSlug));

    await database.insert(folders).values({
      id: folderId,
      name,
      slug: fullSlug,
      parentId: input.parentId || null,
      ownerId: input.ownerId,
    });

    return Result.ok({
      id: folderId,
      name,
      slug: fullSlug,
    } satisfies CreatedFolder);
  } catch (error) {
    return Result.err(toError(error));
  }
}

async function getDescendantFolders(
  database: AppDb,
  folderId: string,
): Promise<Folder[]> {
  const descendants: Folder[] = [];
  const queue = [folderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await database.query.folders.findMany({
      where: eq(folders.parentId, parentId),
    });

    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

async function wouldCreateCycle(
  database: AppDb,
  folderId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (!newParentId) return false;
  if (newParentId === folderId) return true;

  const descendants = await getDescendantFolders(database, folderId);
  return descendants.some((descendant) => descendant.id === newParentId);
}

export async function moveFolder(
  folderId: string,
  newParentId: string | null,
  deps: MoveFolderDeps = {},
) {
  const database = deps.db ?? appDb;
  const generatePreview = deps.generatePreview ?? generateFolderPreview;

  const folder = await database.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return Result.err(new Error("Folder not found"));
  }

  if (folder.parentId === newParentId) {
    return Result.ok({
      folder,
      movedFolders: 0,
      movedFiles: 0,
    } satisfies MoveFolderOutput);
  }

  if (await wouldCreateCycle(database, folderId, newParentId)) {
    return Result.err(new Error("Cannot move folder into its own descendant"));
  }

  let newParentSlug = "";
  if (newParentId) {
    const newParent = await database.query.folders.findFirst({
      where: eq(folders.id, newParentId),
    });

    if (!newParent) {
      return Result.err(new Error("Parent folder not found"));
    }

    newParentSlug = newParent.slug;
  }

  const folderBaseName = folder.slug.includes("/")
    ? folder.slug.split("/").pop()!
    : folder.slug;
  const newSlug = newParentSlug
    ? `${newParentSlug}/${folderBaseName}`
    : folderBaseName;

  if (newSlug !== folder.slug) {
    const existingFolder = await database.query.folders.findFirst({
      where: eq(folders.slug, newSlug),
    });

    if (existingFolder) {
      return Result.err(new Error(`A folder already exists at "${newSlug}"`));
    }
  }

  try {
    const { updatedFolders, updatedFiles } = await relocateFolder(
      database,
      folder,
      {
        slug: newSlug,
        name: folder.name,
        parentId: newParentId,
      },
      deps,
    );
    // The moved subtree keeps its preview bytes. Only its old/new ancestors changed content.
    const parents = [folder.parentId, newParentId].filter(
      (id): id is string => id !== null,
    );
    for (const id of await getAncestorFolderIds(parents, database)) {
      try {
        await generatePreview(id);
      } catch (error) {
        // The relocation has committed. A derived-preview failure must not report
        // that the move failed or encourage retrying a successful mutation.
        const log = createRequestLogger();
        log.error(toError(error), { step: "folder-preview", folderId: id });
        log.emit();
      }
    }

    const updatedFolder = await database.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });

    return Result.ok({
      folder: updatedFolder,
      movedFolders: 1 + updatedFolders,
      movedFiles: updatedFiles,
    } satisfies MoveFolderOutput);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export type RenameFolderDeps = FolderRelocationDeps;

export interface RenameFolderOutput {
  folder?: Folder;
  renamedFolders: number;
  renamedFiles: number;
}

/**
 * Rename a folder: updates display name, slug, and cascades slug changes
 * to all descendant folders and file paths. Also renames the physical
 * directory on disk.
 */
export async function renameFolder(
  folderId: string,
  newName: string,
  deps: RenameFolderDeps = {},
): Promise<Result<RenameFolderOutput, Error>> {
  const database = deps.db ?? appDb;

  const trimmedName = newName.trim();
  if (!trimmedName) {
    return Result.err(new Error("Name is required"));
  }

  const folder = await database.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    return Result.err(new Error("Folder not found"));
  }

  // Build new slug by replacing the last segment
  const newBaseSlug = cleanFolderSlug(trimmedName);
  if (!newBaseSlug) {
    return Result.err(
      new Error("Name must contain at least one alphanumeric character"),
    );
  }

  const parentPrefix = folder.slug.includes("/")
    ? folder.slug.split("/").slice(0, -1).join("/") + "/"
    : "";
  const newSlug = parentPrefix + newBaseSlug;

  // If slug hasn't changed, just update the display name
  if (newSlug === folder.slug) {
    if (trimmedName !== folder.name) {
      await database
        .update(folders)
        .set({ name: trimmedName })
        .where(eq(folders.id, folderId));
    }
    const updated = await database.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    return Result.ok({ folder: updated, renamedFolders: 0, renamedFiles: 0 });
  }

  // Check for slug collision
  const existing = await database.query.folders.findFirst({
    where: eq(folders.slug, newSlug),
  });
  if (existing) {
    return Result.err(new Error(`A folder already exists at "${newSlug}"`));
  }

  try {
    const { updatedFolders, updatedFiles } = await relocateFolder(
      database,
      folder,
      {
        slug: newSlug,
        name: trimmedName,
        parentId: folder.parentId,
      },
      deps,
    );

    const updatedFolder = await database.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });

    return Result.ok({
      folder: updatedFolder,
      renamedFolders: 1 + updatedFolders,
      renamedFiles: updatedFiles,
    });
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function createFolderAndMoveChildren(
  name: string,
  parentId: string | null,
  childFolderIds: string[],
  deps: CreateFolderAndMoveDeps = {},
) {
  const database = deps.db ?? appDb;
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const createId = deps.createId ?? nanoid;
  const ensureDir = deps.ensureDir ?? ensureUploadsDir;

  let parentSlug = "";
  if (parentId) {
    const parent = await database.query.folders.findFirst({
      where: eq(folders.id, parentId),
    });

    if (!parent) {
      return Result.err(new Error("Parent folder not found"));
    }

    parentSlug = parent.slug;
  }

  const baseSlug = cleanFolderSlug(name);
  if (!name.trim() || !baseSlug) {
    return Result.err(new Error("Name and slug are required"));
  }

  const newSlug = parentSlug ? `${parentSlug}/${baseSlug}` : baseSlug;
  const existing = await database.query.folders.findFirst({
    where: eq(folders.slug, newSlug),
  });

  if (existing) {
    return Result.err(new Error(`Folder "${newSlug}" already exists`));
  }

  const newFolderId = createId();
  await database.insert(folders).values({
    id: newFolderId,
    name,
    slug: newSlug,
    parentId,
  });
  await ensureDir(join(uploadsDir, newSlug));

  let totalMovedFolders = 1;
  let totalMovedFiles = 0;

  for (const childId of childFolderIds) {
    const moveResult = await moveFolder(childId, newFolderId, {
      ...deps,
      db: database,
      uploadsDir,
    });

    if (moveResult.isErr()) {
      return Result.err(moveResult.error);
    }

    totalMovedFolders += moveResult.value.movedFolders;
    totalMovedFiles += moveResult.value.movedFiles;
  }

  const newFolder = await database.query.folders.findFirst({
    where: eq(folders.id, newFolderId),
  });

  return Result.ok({
    folder: newFolder,
    movedFolders: totalMovedFolders,
    movedFiles: totalMovedFiles,
  } satisfies MoveFolderOutput);
}
