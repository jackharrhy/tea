import type * as Route from "./types.ts";
import { createRequestLogger } from "evlog";
import { getUserFromRequest } from "#lib/auth.server";
import { createFolderAndMoveChildren, moveFolder } from "#lib/folders.server";

export async function action({ request }: Route.ActionArgs) {
  const log = createRequestLogger();
  const user = await getUserFromRequest(request);

  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.isAdmin) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  log.set({ folderMove: { action: actionType, userId: user.id } });

  // Move a single folder to a new parent
  if (actionType === "move") {
    const folderId = formData.get("folderId") as string;
    const newParentId = formData.get("newParentId") as string | null;

    if (!folderId) {
      return Response.json({ error: "Missing folderId" }, { status: 400 });
    }

    // Convert empty string to null for root-level moves
    const parentId =
      newParentId === "" || newParentId === "root" ? null : newParentId;
    log.set({ folderMove: { folderId, newParentId: parentId } });

    const start = performance.now();
    const result = await moveFolder(folderId, parentId);
    log.set({
      folderMove: { durationMs: Math.round(performance.now() - start) },
    });

    if (result.isErr()) {
      return Response.json({ error: result.error.message }, { status: 400 });
    }

    log.set({
      folderMove: {
        movedFolders: result.value.movedFolders,
        movedFiles: result.value.movedFiles,
      },
    });
    return Response.json({
      success: true,
      folder: result.value.folder,
      movedFolders: result.value.movedFolders,
      movedFiles: result.value.movedFiles,
    });
  }

  // Create a new folder and move multiple folders into it
  if (actionType === "create-and-move") {
    const name = formData.get("name") as string;
    const parentId = formData.get("parentId") as string | null;
    const childIdsJson = formData.get("childFolderIds") as string;

    if (!name) {
      return Response.json({ error: "Missing folder name" }, { status: 400 });
    }

    let childFolderIds: string[] = [];
    if (childIdsJson) {
      try {
        childFolderIds = JSON.parse(childIdsJson);
      } catch {
        return Response.json(
          { error: "Invalid childFolderIds format" },
          { status: 400 },
        );
      }
    }

    // Convert empty string to null for root-level
    const effectiveParentId =
      parentId === "" || parentId === "root" ? null : parentId;

    log.set({
      folderMove: {
        name,
        parentId: effectiveParentId,
        childCount: childFolderIds.length,
      },
    });

    const start = performance.now();
    const result = await createFolderAndMoveChildren(
      name,
      effectiveParentId,
      childFolderIds,
    );
    log.set({
      folderMove: { durationMs: Math.round(performance.now() - start) },
    });

    if (result.isErr()) {
      return Response.json({ error: result.error.message }, { status: 400 });
    }

    log.set({
      folderMove: {
        movedFolders: result.value.movedFolders,
        movedFiles: result.value.movedFiles,
      },
    });
    return Response.json({
      success: true,
      folder: result.value.folder,
      movedFolders: result.value.movedFolders,
      movedFiles: result.value.movedFiles,
    });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
