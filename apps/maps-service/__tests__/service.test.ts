import { readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import {
  HostedBuildsResponseSchema,
  HostedSessionResponseSchema,
} from "@tea/maps-protocol";
import {
  RemoteCompileRequestSchema,
  RemoteCompileResultSchema,
  type RemoteCompileResult,
} from "@tea/maps-editor/core";
import { describe, expect, test } from "vitest";
import { fixture, session } from "./service-fixture.js";

const malformedHumanTokenFetch: typeof fetch = async (input) => {
  if (String(input).endsWith("/oauth/token"))
    return Response.json({
      access_token: "access-token",
      token_type: "Basic",
      expires_in: "forever",
    });
  throw new Error(
    "Userinfo must not be requested for an invalid token response",
  );
};

async function requestWithHost(
  origin: string,
  path: string,
  host: string,
  options: {
    method?: string;
    cookie?: string;
    requestOrigin?: string;
    body?: string;
  } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL(path, origin),
      {
        method: options.method ?? "GET",
        headers: {
          Host: host,
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...(options.requestOrigin ? { Origin: options.requestOrigin } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

const successfulCompilerFetch: typeof fetch = async (_input, init) => {
  const request = RemoteCompileRequestSchema.parse(
    JSON.parse(String(init?.body)),
  );
  expect(request.mapText).toContain("worldspawn");
  expect(request.mapText).toContain("tea_maps_dev.wad");
  expect(request.assets?.[0]?.name).toBe("tea_maps_dev.wad");
  expect(
    Buffer.from(request.assets![0]!.base64, "base64").subarray(0, 4).toString(),
  ).toBe("WAD2");
  expect(request.expectedDocumentRevision).toBe(0);
  return Response.json({
    status: "succeeded",
    buildId: "native-build-1",
    sourceDocumentRevision: request.expectedDocumentRevision,
    diagnostics: [],
    logs: [{ stage: "qbsp", text: "built", truncated: false }],
    elapsedMilliseconds: 7,
    artifacts: [
      {
        name: "showcase.bsp",
        kind: "bsp",
        mediaType: "application/octet-stream",
        base64: Buffer.from([29, 0, 0, 0]).toString("base64"),
      },
    ],
  } satisfies RemoteCompileResult);
};

describe("Tea Maps hosted project service", () => {
  test("returns only the public session contract", async () => {
    const app = await fixture();
    const { cookie, user } = session(app.database);

    expect(await (await fetch(`${app.origin}/api/session`)).json()).toEqual({
      user: null,
    });
    const malformedCookie = await fetch(`${app.origin}/api/session`, {
      headers: { Cookie: "tea_maps_session=%E0%A4%A" },
    });
    expect(malformedCookie.status).toBe(200);
    await expect(malformedCookie.json()).resolves.toEqual({ user: null });
    const oldCookie = cookie.replace("tea_maps_session=", "worldview_session=");
    expect(
      await (
        await fetch(`${app.origin}/api/session`, {
          headers: { Cookie: oldCookie },
        })
      ).json(),
    ).toEqual({ user: null });

    const response: unknown = await (
      await fetch(`${app.origin}/api/session`, { headers: { Cookie: cookie } })
    ).json();
    expect(HostedSessionResponseSchema.parse(response)).toEqual({
      user: {
        id: user.id,
        username: "mapper",
        displayName: "Mapper",
        isAdmin: false,
      },
    });
  });

  test("creates private projects and keeps remote maps behind a 4orm session", async () => {
    const app = await fixture();
    const { cookie } = session(app.database);
    const projectResponse = await fetch(`${app.origin}/api/projects`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lambda Complex", game: "goldsrc" }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (
      (await projectResponse.json()) as {
        project: { id: string; slug: string; role: string };
      }
    ).project;
    expect(project.id).toMatch(/^[0123456789abcdefghjkmnpqrstvwxyz]{12}$/);
    expect(project.slug).toBe("lambda-complex");
    expect(project.role).toBe("owner");

    const mapResponse = await fetch(
      `${app.origin}/api/projects/${project.id}/maps`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test-chamber.map",
          format: "valve-220",
          source: '{\n"classname" "worldspawn"\n}\n',
        }),
      },
    );
    expect(mapResponse.status).toBe(201);
    const map = (
      (await mapResponse.json()) as {
        map: { id: string; slug: string; mapVersion: number };
      }
    ).map;
    expect(map.id).toMatch(/^[0123456789abcdefghjkmnpqrstvwxyz]{12}$/);
    expect(map.slug).toBe("test-chamber");
    expect(map.mapVersion).toBe(0);
    const projectState = await fetch(
      `${app.origin}/api/projects/${project.id}`,
      {
        headers: { Cookie: cookie },
      },
    );
    expect(await projectState.json()).toMatchObject({
      project: {
        slug: "lambda-complex",
        name: "Lambda Complex",
        maps: [{ id: map.id, slug: "test-chamber", name: "test-chamber.map" }],
      },
    });

    const guestResponse = await fetch(`${app.origin}/api/guest-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "no-accountless-access" }),
    });
    expect(guestResponse.status).toBe(404);
    expect((await fetch(`${app.origin}/api/maps/${map.id}`)).status).toBe(401);
    expect(
      (
        await fetch(`${app.origin}/api/maps/${map.id}/realtime-ticket`, {
          method: "POST",
        })
      ).status,
    ).toBe(401);

    const hashes = await readFile(join(app.root, "maps.db"));
    expect(hashes.byteLength).toBeGreaterThan(0);
  });

  test("loads source and creates checkpoints through the authoritative MapCell", async () => {
    const app = await fixture();
    const { cookie } = session(app.database);
    const project = (
      (await (
        await fetch(`${app.origin}/api/projects`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Autosave", game: "quake" }),
        })
      ).json()) as { project: { id: string } }
    ).project;
    const map = (
      (await (
        await fetch(`${app.origin}/api/projects/${project.id}/maps`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "autosave.map", format: "quake" }),
        })
      ).json()) as { map: { id: string } }
    ).map;
    const initial = await app.maps.snapshot(map.id);
    const source = '{\n"classname" "worldspawn"\n"message" "canonical"\n}\n';
    app.maps.snapshots.set(map.id, {
      ...initial,
      source,
      mapVersion: 7,
      sourceSha256: "b".repeat(64),
    });
    const checkpoint = await fetch(
      `${app.origin}/api/maps/${map.id}/checkpoints`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First room" }),
      },
    );
    expect(await checkpoint.json()).toMatchObject({
      checkpoint: { name: "First room", mapVersion: 7 },
    });
    const checkpoints = await fetch(
      `${app.origin}/api/maps/${map.id}/checkpoints`,
      { headers: { Cookie: cookie } },
    );
    expect(checkpoints.status).toBe(200);
    expect(await checkpoints.json()).toMatchObject({
      checkpoints: [{ name: "First room", mapVersion: 7 }],
    });
    const checkpointSource = await fetch(
      `${app.origin}/api/maps/${map.id}/checkpoints/checkpoint-1`,
      { headers: { Cookie: cookie } },
    );
    expect(checkpointSource.status).toBe(200);
    expect(await checkpointSource.json()).toMatchObject({
      checkpoint: { name: "First room", mapVersion: 7 },
      source,
    });
    expect(
      await (
        await fetch(`${app.origin}/api/maps/${map.id}`, {
          headers: { Cookie: cookie },
        })
      ).json(),
    ).toMatchObject({
      map: { source, mapVersion: 7, sourceSha256: "b".repeat(64) },
    });
  });

  test("replaces linked map source only at the reviewed hosted version", async () => {
    const app = await fixture();
    const { cookie } = session(app.database);
    const project = (await (
      await fetch(`${app.origin}/api/projects`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sync", game: "quake" }),
      })
    ).json()) as { project: { id: string } };
    const created = (await (
      await fetch(`${app.origin}/api/projects/${project.project.id}/maps`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "linked.map", format: "quake" }),
      })
    ).json()) as { map: { id: string } };
    const mapId = created.map.id;
    const snapshot = (await (
      await fetch(`${app.origin}/api/maps/${mapId}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { map: { mapVersion: number; sourceSha256: string } };
    const endpoint = `${app.origin}/api/projects/${project.project.id}/maps/${mapId}/source`;
    const payload = {
      expectedMapVersion: snapshot.map.mapVersion,
      expectedSourceSha256: snapshot.map.sourceSha256,
      source: '{\n"classname" "worldspawn"\n"message" "local sync"\n}\n',
    };
    const replace = await fetch(endpoint, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(replace.status).toBe(200);
    expect(await replace.json()).toMatchObject({
      status: "replaced",
      map: { mapVersion: 1, source: payload.source },
    });
    const stale = await fetch(endpoint, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      status: "conflict",
      mapVersion: 1,
    });
    const anonymous = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(anonymous.status).toBe(401);
  });

  test("does not expose map metadata when MapCell initialization fails", async () => {
    const app = await fixture();
    const { cookie } = session(app.database);
    const project = (
      (await (
        await fetch(`${app.origin}/api/projects`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Atomic creation", game: "quake" }),
        })
      ).json()) as { project: { id: string } }
    ).project;
    app.maps.initialize = async () => {
      throw new Error("MapCell unavailable");
    };
    const response = await fetch(
      `${app.origin}/api/projects/${project.id}/maps`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "missing.map", format: "quake" }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await (
        await fetch(`${app.origin}/api/projects/${project.id}`, {
          headers: { Cookie: cookie },
        })
      ).json(),
    ).toMatchObject({ project: { maps: [] } });
  });

  test("rejects invalid or duplicate map names before initializing another MapCell", async () => {
    const app = await fixture();
    const { cookie } = session(app.database);
    const project = (
      (await (
        await fetch(`${app.origin}/api/projects`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "No orphan cells", game: "quake" }),
        })
      ).json()) as { project: { id: string } }
    ).project;
    const create = (name: string) =>
      fetch(`${app.origin}/api/projects/${project.id}/maps`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name, format: "quake" }),
      });
    expect((await create("kept.map")).status).toBe(201);
    expect(app.maps.snapshots.size).toBe(1);
    expect((await create("")).status).toBe(400);
    expect((await create("kept.map")).status).toBe(409);
    expect(app.maps.snapshots.size).toBe(1);
  });

  test("isolates project listings by membership and rejects cross-origin mutations", async () => {
    const app = await fixture();
    const owner = session(app.database);
    const outsider = app.database.upsertUser({
      fourmSub: "fourm-2",
      username: "outsider",
      displayName: "Outsider",
      isAdmin: false,
    });
    const outsiderCookie = `tea_maps_session=${app.database.createSession(outsider.id).token}`;
    await fetch(`${app.origin}/api/projects`, {
      method: "POST",
      headers: { Cookie: owner.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Private", game: "quake" }),
    });
    const listing = await fetch(`${app.origin}/api/projects`, {
      headers: { Cookie: outsiderCookie },
    });
    expect(await listing.json()).toEqual({ projects: [] });
    const rejected = await fetch(`${app.origin}/api/projects`, {
      method: "POST",
      headers: {
        Cookie: owner.cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Nope", game: "quake" }),
    });
    expect(rejected.status).toBe(403);
  });

  test("lets project owners manage access for known Worldview users", async () => {
    const app = await fixture();
    const owner = session(app.database);
    const collaborator = app.database.upsertUser({
      fourmSub: "fourm-collaborator",
      username: "carson",
      displayName: "Carson",
      isAdmin: false,
    });
    const collaboratorCookie = `tea_maps_session=${app.database.createSession(collaborator.id).token}`;
    const project = app.database.createProject(
      owner.user.id,
      "Shared project",
      "quake",
    );

    const ownerListing = await fetch(
      `${app.origin}/api/projects/${project.id}/members`,
      {
        headers: { Cookie: owner.cookie },
      },
    );
    expect(ownerListing.status).toBe(200);
    expect(await ownerListing.json()).toMatchObject({
      users: [
        { id: owner.user.id, username: "mapper", role: "owner" },
        { id: collaborator.id, username: "carson", role: null },
      ],
    });
    expect(
      (
        await fetch(`${app.origin}/api/projects/${project.id}/members`, {
          headers: { Cookie: collaboratorCookie },
        })
      ).status,
    ).toBe(403);

    const grant = await fetch(
      `${app.origin}/api/projects/${project.id}/members/${collaborator.id}`,
      {
        method: "PUT",
        headers: { Cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      },
    );
    expect(grant.status).toBe(200);
    expect(
      await (
        await fetch(`${app.origin}/api/projects/${project.id}`, {
          headers: { Cookie: collaboratorCookie },
        })
      ).json(),
    ).toMatchObject({ project: { id: project.id, role: "editor" } });

    const forbiddenChange = await fetch(
      `${app.origin}/api/projects/${project.id}/members/${owner.user.id}`,
      {
        method: "PUT",
        headers: {
          Cookie: collaboratorCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "viewer" }),
      },
    );
    expect(forbiddenChange.status).toBe(403);
    const removeOwner = await fetch(
      `${app.origin}/api/projects/${project.id}/members/${owner.user.id}`,
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(removeOwner.status).toBe(403);

    const remove = await fetch(
      `${app.origin}/api/projects/${project.id}/members/${collaborator.id}`,
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(remove.status).toBe(200);
    expect(
      (
        await fetch(`${app.origin}/api/projects/${project.id}`, {
          headers: { Cookie: collaboratorCookie },
        })
      ).status,
    ).toBe(404);
  });

  test("admits only one active build per user and bounds hourly build attempts", async () => {
    const app = await fixture();
    const { user } = session(app.database);
    const project = app.database.createProject(user.id, "Build quota", "quake");
    const map = app.database.createMap({
      id: app.database.createMapId(),
      projectId: project.id,
      userId: user.id,
      name: "quota.map",
      format: "quake",
    });
    const mapId = String(map.id);
    expect(app.database.buildAdmission(user.id)).toBe("allowed");
    const active = app.database.createBuild({
      mapId,
      userId: user.id,
      mapVersion: 0,
      profileId: "default",
      quality: "preview",
    });
    expect(app.database.buildAdmission(user.id)).toBe("user-active");
    app.database.updateBuild(active.id, "failed");
    for (let index = 1; index < 6; index += 1) {
      const build = app.database.createBuild({
        mapId,
        userId: user.id,
        mapVersion: 0,
        profileId: "default",
        quality: "preview",
      });
      app.database.updateBuild(build.id, "failed");
    }
    expect(app.database.buildAdmission(user.id)).toBe("user-hourly");
  });

  test.each(["valid", "stale", "wrong-game"] as const)(
    "builds canonical hosted maps, enforcing revision, game format and artifact access (%s worker)",
    async (worker) => {
      const app = await fixture(undefined, async (input, init) => {
        const response = await successfulCompilerFetch(input, init);
        if (worker === "valid") return response;
        const result = RemoteCompileResultSchema.parse(await response.json());
        return Response.json({
          ...result,
          ...(worker === "stale"
            ? { sourceDocumentRevision: 9 }
            : {
                artifacts: [
                  {
                    ...result.artifacts[0]!,
                    base64: Buffer.from([30, 0, 0, 0]).toString("base64"),
                  },
                ],
              }),
        });
      });
      const { user, cookie } = session(app.database);
      const viewer = session(app.database, {
        fourmSub: "build-viewer",
        username: "build-viewer",
        displayName: "Build Viewer",
        isAdmin: false,
      });
      const outsider = session(app.database, {
        fourmSub: "build-outsider",
        username: "build-outsider",
        displayName: "Build Outsider",
        isAdmin: false,
      });
      const project = app.database.createProject(
        user.id,
        "Hosted build",
        "quake",
      );
      expect(
        app.database.setProjectMemberRole(
          project.id,
          user.id,
          viewer.user.id,
          "viewer",
        ),
      ).toBe(true);
      const map = app.database.createMap({
        id: app.database.createMapId(),
        projectId: project.id,
        userId: user.id,
        name: "showcase.map",
        format: "quake",
      });
      const mapId = String(map.id);
      await app.maps.initialize(mapId, '{\n"classname" "worldspawn"\n}\n');

      const stale = await fetch(`${app.origin}/api/maps/${map.id}/builds`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "preview", expectedMapVersion: 9 }),
      });
      expect(stale.status).toBe(409);
      await expect(stale.json()).resolves.toEqual({
        error:
          "The hosted map has not saved this revision yet; wait a moment and try again",
      });
      expect(app.database.listBuilds(mapId, user.id)).toEqual([]);
      const queued = await fetch(`${app.origin}/api/maps/${map.id}/builds`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ quality: "preview", expectedMapVersion: 0 }),
      });
      expect(queued.status).toBe(202);
      const buildId = ((await queued.json()) as { build: { id: string } }).build
        .id;

      await expect
        .poll(async () => {
          const response = await fetch(
            `${app.origin}/api/maps/${map.id}/builds`,
            {
              headers: { Cookie: cookie },
            },
          );
          const { builds } = HostedBuildsResponseSchema.parse(
            await response.json(),
          );
          return builds.find(({ id }) => id === buildId);
        })
        .toMatchObject(
          worker !== "valid"
            ? {
                status: "failed",
                result: {
                  error:
                    worker === "stale"
                      ? "Build worker returned a different map revision"
                      : "Build worker returned the wrong BSP format for quake. Check its game profile configuration.",
                },
              }
            : {
                status: "succeeded",
                result: { artifacts: [expect.any(Object)] },
              },
        );
      if (worker !== "valid") return;
      const build = app.database.build(mapId, buildId, user.id)!;
      const artifact = build.result!.artifacts![0]!;
      const artifactUrl = `${app.origin}/api/maps/${map.id}/builds/${buildId}/artifacts/${artifact.sha256}`;
      expect((await fetch(artifactUrl)).status).toBe(401);
      const downloaded = await fetch(artifactUrl, {
        headers: { Cookie: cookie },
      });
      expect(downloaded.status).toBe(200);
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(
        Uint8Array.from([29, 0, 0, 0]),
      );
      expect(
        (await fetch(artifactUrl, { headers: { Cookie: viewer.cookie } }))
          .status,
      ).toBe(200);
      expect(
        (await fetch(artifactUrl, { headers: { Cookie: outsider.cookie } }))
          .status,
      ).toBe(404);
    },
  );

  test("completes the existing 4orm PKCE flow into a Worldview session", async () => {
    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/oauth/token"))
        return Response.json({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 300,
        });
      if (url.endsWith("/oauth/userinfo"))
        return Response.json({
          sub: "42",
          username: "gordon",
          display_name: "Gordon",
          is_admin: false,
        });
      return new Response("not found", { status: 404 });
    };
    const app = await fixture(mockFetch);
    const login = await fetch(
      `${app.origin}/auth/login?returnTo=${encodeURIComponent("/project/0123456789ab-example")}`,
      { redirect: "manual" },
    );
    expect(login.status).toBe(303);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state")!;
    const oauthCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const callback = await fetch(
      `${app.origin}/auth/callback?code=code-1&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie }, redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(
      "/project/0123456789ab-example",
    );
    const callbackCookies = callback.headers.getSetCookie();
    expect(callbackCookies).toHaveLength(2);
    expect(callbackCookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("tea_maps_oauth=;"),
        expect.stringContaining("tea_maps_session="),
      ]),
    );
    expect(calls).toEqual([
      "https://4orm.example/oauth/token",
      "https://4orm.example/oauth/userinfo",
    ]);
  });

  test("validates, consumes, and clears OAuth state when authorization is denied", async () => {
    const app = await fixture();
    const login = await fetch(`${app.origin}/auth/login`, {
      redirect: "manual",
    });
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const oauthCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const denial = await fetch(
      `${app.origin}/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie }, redirect: "manual" },
    );

    expect(denial.status).toBe(303);
    expect(denial.headers.get("location")).toBe("/?authError=access_denied");
    expect(denial.headers.getSetCookie()).toEqual([
      expect.stringContaining("tea_maps_oauth=;"),
    ]);

    const replay = await fetch(
      `${app.origin}/auth/callback?code=replay&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie }, redirect: "manual" },
    );
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toEqual({
      error: "OAuth transaction is missing or expired",
    });
    expect(replay.headers.getSetCookie()).toEqual([
      expect.stringContaining("tea_maps_oauth=;"),
    ]);
  });

  test("keeps tailnet login, callback, and mutations on the initiating origin", async () => {
    const tailnetOrigin = "https://newport.hedgehog-python.ts.net:8457";
    let tokenRedirectUri: string | null = null;
    const oauthFetch: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/oauth/token")) {
        tokenRedirectUri = new URLSearchParams(String(init?.body)).get(
          "redirect_uri",
        );
        return Response.json({
          access_token: "access-token",
          token_type: "Bearer",
        });
      }
      return Response.json({
        sub: "tailnet-user",
        username: "mapper",
        display_name: "Mapper",
        is_admin: false,
      });
    };
    const app = await fixture(oauthFetch, undefined, [tailnetOrigin]);
    const host = "newport.hedgehog-python.ts.net:8457";
    const login = await requestWithHost(app.origin, "/auth/login", host);
    const authorize = new URL(login.headers.location!);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${tailnetOrigin}/auth/callback`,
    );
    const oauthCookie = login.headers["set-cookie"]![0]!.split(";", 1)[0]!;
    expect(login.headers["set-cookie"]![0]).toContain("Secure");

    const callback = await requestWithHost(
      app.origin,
      `/auth/callback?code=valid&state=${authorize.searchParams.get("state")}`,
      host,
      { cookie: oauthCookie },
    );
    expect(callback.status).toBe(303);
    expect(tokenRedirectUri).toBe(`${tailnetOrigin}/auth/callback`);
    const sessionCookie = callback.headers["set-cookie"]!.find((value) =>
      value.startsWith("tea_maps_session="),
    )!.split(";", 1)[0]!;
    const create = await requestWithHost(app.origin, "/api/projects", host, {
      method: "POST",
      requestOrigin: tailnetOrigin,
      cookie: sessionCookie,
      body: JSON.stringify({ name: "Tailnet map", game: "quake" }),
    });
    expect(create.status).toBe(201);
  });

  test("rejects malformed human token metadata and clears the OAuth cookie", async () => {
    const app = await fixture(malformedHumanTokenFetch);
    const login = await fetch(`${app.origin}/auth/login`, {
      redirect: "manual",
    });
    const authorize = new URL(login.headers.get("location")!);
    const state = authorize.searchParams.get("state")!;
    const oauthCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const callback = await fetch(
      `${app.origin}/auth/callback?code=code-1&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie }, redirect: "manual" },
    );

    expect(callback.status).toBe(500);
    expect(callback.headers.getSetCookie()).toEqual([
      expect.stringContaining("tea_maps_oauth=;"),
    ]);
    expect(await callback.json()).toEqual({ error: "Internal server error" });
  });
});
