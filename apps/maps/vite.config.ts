import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { localFixturesPlugin } from "./scripts/local-fixtures.ts";

const localRoot =
  process.env.TEA_MAPS_LOCAL_FIXTURE_ROOT ??
  fileURLToPath(new URL("./local", import.meta.url));

export default defineConfig({
  publicDir: false,
  server: { host: "127.0.0.1", port: 8793, strictPort: true },
  plugins: [localFixturesPlugin(localRoot)],
});
