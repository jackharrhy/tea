import { testSite } from "../../__tests__/site.ts";
import { it } from "remix/test";
import * as assert from "remix/assert";
import { createRouter } from "remix/router";
import { headRequests } from "../head.ts";
import { openDatabase } from "../../data/database.ts";
import { createContentStore } from "../../data/content.ts";
import { createAuthStore } from "../../data/auth.ts";
import { createTeaRouter } from "../../router.ts";
import { routes } from "../../routes.ts";
import { entryScript } from "../../assets.ts";

it("matches GET status and headers for HEAD without bodies or weaker CMS protection", async () => {
  const database = await openDatabase(":memory:");
  try {
    const store = createContentStore(database.sqlite);
    store.createPage("About", "about");
    store.publishDraft("about", store.editorPage("about")!.revision);
    store.createPage("Draft", "draft");
    const user = database.sqlite
      .prepare("INSERT INTO users (email,password_hash) VALUES (?,?)")
      .run("head-test@example.test", "unused-test-hash");
    const session = createAuthStore(database.sqlite).createSession(
      Number(user.lastInsertRowid),
    );
    const router = createTeaRouter(database, testSite());
    for (const [path, status, cookie] of [
      [routes.home.href(), 200, ""],
      [routes.page.href({ slug: "about" }), 200, ""],
      ["/about/?preview&tag=one&tag=two", 301, ""],
      ["/about?preview", 200, ""],
      [routes.sitemap.href(), 200, ""],
      [routes.robots.href(), 200, ""],
      [routes.health.href(), 200, ""],

      ["/admin.css", 200, ""],
      ["/rich-text.css", 200, ""],
      [entryScript.href, 200, ""],
      ["/missing", 404, ""],
      ["/draft", 404, ""],
      [routes.auth.login.href(), 200, ""],
      [routes.admin.pages.href(), 303, ""],
      [routes.admin.pages.href(), 200, `tea-session-test=${session.id}`],
      [routes.auth.logout.href(), 404, `tea-session-test=${session.id}`],
    ] as const) {
      const url = "http://localhost" + path;
      const headers = { Cookie: cookie };
      const get = await router.fetch(new Request(url, { headers }));
      const head = await router.fetch(
        new Request(url, { method: "HEAD", headers }),
      );
      assert.equal(get.status, status);
      assert.equal(head.status, status);
      assert.deepEqual([...head.headers], [...get.headers]);
      assert.equal(head.body, null);
      assert.equal(await head.text(), "");
      await get.body?.cancel();
    }
    assert.ok(createAuthStore(database.sqlite).resolve(session.id));
    const write = await router.fetch(
      new Request(
        "http://localhost" + routes.admin.save.href({ slug: "about" }),
        {
          method: "POST",
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      ),
    );
    assert.equal(write.status, 401);
  } finally {
    database.sqlite.close();
  }
});

it("cancels discarded streams and preserves the original HEAD method for handlers", async () => {
  let cancelled = false;
  const router = createRouter({ middleware: [headRequests] });
  router.get("/stream", (context) => {
    assert.equal(context.method, "GET");
    assert.equal(context.request.method, "HEAD");
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: { "Content-Type": "text/plain", "Content-Length": "100" },
      },
    );
  });
  const response = await router.fetch(
    new Request("http://localhost/stream", { method: "HEAD" }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal(response.body, null);
  assert.equal(cancelled, true);
});
