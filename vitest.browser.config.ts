import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";

/**
 * Browser-mode tests: anything needing real WebGL2, WebCodecs, or OPFS.
 * That means golden-frame rendering comparisons and the export determinism
 * suite. Requires `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["test/browser/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
