import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFixtureSites } from "./sites.ts";
import { parseSites } from "../config.ts";
import luke from "@tea/cms/sites/luke";
import { createApp } from "../app.ts";
import { seedFixture } from "./fixture.ts";
import { openDatabase } from "../app/data/database.ts";
import { createContentStore } from "../app/data/content.ts";

it("isolates host routing, sessions, writes, uploads, optional features and analytics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "teacms-tenants-"));
  const sites = parseFixtureSites(
    [
      {
        id: "one",
        template: "andrew",
        name: "First fixture",
        origin: "https://one.example.test",
        aliases: ["www.one.example.test"],
        preview: false,
      },
      {
        id: "two",
        template: "luke",
        name: "Second fixture",
        origin: "https://two.example.test",
        aliases: [],
        preview: true,
      },
    ],
    dir,
  );
  const app = await createApp(sites);
  try {
    const [one, two] = await Promise.all(sites.map(seedFixture));
    const get = (host: string, path = "/", cookie = "") =>
      app.fetch(
        new Request(`http://${host}${path}`, { headers: { Cookie: cookie } }),
      );
    const home = await (await get("one.example.test")).text();
    assert.match(home, /First fixture/);
    assert.match(home, /site-sidebar/);
    assert.ok(!home.includes("Second fixture"));
    const second = await get("two.example.test");
    assert.equal(second.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await second.text(), /site-header/);
    assert.equal((await get("unknown.example.test")).status, 404);
    const alias = await get("www.one.example.test", "/example?x=1&x=2");
    assert.equal(alias.status, 308);
    assert.equal(
      alias.headers.get("location"),
      "https://one.example.test/example?x=1&x=2",
    );
    assert.equal(
      (await get("two.example.test", "/tea/admin", one.cookie)).status,
      303,
    );
    assert.equal(
      (await get("one.example.test", "/tea/admin", two.cookie)).status,
      303,
    );
    assert.equal(
      (await get("one.example.test", "/tea/admin/adornments", one.cookie))
        .status,
      200,
    );
    assert.equal(
      (await get("two.example.test", "/tea/admin/adornments", two.cookie))
        .status,
      404,
    );
    const editor = await (
      await get("two.example.test", "/tea/admin/homepage", two.cookie)
    ).text();
    assert.ok(!editor.includes('href="/tea/admin/adornments"'));
    const cross = await app.fetch(
      new Request("http://two.example.test/tea/admin/pages", {
        method: "POST",
        headers: {
          Origin: sites[0].origin,
          Cookie: two.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Cross origin", slug: "cross" }),
      }),
    );
    assert.equal(cross.status, 403);
    for (const site of sites) {
      const { sqlite } = await openDatabase(join(site.dataDir, "tea.db"));
      try {
        const store = createContentStore(sqlite);
        store.saveSite(
          {
            ...store.site(),
            analytics_id: site.id === "one" ? "G-FIRST123" : "G-SECOND123",
            analytics_enabled: true,
          },
          store.site().revision,
        );
        sqlite
          .prepare(
            "INSERT INTO media(id,filename,mime_type,size,path) VALUES ('same','sample.txt','text/plain',3,'sample.txt')",
          )
          .run();
        await mkdir(join(site.dataDir, "uploads"));
        await writeFile(join(site.dataDir, "uploads/sample.txt"), site.id);
      } finally {
        sqlite.close();
      }
    }
    assert.equal(
      await (await get("one.example.test", "/tea/api/media/file/same")).text(),
      "one",
    );
    assert.equal(
      await (await get("two.example.test", "/tea/api/media/file/same")).text(),
      "two",
    );
    const tracked = await (await get("one.example.test")).text();
    assert.match(tracked, /G-FIRST123/);
    assert.ok(!tracked.includes("G-SECOND123"));
    assert.ok(
      !(await (await get("two.example.test")).text()).includes(
        "googletagmanager",
      ),
    );
    assert.ok(
      !(await (await get("one.example.test", "/?preview")).text()).includes(
        "googletagmanager",
      ),
    );
    assert.ok(
      !(
        await (await get("one.example.test", "/tea/admin", one.cookie)).text()
      ).includes("googletagmanager"),
    );
    assert.match(
      await (await get("one.example.test", "/sitemap.xml")).text(),
      /https:\/\/one.example.test/,
    );
    for (const path of [
      "/assets/cms/data/auth.ts",
      "/assets/cms/site.ts",
      "/assets/sites/andrew/app/page.tsx",
      "/assets/cms/ui/public/image-layout.test.ts",
      "/tea.db",
      "/.env",
    ])
      assert.equal((await get("one.example.test", path)).status, 404, path);
  } finally {
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects ambiguous domains and malformed site manifests", () => {
  const row = {
    id: "one",
    presentation: luke,
    config: {
      name: "Fixture",
      origin: "https://one.example.test",
      aliases: [],
      preview: true,
      features: { adornments: false, riso: false },
      background: "#ffffff",
    },
  };
  for (const input of [
    [row, { ...row, id: "two" }],
    [{ ...row, id: "../outside" }],
    [
      {
        ...row,
        config: { ...row.config, origin: "https://one.example.test/path" },
      },
    ],
    [{ ...row, config: { ...row.config, aliases: ["elsewhere/path"] } }],
    [{ ...row, config: { ...row.config, background: "red" } }],
  ])
    assert.throws(() => parseSites(input, "/tmp/test"));
});
