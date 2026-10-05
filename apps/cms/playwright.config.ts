import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "__tests__",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium", headless: true },
  webServer: {
    command:
      "NODE_ENV=production node --import remix/node-tsx __tests__/server.ts",
    port: 4352,
    reuseExistingServer: false,
  },
});
