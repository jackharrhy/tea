import { createAssetServer } from "remix/assets";
import { componentHmr } from "remix/component-hmr/assets";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const nodeEnv = process.env.NODE_ENV ?? "development";
const isDevelopment = nodeEnv === "development";
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR);

export const assets = createAssetServer({
  basePath: "/assets",
  rootDir,
  mounts: { app: "apps/letters-to-steve/app", npm: "node_modules" },

  allowFiles: [
    "apps/letters-to-steve/app/routes.ts",
    "apps/letters-to-steve/app/**/public/**",
  ],
  allowPackages: [
    "remix",
    "@tiptap/core",
    "@tiptap/extension-blockquote",
    "@tiptap/extension-bold",
    "@tiptap/extension-document",
    "@tiptap/extension-hard-break",
    "@tiptap/extension-image",
    "@tiptap/extension-italic",
    "@tiptap/extension-link",
    "@tiptap/extension-list",
    "@tiptap/extension-paragraph",
    "@tiptap/extension-placeholder",
    "@tiptap/extension-text",
    "@tiptap/extensions",
    "@tiptap/pm",
    "@fontsource-variable/shantell-sans",
    "@fontsource-variable/literata",
  ],
  denyFiles: ["**/__tests__/**"],
  files: { extensions: [".woff2"] },
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
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
});

export const browserEntry = await assets.getScriptEntry(
  "apps/letters-to-steve/app/actions/public/entry.ts",
);
