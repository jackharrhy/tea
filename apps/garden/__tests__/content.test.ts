import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createContentStore } from "../app/content/store.ts";
import { createMarkdownRenderer } from "../app/content/markdown.ts";
import { resolveWikiLink } from "../app/content/garden-routing.mjs";
import { createGarden } from "../app/router.tsx";
import { exportSnapshot } from "../app/content/publish.ts";
import type { GardenConfig } from "../app/config.ts";

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tea-garden-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notes = path.join(directory, "Garden");
  const assets = path.join(directory, "Assets");
  await fs.mkdir(notes);
  await fs.mkdir(assets);
  async function note(name: string, source: string) {
    const file = path.join(notes, name + ".md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  }
  await note(
    "Home",
    "---\npublic: true\n---\n# Fixture home\n\n[[Visible|A link]] [[Secret]]\n\n![[photo.png|200x100]]",
  );
  await note(
    "Visible",
    "---\npublic: true\naliases: [Other name]\n---\n# Visible heading\n\n- A list item\n\n```js\nconst n = 1\n```",
  );
  await note("Secret", "---\npublic: false\n---\nPrivate fixture body");
  await note("Unset", "# No publication flag");
  await note("Quoted", '---\npublic: "true"\n---\nNot a boolean');
  await fs.writeFile(path.join(assets, "photo.png"), Buffer.from([1, 2, 3]));
  const config: GardenConfig = {
    development: true,
    directory: notes,
    assetsDirectory: assets,
    origin: "https://example.test",
    assetOrigin: "https://media.example.test",
    lastfmKey: undefined,
  };
  return { directory, notes, assets, note, config };
}

test("public-only index, aliases, canonical slugs, and invalidation", async (t) => {
  const f = await fixture(t);
  const store = createContentStore(f.notes);
  assert.deepEqual(
    store.read().entries.map((entry) => entry.id),
    ["home", "visible"],
  );
  assert.equal(resolveWikiLink("[[Other name]]", store.read().index).ok, true);
  assert.equal(resolveWikiLink("[[Secret]]", store.read().index).ok, false);
  await f.note("Visible", "---\npublic: false\n---\nNo longer public");
  store.invalidate();
  assert.equal(store.read().byId.has("visible"), false);
  await fs.rename(
    path.join(f.notes, "Home.md"),
    path.join(f.notes, "Renamed.md"),
  );
  store.invalidate();
  assert.equal(store.read().byId.has("home"), false);
  assert.equal(store.read().byId.has("renamed"), true);
});

test("Markdown preserves links, media dimensions, code, legacy list rendering, and component blocks", async (t) => {
  const f = await fixture(t);
  const snapshot = createContentStore(f.notes).read();
  const render = createMarkdownRenderer(snapshot.index);
  const segments = await render(snapshot.byId.get("home")!.body);
  const html = segments
    .filter((segment) => segment.type === "prose")
    .map((segment) => segment.html)
    .join("");
  assert.match(html, /href="\/visible"/);
  assert.doesNotMatch(html, /href="\/secret"/);
  assert.match(html, /width="200"/);
  assert.match(html, /height="100"/);
  const code = await render(snapshot.byId.get("visible")!.body);
  assert.match(JSON.stringify(code), /astro-code/);
  assert.doesNotMatch(JSON.stringify(code), /<ul>/);
  const emphasis = await render("un**_it_**");
  assert.equal(
    emphasis[0].type === "prose" && emphasis[0].html,
    "<p>un<strong><em>it</em></strong></p>",
  );
  assert.deepEqual(
    await render(
      "```component\nProject\nname: Fixture project\nlink: https://example.test\n```",
    ),
    [
      {
        type: "component",
        props: {
          component: "Project",
          name: "Fixture project",
          link: "https://example.test",
        },
      },
    ],
  );
  await assert.rejects(
    render("```component\nUnknown\n```"),
    /Unknown component/,
  );
});

test("route collisions fail explicitly", async (t) => {
  const f = await fixture(t);
  await f.note("Vísible!", "---\npublic: true\n---\nCollision");
  assert.throws(() => createContentStore(f.notes).read(), /route collision/);
});

test("HTTP pages, feeds, tools, assets and production boundaries", async (t) => {
  const f = await fixture(t);
  const { router } = createGarden(f.config);
  const get = (pathname: string, init?: RequestInit) =>
    router.fetch(new Request(`https://example.test${pathname}`, init));
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Fixture home/);
  assert.equal((await get("/secret")).status, 404);
  assert.equal((await get("/quoted")).status, 404);
  assert.equal((await get("/home")).status, 301);
  assert.equal((await get("/home/")).status, 301);
  assert.equal((await get("/visible/")).status, 200);
  assert.equal((await get("/404")).status, 404);
  assert.equal((await get("/visible", { method: "HEAD" })).status, 200);
  assert.equal(
    (await get("/asset/photo.png")).headers.get("Cache-Control"),
    "no-cache",
  );
  const bytes = await (
    await get("/asset/photo.png", { headers: { Range: "bytes=1-2" } })
  ).arrayBuffer();
  assert.deepEqual([...new Uint8Array(bytes)], [2, 3]);
  await fs.symlink(
    path.join(f.notes, "Secret.md"),
    path.join(f.assets, "escape.md"),
  );
  assert.equal((await get("/asset/escape.md")).status, 400);
  assert.equal((await get("/assets/app/content/store.ts")).status, 404);
  const rss = await get("/linkblog/rss.xml");
  assert.equal(rss.headers.get("Access-Control-Allow-Origin"), "*");
  assert.doesNotMatch(await rss.text(), /Secret|Private fixture/);
  const thumbnail = await get("/tools/youtube-thumbnail-fetcher/fetch", {
    method: "POST",
    body: new URLSearchParams({ url: "https://youtu.be/dQw4w9WgXcQ" }),
  });
  assert.equal(thumbnail.status, 200);
  assert.match(await thumbnail.text(), /dQw4w9WgXcQ\/maxresdefault.jpg/);
  assert.equal(
    (
      await get("/tools/youtube-thumbnail-fetcher/fetch", {
        method: "POST",
        body: new URLSearchParams({ url: "javascript:bad" }),
      })
    ).status,
    400,
  );
  const production = createGarden({ ...f.config, development: false });
  const request = (pathname: string) =>
    production.router.fetch(`https://example.test${pathname}`);
  assert.equal((await request("/debug")).status, 404);
  assert.equal((await request("/__dev/revision")).status, 404);
  assert.equal((await request("/debug/notes")).status, 404);
  assert.equal(
    (await request("/asset/folder/a%20b.png")).headers.get("Location"),
    "https://media.example.test/folder/a%20b.png",
  );
});

test("snapshot exports only public source, referenced media metadata, and refuses in-place overwrite", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.assets, "unreferenced.png"),
    "private media fixture",
  );
  const outputPath = path.join(f.directory, "snapshot");
  const manifest = await exportSnapshot({
    vaultPath: f.notes,
    assetsPath: f.assets,
    outputPath,
  });
  assert.equal(manifest.pages.length, 2);
  assert.deepEqual(
    manifest.assets.map((asset) => asset.sourcePath),
    ["photo.png"],
  );
  assert.equal(
    await fs.readFile(path.join(outputPath, "Home.md"), "utf8"),
    await fs.readFile(path.join(f.notes, "Home.md"), "utf8"),
  );
  await assert.rejects(fs.stat(path.join(outputPath, "Secret.md")), {
    code: "ENOENT",
  });
  await assert.rejects(
    exportSnapshot({ vaultPath: f.notes, assetsPath: f.assets, outputPath }),
    { code: "EEXIST" },
  );
});
