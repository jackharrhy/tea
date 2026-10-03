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
    "/core": "packages/teacms/app",
    "/sites": "sites",
    "/npm": "../../node_modules",
  },
  allowFiles: [
    "packages/teacms/app/routes.ts",
    "packages/teacms/app/**/public/**",
    "sites/*/app/public/**",
  ],
  allowPackages: [
    "remix",
    "@tiptap/core",
    "@tiptap/pm",
    "@tiptap/starter-kit",
    "morphdom",
  ],
  denyFiles: ["**/*.test.*"],
  sourceMaps: isDevelopment ? "external" : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? async () =>
        (await import("remix/node-hmr/runtime")).createBrowserHmrChannel()
    : undefined,
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
});

const entry = "packages/teacms/app/actions/public/entry.ts";

export const entryScript = await assets.getScriptEntry(entry);
