import { createAssetServer } from "remix/assets";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const isDevelopment = process.env.NODE_ENV === "development";

export const assets = createAssetServer({
  basePath: "/assets",
  rootDir,
  mounts: { app: "apps/marky/app", npm: "node_modules" },
  allowFiles: [
    "apps/marky/app/assets/**",
    "apps/marky/app/frontend/**",
    "apps/marky/app/shared/**",
    "apps/marky/app/ui/**",
  ],
  allowPackages: [
    "remix",
    "prosemirror-commands",
    "prosemirror-keymap",
    "prosemirror-model",
    "prosemirror-schema-basic",
    "prosemirror-state",
    "prosemirror-view",
    "y-prosemirror",
    "y-protocols",
    "yjs",
  ],
  denyFiles: [
    "**/__tests__/**",
    "apps/marky/app/data/**",
    "apps/marky/app/middleware/**",
  ],
  sourceMaps: isDevelopment ? "external" : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
});

export const entryScript = await assets.getScriptEntry(
  "apps/marky/app/assets/entry.ts",
);
