import { createAssetServer } from "remix/assets";
import { fileURLToPath } from "node:url";

export const assets = createAssetServer({
  basePath: "/assets",
  rootDir: fileURLToPath(new URL("../../../", import.meta.url)),
  mounts: { app: "apps/garden/app", npm: "node_modules" },
  allowFiles: ["apps/garden/app/ui/public/**"],
  allowPackages: ["remix"],
  denyFiles: ["**/__tests__/**"],
  files: { extensions: [".txt"] },
  watch: process.env.NODE_ENV === "development",
  minify: process.env.NODE_ENV === "production",
});
