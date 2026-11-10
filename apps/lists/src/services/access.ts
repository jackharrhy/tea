import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";

export const API_SCOPES = [
  "lists:read",
  "subscribers:read",
  "subscribers:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:send",
  "templates:read",
  "templates:write",
  "deliverability:read",
  "dmarc:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export type Principal = {
  userId: number;
  email: string;
  role: "owner" | "admin" | "member";
  scopes: Set<ApiScope>;
  listIds: "all" | Set<number>;
  credentialId?: number;
};

export class AccessDeniedError extends Error {
  status = 403;
}

export function assertScope(principal: Principal, scope: ApiScope) {
  if (!principal.scopes.has(scope))
    throw new AccessDeniedError(`Missing scope: ${scope}`);
}

export function assertListAccess(principal: Principal, listId: number) {
  if (principal.listIds !== "all" && !principal.listIds.has(listId)) {
    throw new AccessDeniedError("List access denied");
  }
}

export function principalForUser(
  db: Db,
  user: typeof schema.users.$inferSelect,
  scopes: Iterable<ApiScope> = API_SCOPES,
): Principal {
  const listIds =
    user.role === "owner" || user.role === "admin"
      ? ("all" as const)
      : new Set(
          db
            .select({ listId: schema.userLists.listId })
            .from(schema.userLists)
            .where(eq(schema.userLists.userId, user.id))
            .all()
            .map((row) => row.listId),
        );

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    scopes: new Set(scopes),
    listIds,
  };
}

export function canAccessSubscriber(
  db: Db,
  principal: Principal,
  subscriberId: number,
): boolean {
  if (principal.listIds === "all") return true;
  if (principal.listIds.size === 0) return false;
  return db
    .select({ subscriberId: schema.subscriberLists.subscriberId })
    .from(schema.subscriberLists)
    .where(
      and(
        eq(schema.subscriberLists.subscriberId, subscriberId),
        inArray(schema.subscriberLists.listId, [...principal.listIds]),
      ),
    )
    .all()
    .some((row) => row.subscriberId === subscriberId);
}
