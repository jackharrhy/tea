import type * as Route from "./types.ts";

import { getUserFromRequest } from "#lib/auth.server";
import { queueRemoteImports } from "#lib/remote-import-queue.server";

export async function action({ request }: Route.ActionArgs) {
  const user = await getUserFromRequest(request);
  if (!user)
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.isAdmin)
    return Response.json({ error: "Admin access required" }, { status: 403 });

  const formData = await request.formData();

  try {
    const queued = await queueRemoteImports({
      sourceUrls: String(formData.get("sourceUrls") ?? ""),
      targetFolderId:
        String(formData.get("targetFolderId") ?? "").trim() || null,
      userId: user.id,
    });
    return Response.json({
      success: true,
      action: "remote-site-import",
      ...queued,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid import URL" },
      { status: 400 },
    );
  }
}
