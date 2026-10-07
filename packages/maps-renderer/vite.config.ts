import { resolve } from "node:path";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [typegpu()],
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/index.ts"),
        core: resolve(import.meta.dirname, "src/core/index.ts"),
        element: resolve(import.meta.dirname, "src/element/index.ts"),
        runtime: resolve(import.meta.dirname, "src/runtime/index.ts"),
        walkability: resolve(import.meta.dirname, "src/walkability/index.ts"),
      },
      formats: ["es"],
      fileName: (_, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^typegpu(?:\/.*)?$/, "wgpu-matrix", "zod"],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
});
