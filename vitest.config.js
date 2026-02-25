import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.js"],
    exclude: ["**/e2e/**", "**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["lib/**/*.js", "routes/**/*.js", "ws/**/*.js", "public/**/*.js"],
      exclude: ["public/index.html"],
      thresholds: {
        lines: 83,
        functions: 64,
        branches: 48,
        statements: 64,
      },
    },
  },
});
