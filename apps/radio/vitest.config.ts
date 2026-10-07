import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          RADIO_PASSWORD: "test-password",
          RADIO_SESSION_SECRET:
            "test-session-secret-that-is-at-least-32-characters",
        },
      },
    }),
  ],
  test: {
    include: ["__tests__/worker/**/*.test.ts"],
  },
});
