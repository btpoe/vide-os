/**
 * The command registry: one place where every user-triggerable action lives.
 *
 * Menus, tool buttons, and keyboard shortcuts all resolve to the same command
 * object, so an action has exactly one implementation. Previously the menu bar
 * triggered "Delete" by dispatching a synthetic KeyboardEvent at `window` and
 * hoping the timeline's listener happened to be mounted.
 */

import { chordFromEvent, chordsMatch, parseChord, type Chord } from "./keys";

export interface Command {
  id: string;
  label: string;
  /** Chord spec, e.g. "Mod+Shift+Z". Omit for commands with no shortcut. */
  shortcut?: string;
  /** Grouping for the shortcut reference sheet. */
  category?: string;
  /** Menus grey the command out when this returns false; dispatch is a no-op. */
  enabled?: () => boolean;
  run: () => void;
}

const commands = new Map<string, Command>();
/** Parsed once at registration — chord parsing is not worth doing per keypress. */
const chords = new Map<string, Chord>();

export function registerCommand(command: Command): void {
  if (commands.has(command.id)) {
    throw new Error(`Duplicate command id: ${command.id}`);
  }
  commands.set(command.id, command);
  if (command.shortcut) chords.set(command.id, parseChord(command.shortcut));
}

export function registerCommands(list: Command[]): void {
  for (const command of list) registerCommand(command);
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

export function isEnabled(id: string): boolean {
  const command = commands.get(id);
  if (!command) return false;
  return command.enabled ? command.enabled() : true;
}

/**
 * Runs a command by id. Returns whether it actually ran, so callers can tell
 * "no such command" and "command disabled" apart from "done".
 */
export function runCommand(id: string): boolean {
  const command = commands.get(id);
  if (!command) {
    console.warn(`Unknown command: ${id}`);
    return false;
  }
  if (command.enabled && !command.enabled()) return false;
  command.run();
  return true;
}

/** Resets registry state. Test-only. */
export function clearCommands(): void {
  commands.clear();
  chords.clear();
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
}

/**
 * Matches a keydown against registered shortcuts and runs the first hit.
 * Returns true if a command consumed the event.
 */
export function handleKeyDown(e: KeyboardEvent): boolean {
  // Never steal keystrokes from a field the user is typing in.
  if (isTextEntry(e.target)) return false;

  const pressed = chordFromEvent(e);
  for (const [id, chord] of chords) {
    if (!chordsMatch(chord, pressed)) continue;

    const command = commands.get(id);
    if (!command) continue;
    // A disabled command still swallows its shortcut — otherwise Backspace
    // with nothing selected would fall through to browser navigation.
    e.preventDefault();
    if (command.enabled && !command.enabled()) return true;
    command.run();
    return true;
  }
  return false;
}

/** Installs the global listener. Returns a teardown function. */
export function installShortcuts(target: Window = window): () => void {
  const listener = (e: KeyboardEvent) => {
    handleKeyDown(e);
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
