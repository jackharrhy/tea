import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tea-maps",
    compatibilityDate: "2026-10-03",
    entrypoint: "worker.ts",
    assets: {
      runWorkerFirst: [
        "/",
        "/editor",
        "/new-map",
        "/projects",
        "/projects/*",
        "/api/*",
        "/auth/*",
        "/sync/*",
      ],
    },
    observability: { enabled: true },
    env: {
      ASSETS: bindings.assets(),
      MAPS_SERVICE_ORIGIN: bindings.text(
        process.env.TEA_MAPS_SERVICE_ORIGIN ?? "http://127.0.0.1:8792",
      ),
      MAPS_COLLABORATION_ORIGIN: bindings.text(
        process.env.TEA_MAPS_COLLABORATION_ORIGIN ?? "http://127.0.0.1:8787",
      ),
    },
  },
});
