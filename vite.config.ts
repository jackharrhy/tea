import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      ".agents/**",
      "package-lock.json",
      "apps/cms/sites/*/public/icons/**",
      "**/.cloudflare/**",
      "packages/maps-renderer/dist/**",
      "packages/maps-editor/dist/**",
      "packages/maps-protocol/dist/**",
      "apps/ref/worker-configuration.d.ts",
      "apps/radio/worker-configuration.d.ts",
      "apps/maps-collaboration/worker-configuration.d.ts",
    ],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: { correctness: "error", suspicious: "error" },
    options: { denyWarnings: true },
    rules: {
      "eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "eslint/no-underscore-dangle": [
        "error",
        { allow: ["_meta", "enum_", "null_"] },
      ],
    },
    ignorePatterns: [
      "node_modules/**",
      "apps/cms/tmp/**",
      "apps/cms/data/**",
      "apps/ref/dist/**",
      "apps/radio/dist/**",
      "apps/maps/dist/**",
      "apps/maps-compiler/dist/**",
      "apps/maps-service/dist/**",
      "packages/maps-renderer/dist/**",
      "packages/maps-editor/dist/**",
      "packages/maps-protocol/dist/**",
      "apps/radio/public/fonts/*.woff2",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
});
