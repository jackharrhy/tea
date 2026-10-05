import { it } from "remix/test";
import * as assert from "remix/assert";
import { createController } from "remix/router";
import { route } from "remix/routes";
import { sessionCookie } from "../auth.ts";
import { createEdgeRouter, type EdgeContext } from "../index.tsx";
import type { Bindings } from "../types.ts";

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
  assert.equal(html.includes("Draft title"), true);
  assert.equal(html.includes("Save draft"), true);
  assert.equal(html.includes("Publish draft"), true);
  assert.equal(html.includes("Example site"), true);

  const publicPage = await app.fetch(new Request(origin));
  assert.equal(publicPage.status, 200);
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
