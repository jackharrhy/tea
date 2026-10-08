import type * as Route from "./types.ts";

import { requireSessionUser } from "#lib/session-auth.server";

import { operationCatalog } from "../../../operations/catalog.ts";
import {
  operationErrorResponse,
  readOperationJson,
} from "../../../operations/errors.ts";
import {
  folderCreateInput,
  folderListInput,
} from "../../../operations/folders.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireSessionUser(request);
  const url = new URL(request.url);
  try {
    const input = folderListInput.parse({
      slug: url.searchParams.get("slug") ?? undefined,
      includeSystem: url.searchParams.get("includeSystem") === "true",
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.has("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined,
    });
    return Response.json(
      await operationCatalog.foldersList.execute(
        { user, channel: "cli" },
        input,
      ),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireSessionUser(request);
  try {
    const input = folderCreateInput.parse(await readOperationJson(request));
    return Response.json(
      await operationCatalog.foldersCreate.execute(
        { user, channel: "cli" },
        input,
      ),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}
