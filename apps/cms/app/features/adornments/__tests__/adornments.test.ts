import { it } from "remix/test";
import * as assert from "remix/assert";
import { openDatabase } from "../../../data/database.ts";
import { createContentStore } from "../../../data/content.ts";
import { saveAdornment } from "../adornments.ts";

it("rejects stale shared artwork edits and keeps its revision out of rendered content", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    sqlite.exec(
      "INSERT INTO media(id,filename,mime_type,size,path) VALUES('art','Art','image/png',1,'art.png')",
    );
    const store = createContentStore(sqlite);
    assert.equal(
      saveAdornment(store, { name: "Tape", media_id: "art", css: {} }).ok,
      true,
    );
    const original = store.adornments()[0];
    assert.equal(
      saveAdornment(store, { ...original, css: { rotation: 12 } }).ok,
      true,
    );
    assert.equal(
      saveAdornment(store, { ...original, css: { rotation: 24 } }).ok,
      false,
    );
    assert.equal(store.adornments()[0].css.rotation, 12);
  } finally {
    sqlite.close();
  }
});
