import { resolve } from "node:path";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [typegpu()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/standalone.ts"),
      formats: ["es"],
      fileName: () => "standalone.js",
    },
    sourcemap: true,
    emptyOutDir: false,
  },
});
