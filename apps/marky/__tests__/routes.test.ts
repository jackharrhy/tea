import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { createRouter } from "../app/router.tsx";
import { loadConfig } from "../app/config.ts";
import { routes } from "../app/routes.ts";

const { createCookie } = await import("remix/cookie");
const { createMemorySessionStorage } =
  await import("remix/session-storage/memory");
const router = createRouter({
  config: loadConfig({}),
  sessionCookie: createCookie("marky.session", { secrets: ["test-secret"] }),
  sessionStorage: createMemorySessionStorage(),
});

describe("routes", () => {
  it("home page returns 200 HTML", async () => {
    const response = await router.fetch(
      new Request("http://localhost" + routes.home.href()),
    );
    assert.equal(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assert.match(contentType, /text\/html/);
    const body = await response.text();
    assert.match(body, /marky/);
  });

  it("home page mounts the editor client entry", async () => {
    const response = await router.fetch(
      new Request("http://localhost" + routes.home.href()),
    );
    const body = await response.text();
    assert.match(body, /editor-app\.tsx/);
    // Hydration props payload is emitted by the runtime for client entries.
    assert.match(body, /rmx-data/);
  });

  it("asset route compiles a TypeScript module", async () => {
    const url =
      "http://localhost" +
      routes.assets.href({ path: "app/shared/constants.ts" });
    const response = await router.fetch(new Request(url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    const body = await response.text();
    assert.match(body, /PROSEMIRROR_FRAGMENT_NAME/);
  });

  it("asset route 404s on a missing file", async () => {
    const url =
      "http://localhost" + routes.assets.href({ path: "app/missing-file.ts" });
    const response = await router.fetch(new Request(url));
    assert.equal(response.status, 404);
  });

  it("asset route denies server-only modules", async () => {
    const url =
      "http://localhost" +
      routes.assets.href({ path: "app/middleware/sockets.ts" });
    const response = await router.fetch(new Request(url));
    assert.notEqual(response.status, 200);
  });

  it("asset route denies app/data/discord.ts", async () => {
    const url =
      "http://localhost" + routes.assets.href({ path: "app/data/discord.ts" });
    const response = await router.fetch(new Request(url));
    assert.notEqual(response.status, 200);
  });

  it("asset route denies app/data/git-store.ts", async () => {
    const url =
      "http://localhost" +
      routes.assets.href({ path: "app/data/git-store.ts" });
    const response = await router.fetch(new Request(url));
    assert.notEqual(response.status, 200);
  });

  it("asset route denies app/config.ts", async () => {
    const url =
      "http://localhost" + routes.assets.href({ path: "app/config.ts" });
    const response = await router.fetch(new Request(url));
    // app/config.ts is at the app root; allow rules don't match it, so the
    // asset server should not serve it.
    assert.notEqual(response.status, 200);
  });

  it("home redirects to /auth/sign-in when discord mode and no session", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = createCookie("marky.session", { secrets: ["sssh"] });
    const discordRouter = createRouter({
      config: loadConfig({
        MARKY_AUTH: "discord",
        DISCORD_CLIENT_ID: "cid",
        DISCORD_CLIENT_SECRET: "cs",
        DISCORD_GUILD_ID: "gid",
        MARKY_BASE_URL: "http://localhost",
        SESSION_SECRET: "sssh",
      }),
      sessionStorage,
      sessionCookie,
    });
    {
      const response = await discordRouter.fetch(
        new Request("http://localhost/"),
      );
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/auth/sign-in");
    }
  });

  it("home renders editor in discord mode when session has identity", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = createCookie("marky.session", { secrets: ["sssh"] });

    const seed = await sessionStorage.read(null);
    seed.set("identity", { discordId: "7", name: "Jack", color: "#205ea6" });
    const sessionId = await sessionStorage.save(seed);
    if (!sessionId) throw new Error("expected session id");
    const cookieHeader = await sessionCookie.serialize(sessionId);

    const discordRouter = createRouter({
      config: loadConfig({
        MARKY_AUTH: "discord",
        DISCORD_CLIENT_ID: "cid",
        DISCORD_CLIENT_SECRET: "cs",
        DISCORD_GUILD_ID: "gid",
        MARKY_BASE_URL: "http://localhost",
        SESSION_SECRET: "sssh",
      }),
      sessionStorage,
      sessionCookie,
    });
    {
      const response = await discordRouter.fetch(
        new Request("http://localhost/", { headers: { cookie: cookieHeader } }),
      );
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /editor-app\.tsx/);
      assert.match(body, /Sign out/);
    }
  });
});
