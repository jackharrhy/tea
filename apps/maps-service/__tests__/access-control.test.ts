import { describe, expect, test } from "vitest";
import {
  createDevelopmentMaterials,
  createDiagnosticQuakePalette,
  encodeQuakeWad2,
} from "@tea/maps-editor/core";
import { verifyRealtimeTicket } from "../src/realtime-ticket.js";
import {
  fixture,
  session,
  TEST_REALTIME_TICKET_SECRET,
} from "./service-fixture.js";

type TestSession = ReturnType<typeof session>;

const compilerFetch: typeof fetch = async () =>
  Response.json({
    status: "succeeded",
    diagnostics: [],
    logs: [],
    artifacts: [],
  });

function headers(principal: TestSession | null, json = false): HeadersInit {
  return {
    ...(principal ? { Cookie: principal.cookie } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function createAccessFixture() {
  const app = await fixture(undefined, compilerFetch);
  const owner = session(app.database);
  const editor = session(app.database, {
    fourmSub: "fourm-editor",
    username: "editor",
    displayName: "Editor",
    isAdmin: false,
  });
  const viewer = session(app.database, {
    fourmSub: "fourm-viewer",
    username: "viewer",
    displayName: "Viewer",
    isAdmin: false,
  });
  const outsider = session(app.database, {
    fourmSub: "fourm-outsider",
    username: "outsider",
    displayName: "Outsider",
    isAdmin: false,
  });
  const adminOutsider = session(app.database, {
    fourmSub: "fourm-admin",
    username: "admin",
    displayName: "Admin outsider",
    isAdmin: true,
  });
  const project = app.database.createProject(
    owner.user.id,
    "Access matrix",
    "quake",
  );
  expect(
    app.database.setProjectMemberRole(
      project.id,
      owner.user.id,
      editor.user.id,
      "editor",
    ),
  ).toBe(true);
  expect(
    app.database.setProjectMemberRole(
      project.id,
      owner.user.id,
      viewer.user.id,
      "viewer",
    ),
  ).toBe(true);
  const mapId = app.database.createMapId();
  app.database.createMap({
    id: mapId,
    projectId: project.id,
    userId: owner.user.id,
    name: "permissions.map",
    format: "quake",
  });
  await app.maps.initialize(mapId, '{\n"classname" "worldspawn"\n}\n');
  const resource = await app.blobs.put(
    new Uint8Array(
      encodeQuakeWad2(
        createDevelopmentMaterials(),
        createDiagnosticQuakePalette(),
      ),
    ),
  );
  const mount = app.database.createResourceMount({
    projectId: project.id,
    userId: owner.user.id,
    provider: "artbin",
    providerAssetId: "resource-fixture",
    expectedSha256: resource.sha256,
    kind: "wad",
    displayName: "resource.wad",
    size: resource.size,
    metadata: { mimeType: "application/octet-stream" },
  });
  if (!mount) throw new Error("Owner could not create the resource fixture");
  return {
    app,
    owner,
    editor,
    viewer,
    outsider,
    adminOutsider,
    project,
    mapId,
    mount,
  };
}

describe("hosted project access control", () => {
  test("rejects every browser mutation before authentication or domain work when cross-origin", async () => {
    const { app } = await createAccessFixture();
    const mutations = [
      ["POST", "/auth/logout"],
      ["POST", "/api/projects"],
      ["PUT", "/api/projects/project-1/members/user-1"],
      ["DELETE", "/api/projects/project-1/members/user-1"],
      ["POST", "/api/projects/project-1/maps"],
      ["PUT", "/api/projects/project-1/maps/map-1/source"],
      ["POST", "/api/projects/project-1/resources"],
      ["POST", "/api/maps/map-1/checkpoints"],
      ["POST", "/api/maps/map-1/realtime-ticket"],
      ["POST", "/api/maps/map-1/builds"],
    ] as const;

    for (const [method, pathname] of mutations) {
      const response = await fetch(`${app.origin}${pathname}`, {
        method,
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        ...(method === "DELETE" ? {} : { body: "{}" }),
      });
      expect(response.status, `${method} ${pathname}`).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Cross-origin mutation rejected",
      });
    }
  });

  test("limits conditional source replacement to editors in the owning project", async () => {
    const { app, owner, editor, viewer, outsider, project, mapId } =
      await createAccessFixture();
    const snapshot = await app.maps.snapshot(mapId);
    const body = JSON.stringify({
      expectedMapVersion: snapshot.mapVersion,
      expectedSourceSha256: snapshot.sourceSha256,
      source: snapshot.source,
    });
    const url = `${app.origin}/api/projects/${project.id}/maps/${mapId}/source`;
    for (const [principal, expected] of [
      [viewer, 403],
      [outsider, 404],
      [editor, 200],
      [owner, 200],
    ] as const) {
      const response = await fetch(url, {
        method: "PUT",
        headers: headers(principal, true),
        body,
      });
      expect(response.status).toBe(expected);
    }
    const wrongProject = await fetch(
      `${app.origin}/api/projects/another-project/maps/${mapId}/source`,
      { method: "PUT", headers: headers(owner, true), body },
    );
    expect(wrongProject.status).toBe(404);
  });

  test("allows project members to read hosted state without disclosing it to outsiders", async () => {
    const { app, owner, editor, viewer, outsider, project, mapId, mount } =
      await createAccessFixture();
    const memberRoutes = [
      `/api/projects/${project.id}`,
      `/api/projects/${project.id}/resources`,
      `/api/projects/${project.id}/resources/${mount.id}/content`,
      `/api/maps/${mapId}`,
      `/api/maps/${mapId}/builds`,
    ];
    for (const route of memberRoutes) {
      for (const principal of [owner, editor, viewer]) {
        expect(
          (
            await fetch(`${app.origin}${route}`, {
              headers: headers(principal),
            })
          ).status,
        ).toBe(200);
      }
    }
    for (const route of memberRoutes) {
      expect(
        (await fetch(`${app.origin}${route}`, { headers: headers(outsider) }))
          .status,
      ).toBe(404);
    }
    expect(
      (await fetch(`${app.origin}/api/projects/${project.id}`)).status,
    ).toBe(401);
    expect(
      (await fetch(`${app.origin}/api/projects/${project.id}/resources`))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(
          `${app.origin}/api/projects/${project.id}/resources/${mount.id}/content`,
        )
      ).status,
    ).toBe(401);
    expect((await fetch(`${app.origin}/api/maps/${mapId}`)).status).toBe(401);
    expect((await fetch(`${app.origin}/api/maps/${mapId}/builds`)).status).toBe(
      401,
    );
  });

  test("issues realtime tickets only to members and preserves their exact role", async () => {
    const { app, owner, editor, viewer, outsider, mapId } =
      await createAccessFixture();
    for (const [principal, role] of [
      [owner, "owner"],
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const) {
      const response = await fetch(
        `${app.origin}/api/maps/${mapId}/realtime-ticket`,
        {
          method: "POST",
          headers: headers(principal),
        },
      );
      expect(response.status).toBe(201);
      const { ticket } = (await response.json()) as { ticket: string };
      expect(
        verifyRealtimeTicket(ticket, TEST_REALTIME_TICKET_SECRET),
      ).toMatchObject({
        mapId,
        principalId: principal.user.id,
        actorId: principal.user.id,
        role,
      });
    }
    expect(
      (
        await fetch(`${app.origin}/api/maps/${mapId}/realtime-ticket`, {
          method: "POST",
          headers: headers(outsider),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${app.origin}/api/maps/${mapId}/realtime-ticket`, {
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });

  test("restricts hosted mutations to their declared owner/editor policy", async () => {
    const {
      app,
      owner,
      editor,
      viewer,
      outsider,
      adminOutsider,
      project,
      mapId,
    } = await createAccessFixture();

    for (const [index, principal] of [owner, editor].entries()) {
      const create = await fetch(
        `${app.origin}/api/projects/${project.id}/maps`,
        {
          method: "POST",
          headers: headers(principal, true),
          body: JSON.stringify({
            name: `allowed-${index}.map`,
            format: "quake",
          }),
        },
      );
      expect(create.status).toBe(201);
      const checkpoint = await fetch(
        `${app.origin}/api/maps/${mapId}/checkpoints`,
        {
          method: "POST",
          headers: headers(principal, true),
          body: JSON.stringify({ name: `Allowed ${index}` }),
        },
      );
      expect(checkpoint.status).toBe(201);
    }

    for (const [index, principal] of [
      viewer,
      outsider,
      adminOutsider,
    ].entries()) {
      expect(
        (
          await fetch(`${app.origin}/api/maps/${mapId}/checkpoints`, {
            headers: headers(principal),
          })
        ).status,
      ).toBe(principal === viewer ? 200 : 403);
      expect(
        (
          await fetch(
            `${app.origin}/api/maps/${mapId}/checkpoints/checkpoint-1`,
            {
              headers: headers(principal),
            },
          )
        ).status,
      ).toBe(principal === viewer ? 200 : 404);
      expect(
        (
          await fetch(`${app.origin}/api/projects/${project.id}/maps`, {
            method: "POST",
            headers: headers(principal, true),
            body: JSON.stringify({
              name: `forbidden-${index}.map`,
              format: "quake",
            }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${app.origin}/api/maps/${mapId}/checkpoints`, {
            method: "POST",
            headers: headers(principal, true),
            body: JSON.stringify({ name: `Forbidden ${index}` }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${app.origin}/api/projects/${project.id}/resources`, {
            method: "POST",
            headers: headers(principal, true),
            body: JSON.stringify({ assetId: "not-fetched" }),
          })
        ).status,
      ).toBe(403);
    }
    expect(app.maps.snapshots.size).toBe(3);
    expect(app.maps.checkpoints).toHaveLength(2);
    expect(
      (
        await fetch(`${app.origin}/api/projects/${project.id}/resources`, {
          method: "POST",
          headers: headers(owner, true),
          body: JSON.stringify({ assetId: "owner-request" }),
        })
      ).status,
    ).toBe(503);

    const editorBuild = await fetch(`${app.origin}/api/maps/${mapId}/builds`, {
      method: "POST",
      headers: headers(editor, true),
      body: JSON.stringify({ expectedMapVersion: 0 }),
    });
    expect(editorBuild.status).toBe(202);
    for (const principal of [viewer, outsider]) {
      expect(
        (
          await fetch(`${app.origin}/api/maps/${mapId}/builds`, {
            method: "POST",
            headers: headers(principal, true),
            body: JSON.stringify({ expectedMapVersion: 0 }),
          })
        ).status,
      ).toBe(403);
    }

    expect(
      (
        await fetch(`${app.origin}/api/projects/${project.id}/maps`, {
          method: "POST",
          headers: headers(null, true),
          body: JSON.stringify({ name: "anonymous.map", format: "quake" }),
        })
      ).status,
    ).toBe(401);
  });

  test("rejects forged and revoked sessions", async () => {
    const { app, outsider } = await createAccessFixture();
    expect(
      (
        await fetch(`${app.origin}/api/projects`, {
          headers: { Cookie: "worldview_session=forged" },
        })
      ).status,
    ).toBe(401);
    const token = outsider.cookie.slice("worldview_session=".length);
    app.database.deleteSession(token);
    expect(
      (
        await fetch(`${app.origin}/api/projects`, {
          headers: headers(outsider),
        })
      ).status,
    ).toBe(401);
  });
});
