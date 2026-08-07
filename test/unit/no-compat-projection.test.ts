import { describe, it, expect } from "vitest";

/**
 * The compatibility projection has one consumer left, and it is on its way out.
 *
 * `projectState` reshapes the document into the seconds-based, `mediaId`-keyed
 * form the original panels were written against. It exists only so the model
 * rewrite could land before the panel rewrites. Every panel has since moved to
 * `doc()`; what remains is the old export engine, which Phase 5 replaces
 * outright.
 *
 * This test is the ratchet. Without it the projection quietly grows new
 * readers — it is the more convenient shape, and nothing else stops you.
 */

/** Files still permitted to read the projection, with the reason they may. */
const ALLOWED = new Map([
  ["../../src/stores/project-store.ts", "defines it"],
  [
    "../../src/renderer/export-engine.ts",
    "deleted in Phase 5, along with this exemption",
  ],
]);

const sources: Record<string, string> = import.meta.glob("../../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("compatibility projection", () => {
  it("is read only by the files still allowed to", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);

    const offenders = Object.entries(sources)
      .filter(([, text]) => /\bprojectState\b/.test(text))
      .map(([path]) => path)
      .filter((path) => !ALLOWED.has(path));

    expect(offenders, "read doc() instead of projectState").toEqual([]);
  });

  it("still has an exemption list to shrink", () => {
    // When this fails because the list is empty, delete the projection and
    // this test with it.
    expect(ALLOWED.size).toBeGreaterThan(1);
  });
});
