import { testSite } from "../../test-site.ts";
import { it } from "remix/test";
import * as assert from "remix/assert";
import { openDatabase } from "../../data/database.ts";
import { ContentStore } from "../../data/content.ts";
import { AuthStore } from "../../data/auth.ts";
import { createTeaRouter } from "../../router.ts";
import { searchAppearanceRows } from "./search-appearance.tsx";
import { pageMetadata } from "../public-seo.ts";

it("reports live metadata, homepage drafts and unpublished pages without publishing edits", async () => {
  const database = await openDatabase(":memory:");
  try {
    const store = new ContentStore(database.sqlite);
    const site = store.site();
    assert.ok(
      store.saveSite({ ...site, description: "Site fallback." }, site.revision)
        .ok,
    );
    const homepage = store.editorPage("")!;
    assert.ok(
      store.saveDraft(
        "",
        {
          ...homepage,
          seo: {
            ...homepage.seo,
            description: "Unpublished homepage description.",
          },
        },
        homepage.revision,
      ).ok,
    );
    store.createPage("Live page", "live-page");
    assert.ok(
      store.publishDraft("live-page", store.editorPage("live-page")!.revision)
        .ok,
    );
    store.createPage("Draft only", "draft-only");
    const draft = store.editorPage("draft-only")!;
    assert.ok(
      store.saveDraft(
        "draft-only",
        {
          ...draft,
          seo: {
            ...draft.seo,
            no_index: true,
            canonical: "https://example.com/original",
          },
        },
        draft.revision,
      ).ok,
    );

    const rows = searchAppearanceRows(store);
    assert.equal(rows.length, 3);
    const home = rows[0];
    assert.equal(home.slug, "");
    assert.equal(home.live?.description, "Site fallback.");
    assert.equal(home.live?.defaultDescription, true);
    assert.equal(home.draft?.description, "Unpublished homepage description.");
    assert.equal(
      home.editHref,
      "/tea/admin/homepage?section=seo#search-sharing",
    );
    const live = rows.find((row) => row.slug === "live-page")!;
    assert.equal(
      live.live?.title,
      pageMetadata(store.page("live-page"), store.site(), "/live-page").title,
    );
    assert.equal(live.draft, null);
    const unpublished = rows.find((row) => row.slug === "draft-only")!;
    assert.equal(unpublished.live, null);
    assert.equal(unpublished.draft?.hidden, true);
    assert.equal(unpublished.draft?.elsewhere, true);
    assert.equal(unpublished.draft?.missing, true);

    const user = database.sqlite
      .prepare("INSERT INTO users (email,password_hash) VALUES (?,?)")
      .run("seo-test@example.test", "unused-test-hash");
    const session = new AuthStore(database.sqlite).createSession(
      Number(user.lastInsertRowid),
    );
    const router = createTeaRouter(database, testSite());
    const url = "http://localhost/tea/admin/seo";
    assert.equal((await router.fetch(new Request(url))).status, 303);
    const headers = { Cookie: `tea-session-test=${session.id}` };
    const response = await router.fetch(
      new Request(url + "?filter=drafts", { headers }),
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Compare saved draft/);
    assert.match(html, /Unpublished homepage description/);
    assert.match(html, /Not published/);
    assert.match(html, /Hidden from search; excluded from the sitemap/);
    assert.match(html, /Canonical points to another URL/);
    assert.ok(!html.includes('aria-label="Live page"'));
    assert.equal(store.homepage().seo.description, null);
    assert.equal(store.page("draft-only"), null);
  } finally {
    database.sqlite.close();
  }
});

it("missing-details filter clears with a description and sharing image, not a title override", async () => {
  const database = await openDatabase(":memory:");
  try {
    const store = new ContentStore(database.sqlite);
    database.sqlite
      .prepare(
        "INSERT INTO media(id,filename,mime_type,size,path) VALUES(?,?,?,?,?)",
      )
      .run("photo", "Photo", "image/png", 1, "photo.png");
    const home = store.editorPage("")!;
    assert.ok(
      store.saveDraft(
        "",
        {
          ...home,
          seo: {
            ...home.seo,
            description: "Homepage description.",
            image_id: "photo",
          },
        },
        home.revision,
      ).ok,
    );
    assert.ok(store.publishDraft("", store.editorPage("")!.revision).ok);
    const row = searchAppearanceRows(store)[0];
    assert.equal(row.live?.missing, false);
    assert.equal(row.live?.defaultDescription, false);
    assert.equal(row.live?.title, store.site().site_name);
    assert.ok(row.live?.image?.endsWith("/tea/api/media/file/photo"));
    assert.equal(row.draft, null);
  } finally {
    database.sqlite.close();
  }
});
