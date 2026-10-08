import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

import { createAssetServer } from "remix/assets";
import { componentHmr } from "remix/component-hmr/assets";

const webRoot = path.resolve(import.meta.dirname, "..");
const rootDir = path.resolve(webRoot, "../..");
const isDevelopment = (process.env.NODE_ENV ?? "development") === "development";
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR);

export const assetServer = createAssetServer({
  basePath: "/assets",
  rootDir,
  mounts: {
    app: "apps/artbin/app",
    shared: "packages/artbin-core/src",
    npm: "node_modules",
  },
  allowFiles: [
    "apps/artbin/app/routes.ts",
    "apps/artbin/app/ui/styles.ts",
    "apps/artbin/app/ui/modal.tsx",
    "apps/artbin/app/ui/primitives.tsx",
    "apps/artbin/app/ui/file-collection.tsx",
    "apps/artbin/app/ui/media-card.tsx",
    "apps/artbin/app/**/public/**",
  ],
  allowPackages: ["@artbin/core", "@jackharrhy/worldview", "remix", "three"],
  denyFiles: ["apps/artbin/app/**/__tests__/**"],
  files: {
    extensions: [
      ".svg",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".woff",
      ".woff2",
    ],
  },
  sourceMaps: isDevelopment ? "external" : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? {
        channel: async () =>
          (await import("remix/node-hmr/runtime")).createBrowserHmrChannel(),
        moduleImporter: "remix/multiple-import-maps-polyfill",
      }
    : undefined,
  scripts: {
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "development",
      ),
    },
    loaders: [
      // tus-js-client has CommonJS dependencies. Bundle this one shared client into
      // browser ESM through Remix's loader hook; the rest of the app stays source-served.
      (url, context, nextLoad) => {
        const result = nextLoad(url, context);
        const filename = fileURLToPath(url);
        if (
          filename !== path.join(rootDir, "packages/artbin-core/src/uploads.ts")
        )
          return result;
        const bundled = buildSync({
          entryPoints: [filename],
          bundle: true,
          platform: "browser",
          format: "esm",
          write: false,
          target: "es2022",
          minify: !isDevelopment,
        });
        return {
          ...result,
          format: "module",
          source: bundled.outputFiles[0]!.text,
        };
      },
      ...(isHmr ? [componentHmr()] : []),
    ],
  },
});

const entry = "apps/artbin/app/actions/public/entry.ts";
const bspOverviewEntry =
  "apps/artbin/app/actions/public/bsp-overview-renderer.ts";

export const entryScript = await assetServer.getScriptEntry(entry);
export const documentImportMap = await assetServer.getImportMap([
  entry,
  bspOverviewEntry,
]);
export const bspOverviewEntryHref = await assetServer.getHref(bspOverviewEntry);
