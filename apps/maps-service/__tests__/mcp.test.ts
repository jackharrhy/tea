import { describe, expect, test } from "vitest";
import { fixture } from "./service-fixture.js";

const mcpAuth = {
  fourmUrl: "https://4orm.example",
  publicUrl: "http://127.0.0.1",
  clientId: "worldview-server",
  clientSecret: "test-secret",
};

function fourmFetch(admin: boolean, scope = "worldview:admin"): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth/introspect"))
      return Response.json({
        active: true,
        principal_type: "user",
        sub: "mcp-user",
        aud: `${mcpAuth.publicUrl}/mcp`,
        scope: `openid ${scope}`,
        exp: Math.floor(Date.now() / 1000) + 600,
      });
    if (url.endsWith("/oauth/userinfo"))
      return Response.json({
        sub: "mcp-user",
        username: "admin",
        display_name: "Admin",
        is_admin: admin,
      });
    throw new Error(`Unexpected 4orm URL ${url}`);
  };
}

async function call(
  origin: string,
  method: string,
  args: unknown,
  token = "test-token",
) {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: method, arguments: args },
    }),
  });
}

describe("Tea Maps MCP", () => {
  test("advertises OAuth and limits tools to admins with project membership", async () => {
    const app = await fixture(fourmFetch(true), undefined, undefined, mcpAuth);
    mcpAuth.publicUrl = app.origin;
    const metadata = await fetch(
      `${app.origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect((await metadata.json()).resource).toBe(`${app.origin}/mcp`);
    const unauthenticated = await fetch(`${app.origin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
    const initialized = await fetch(`${app.origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
    });
    expect((await initialized.json()).result.serverInfo.name).toBe("tea-maps");

    const created = await call(app.origin, "tea_maps_create_project", {
      name: "MCP map",
      game: "quake",
    });
    expect(created.status).toBe(200);
    const project = (await created.json()).result.structuredContent.project;
    expect(project.name).toBe("MCP map");
    const legacyList = await call(app.origin, "worldview_list_projects", {});
    expect(
      (await legacyList.json()).result.structuredContent.projects.map(
        (item: { id: string }) => item.id,
      ),
    ).toContain(project.id);
    const mapResponse = await call(app.origin, "tea_maps_create_map", {
      projectId: project.id,
      name: "test.map",
      format: "quake",
    });
    expect((await mapResponse.json()).result.structuredContent.map.name).toBe(
      "test.map",
    );
    const grantResponse = await call(
      app.origin,
      "tea_maps_create_browser_grant",
      { projectId: project.id },
    );
    expect(
      (await grantResponse.json()).result.structuredContent.projectUrl,
    ).toBe(`${app.origin}/projects/${project.id}`);
    const outsider = app.database.upsertUser({
      fourmSub: "outsider",
      username: "outsider",
      displayName: "Outsider",
      isAdmin: false,
    });
    const other = app.database.createProject(outsider.id, "Private", "quake");
    const denied = await call(app.origin, "worldview_get_project", {
      projectId: other.id,
    });
    expect((await denied.json()).result.isError).toBe(true);

    const listed = await fetch(`${app.origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    const tools = (await listed.json()).result.tools;
    expect(tools.map((tool: { name: string }) => tool.name)).toContain(
      "tea_maps_start_build",
    );
    expect(tools.map((tool: { name: string }) => tool.name)).not.toContain(
      "worldview_start_build",
    );
  });

  test("rejects a current non-admin even with a valid scoped OAuth token", async () => {
    const app = await fixture(fourmFetch(false), undefined, undefined, mcpAuth);
    mcpAuth.publicUrl = app.origin;
    expect((await call(app.origin, "tea_maps_list_projects", {})).status).toBe(
      403,
    );
  });

  test("uses a configured Tea scope for discovery and token checks", async () => {
    const config = { ...mcpAuth, scope: "tea_maps:admin" };
    const app = await fixture(
      fourmFetch(true, "tea_maps:admin"),
      undefined,
      undefined,
      config,
    );
    mcpAuth.publicUrl = app.origin;
    config.publicUrl = app.origin;
    const metadata = await fetch(
      `${app.origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect((await metadata.json()).scopes_supported).toEqual([
      "openid",
      "tea_maps:admin",
    ]);
    const challenge = await fetch(`${app.origin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(challenge.headers.get("www-authenticate")).toContain(
      'scope="openid tea_maps:admin"',
    );
    expect((await call(app.origin, "tea_maps_list_projects", {})).status).toBe(
      200,
    );

    const legacyOnly = await fixture(
      fourmFetch(true),
      undefined,
      undefined,
      config,
    );
    mcpAuth.publicUrl = legacyOnly.origin;
    config.publicUrl = legacyOnly.origin;
    expect(
      (await call(legacyOnly.origin, "tea_maps_list_projects", {})).status,
    ).toBe(401);
  });
});
