import { mkdir, copyFile, cp } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["app/client.ts"],
  outfile: "dist/client/assets/community.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});

await mkdir("dist/client/static", { recursive: true });
await cp("static", "dist/client/static", { recursive: true });
await copyFile(
  new URL(import.meta.resolve("htmx.org/dist/htmx.min.js")),
  "dist/client/static/htmx.min.js",
);
await build({
  entryPoints: ["app/browser/app.ts"],
  outfile: "dist/client/static/app.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await build({
  entryPoints: ["app/browser/codemirror.ts"],
  outfile: "dist/client/static/codemirror.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
