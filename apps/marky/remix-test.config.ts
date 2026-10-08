import type { RemixTestConfig } from "remix/test";

const config: RemixTestConfig = {
  glob: {
    test: "__tests__/**/*.test.ts",
    exclude: "node_modules/**",
  },
  coverage: {
    dir: ".coverage",
    include: ["app/**/*.{ts,tsx}"],
    // Browser-only modules that need a DOM (CollaborativeEditor / user.ts /
    // the editor UI) aren't unit-tested at the server-test layer. They want
    // component tests via `render()` from remix/ui/test which requires a
    // headless browser — not worth the complexity for this project right now.
    // SocketHandler is browser-targeted but has no DOM dependency, so it
    // stays in the coverage report.
    exclude: [
      "app/**/*.test.{ts,tsx}",
      "app/frontend/collaborative-editor.ts",
      "app/frontend/user.ts",
      "app/ui/**",
      "app/assets/**",
    ],
    statements: 80,
    lines: 80,
    branches: 70,
    functions: 80,
  },
};

export default config;
