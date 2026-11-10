import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist/client",
    lib: {
      entry: {
        game: "app/entry.ts",
        world: "app/world.tsx",
      },
      formats: ["es"],
      fileName: (_format, name) => `assets/${name}.js`,
      cssFileName: "assets/gurgur",
    },
  },
});
