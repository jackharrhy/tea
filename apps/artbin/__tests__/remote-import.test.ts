import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  findRedundantArchiveRoot,
  normalizeArchiveEntryPath,
  stripArchiveRoot,
} from "#lib/archive-reader.server";
import {
  describeRemoteImport,
  fetchRemoteImportManifest,
  isAllowedRemoteDownloadUrl,
  parseRemoteImportUrl,
} from "#lib/import-sources.server";
import { downloadRemoteFile } from "#lib/remote-download.server";
import {
  isPublicRemoteAddress,
  resolvePublicHttpsUrl,
  validatePublicHttpsUrl,
} from "#lib/public-remote-url.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote import source URLs", () => {
  test("uses submission-specific fallback copy when a source has no description", () => {
    expect(
      describeRemoteImport({
        provider: "gamebanana",
        externalId: "580944",
        canonicalUrl: "https://gamebanana.com/mods/580944",
        title: "de_cyberpunk",
        author: "spiderman32in1",
        game: "Counter-Strike 1.6",
        description: null,
        files: [],
        metadata: {},
      }),
    ).toBe(
      "de_cyberpunk by spiderman32in1 for Counter-Strike 1.6, published on GameBanana.",
    );
  });
  test("canonicalizes supported GameBanana and SCMapDB map pages", () => {
    expect(
      parseRemoteImportUrl("https://www.gamebanana.com/mods/140244?foo=bar"),
    ).toEqual({
      provider: "gamebanana",
      externalId: "140244",
      canonicalUrl: "https://gamebanana.com/mods/140244",
    });
    expect(parseRemoteImportUrl("http://scmapdb.com/map:Decay/p/2")).toEqual({
      provider: "scmapdb",
      externalId: "decay",
      canonicalUrl: "https://scmapdb.wikidot.com/map:decay",
    });
  });

  test("accepts direct HTTPS archives as generic site imports", async () => {
    const parsed = parseRemoteImportUrl(
      "https://downloads.example.com/maps/mapper_collection.zip?version=2#download",
    );
    expect(parsed).toMatchObject({
      provider: "direct",
      canonicalUrl:
        "https://downloads.example.com/maps/mapper_collection.zip?version=2",
    });
    expect(parsed.externalId).toMatch(/^[a-f0-9]{24}$/);

    const manifest = await fetchRemoteImportManifest(parsed.canonicalUrl);
    expect(manifest).toMatchObject({
      provider: "direct",
      title: "Mapper Collection",
      description: "Imported from downloads.example.com.",
      files: [
        {
          name: "mapper_collection.zip",
          url: "https://downloads.example.com/maps/mapper_collection.zip?version=2",
        },
      ],
    });
  });

  test("rejects unsupported pages and download hosts", () => {
    expect(() =>
      parseRemoteImportUrl("https://gamebanana.com/games/54"),
    ).toThrow("must point to a mod or map page");
    expect(() =>
      parseRemoteImportUrl("https://example.com/mods/140244"),
    ).toThrow("Supported sources");
    expect(() => parseRemoteImportUrl("http://example.com/maps.zip")).toThrow(
      "must use HTTPS",
    );
    expect(() => parseRemoteImportUrl("https://localhost/maps.zip")).toThrow(
      "public internet",
    );
    expect(
      isAllowedRemoteDownloadUrl(
        "gamebanana",
        "https://filecache37.gamebanana.com/a.zip",
      ),
    ).toBe(true);
    expect(
      isAllowedRemoteDownloadUrl(
        "gamebanana",
        "https://gamebanana.com.evil.test/a.zip",
      ),
    ).toBe(false);
    expect(
      isAllowedRemoteDownloadUrl("scmapdb", "http://scmapdb.wdfiles.com/a.zip"),
    ).toBe(false);
  });

  test("distinguishes public addresses from local and reserved networks", () => {
    expect(isPublicRemoteAddress("8.8.8.8")).toBe(true);
    expect(isPublicRemoteAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicRemoteAddress("127.0.0.1")).toBe(false);
    expect(isPublicRemoteAddress("10.0.0.1")).toBe(false);
    expect(isPublicRemoteAddress("169.254.169.254")).toBe(false);
    expect(isPublicRemoteAddress("::1")).toBe(false);
    expect(isPublicRemoteAddress("fc00::1")).toBe(false);
    expect(isPublicRemoteAddress("2001:db8::1")).toBe(false);
    expect(() => validatePublicHttpsUrl("https://[::1]/maps.zip")).toThrow(
      "private",
    );
  });

  test("rejects a hostname if any DNS answer points at a private network", async () => {
    const mixedResolver = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ]);
    await expect(
      resolvePublicHttpsUrl(
        "https://downloads.example.com/maps.zip",
        mixedResolver,
      ),
    ).rejects.toThrow("private or reserved");
  });

  test("maps the public GameBanana API response and filters unsafe file records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "Test Map",
              description: "<p>A &amp; B</p>",
              "Owner().name": "mapper",
              "Game().name": "Half-Life",
              "Files().aFiles()": {
                good: {
                  _sFile: "test_map.zip",
                  _sDownloadUrl: "https://gamebanana.com/dl/123",
                  _nFilesize: 99,
                  _sMd5Checksum: "abc",
                  _sAvResult: "clean",
                  _bIsArchived: false,
                },
                old: {
                  _sFile: "old.zip",
                  _sDownloadUrl: "https://gamebanana.com/dl/124",
                  _sAvResult: "clean",
                  _bIsArchived: true,
                },
                dirty: {
                  _sFile: "dirty.zip",
                  _sDownloadUrl: "https://gamebanana.com/dl/125",
                  _sAvResult: "infected",
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const manifest = await fetchRemoteImportManifest(
      "https://gamebanana.com/mods/140244",
    );

    expect(manifest).toMatchObject({
      provider: "gamebanana",
      title: "Test Map",
      author: "mapper",
      game: "Half-Life",
      description: "A & B",
    });
    expect(manifest.files).toEqual([
      {
        name: "test_map.zip",
        url: "https://gamebanana.com/dl/123",
        size: 99,
        md5: "abc",
      },
    ]);
  });

  test("extracts only official archive attachments from an SCMapDB page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<div id="page-title">Test &amp; Map</div>
           <table><tr><td><strong>Author</strong></td><td>Map Person</td></tr></table>
           <h2><span>Description</span></h2><p>A cooperative map.</p>
           <div class="dl"><a href="https://mirror.example.test/test.zip">Mirror</a>
           <a href="http://scmapdb.com/local--files/map:test/test_map.7z">SCMapDB</a>
           <a href="http://scmapdb.com/local--files/map:test/test_map_old.zip">Old version</a>
           <a href="http://scmapdb.wdfiles.com/local--files/map:test/screenshot.jpg">Image</a>
           <div class="dl-how-to-install"></div>`,
            { status: 200 },
          ),
      ),
    );

    const manifest = await fetchRemoteImportManifest(
      "https://scmapdb.com/map:test",
    );

    expect(manifest).toMatchObject({
      provider: "scmapdb",
      title: "Test & Map",
      author: "Map Person",
      game: "Sven Co-op",
      description: "A cooperative map.",
    });
    expect(manifest.files).toEqual([
      {
        name: "test_map.7z",
        url: "https://scmapdb.wdfiles.com/local--files/map:test/test_map.7z",
      },
    ]);
  });
});

describe("remote archive safety", () => {
  test("normalizes ordinary paths and rejects traversal or absolute paths", () => {
    expect(normalizeArchiveEntryPath("maps\\campaign\\start.bsp")).toBe(
      "maps/campaign/start.bsp",
    );
    expect(normalizeArchiveEntryPath("../escape.bsp")).toBeNull();
    expect(normalizeArchiveEntryPath("maps/../escape.bsp")).toBeNull();
    expect(normalizeArchiveEntryPath("/absolute/map.bsp")).toBeNull();
    expect(normalizeArchiveEntryPath("C:\\maps\\map.bsp")).toBeNull();
    expect(normalizeArchiveEntryPath("maps//map.bsp")).toBeNull();
  });

  test("strips only a common wrapper matching the import or archive name", () => {
    const acidtabEntries = [
      { path: "de_acidtab/maps/de_acidtab.bsp", size: 100 },
      { path: "de_acidtab/acidtab.wad", size: 200 },
      { path: "de_acidtab/sound/ambient.wav", size: 300 },
    ];
    const root = findRedundantArchiveRoot(
      acidtabEntries,
      "de_acidtab",
      "de_acidtab.zip",
    );

    expect(root).toBe("de_acidtab");
    expect(stripArchiveRoot(acidtabEntries[0].path, root)).toBe(
      "maps/de_acidtab.bsp",
    );
    expect(stripArchiveRoot(acidtabEntries[1].path, root)).toBe("acidtab.wad");

    expect(
      findRedundantArchiveRoot(
        [{ path: "release/maps/example.bsp", size: 1 }],
        "Example Map",
        "example-map.zip",
      ),
    ).toBeNull();
    expect(
      findRedundantArchiveRoot(
        [
          { path: "maps/example.bsp", size: 1 },
          { path: "readme.txt", size: 1 },
        ],
        "Example Map",
        "example-map.zip",
      ),
    ).toBeNull();
  });

  test("streams trusted redirects and verifies the expected checksum", async () => {
    const contents = Buffer.from("archive bytes");
    const md5 = createHash("md5").update(contents).digest("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://gamebanana.com/dl/123") {
          return new Response(null, {
            status: 302,
            headers: {
              location: "https://filecache37.gamebanana.com/mods/test.zip",
            },
          });
        }
        return new Response(contents, {
          status: 200,
          headers: { "content-length": String(contents.length) },
        });
      }),
    );
    const directory = await mkdtemp(join(tmpdir(), "artbin-download-test-"));
    const destination = join(directory, "test.zip");

    try {
      const result = await downloadRemoteFile(
        "gamebanana",
        "https://gamebanana.com/dl/123",
        destination,
        contents.length,
        md5,
      );
      expect(result).toMatchObject({ bytes: contents.length, md5 });
      expect(await readFile(destination)).toEqual(contents);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("refuses redirects away from a provider's trusted hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/untrusted.zip" },
          }),
      ),
    );

    await expect(
      downloadRemoteFile(
        "gamebanana",
        "https://gamebanana.com/dl/123",
        "/tmp/unused.zip",
      ),
    ).rejects.toThrow("untrusted host");
  });
});
