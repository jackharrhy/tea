import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { localFixturesPlugin } from "./scripts/local-fixtures.ts";

const localRoot = fileURLToPath(new URL("./local", import.meta.url));

export default defineConfig(({ command }) => ({
  publicDir: command === "serve" ? "dist/client-dev" : "dist/client",
  server: { port: 8790 },
  plugins: [
    command === "serve" ? localFixturesPlugin(localRoot) : null,
    cloudflare(),
  ],
}));
