import {
  IdentityError,
  requireTokenRole,
  roleScope,
  type TokenPrincipal,
} from "@tea/identity";

export function authorizeArchive(
  principal: TokenPrincipal,
  projectId: string,
  operation: "read" | "restore",
): void {
  if (principal.principalType !== "user")
    throw new IdentityError("Human archive authorization required", 403);
  const selected = (["member", "admin"] as const).filter(
    (role) =>
      principal.roles.has(role) && principal.scopes.has(roleScope(role)),
  );
  if (selected.length !== 1)
    throw new IdentityError(
      "Exactly one archive membership scope is required",
      403,
    );
  requireTokenRole(principal, projectId, selected[0]);
  if (operation === "restore" && selected[0] !== "admin")
    throw new IdentityError("Archive restore requires an admin grant", 403);
  const permissions =
    operation === "read"
      ? ["archive-read"]
      : ["archive-read", "archive-restore"];
  for (const permission of permissions)
    if (
      !principal.roles.has(permission) ||
      !principal.scopes.has(roleScope(permission))
    )
      throw new IdentityError(
        `Archive ${operation} permission is missing`,
        403,
      );
}
