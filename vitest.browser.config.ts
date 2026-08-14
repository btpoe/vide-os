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
    /**
     * Ignored in browser mode — a real Chromium provides the environment — but
     * it must still name a package Vitest can resolve. Left unset it resolved
     * to `jsdom`, which is not installed and does not need to be, and Vitest
     * set the exit code to 1 before running anything. Every browser run
     * reported "160 passed" and then failed, so the browser CI job had been
     * red, and unable to gate anything, for as long as it had existed.
     */
    environment: "node",
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
