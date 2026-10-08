import { getUserFromRequest } from "./auth.server.ts";
import type { User } from "#db";

/** Authenticate any user (admin or not). Throws 401 if not logged in. */
export async function requireSessionUser(request: Request): Promise<User> {
  const user = await getUserFromRequest(request);
  if (!user) {
    throw Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  return user;
}

/** Authenticate and require admin. Throws 401/403. */
export async function requireSessionAdmin(request: Request): Promise<User> {
  const user = await requireSessionUser(request);
  if (!user.isAdmin) {
    throw Response.json({ error: "Admin access required" }, { status: 403 });
  }
  return user;
}
