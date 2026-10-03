import { it } from "remix/test";
import * as assert from "remix/assert";
import { openDatabase } from "./database.ts";
import { ContentStore } from "./content.ts";

it("rolls back history and published deletion when removing the draft fails", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    const store = new ContentStore(sqlite);
    store.createPage("Page", "page");
    store.publishDraft("page", store.editorPage("page")!.revision);
    const original = store.page("page")!;
    store.saveDraft("page", { ...original, title: "Draft" }, original.revision);
    const before = store.editorPage("page")!;
    const history = sqlite
      .prepare("SELECT count(*) AS count FROM content_history")
      .get()!.count;
    sqlite.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON page_drafts BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    let failed = false;
    try {
      store.deletePage("page", before.revision);
    } catch {
      failed = true;
    }
    assert.equal(failed, true);
    assert.deepEqual(store.page("page"), original);
    assert.deepEqual(store.editorPage("page"), before);
    assert.equal(
      sqlite.prepare("SELECT count(*) AS count FROM content_history").get()!
        .count,
      history,
    );
    assert.equal(sqlite.isTransaction, false);
  } finally {
    sqlite.close();
  }
});
