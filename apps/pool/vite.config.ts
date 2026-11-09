import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  define: {
    "import.meta.env.VITE_APP_REVISION": JSON.stringify(
      process.env.APP_REVISION ?? "development",
    ),
    "import.meta.env.VITE_POOL_BUILD": JSON.stringify("pool-v3/box3d@0.1.1"),
  },
  build: {
    target: "esnext",
    outDir: "dist/client",
    lib: {
      entry: {
        game: "app/game/entry.ts",
        "pool-game": "app/game/pool-game.tsx",
      },
      formats: ["es"],
      fileName: (_format, name) => `assets/${name}.js`,
      cssFileName: "assets/game",
    },
  },
});
