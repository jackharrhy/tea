import type * as Route from "./types.ts";
import { requireSessionUser } from "#lib/session-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireSessionUser(request);
  return Response.json({
    user: {
      id: user.id,
      name: user.username,
      isAdmin: user.isAdmin,
    },
  });
}
