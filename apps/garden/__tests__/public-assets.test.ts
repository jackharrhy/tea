import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  selectPublicAssets,
  readApprovedPublic,
} from "../app/content/public-assets.ts";
import { exportSnapshot } from "../app/content/publish.ts";

async function fixture(
  t: { after(callback: () => Promise<void>): void },
  body = "",
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "garden-selection-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const vaultPath = path.join(directory, "notes");
  const assetsPath = path.join(directory, "assets");
  await fs.mkdir(vaultPath);
  await fs.mkdir(assetsPath);
  async function note(name: string, text: string) {
    await fs.writeFile(path.join(vaultPath, `${name}.md`), text);
  }
  async function asset(name: string, text = "fixture bytes") {
    await fs.mkdir(path.dirname(path.join(assetsPath, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(assetsPath, name), text);
  }
  await note("Home", `---\npublic: true\n---\n${body}`);
  for (const [name, frontmatter] of [
    ["Private", "false"],
    ["Quoted", '"true"'],
    ["Unset", "null"],
  ])
    await note(name, `---\npublic: ${frontmatter}\n---\n![[not-selected.png]]`);
  await asset("not-selected.png");
  return { directory, vaultPath, assetsPath, asset, note };
}
const names = (assets: Array<{ sourcePath: string }>) =>
  assets.map((asset) => asset.sourcePath).toSorted();

test("one public selection covers rendered wiki, Markdown, HTML, OG image and actual component URLs", async (t) => {
  const f = await fixture(
    t,
    `![[wiki.png|20x10]]\n\n![inline](/asset/inline.png?size=2#part)\n\n![ref][image]\n\n[image]: /asset/ref%20image.png\n\n<a href="/asset/document.pdf#page=1">Read</a><video poster="/asset/poster.png"><source src="/asset/movie.mp4"></video>\n\n\`\`\`component\nProject\nimage: /asset/project.png\nlink: /asset/project.pdf\ndescription: /asset/not-selected.png\n\`\`\``,
  );
  await f.note(
    "Social",
    '---\npublic: true\nog-image: "![[og.png]]"\n---\nSocial',
  );
  const expected = [
    "wiki.png",
    "inline.png",
    "ref image.png",
    "document.pdf",
    "poster.png",
    "movie.mp4",
    "project.png",
    "project.pdf",
    "og.png",
  ].toSorted();
  for (const name of expected) await f.asset(name);
  const outputPath = path.join(f.directory, "snapshot");
  const manifest = await exportSnapshot({ ...f, outputPath });
  assert.deepEqual(names(manifest.assets), expected);
  assert.equal(manifest.pages.length, 2);
  assert.equal(JSON.stringify(manifest).includes("not-selected"), false);
});

test("CSS imports, escaped URLs, HTML srcset/SVG/style dependencies close transitively with cycles", async (t) => {
  const f = await fixture(
    t,
    '<link href="/asset/styles/main.css"><iframe src="/asset/doc.html"></iframe>',
  );
  await f.asset(
    "styles/main.css",
    '@import "nested/other.css"; .a{background:url(../back\\ ground.png)}',
  );
  await f.asset(
    "styles/nested/other.css",
    '@import "../main.css"; @font-face{src:url(../../font.woff2)}',
  );
  await f.asset(
    "doc.html",
    '<img srcset="small.png 1x, large.png?version=2 2x, data:image/png;base64,AAAA 3x"><svg><use xlink:href="icons.svg#part"/></svg><div style="background:url(inline.png)"></div><style>.a{background:url(style.png)}</style>',
  );
  await f.asset(
    "icons.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="svg.png"/><use href="#part"/></svg>',
  );
  const expected = [
    "styles/main.css",
    "styles/nested/other.css",
    "back ground.png",
    "font.woff2",
    "doc.html",
    "small.png",
    "large.png",
    "icons.svg",
    "inline.png",
    "style.png",
    "svg.png",
  ].toSorted();
  for (const name of expected.filter((file) => !/\.(css|html|svg)$/.test(file)))
    await f.asset(name);
  assert.deepEqual(names((await selectPublicAssets(f)).assets), expected);
});

test("configured CDN URLs and explicit approved paths share the same transitive selection", async (t) => {
  const f = await fixture(
    t,
    '<img src="https://media.example.test/public/a.png?v=2#part"><img src="https://site.example/asset/site.png"><img src="https://elsewhere.example/private.png">',
  );
  await f.asset("a.png");
  await f.asset("site.png");
  await f.asset("approved.css", ".a{background:url(extra.png)}");
  await f.asset("extra.png");
  const { assets } = await selectPublicAssets({
    ...f,
    assetOrigin: "https://media.example.test/public/",
    origin: "https://site.example",
    approvedPublic: ["approved.css"],
  });
  assert.deepEqual(names(assets), [
    "a.png",
    "approved.css",
    "extra.png",
    "site.png",
  ]);
});

test("encoded directory names are decoded once and only real HTML attributes authorize files", async (t) => {
  const f = await fixture(
    t,
    '<link href="/asset/percent%25dir/main.css"><div data="/asset/not-selected.png" src="/asset/not-selected.png" href="/asset/not-selected.png"></div>',
  );
  await f.asset(
    "percent%dir/main.css",
    ".a{background:url(image.png?x=1#part)}",
  );
  await f.asset("percent%dir/image.png");
  assert.deepEqual(names((await selectPublicAssets(f)).assets), [
    "percent%dir/image.png",
    "percent%dir/main.css",
  ]);
});

test("explicit approval files select export assets and reject invalid selections", async (t) => {
  const f = await fixture(t);
  await f.asset("approved.png");
  const selection = path.join(f.directory, "approved.json");
  await fs.writeFile(selection, JSON.stringify(["approved.png"]));
  const manifest = await exportSnapshot({
    ...f,
    outputPath: path.join(f.directory, "snapshot"),
    approvedPublic: await readApprovedPublic(selection),
  });
  assert.deepEqual(names(manifest.assets), ["approved.png"]);
  await fs.writeFile(selection, JSON.stringify({ all: true }));
  await assert.rejects(readApprovedPublic(selection), /JSON array/);
  for (const approvedPublic of [["../escape"], ["folder"], ["bad\nname"]]) {
    await fs.mkdir(path.join(f.assetsPath, "folder"), { recursive: true });
    await assert.rejects(selectPublicAssets({ ...f, approvedPublic }));
  }
});

test("containment, hidden paths, malformed URLs, missing files and unsupported dependency syntax fail closed", async (t) => {
  const f = await fixture(t);
  for (const body of [
    '<img src="/asset/../escape.png">',
    '<img src="/asset/%2e%2e/escape.png">',
    '<img src="/asset/.hidden">',
    '<img src="/asset/bad%00name">',
    '<img src="/asset/bad%XX">',
    '<img src="/asset/missing.png">',
    '<img src="relative.png">',
    '<base href="/asset/"><img src="relative.png">',
    '<iframe srcdoc="ignored"></iframe>',
    '<style>.a{background:image-set("unselected.png" 1x)}</style>',
    '<style>.a{background:u\\72l("unselected.png")}</style>',
  ]) {
    await f.note("Home", `---\npublic: true\n---\n${body}`);
    await assert.rejects(selectPublicAssets(f));
  }
  await f.asset("outside.png");
  await fs.symlink(
    path.join(f.directory, "notes/Home.md"),
    path.join(f.assetsPath, "escape.png"),
  );
  await f.note("Home", "---\npublic: true\n---\n![[escape.png]]");
  await assert.rejects(selectPublicAssets(f), /escapes/);
  await f.note(
    "Home",
    '---\npublic: true\n---\n<a href="/asset/folder">folder</a>',
  );
  await fs.mkdir(path.join(f.assetsPath, "folder"));
  await assert.rejects(selectPublicAssets(f), /regular file/);
});

test("asset documents distinguish explicit /asset URLs from CDN-root-relative URLs", async (t) => {
  const f = await fixture(t, '<iframe src="/asset/nested/doc.html"></iframe>');
  await f.asset(
    "nested/doc.html",
    '<link href="/asset/main.css"><img src="/root.png">',
  );
  await f.asset(
    "main.css",
    ".a{background:url(/asset/explicit.png)}.b{background:url(/cdn-root.png)}",
  );
  for (const file of [
    "root.png",
    "explicit.png",
    "cdn-root.png",
    "asset/explicit.png",
  ])
    await f.asset(file);
  assert.deepEqual(names((await selectPublicAssets(f)).assets), [
    "cdn-root.png",
    "explicit.png",
    "main.css",
    "nested/doc.html",
    "root.png",
  ]);
});

test("SVG presentation attributes use the CSS dependency parser", async (t) => {
  const f = await fixture(t, "![[picture.svg]]");
  await f.asset(
    "picture.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(paint.svg#fill)" stroke="url(/asset/stroke.svg#stroke)" filter="url(filter.svg#f)" mask="url(mask.svg#m)" clip-path="url(clip.svg#c)" marker-start="url(marker.svg#start)" marker-mid="url(marker.svg#mid)" marker-end="url(marker.svg#end)" cursor="url(cursor.png), auto"/></svg>',
  );
  const dependencies = [
    "paint.svg",
    "stroke.svg",
    "filter.svg",
    "mask.svg",
    "clip.svg",
    "marker.svg",
  ];
  for (const file of dependencies)
    await f.asset(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await f.asset("cursor.png");
  assert.deepEqual(
    names((await selectPublicAssets(f)).assets),
    ["picture.svg", "cursor.png", ...dependencies].toSorted(),
  );
});

test("executable dependencies require exact approval without inferring JavaScript imports", async (t) => {
  const f = await fixture(t, '<script src="/asset/main.js"></script>');
  await f.asset("main.js", 'import "./not-selected.js";');
  await f.asset("not-selected.js", "const privateFixture = true;");
  await assert.rejects(selectPublicAssets(f), /script assets require explicit/);
  assert.deepEqual(
    names(
      (await selectPublicAssets({ ...f, approvedPublic: ["main.js"] })).assets,
    ),
    ["main.js"],
  );
  await f.note(
    "Home",
    '---\npublic: true\n---\n<a href="/asset/runner.txt">Download</a><iframe src="/asset/doc.html"></iframe>',
  );
  await f.asset("runner.txt", 'fetch("not-selected.png")');
  await f.asset("doc.html", '<script src="runner.txt"></script>');
  await assert.rejects(
    selectPublicAssets({ ...f, approvedPublic: ["doc.html"] }),
    /script assets require explicit/,
  );
  assert.deepEqual(
    names(
      (
        await selectPublicAssets({
          ...f,
          approvedPublic: ["doc.html", "runner.txt"],
        })
      ).assets,
    ),
    ["doc.html", "runner.txt"],
  );
});

test("inline executable markup needs exact document approval; inert JSON data is allowed", async (t) => {
  const f = await fixture(t, '<iframe src="/asset/doc.html"></iframe>');
  for (const source of [
    '<script>fetch("unknown")</script>',
    "<svg onload=\"fetch('unknown')\"></svg>",
  ]) {
    await f.asset("doc.html", source);
    await assert.rejects(selectPublicAssets(f), /Inline scripts require/);
    assert.deepEqual(
      names(
        (await selectPublicAssets({ ...f, approvedPublic: ["doc.html"] }))
          .assets,
      ),
      ["doc.html"],
    );
  }
  await f.note(
    "Home",
    '---\npublic: true\n---\n<script>fetch("unknown")</script>',
  );
  await assert.rejects(
    selectPublicAssets(f),
    /inline page scripts are unsupported/,
  );
  await f.note(
    "Home",
    '---\npublic: true\n---\n<script type="application/ld+json">{"name":"fixture"}</script>',
  );
  assert.deepEqual((await selectPublicAssets(f)).assets, []);
});
