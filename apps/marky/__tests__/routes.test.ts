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
    const policy = response.headers.get("content-security-policy") ?? "";
    const nonce = /style-src[^;]*'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.match(policy, /style-src-attr 'unsafe-inline'/);
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
    assert.ok(body.includes(`nonce="${nonce}"`));
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

  it("home redirects to /auth/sign-in in Central mode without a session", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = createCookie("marky.session", { secrets: ["sssh"] });
    const centralRouter = createRouter({
      config: loadConfig({
        MARKY_AUTH: "central",
        AUTH_ISSUER: "https://auth.example.test",
        AUTH_CLIENT_ID: "marky-web",
        AUTH_PROJECT_ID: "marky-project",
        AUTH_ORGANIZATION_ID: "marky-org",
        MARKY_BASE_URL: "https://md.example.test",
        SESSION_SECRET: "sssh",
      }),
      sessionStorage,
      sessionCookie,
    });
    {
      const response = await centralRouter.fetch(
        new Request("https://md.example.test/"),
      );
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/auth/sign-in");
    }
  });

  it("home renders editor for a live Central session", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = createCookie("marky.session", { secrets: ["sssh"] });

    const seed = await sessionStorage.read(null);
    seed.set("identity", {
      subject: "reviewed-jack",
      expiresAt: Date.now() + 60_000,
      name: "Jack",
      color: "#205ea6",
    });
    const sessionId = await sessionStorage.save(seed);
    if (!sessionId) throw new Error("expected session id");
    const cookieHeader = await sessionCookie.serialize(sessionId);

    const centralRouter = createRouter({
      config: loadConfig({
        MARKY_AUTH: "central",
        AUTH_ISSUER: "https://auth.example.test",
        AUTH_CLIENT_ID: "marky-web",
        AUTH_PROJECT_ID: "marky-project",
        AUTH_ORGANIZATION_ID: "marky-org",
        MARKY_BASE_URL: "https://md.example.test",
        SESSION_SECRET: "sssh",
      }),
      sessionStorage,
      sessionCookie,
    });
    {
      const response = await centralRouter.fetch(
        new Request("https://md.example.test/", {
          headers: { cookie: cookieHeader },
        }),
      );
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /editor-app\.tsx/);
      assert.match(body, /Sign out/);
    }
  });

  it("central mode rejects old and expired sessions", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = createCookie("marky.session", { secrets: ["sssh"] });
    const centralRouter = createRouter({
      config: loadConfig({
        MARKY_AUTH: "central",
        MARKY_BASE_URL: "https://md.example.test",
        AUTH_ISSUER: "https://auth.example.test",
        AUTH_CLIENT_ID: "marky-web",
        AUTH_PROJECT_ID: "marky-project",
        AUTH_ORGANIZATION_ID: "marky-org",
        SESSION_SECRET: "sssh",
      }),
      sessionStorage,
      sessionCookie,
    });
    const seed = await sessionStorage.read(null);
    seed.set("identity", { name: "Jack", color: "#205ea6" });
    const sessionId = await sessionStorage.save(seed);
    assert.ok(sessionId);
    const cookieHeader = await sessionCookie.serialize(sessionId);
    const request = () =>
      new Request("https://md.example.test/", {
        headers: { cookie: cookieHeader },
      });
    assert.equal((await centralRouter.fetch(request())).status, 302);
    seed.set("identity", {
      subject: "central-subject",
      name: "Jack",
      color: "#205ea6",
      expiresAt: Date.now() - 1,
    });
    await sessionStorage.save(seed);
    assert.equal((await centralRouter.fetch(request())).status, 302);
    seed.set("identity", {
      subject: "central-subject",
      name: "Jack",
      color: "#205ea6",
      expiresAt: Date.now() + 60000,
    });
    await sessionStorage.save(seed);
    assert.equal((await centralRouter.fetch(request())).status, 200);
  });
});
