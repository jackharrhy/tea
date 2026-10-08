import type * as Route from "./types.ts";

import { requireSessionAdmin } from "#lib/session-auth.server";

import { operationCatalog } from "../../../operations/catalog.ts";
import {
  operationErrorResponse,
  readOperationJson,
} from "../../../operations/errors.ts";
import { folderManageInput } from "../../../operations/folders.ts";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireSessionAdmin(request);
  try {
    const input = folderManageInput.parse(await readOperationJson(request));
    return Response.json(
      await operationCatalog.folderManage.execute(
        { user, channel: "cli" },
        input,
      ),
    );
  } catch (error) {
    return operationErrorResponse(error);
  }
}
