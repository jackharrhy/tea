import { it } from "remix/test";
import * as assert from "remix/assert";
import { createController } from "remix/router";
import { route } from "remix/routes";
import { sessionCookie } from "../auth.ts";
import { createEdgeRouter, type EdgeContext } from "../index.tsx";
import type { Bindings } from "../types.ts";

it("requires a preview signing secret only when Central mode exposes preview links", () => {
  const env = {
    TEA_SESSION_SECRET: "session-secret",
    TEA_EDITOR_ORIGIN: "https://cms.example.test",
    TEA_AUTH_ISSUER: "https://auth.example.test",
    TEA_AUTH_CLIENT_ID: "client",
    TEA_AUTH_PROJECT_ID: "project",
    TEA_AUTH_ORGANIZATION_ID: "org",
    TEA_AUTH_OWNER_SUBJECT: "owner",
  } as Bindings;
  const config = { siteName: "CMS", collections: [] };
  createEdgeRouter(env, config);
  assert.throws(
    () =>
      createEdgeRouter(env, {
        ...config,
        previewUrl: (collection: string, slug: string, token: string) =>
          `https://preview.example.test/${collection}/${slug}?token=${token}`,
      }),
    /preview secrets/,
  );
});

it("serves a native Remix editor and public page from one router", async () => {
  const row = {
    collection: "articles",
    slug: "example",
    draft: JSON.stringify({ title: "Draft title" }),
    published: JSON.stringify({ title: "Published title" }),
    revision: 2,
    published_at: "2026-09-28",
  };
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            values = args;
            return this;
          },
          async first() {
            return row;
          },
          async all() {
            return { results: [row] };
          },
          async run() {
            if (sql.startsWith("UPDATE tea_entries SET draft")) {
              row.draft = String(values[0]);
              row.revision += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    },
    MEDIA: {},
    TEA_ADMIN_PASSWORD: "password",
    TEA_SESSION_SECRET: "session-secret",
    TEA_PREVIEW_SECRET: "preview-secret",
  } as unknown as Bindings;
  const publicRoutes = route({ home: "/" });
  const app = createEdgeRouter(
    env,
    {
      siteName: "Example site",
      collections: [
        {
          name: "articles",
          label: "Articles",
          fields: [{ name: "title", label: "Title", type: "text" }],
        },
      ],
    },
    (router) => {
      router.map(
        publicRoutes,
        createController<typeof publicRoutes, EdgeContext>(publicRoutes, {
          actions: {
            home({ render }) {
              return render(
                <html>
                  <body>
                    <h1>Public page</h1>
                  </body>
                </html>,
              );
            },
          },
        }),
      );
    },
  );

  const origin = "https://example.test";
  const cookie = await sessionCookie(new Request(`${origin}/tea/login`), env);
  const editor = await app.fetch(
    new Request(`${origin}/tea/articles/example`, {
      headers: { Cookie: cookie },
    }),
  );
  const html = await editor.text();
  assert.equal(editor.status, 200);
  assert.equal(editor.headers.get("Cache-Control"), "private, no-store");
  const policy = editor.headers.get("Content-Security-Policy") ?? "";
  assert.match(policy, /style-src 'self' 'nonce-[^']+'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.equal(html.includes("Draft title"), true);
  assert.equal(html.includes("Save draft"), true);
  assert.equal(html.includes("Publish draft"), true);
  assert.equal(html.includes("Example site"), true);

  const publicPage = await app.fetch(new Request(origin));
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.headers.get("Cache-Control"), "private, no-store");
  assert.match(
    publicPage.headers.get("Content-Security-Policy") ?? "",
    /nonce-/,
  );
  assert.equal((await publicPage.text()).includes("Public page"), true);

  const published = await app.fetch(
    new Request(`${origin}/api/content/articles/example`),
  );
  assert.equal(
    ((await published.json()) as { data: { title: string } }).data.title,
    "Published title",
  );

  const visual = await app.fetch(
    new Request(`${origin}/tea/visual/articles/example`, {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(visual.status, 200);
  assert.equal(
    ((await visual.json()) as { fields: { value: string }[] }).fields[0].value,
    "Draft title",
  );
  const edited = await app.fetch(
    new Request(`${origin}/tea/visual/articles/example`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "title",
        value: "Edited on page",
        revision: 2,
      }),
    }),
  );
  assert.equal(edited.status, 200);
  assert.equal(((await edited.json()) as { revision: number }).revision, 3);
  assert.equal(row.published, JSON.stringify({ title: "Published title" }));

  const oversized = await app.fetch(
    new Request(`${origin}/tea/visual/articles/example`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "x".repeat(16_385),
    }),
  );
  assert.equal(oversized.status, 413);
  assert.equal(row.revision, 3);
});

it("routes Central editor login and rejects the prototype password session", async () => {
  const env = {
    DB: {},
    MEDIA: {},
    TEA_SESSION_SECRET: "session-secret",
    TEA_PREVIEW_SECRET: "preview-secret",
    TEA_EDITOR_ORIGIN: "https://cms.example.test",
    TEA_AUTH_ISSUER: "https://auth.example.test",
    TEA_AUTH_CLIENT_ID: "client",
    TEA_AUTH_PROJECT_ID: "project",
    TEA_AUTH_ORGANIZATION_ID: "org",
    TEA_AUTH_OWNER_SUBJECT: "owner",
  } as unknown as Bindings;
  const app = createEdgeRouter(env, { siteName: "CMS", collections: [] });
  const oldCookie = await sessionCookie(
    new Request("https://cms.example.test/tea"),
    env,
  );
  const oldSession = await app.fetch(
    new Request("https://cms.example.test/tea", {
      headers: { Cookie: oldCookie },
    }),
  );
  assert.equal(oldSession.status, 303);
  assert.equal(oldSession.headers.get("location"), "/tea/login");
  const login = await app.fetch(
    new Request("https://cms.example.test/tea/login"),
  );
  assert.equal(login.headers.get("location"), "/tea/auth/login");
  const invalidCallback = await app.fetch(
    new Request("https://cms.example.test/tea/auth/callback"),
  );
  assert.equal(invalidCallback.status, 400);
  const password = await app.fetch(
    new Request("https://cms.example.test/tea/login", {
      method: "POST",
      headers: { Origin: "https://cms.example.test" },
      body: new URLSearchParams({ password: "old" }),
    }),
  );
  assert.equal(password.status, 404);
  const oldPreviewToken = await app.fetch(
    new Request("https://cms.example.test/api/preview/pages", {
      headers: { Authorization: "Bearer preview-secret" },
    }),
  );
  assert.equal(oldPreviewToken.status, 503);
});

it("lets a standalone site own staff login and route authorization", async () => {
  const env = { TEA_PREVIEW_SECRET: "preview-secret" } as Bindings;
  const app = createEdgeRouter(env, {
    siteName: "Example site",
    collections: [],
    auth: {
      loginPath: "/staff/login",
      async authorize(request) {
        return request.headers.get("X-Staff") === "editor"
          ? "allow"
          : request.headers.get("X-Staff") === "visitor"
            ? "forbidden"
            : "login";
      },
      async logout() {
        return new Response(null, {
          status: 303,
          headers: { Location: "/staff/login" },
        });
      },
    },
  });
  const origin = "https://example.test";
  const anonymous = await app.fetch(new Request(origin + "/tea"));
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.get("Location"), "/staff/login");
  const denied = await app.fetch(
    new Request(origin + "/tea", { headers: { "X-Staff": "visitor" } }),
  );
  assert.equal(denied.status, 403);
  const editor = await app.fetch(
    new Request(origin + "/tea", { headers: { "X-Staff": "editor" } }),
  );
  assert.equal(editor.status, 200);
  const login = await app.fetch(new Request(origin + "/tea/login"));
  assert.equal(login.headers.get("Location"), "/staff/login");
});
