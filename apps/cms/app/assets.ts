import { fileURLToPath } from "node:url";
import { createAssetServer } from "remix/assets";
import { componentHmr } from "remix/component-hmr/assets";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const nodeEnv = process.env.NODE_ENV ?? "development";
const isDevelopment = nodeEnv === "development";
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR);

export const assets = createAssetServer({
  basePath: "/assets",
  rootDir,

  mounts: {
    "/cms": "apps/cms/app",
    "/rich-text": "packages/rich-text",
    "/sites": "apps/cms/sites",
    "/npm": "node_modules",
  },
  allowFiles: [
    "apps/cms/app/routes.ts",
    "apps/cms/app/**/public/**",
    "apps/cms/sites/*/app/public/**",
  ],
  allowPackages: [
    "remix",
    "@tea/rich-text",
    "@tiptap/core",
    "@tiptap/pm",
    "@tiptap/starter-kit",
    "morphdom",
  ],
  denyFiles: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
  sourceMaps: isDevelopment ? "external" : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? async () =>
        (await import("remix/node-hmr/runtime")).createBrowserHmrChannel()
    : undefined,
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
});

const entry = "apps/cms/app/actions/public/entry.ts";

export const entryScript = await assets.getScriptEntry(entry);
