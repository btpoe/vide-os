import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerCommand,
  registerCommands,
  clearCommands,
  runCommand,
  isEnabled,
  getCommand,
  allCommands,
  handleKeyDown,
} from "@/commands/registry";
import {
  parseChord,
  chordsMatch,
  chordFromEvent,
  formatChord,
  setPlatformIsMac,
} from "@/commands/keys";

/**
 * `Mod` resolves to Cmd on macOS and Ctrl elsewhere. Pin it so these assertions
 * mean the same thing on a developer's Mac and on Linux CI.
 */
setPlatformIsMac(false);
function keyEvent(init: Partial<KeyboardEventInit> & { key: string }) {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    target: init.key === "__input" ? null : { tagName: "DIV" },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("chord parsing", () => {
  it("parses a bare key", () => {
    expect(parseChord("V")).toEqual({
      key: "V",
      mod: false,
      shift: false,
      alt: false,
    });
  });

  it("is case-insensitive for single characters", () => {
    expect(parseChord("z").key).toBe("Z");
    expect(parseChord("Z").key).toBe("Z");
  });

  it("parses modifiers in any order", () => {
    expect(parseChord("Mod+Shift+Z")).toEqual(parseChord("Shift+Mod+Z"));
  });

  it("maps space to a named key", () => {
    expect(parseChord(" ").key).toBe("Space");
  });

  it("preserves multi-character key names", () => {
    expect(parseChord("ArrowLeft").key).toBe("ArrowLeft");
    expect(parseChord("Shift+ArrowLeft")).toEqual({
      key: "ArrowLeft",
      mod: false,
      shift: true,
      alt: false,
    });
  });

  it("treats Mod+Z and Mod+Shift+Z as different chords", () => {
    expect(chordsMatch(parseChord("Mod+Z"), parseChord("Mod+Shift+Z"))).toBe(false);
  });

  it("does not match a bare key against its modified form", () => {
    const pressed = chordFromEvent(keyEvent({ key: "a", ctrlKey: true }));
    expect(chordsMatch(parseChord("A"), pressed)).toBe(false);
    expect(chordsMatch(parseChord("Mod+A"), pressed)).toBe(true);
  });

  it("resolves Mod to the platform modifier", () => {
    const withCtrl = chordFromEvent(keyEvent({ key: "z", ctrlKey: true }));
    const withCmd = chordFromEvent(keyEvent({ key: "z", metaKey: true }));

    setPlatformIsMac(false);
    expect(chordsMatch(parseChord("Mod+Z"), withCtrl)).toBe(true);
    expect(formatChord("Mod+Z")).toBe("Ctrl+Z");

    setPlatformIsMac(true);
    expect(
      chordsMatch(
        parseChord("Mod+Z"),
        chordFromEvent(keyEvent({ key: "z", metaKey: true })),
      ),
    ).toBe(true);
    expect(formatChord("Mod+Z")).toBe("⌘Z");
    // macOS orders modifiers ⌃⌥⇧⌘, so Command sits next to the key.
    expect(formatChord("Mod+Shift+Z")).toBe("⇧⌘Z");
    setPlatformIsMac(false);
    expect(formatChord("Mod+Shift+Z")).toBe("Ctrl+Shift+Z");
    setPlatformIsMac(true);

    // Restore for the remaining tests.
    setPlatformIsMac(false);
    expect(chordsMatch(parseChord("Mod+Z"), withCmd)).toBe(false);
  });
});

describe("command registry", () => {
  beforeEach(() => clearCommands());

  it("registers and runs a command", () => {
    const run = vi.fn();
    registerCommand({ id: "test.run", label: "Test", run });
    expect(runCommand("test.run")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects duplicate ids", () => {
    registerCommand({ id: "dup", label: "A", run: () => {} });
    expect(() => registerCommand({ id: "dup", label: "B", run: () => {} })).toThrow(
      /Duplicate command id/,
    );
  });

  it("returns false for an unknown command without throwing", () => {
    expect(runCommand("nope")).toBe(false);
  });

  it("does not run a disabled command", () => {
    const run = vi.fn();
    registerCommand({
      id: "test.disabled",
      label: "Disabled",
      enabled: () => false,
      run,
    });
    expect(isEnabled("test.disabled")).toBe(false);
    expect(runCommand("test.disabled")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a command with no enabled predicate as enabled", () => {
    registerCommand({ id: "test.always", label: "Always", run: () => {} });
    expect(isEnabled("test.always")).toBe(true);
  });

  it("exposes registered commands for menus", () => {
    registerCommands([
      { id: "a", label: "A", run: () => {} },
      { id: "b", label: "B", run: () => {} },
    ]);
    expect(allCommands().map((c) => c.id)).toEqual(["a", "b"]);
    expect(getCommand("a")?.label).toBe("A");
  });
});

describe("keyboard dispatch", () => {
  beforeEach(() => clearCommands());

  it("runs the command whose chord matches", () => {
    const run = vi.fn();
    registerCommand({ id: "k", label: "K", shortcut: "Mod+S", run });

    const e = keyEvent({ key: "s", ctrlKey: true });
    expect(handleKeyDown(e)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("ignores a non-matching chord", () => {
    const run = vi.fn();
    registerCommand({ id: "k", label: "K", shortcut: "Mod+S", run });

    const e = keyEvent({ key: "s" });
    expect(handleKeyDown(e)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("swallows the shortcut of a disabled command", () => {
    // Backspace with nothing selected must not fall through to browser
    // back-navigation just because the delete command is disabled.
    const run = vi.fn();
    registerCommand({
      id: "del",
      label: "Delete",
      shortcut: "Backspace",
      enabled: () => false,
      run,
    });

    const e = keyEvent({ key: "Backspace" });
    expect(handleKeyDown(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("does not fire while the user is typing in a field", () => {
    const run = vi.fn();
    registerCommand({ id: "k", label: "K", shortcut: "Space", run });

    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      const e = {
        key: " ",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: { tagName },
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;
      expect(handleKeyDown(e)).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("does not fire inside a contenteditable", () => {
    const run = vi.fn();
    registerCommand({ id: "k", label: "K", shortcut: "Space", run });

    const e = {
      key: " ",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { tagName: "DIV", isContentEditable: true },
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(handleKeyDown(e)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
