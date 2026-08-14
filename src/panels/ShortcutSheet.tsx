/**
 * The keyboard reference, read out of the command registry.
 *
 * It used to be a hand-written list in `App.tsx`, and it had drifted: J and L
 * were described as five-second jumps when they had become shuttle controls,
 * markers and three-point editing were missing entirely, and Escape, the zoom
 * commands and the tool for text were nowhere. A reference that is wrong is
 * worse than none, because the reader believes it.
 *
 * So it is generated. Every command that carries a shortcut appears here, in
 * its own category, with the chord formatted for this platform — which means a
 * new command cannot be added without documenting itself.
 *
 * The one thing not generated is the panel layout section. Those keys are
 * handled by the docking layout's own tablists and separators rather than by
 * the registry, and a keyboard user needs to be told they exist.
 */

import { Component, For } from "solid-js";
import { allCommands, formatChord, type Command } from "@/commands";

/** Sections in the order they are useful, with anything new falling in after. */
const CATEGORY_ORDER = [
  "File",
  "Playback",
  "Editing",
  "Timeline",
  "Source",
  "Markers",
  "Tools",
  "View",
];

export interface ShortcutEntry {
  label: string;
  keys: string;
}

/**
 * Commands grouped for display, merging those that share an implementation.
 *
 * Delete and Backspace are one action with two bindings, and listing them as
 * two entries reads as two features. Merging on the function identity is exact,
 * where merging on the label would only be a guess.
 */
export function shortcutSections(
  commands: Command[] = allCommands(),
): [string, ShortcutEntry[]][] {
  const sections = new Map<string, ShortcutEntry[]>();
  const byRun = new Map<Command["run"], ShortcutEntry>();

  for (const command of commands) {
    if (!command.shortcut) continue;
    const category = command.category ?? "Other";

    const merged = byRun.get(command.run);
    if (merged) {
      merged.keys += ` or ${formatChord(command.shortcut)}`;
      continue;
    }

    const entry: ShortcutEntry = {
      label: command.label,
      keys: formatChord(command.shortcut),
    };
    byRun.set(command.run, entry);

    const existing = sections.get(category);
    if (existing) existing.push(entry);
    else sections.set(category, [entry]);
  }

  return [...sections.entries()].sort(([a], [b]) => {
    const rankA = CATEGORY_ORDER.indexOf(a);
    const rankB = CATEGORY_ORDER.indexOf(b);
    return (
      (rankA === -1 ? CATEGORY_ORDER.length : rankA) -
        (rankB === -1 ? CATEGORY_ORDER.length : rankB) || a.localeCompare(b)
    );
  });
}

/** Keys the docking layout handles itself. Not commands, so not generated. */
const PANEL_KEYS: ShortcutEntry[] = [
  { label: "Move between panel tabs", keys: "← →" },
  { label: "First / last tab", keys: "Home / End" },
  { label: "Close the focused panel", keys: "⌦" },
  { label: "Resize a split (focus the divider)", keys: "← → ↑ ↓" },
  { label: "Resize in larger steps", keys: "⇧ + arrow" },
];

const Section: Component<{ title: string; entries: ShortcutEntry[] }> = (props) => (
  <div>
    <div class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">
      {props.title}
    </div>
    <div class="grid grid-cols-[7rem_1fr] gap-y-1">
      <For each={props.entries}>
        {(entry) => (
          <>
            <span class="font-mono text-muted-foreground">{entry.keys}</span>
            <span class="text-foreground">{entry.label}</span>
          </>
        )}
      </For>
    </div>
  </div>
);

const ShortcutSheet: Component = () => (
  <div class="px-5 py-4 space-y-3 text-xs">
    <For each={shortcutSections()}>
      {([category, entries]) => <Section title={category} entries={entries} />}
    </For>
    <Section title="Panels" entries={PANEL_KEYS} />
  </div>
);

export default ShortcutSheet;
