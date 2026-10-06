import { it } from "remix/test";
import * as assert from "remix/assert";
import { openDatabase } from "../database.ts";
import { ContentStore } from "../content.ts";

it("keeps new and existing pages private until publish, with independent revisions", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    const store = new ContentStore(sqlite);
    store.createPage("Private page", "private-page");
    const first = store.editorPage("private-page")!;
    assert.equal(store.page("private-page"), null);
    assert.equal(store.createPage("Duplicate", "private-page").ok, false);
    assert.equal(
      store.saveDraft(
        first.slug,
        { ...first, title: "Reviewed draft" },
        first.revision,
      ).ok,
      true,
    );
    assert.equal(store.publishDraft(first.slug, first.revision).ok, false);
    assert.equal(store.page(first.slug), null);
    assert.equal(
      store.publishDraft(first.slug, store.editorPage(first.slug)!.revision).ok,
      true,
    );
    const live = store.page(first.slug)!;
    assert.equal(live.title, "Reviewed draft");
    assert.equal(
      store.saveDraft(
        first.slug,
        { ...live, title: "Second draft" },
        live.revision,
      ).ok,
      true,
    );
    assert.equal(store.page(first.slug)!.revision, live.revision);
    assert.equal(store.saveDraft(first.slug, live, live.revision).ok, false);
    assert.equal(store.editorPage(first.slug)!.title, "Second draft");
    assert.equal(
      store.publishDraft(first.slug, store.editorPage(first.slug)!.revision).ok,
      true,
    );
    assert.equal(store.page(first.slug)!.title, "Second draft");
    assert.equal(store.editorPage(first.slug)!.hasDraft, false);
    const home = store.homepage();
    const blocks = [
      {
        id: "new",
        type: "paragraph",
        props: { future: "preserved" },
        custom: { a: 1 },
        content: [{ type: "text", text: "Private homepage" }],
      },
    ];
    assert.equal(
      store.saveDraft("", { ...home, blocks }, home.revision).ok,
      true,
    );
    assert.deepEqual(store.homepage(), home);
    assert.equal(
      store.publishDraft("", store.editorPage("")!.revision).ok,
      true,
    );
    assert.deepEqual(store.homepage().blocks, blocks);
  } finally {
    sqlite.close();
  }
});

it("protects draft media and refuses to publish over a newer public version", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    const store = new ContentStore(sqlite);
    const home = store.homepage();
    const blocks = [
      {
        id: "image",
        type: "media",
        props: {
          mediaId: "draft-art",
          adornments: JSON.stringify([
            { adornmentName: "tape", css: { left: "10%" } },
          ]),
        },
      },
    ];
    store.saveDraft("", { ...home, blocks }, home.revision);
    assert.ok(store.mediaReferences("draft-art").includes("Homepage"));
    assert.ok(store.adornmentReferences("tape").includes("Homepage"));
    store.savePage(
      "",
      { ...home, seo: { ...home.seo, title: "Another publish" } },
      home.revision,
    );
    assert.equal(
      store.publishDraft("", store.editorPage("")!.revision).ok,
      false,
    );
    assert.equal(store.savePage("", home, home.revision).ok, false);
    assert.equal(store.homepage().seo.title, "Another publish");
    assert.deepEqual(store.editorPage("")!.blocks, blocks);
  } finally {
    sqlite.close();
  }
});
