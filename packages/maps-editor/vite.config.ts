import { resolve } from "node:path";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [typegpu()],
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        "core/index": resolve(import.meta.dirname, "src/core/index.ts"),
        "render/index": resolve(import.meta.dirname, "src/render/index.ts"),
      },
      formats: ["es"],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        "@jackharrhy/tea-maps-renderer",
        /^@tea\/maps-renderer\//,
        /^typegpu(?:\/.*)?$/,
        "wgpu-matrix",
        "zod",
      ],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
});
