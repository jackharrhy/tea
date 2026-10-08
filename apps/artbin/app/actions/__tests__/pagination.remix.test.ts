import * as assert from "remix/assert";
import { afterEach, beforeEach, it } from "remix/test";
import { files, folders } from "#db";
import { routes } from "../../routes.ts";
import {
  createRouterHarness,
  adminCookie,
  router,
  type RouterHarness,
} from "../../../__tests__/router-harness.ts";

let harness: RouterHarness;
beforeEach(async () => {
  harness = await createRouterHarness();
});
afterEach(() => harness.close());

it("serves filtered cursor pages for global and folder browsing without changing document responses", async () => {
  await harness.database.db
    .insert(folders)
    .values({ id: "paged", name: "Paged", slug: "paged" });
  await harness.database.db.insert(files).values(
    Array.from({ length: 105 }, (_, index) => ({
      id: `file-${String(index).padStart(3, "0")}`,
      folderId: "paged",
      path: `paged/needle-${index}.png`,
      name: `needle-${index}.png`,
      kind: "texture" as const,
      mimeType: "image/png",
      size: 1,
      status: index === 104 ? ("pending" as const) : ("approved" as const),
    })),
  );
  for (const base of [
    routes.folders.href(),
    routes.folder.index.href({ path: "paged" }),
  ]) {
    const url = new URL(`${base}?view=textures&q=needle`, "http://artbin.test");
    const seen = new Set<string>();
    for (const expected of [50, 50, 4]) {
      const response = await router.fetch(
        harness.request(url.pathname + url.search, adminCookie, {
          headers: { Accept: "application/json" },
        }),
      );
      assert.equal(response.status, 200);
      assert.ok(
        response.headers
          .get("vary")
          ?.toLowerCase()
          .split(/,\s*/)
          .includes("accept"),
      );
      const page = await response.json();
      assert.equal(page.files.length, expected);
      for (const file of page.files) {
        assert.ok(!seen.has(file.id));
        assert.equal(file.kind, "texture");
        seen.add(file.id);
      }
      if (expected === 4) assert.equal(page.nextCursor, null);
      else url.searchParams.set("cursor", page.nextCursor);
    }
    assert.equal(seen.size, 104);
    const html = await router.fetch(
      harness.request(`${base}?view=textures&q=needle`, adminCookie),
    );
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await html.text(), /Load more/);
    url.searchParams.set("view", "models");
    const empty = await router.fetch(
      harness.request(url.pathname + url.search, adminCookie, {
        headers: { Accept: "application/json" },
      }),
    );
    assert.equal((await empty.json()).files.length, 0);
    const anonymous = await router.fetch(
      harness.request(url.pathname + url.search, undefined, {
        headers: { Accept: "application/json" },
      }),
    );
    assert.equal(anonymous.status, 303);
  }
});
