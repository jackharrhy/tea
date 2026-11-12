import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AUTH_ISSUER: "https://auth.example.test",
          AUTH_CLIENT_ID: "radio-web",
          AUTH_PROJECT_ID: "radio-project",
          AUTH_ORGANIZATION_ID: "radio-org",
          AUTH_PUBLIC_ORIGIN: "https://radio.test",
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
