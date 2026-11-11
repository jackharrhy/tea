import { describe, expect, it } from "vitest";
import {
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  roleScope,
  type TokenPrincipal,
} from "@harrhy/identity";
import { authorizeArchive } from "../archive-auth.ts";

const project = "ref-project";
function token(
  membership: "member" | "admin",
  permissions: string[],
): TokenPrincipal {
  return {
    subject: "reviewed-human",
    clientId: "delegated-cli",
    principalType: "user",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    audiences: new Set([project]),
    roles: new Set([membership, ...permissions]),
    scopes: new Set([
      projectAudienceScope(project),
      PROJECT_ROLES_SCOPE,
      roleScope(membership),
      ...permissions.map(roleScope),
    ]),
  };
}

describe("Ref delegated archive authorization", () => {
  it("limits archive reads and restores to an admin with operation grants", () => {
    const member = token("member", ["archive-read"]);
    expect(() => authorizeArchive(member, project, "read")).toThrow();
    expect(() => authorizeArchive(member, project, "restore")).toThrow();
    const admin = token("admin", ["archive-read", "archive-restore"]);
    expect(() => authorizeArchive(admin, project, "read")).not.toThrow();
    expect(() => authorizeArchive(admin, project, "restore")).not.toThrow();
    expect(() =>
      authorizeArchive(
        {
          ...admin,
          scopes: new Set(
            [...admin.scopes].filter(
              (scope) => scope !== roleScope("archive-read"),
            ),
          ),
        },
        project,
        "restore",
      ),
    ).toThrow();
  });

  it("rejects wrong resource, service principals, and ambiguous or missing membership scopes", () => {
    const member = token("member", ["archive-read"]);
    expect(() =>
      authorizeArchive(
        { ...member, audiences: new Set(["another-project"]) },
        project,
        "read",
      ),
    ).toThrow();
    expect(() =>
      authorizeArchive(
        { ...member, principalType: "service" },
        project,
        "read",
      ),
    ).toThrow();
    expect(() =>
      authorizeArchive(
        {
          ...member,
          scopes: new Set(
            [...member.scopes].filter((scope) => scope !== roleScope("member")),
          ),
        },
        project,
        "read",
      ),
    ).toThrow();
    const admin = token("admin", ["archive-read", "archive-restore"]);
    expect(() =>
      authorizeArchive(
        {
          ...admin,
          scopes: new Set([...admin.scopes, roleScope("member")]),
          roles: new Set([...admin.roles, "member"]),
        },
        project,
        "restore",
      ),
    ).toThrow();
  });
});
