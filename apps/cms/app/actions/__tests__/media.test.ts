import { testSite } from "../../__tests__/site.ts";
import { it } from "remix/test";
import * as assert from "remix/assert";
import { safeUploadPath, serveMedia, uploadMedia } from "../media.ts";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../data/database.ts";
import { createContentStore } from "../../data/content.ts";
import { createTeaRouter } from "../../router.ts";
it("confines stored media paths to the upload directory", () => {
  assert.equal(
    safeUploadPath("/tmp/uploads", "image.png"),
    "/tmp/uploads/image.png",
  );
  assert.equal(safeUploadPath("/tmp/uploads", "../tea.db"), null);
  assert.equal(safeUploadPath("/tmp/uploads", "/etc/passwd"), null);
  assert.equal(safeUploadPath("/tmp/uploads", "nested/image.png"), null);
});

it("streams typed media and ranges while rejecting missing files and symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tea-media-test-"));
  const previous = process.env.TEA_DATA_DIR;
  process.env.TEA_DATA_DIR = directory;
  const database = await openDatabase(":memory:");
  const store = createContentStore(database.sqlite);
  try {
    await mkdir(join(directory, "uploads"));
    await writeFile(join(directory, "uploads", "test.png"), "0123456789");
    await symlink(
      join(directory, "uploads", "test.png"),
      join(directory, "uploads", "link.png"),
    );
    for (const [id, path] of [
      ["present", "test.png"],
      ["missing", "gone.png"],
      ["link", "link.png"],
      ["traversal", "../tea.db"],
    ]) {
      database.sqlite
        .prepare(
          "INSERT INTO media (id,filename,mime_type,size,path,alt) VALUES (?,?,'image/png',10,?,'')",
        )
        .run(id, path, path);
    }
    const request = new Request("http://localhost/tea/api/media/file/present");
    const full = await serveMedia(request, "present", store);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("Content-Type"), "image/png");
    assert.equal(full.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(await full.text(), "0123456789");
    const router = createTeaRouter(database, testSite(directory));
    const head = await router.fetch(
      new Request(request, { method: "HEAD", headers: { Range: "bytes=2-5" } }),
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(head.headers.get("content-range"), null);
    assert.equal(head.headers.get("content-type"), "image/png");
    assert.equal(head.body, null);
    const unchanged = await router.fetch(
      new Request(request, {
        method: "HEAD",
        headers: { "If-None-Match": head.headers.get("etag")! },
      }),
    );
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.body, null);
    const partial = await serveMedia(
      new Request(request, { headers: { Range: "bytes=2-5" } }),
      "present",
      store,
    );
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "2345");
    assert.equal((await serveMedia(request, "unknown", store)).status, 404);
    assert.equal((await serveMedia(request, "missing", store)).status, 410);
    assert.equal((await serveMedia(request, "link", store)).status, 410);
    assert.equal((await serveMedia(request, "traversal", store)).status, 404);
    const form = new FormData();
    form.set(
      "file",
      new File(["<script>alert(1)</script>"], "fake.png", {
        type: "image/png",
      }),
    );
    assert.equal(
      (
        await uploadMedia(
          new Request(request, { method: "POST", body: form }),
          store,
        )
      ).status,
      400,
    );
  } finally {
    database.sqlite.close();
    if (previous === undefined) delete process.env.TEA_DATA_DIR;
    else process.env.TEA_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
