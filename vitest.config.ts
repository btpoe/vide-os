import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Node-mode unit + property tests. Golden-frame and export-determinism
    // tests need real WebGL2/WebCodecs and live in vitest.browser.config.ts.
    environment: "node",
    include: ["test/unit/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/browser/**", "test/e2e/**", "node_modules/**"],
  },
});
