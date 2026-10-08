import { eq } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { db } from "#db/connection.server";
import { folders } from "#db";
import { moveFolder, renameFolder } from "#lib/folders.server";

import { loadFolderPage } from "../../data/folder-page.ts";
import { requireUser } from "../../middleware/auth.ts";
import { deleteFolderOperation } from "../../operations/folders.ts";
import { routes } from "../../routes.ts";
import { FolderRoutePage } from "./page.tsx";

export default createController(routes.folder, {
  middleware: [requireUser()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadFolderPage(
        context.url,
        context.params.path,
        context.user,
      );
      if (!data) return new Response("Folder not found", { status: 404 });
      if (context.request.headers.get("accept") === "application/json") {
        return Response.json(
          data.page === "folder"
            ? (data.searchResults ?? { files: [], nextCursor: null })
            : { files: [], nextCursor: null },
          { headers: { Vary: "Accept", "Cache-Control": "private, no-store" } },
        );
      }
      return context.render(
        <FolderRoutePage data={data} user={context.user} />,
        {
          headers: { Vary: "Accept" },
        },
      );
    },

    async action(context) {
      const user = context.user;
      if (!user?.isAdmin) return new Response("Forbidden", { status: 403 });
      const folder = await db.query.folders.findFirst({
        where: eq(folders.slug, context.params.path),
      });
      if (!folder) return new Response("Folder not found", { status: 404 });

      const formData = await context.request.formData();
      const action = formData.get("_action");

      if (action === "rename") {
        const name =
          typeof formData.get("name") === "string"
            ? String(formData.get("name"))
            : "";
        const result = await renameFolder(folder.id, name);
        if (result.isErr() || !result.value.folder) {
          return new Response(
            result.isErr() ? result.error.message : "Rename failed",
            {
              status: 400,
            },
          );
        }
        return redirect(
          routes.folder.index.href({ path: result.value.folder.slug }),
          303,
        );
      }

      if (action === "update-description") {
        const value = formData.get("description");
        const description = typeof value === "string" ? value.trim() : "";
        await db
          .update(folders)
          .set({ description: description || null })
          .where(eq(folders.id, folder.id));
        return redirect(routes.folder.index.href({ path: folder.slug }), 303);
      }

      if (action === "move") {
        const value = formData.get("newParentId");
        const parentId = typeof value === "string" && value ? value : null;
        const result = await moveFolder(folder.id, parentId);
        if (result.isErr() || !result.value.folder) {
          return new Response(
            result.isErr() ? result.error.message : "Move failed",
            {
              status: 400,
            },
          );
        }
        return redirect(
          routes.folder.index.href({ path: result.value.folder.slug }),
          303,
        );
      }

      if (action === "delete") {
        if (formData.get("confirmName") !== folder.name) {
          return new Response("Folder name confirmation did not match", {
            status: 400,
          });
        }
        await deleteFolderOperation(
          { user, channel: "admin" },
          {
            slug: folder.slug,
            execution: {
              mode: "apply",
              confirm: true,
              confirmationName: String(formData.get("confirmName") ?? ""),
            },
          },
        );
        return redirect(routes.folders.href(), 303);
      }

      return new Response("Unknown folder action", { status: 400 });
    },
  },
});
