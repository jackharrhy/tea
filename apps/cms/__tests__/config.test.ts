import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRegistry, parseOperatorOrigin } from "../config.ts";

it("discovers site manifests and applies local origin overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "teacms-config-"));
  try {
    const site = join(root, "sites", "fixture");
    await mkdir(join(site, "app"), { recursive: true });
    await writeFile(
      join(site, "app/site.ts"),
      "export default { publicDir: '.', Page: () => () => null };\n",
    );
    await writeFile(
      join(site, "site.json"),
      JSON.stringify({
        name: "Fixture",
        origin: "https://fixture.example.test",
        aliases: [],
        preview: false,
        features: { adornments: false, riso: false },
        background: "#ffffff",
      }),
    );
    await writeFile(
      join(site, "site.local.json"),
      JSON.stringify({
        origin: "https://preview.example.test",
        preview: true,
      }),
    );
    const sites = await loadRegistry(join(root, "sites"), join(root, "data"));
    assert.equal(sites[0].origin, "https://preview.example.test");
    assert.equal(sites[0].name, "Fixture");
    assert.equal(sites[0].preview, true);
    assert.equal(
      parseOperatorOrigin("https://operator.example.test", sites),
      "https://operator.example.test",
    );
    assert.throws(() => parseOperatorOrigin(sites[0].origin, sites));
    assert.throws(() =>
      parseOperatorOrigin("https://operator.example.test/path", sites),
    );
    const tracked = await loadRegistry(
      join(root, "sites"),
      join(root, "data"),
      false,
    );
    assert.equal(tracked[0].origin, "https://fixture.example.test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
