import { describe, it, expect } from "vitest";
import { newId, computeContentKey, isContentKey } from "@/model/ids";

function blobOf(bytes: number, fill = 0): Blob {
  return new Blob([new Uint8Array(bytes).fill(fill)]);
}

describe("document ids", () => {
  it("are unique", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(ids.size).toBe(5000);
  });

  it("carry an optional prefix for readability in debugging", () => {
    expect(newId("clip")).toMatch(/^clip-[0-9a-f-]{36}$/);
  });
});

describe("content keys", () => {
  it("are stable for identical bytes", async () => {
    const a = await computeContentKey(blobOf(1000, 7));
    const b = await computeContentKey(blobOf(1000, 7));
    expect(a).toBe(b);
  });

  it("differ for different content at the same size", async () => {
    const a = await computeContentKey(blobOf(1000, 7));
    const b = await computeContentKey(blobOf(1000, 8));
    expect(a).not.toBe(b);
  });

  it("differ for the same content at different sizes", async () => {
    // Length is mixed into the digest, so a truncated copy is a different asset
    // even though every byte it does have matches.
    const a = await computeContentKey(blobOf(1000, 7));
    const b = await computeContentKey(blobOf(2000, 7));
    expect(a).not.toBe(b);
  });

  it("distinguishes files that differ only near the start", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const changed = new Uint8Array(big);
    changed[10] = 1;
    expect(await computeContentKey(new Blob([big]))).not.toBe(
      await computeContentKey(new Blob([changed])),
    );
  });

  it("distinguishes files that differ only near the end", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const changed = new Uint8Array(big);
    changed[changed.length - 10] = 1;
    expect(await computeContentKey(new Blob([big]))).not.toBe(
      await computeContentKey(new Blob([changed])),
    );
  });

  it("does not read files that differ only in the middle", async () => {
    // A documented limitation of sampling both ends: same size, same head and
    // tail, different middle collides. Asserting it so the trade-off is
    // explicit rather than a surprise later.
    const big = new Uint8Array(4 * 1024 * 1024);
    const changed = new Uint8Array(big);
    changed[2 * 1024 * 1024] = 1;
    expect(await computeContentKey(new Blob([big]))).toBe(
      await computeContentKey(new Blob([changed])),
    );
  });

  it("handles an empty blob", async () => {
    expect(isContentKey(await computeContentKey(new Blob([])))).toBe(true);
  });

  it("produces a recognisable 128-bit hex key", async () => {
    const key = await computeContentKey(blobOf(100));
    expect(key).toHaveLength(32);
    expect(isContentKey(key)).toBe(true);
  });

  it("rejects legacy Date.now()-style media ids", () => {
    expect(isContentKey("media-1739822401234-3")).toBe(false);
    expect(isContentKey("__text__")).toBe(false);
    expect(isContentKey("")).toBe(false);
  });
});
