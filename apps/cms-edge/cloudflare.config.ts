import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tea-cms-edge",
    compatibilityDate: "2026-10-03",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "worker.ts",
    observability: {
      enabled: true,
    },
    env: {
      TEA_ADMIN_PASSWORD: bindings.secret(),
      TEA_SESSION_SECRET: bindings.secret(),
      TEA_PREVIEW_SECRET: bindings.secret(),
      DB: bindings.d1({
        name: "tea-cms-edge",
        id: "00000000-0000-0000-0000-000000000000",
      }),
      MEDIA: bindings.r2({
        name: "tea-cms-edge-media",
      }),
    },
  },
});
