import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { serveStaticFile } from "../src/static-files.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

it("serves configured assets and falls back to index only for document paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "tea-maps-static-"));
  roots.push(root);
  await writeFile(join(root, "index.html"), "<main>Maps</main>");
  await writeFile(join(root, "editor.js"), "export const editor = true;");

  const editor = await serveStaticFile("/editor.js", root);
  expect(editor?.headers.get("content-type")).toBe(
    "text/javascript; charset=utf-8",
  );
  expect(await editor?.text()).toBe("export const editor = true;");
  expect(await (await serveStaticFile("/projects/one", root))?.text()).toBe(
    "<main>Maps</main>",
  );
  expect(await serveStaticFile("/missing.js", root)).toBeNull();
});
