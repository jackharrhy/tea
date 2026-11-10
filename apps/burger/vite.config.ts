import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  build: {
    target: "esnext",
    outDir: "dist/client",
    lib: {
      entry: {
        game: "app/game/entry.ts",
        "burger-game": "app/game/burger-game.tsx",
      },
      formats: ["es"],
      fileName: (_format, name) => `assets/${name}.js`,
      cssFileName: "assets/burger",
    },
  },
});
