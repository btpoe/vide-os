import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";

/**
 * Performance budgets that need nothing but Node.
 *
 * A separate project rather than part of the unit suite: these are the only
 * tests whose result depends on the machine, they run one file at a time so
 * they are not competing with the rest of the suite for cores, and keeping them
 * apart means a slow laptop cannot make `pnpm test` look broken.
 *
 * The budgets needing real GL live in the browser suite, for the obvious
 * reason. Both read the same `VITE_PERF_ALLOWANCE`.
 */
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["test/perf/**/*.test.ts"],
    fileParallelism: false,
  },
});
