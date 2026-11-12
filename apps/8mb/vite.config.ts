import { defineConfig } from "vite";

export default defineConfig({
  base: "/8mb/",
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: "dist/8mb",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: "src/main.ts" },
  },
});
