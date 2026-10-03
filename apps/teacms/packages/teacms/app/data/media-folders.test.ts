import { it } from "remix/test";
import * as assert from "remix/assert";
import { openDatabase } from "./database.ts";
import { ContentStore } from "./content.ts";
import {
  mediaFolders,
  saveFolder,
  deleteFolder,
  saveMediaDetails,
} from "./media-folders.ts";

it("supports nested folders and notes without changing file URLs; rejects cycles and nonempty deletion", async () => {
  const { sqlite } = await openDatabase(":memory:");
  try {
    const store = new ContentStore(sqlite);
    sqlite
      .prepare(
        "INSERT INTO media (id,filename,mime_type,size,path) VALUES (?,?,?,?,?)",
      )
      .run("art", "art.png", "image/png", 20, "art.png");
    const parent = saveFolder(store, {
      name: "Artwork",
      description: "For images",
      parent_id: null,
    });
    assert.equal(parent.ok, true);
    const child = saveFolder(store, {
      name: "Tape",
      description: "Paper strips",
      parent_id: parent.id,
    });
    assert.equal(
      saveFolder(store, {
        id: parent.id,
        name: "Artwork",
        description: "",
        parent_id: child.id,
      }).ok,
      false,
    );
    assert.equal(
      saveFolder(store, { name: "TAPE", description: "", parent_id: parent.id })
        .ok,
      false,
    );
    assert.equal(
      saveMediaDetails(store, "art", {
        alt: "Tape",
        description: "Scanned paper",
        folder_id: child.id,
      }).ok,
      true,
    );
    assert.equal(store.mediaItem("art")!.path, "art.png");
    assert.equal(store.media()[0].description, "Scanned paper");
    assert.equal(deleteFolder(store, child.id!).ok, false);
    assert.equal(deleteFolder(store, parent.id!).ok, false);
    saveMediaDetails(store, "art", { alt: "Tape", folder_id: null });
    assert.equal(store.media()[0].description, "Scanned paper");
    assert.equal(deleteFolder(store, child.id!).ok, true);
    assert.equal(deleteFolder(store, parent.id!).ok, true);
    assert.equal(mediaFolders(store).length, 0);
  } finally {
    sqlite.close();
  }
});
