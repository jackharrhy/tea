import { mkdir, copyFile } from "node:fs/promises";
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
await copyFile("static/style.css", "dist/client/static/style.css");
