import { describe, expect, test } from "vitest";
import { fixture, session } from "./service-fixture.js";

describe("browser automation grant", () => {
  test("redeems once and scopes browser APIs to one project for one hour", async () => {
    const app = await fixture();
    const owner = session(app.database);
    const first = app.database.createProject(owner.user.id, "First", "quake");
    const second = app.database.createProject(owner.user.id, "Second", "quake");
    const mapId = app.database.createMapId();
    app.database.createMap({
      id: mapId,
      projectId: first.id,
      userId: owner.user.id,
      name: "one.map",
      format: "quake",
    });
    await app.maps.initialize(mapId, '{\n"classname" "worldspawn"\n}\n');
    const grant = app.database.createAutomationGrant(owner.user.id, first.id);
    expect(grant).not.toBeNull();
    const redeem = () =>
      fetch(`${app.origin}/api/automation/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: grant!.code }),
      });
    const response = await redeem();
    expect(response.status).toBe(200);
    expect((await redeem()).status).toBe(401);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const scoped = (path: string, method = "GET", body?: string) =>
      fetch(`${app.origin}${path}`, {
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
      });
    expect((await scoped("/api/session")).status).toBe(200);
    expect((await scoped(`/api/projects/${first.id}`)).status).toBe(200);
    expect((await scoped(`/api/maps/${mapId}`)).status).toBe(200);
    expect((await scoped(`/api/projects/${second.id}`)).status).toBe(401);
    expect((await scoped("/api/projects")).status).toBe(401);
    expect((await scoped(`/api/projects/${first.id}/members`)).status).toBe(
      401,
    );
    expect(
      (
        await scoped(
          `/api/projects/${first.id}/members/${owner.user.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(401);
    const upload = (projectId: string) =>
      fetch(
        `${app.origin}/api/projects/${projectId}/resources/upload?name=defs.fgd&kind=fgd`,
        {
          method: "PUT",
          headers: { Cookie: cookie, "Content-Type": "text/plain" },
          body: "@PointClass = info_test []",
        },
      );
    expect((await upload(first.id)).status).toBe(201);
    expect((await upload(second.id)).status).toBe(401);
    expect(
      (
        await scoped(
          `/api/projects/${first.id}/maps`,
          "POST",
          JSON.stringify({ name: "two.map", format: "quake" }),
        )
      ).status,
    ).toBe(201);
  });
});
