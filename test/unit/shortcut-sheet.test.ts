import { describe, it, expect, beforeAll } from "vitest";
import { shortcutSections } from "@/panels/ShortcutSheet";
import { commands } from "@/commands/definitions";
import { setPlatformIsMac } from "@/commands/keys";
import type { Command } from "@/commands";

/**
 * The shortcut reference is generated, and this is why.
 *
 * The sheet it replaced was hand-written and had drifted: J and L were
 * described as five-second jumps long after they became shuttle controls, and
 * markers, three-point editing, zoom-to-fit, Escape and the text tool were
 * missing entirely. The assertion that matters is not how it looks — it is that
 * a command carrying a shortcut cannot fail to appear in it.
 */

beforeAll(() => {
  // Pinned, or the expected strings depend on whose machine this runs on.
  setPlatformIsMac(false);
});

const listed = (sections: [string, { label: string; keys: string }[]][]) =>
  sections.flatMap(([, entries]) => entries);

describe("the generated sheet", () => {
  it("lists every command that has a shortcut", () => {
    const withShortcut = commands.filter((c) => c.shortcut);
    // Distinct actions: two bindings for one action are one line, not two.
    const actions = new Set(withShortcut.map((c) => c.run));

    expect(listed(shortcutSections(commands))).toHaveLength(actions.size);
    expect(actions.size).toBeGreaterThan(20);
  });

  it("leaves out commands that have no shortcut", () => {
    const labels = listed(shortcutSections(commands)).map((e) => e.label);
    const unbound = commands.find((c) => !c.shortcut);
    if (unbound) expect(labels).not.toContain(unbound.label);
  });

  it("merges two keys bound to one action onto one line", () => {
    // Delete and Backspace both delete the selection. Listed separately they
    // read as two features, and with the old glyph table they rendered as the
    // same key written twice.
    const entry = listed(shortcutSections(commands)).find((e) => e.label === "Delete");
    expect(entry?.keys).toBe("Delete or Backspace");
  });

  it("formats chords for the platform rather than printing the spec", () => {
    const entry = listed(shortcutSections(commands)).find((e) => e.label === "Undo");
    expect(entry?.keys).toBe("Ctrl+Z");

    setPlatformIsMac(true);
    const onMac = listed(shortcutSections(commands)).find((e) => e.label === "Undo");
    expect(onMac?.keys).toBe("⌘Z");
    setPlatformIsMac(false);
  });

  it("puts the sections in a useful order, with anything new after them", () => {
    const invented: Command[] = [
      {
        id: "x.one",
        label: "Invented",
        shortcut: "Q",
        category: "Zebra",
        run: () => {},
      },
      ...commands,
    ];
    const order = shortcutSections(invented).map(([category]) => category);

    expect(order[0]).toBe("Playback");
    expect(order.indexOf("Editing")).toBeLessThan(order.indexOf("Tools"));
    // An unrecognised category still appears — silently dropping it would make
    // the sheet lie again, which is the whole reason it is generated.
    expect(order[order.length - 1]).toBe("Zebra");
  });
});
