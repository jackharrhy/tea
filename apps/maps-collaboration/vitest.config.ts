import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEA_MAPS_REALTIME_TICKET_SECRET:
            "test-worldview-realtime-ticket-secret-0001",
        },
      },
    }),
  ],
  test: { include: ["__tests__/**/*.test.ts"] },
});
