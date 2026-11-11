import {
  IdentityError,
  requireTokenRole,
  roleScope,
  type TokenPrincipal,
} from "@harrhy/identity";

export function authorizeArchive(
  principal: TokenPrincipal,
  projectId: string,
  operation: "read" | "restore",
): void {
  if (principal.principalType !== "user")
    throw new IdentityError("Human archive authorization required", 403);
  if (
    principal.roles.has("member") ||
    principal.scopes.has(roleScope("member")) ||
    !principal.scopes.has(roleScope("admin"))
  )
    throw new IdentityError("Archive requires an admin scope", 403);
  requireTokenRole(principal, projectId, "admin");
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
