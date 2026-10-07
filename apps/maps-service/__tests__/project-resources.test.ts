import { describe, expect, test } from "vitest";
import { fixture, session } from "./service-fixture.js";

describe("hosted project assets", () => {
  test("stores direct uploads independently and counts each content hash once", async () => {
    const app = await fixture();
    const owner = session(app.database);
    const project = app.database.createProject(
      owner.user.id,
      "Assets",
      "quake",
    );
    const endpoint = `${app.origin}/api/projects/${project.id}/resources/upload?name=game.fgd&kind=fgd`;
    const upload = () =>
      fetch(endpoint, {
        method: "PUT",
        headers: { Cookie: owner.cookie, "Content-Type": "text/plain" },
        body: '@PointClass = test : "Test" []',
      });

    const first = await upload();
    expect(first.status).toBe(201);
    const firstMount = (await first.json()).mount;
    const second = await upload();
    expect(second.status).toBe(201);
    const secondMount = (await second.json()).mount;
    expect(firstMount.provider).toBe("upload");
    expect(firstMount.expectedSha256).toBe(secondMount.expectedSha256);
    expect(app.database.projectAssetBytes(project.id)).toBe(firstMount.size);

    const content = await fetch(
      `${app.origin}/api/projects/${project.id}/resources/${firstMount.id}/content`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(await content.text()).toBe('@PointClass = test : "Test" []');
    const removed = await fetch(
      `${app.origin}/api/projects/${project.id}/resources/${firstMount.id}`,
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(removed.status).toBe(200);
    expect(app.database.projectAssetBytes(project.id)).toBe(firstMount.size);
  });

  test("enforces ownership, a 512 MiB file cap, and a 1 GiB unique-asset quota", async () => {
    const app = await fixture();
    const owner = session(app.database);
    const outsider = session(app.database, {
      fourmSub: "other",
      username: "other",
      displayName: "Other",
      isAdmin: true,
    });
    const project = app.database.createProject(owner.user.id, "Quota", "quake");
    const endpoint = `${app.origin}/api/projects/${project.id}/resources/upload?name=test.fgd&kind=fgd`;
    expect(
      (
        await fetch(endpoint, {
          method: "PUT",
          headers: { Cookie: outsider.cookie },
          body: "x",
        })
      ).status,
    ).toBe(403);
    expect(() =>
      app.database.createResourceMount({
        projectId: project.id,
        userId: owner.user.id,
        provider: "upload",
        providerAssetId: "oversized",
        expectedSha256: "f".repeat(64),
        kind: "wad",
        displayName: "oversized.wad",
        size: 512 * 1024 * 1024 + 1,
        metadata: {},
      }),
    ).toThrow("512 MiB");

    for (const [index, size] of [
      512 * 1024 * 1024,
      512 * 1024 * 1024,
    ].entries()) {
      app.database.createResourceMount({
        projectId: project.id,
        userId: owner.user.id,
        provider: "upload",
        providerAssetId: String(index),
        expectedSha256: String(index).repeat(64),
        kind: "wad",
        displayName: `${index}.wad`,
        size,
        metadata: {},
      });
    }
    expect(app.database.projectAssetBytes(project.id)).toBe(1024 * 1024 * 1024);
    expect(() =>
      app.database.createResourceMount({
        projectId: project.id,
        userId: owner.user.id,
        provider: "upload",
        providerAssetId: "third",
        expectedSha256: "a".repeat(64),
        kind: "fgd",
        displayName: "third.fgd",
        size: 1,
        metadata: {},
      }),
    ).toThrow("1 GiB quota");
  });
});
