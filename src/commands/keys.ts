/**
 * Keyboard chord parsing and matching.
 *
 * Shortcuts are written as `Mod+Shift+Z`, where `Mod` means Cmd on macOS and
 * Ctrl everywhere else. Matching normalises to a canonical string so that a
 * chord definition and a live KeyboardEvent can be compared directly, instead
 * of being pattern-matched by hand at each call site.
 */

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Mutable so tests can pin it. Without this, `Mod` resolves to Cmd on a
 * developer's Mac and Ctrl on Linux CI, and the same assertion passes locally
 * while failing in the pipeline.
 */
let isMac = detectMac();

export function setPlatformIsMac(value: boolean): void {
  isMac = value;
}

export function platformIsMac(): boolean {
  return isMac;
}

/** Keys whose `event.key` we compare case-insensitively. */
function normalizeKeyName(key: string): string {
  if (key === " " || key === "Spacebar") return "Space";
  if (key.length === 1) return key.toUpperCase();
  // Arrow/Home/End/Delete/etc. already arrive capitalised.
  return key;
}

export interface Chord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseChord(spec: string): Chord {
  const parts = spec.split("+");
  // The key segment is not trimmed: a spec written as a literal " " would
  // otherwise trim down to "" and match nothing.
  const rawKey = parts[parts.length - 1];
  const key = normalizeKeyName(rawKey.trim() === "" ? " " : rawKey.trim());
  const mods = parts.slice(0, -1).map((m) => m.trim().toLowerCase());
  return {
    key,
    mod: mods.includes("mod"),
    shift: mods.includes("shift"),
    alt: mods.includes("alt") || mods.includes("option"),
  };
}

export function chordFromEvent(e: KeyboardEvent): Chord {
  return {
    key: normalizeKeyName(e.key),
    // Cmd on macOS, Ctrl elsewhere — the two are never both meaningful.
    mod: isMac ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

export function chordsMatch(a: Chord, b: Chord): boolean {
  return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;
}

/** Human-readable form for menus and the shortcut sheet. */
export function formatChord(spec: string): string {
  const chord = parseChord(spec);
  const parts: string[] = [];
  if (isMac) {
    // macOS orders modifiers ⌃⌥⇧⌘ — Command is always adjacent to the key.
    if (chord.alt) parts.push("⌥");
    if (chord.shift) parts.push("⇧");
    if (chord.mod) parts.push("⌘");
  } else {
    if (chord.mod) parts.push("Ctrl");
    if (chord.alt) parts.push("Alt");
    if (chord.shift) parts.push("Shift");
  }

  const KEY_GLYPHS: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    // Two different keys, and the shortcut sheet lists both, so they cannot
    // share a glyph — ⌫ is Backspace and ⌦ is forward delete. Only on macOS:
    // elsewhere the keys are labelled with the words, and printing Mac glyphs
    // on a Windows keyboard is a puzzle rather than a reference.
    ...(isMac ? { Delete: "⌦", Backspace: "⌫" } : {}),
    Space: "Space",
    Home: "Home",
    End: "End",
  };
  parts.push(KEY_GLYPHS[chord.key] ?? chord.key);

  return parts.join(isMac ? "" : "+");
}
