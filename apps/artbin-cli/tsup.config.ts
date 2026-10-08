import { readFileSync } from "fs";
import { defineConfig } from "tsup";

const uiHtml = readFileSync("dist-ui/index.html", "utf-8");
const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle all dependencies into the output so the published package
  // has zero runtime deps. sharp is excluded since the CLI never
  // calls BSP texture extraction (the server handles that).
  noExternal: [/.*/],
  external: ["sharp", /^@img\/sharp-/],
  define: {
    BROWSE_UI_HTML: JSON.stringify(uiHtml),
    CLI_VERSION: JSON.stringify(packageJson.version),
  },
  // Ensure Node builtins aren't wrapped in __require() shims.
  // tsup's noExternal bundles everything, but CJS deps like mime-types
  // use require("path") which breaks in ESM. Setting platform: "node"
  // should handle this, but we also need the banner to create a require
  // function for CJS interop.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "module";\nconst require = createRequire(import.meta.url);',
  },
});
