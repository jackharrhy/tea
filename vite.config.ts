import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      ".agents/**",
      "package-lock.json",
      "apps/cms/sites/*/public/icons/**",
      "apps/cms-edge/worker-configuration.d.ts",
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
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
});
