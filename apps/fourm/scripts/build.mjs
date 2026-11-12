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
