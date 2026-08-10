# Commands API

Every user-triggerable action in VideOS is a command. Menus, toolbar buttons and
keyboard shortcuts all dispatch through one registry, so an action has exactly
one implementation and one enabled-state predicate.

---

## The interface

```ts
// src/commands/registry.ts

export interface Command {
  /** Unique. Convention is "area.verb": "edit.rippleDelete", "tool.razor". */
  id: string;
  /** Human-readable. Menus read this — never retype it beside a menu item. */
  label: string;
  /** Chord spec, e.g. "Mod+Shift+Z". Omit for commands with no shortcut. */
  shortcut?: string;
  /** Grouping for the shortcut reference sheet. */
  category?: string;
  /** Menus grey the command out when this returns false; dispatch is a no-op. */
  enabled?: () => boolean;
  run: () => void;
}

export function registerCommand(command: Command): void;
export function registerCommands(list: Command[]): void;
export function getCommand(id: string): Command | undefined;
export function allCommands(): Command[];
export function isEnabled(id: string): boolean;
export function runCommand(id: string): boolean;
export function installShortcuts(target?: Window): () => void;
export function clearCommands(): void; // test-only
```

`registerCommand` **throws on a duplicate id**. That is deliberate: two
implementations of one action is the bug this registry exists to prevent.

`runCommand` returns whether the command actually ran, so a caller can
distinguish "no such command" and "command disabled" from "done".

---

## Adding a command

```ts
import type { Command } from "@/commands/registry";
import { timelineState } from "@/stores/timeline-store";
import { applyEdit } from "@/stores/project-store";

export const myCommands: Command[] = [
  {
    id: "clip.reverseSelection",
    label: "Reverse Selected Clips",
    shortcut: "Mod+R",
    category: "Editing",
    enabled: () => timelineState.selectedClips.length > 0,
    run: () => {
      applyEdit("Reverse clips", (draft) => {
        // mutate the draft
      });
    },
  },
];
```

Register it where the built-ins are registered, in `App.tsx`'s `onMount`:

```ts
registerCommands([...builtInCommands, ...myCommands]);
```

Commands that need to close over component state — opening a dialog, for
instance — are registered inline in `App.tsx` for exactly that reason. Static
ones live in [`src/commands/definitions.ts`](../../src/commands/definitions.ts).

### Adding it to a menu

Do not retype the label or the shortcut. `App.tsx` has a helper that reads both
from the registry:

```ts
const fromCommand = (id: string, labelOverride?: string) => ({
  get label() {
    return labelOverride ?? getCommand(id)?.label ?? id;
  },
  get shortcut() {
    const s = getCommand(id)?.shortcut;
    return s ? formatChord(s) : "";
  },
  get disabled() {
    return !isEnabled(id);
  },
  action: () => runCommand(id),
});
```

**Every field is a getter, and that matters.** The menu array is built in the
component body, which runs _before_ `onMount` registers the commands. Reading
eagerly gave menus that displayed raw command ids like `edit.undo` — a bug that
typechecked, passed every unit test, and was only found by driving the real UI.

---

## Shortcuts

### Chord syntax

```
"Space"           "K"              "ArrowLeft"
"Mod+S"           "Mod+Shift+Z"    "Shift+Alt+M"
```

| Token            | Meaning                              |
| ---------------- | ------------------------------------ |
| `Mod`            | ⌘ on macOS, Ctrl elsewhere           |
| `Shift`          |                                      |
| `Alt` / `Option` | Same modifier                        |
| Anything else    | The key, matched against `event.key` |

Single characters are compared case-insensitively. `" "` and `"Spacebar"`
normalise to `Space`. Named keys (`ArrowLeft`, `Home`, `End`, `Delete`,
`Backspace`) arrive already capitalised.

`formatChord(spec)` renders a chord for display — `⇧⌘Z` on macOS, `Ctrl+Shift+Z`
elsewhere, with glyphs for arrows and delete.

Chords are parsed **once at registration**, not per keypress.

### Two behaviours worth knowing

**Shortcuts never fire in a text field.** `handleKeyDown` returns early for
`INPUT`, `TEXTAREA`, `SELECT` and anything `contentEditable`.

**A disabled command still swallows its shortcut.** `preventDefault` is called
_before_ the enabled check, so `Backspace` with nothing selected does not fall
through to browser back-navigation.

### Platform detection in tests

```ts
import { setPlatformIsMac } from "@/commands/keys";
setPlatformIsMac(true);
```

`Mod` resolves from `navigator.platform`. Left as a module constant, the same
assertion passes on a developer's Mac and fails on Linux CI. This setter exists
purely so tests can pin it.

---

## Dispatching from your own UI

```ts
import { runCommand, isEnabled, getCommand, formatChord } from "@/commands";

<button
  disabled={!isEnabled("edit.rippleDelete")}
  onClick={() => runCommand("edit.rippleDelete")}
  title={formatChord(getCommand("edit.rippleDelete")?.shortcut ?? "")}
>
  {getCommand("edit.rippleDelete")?.label}
</button>
```

This is the pattern to copy. Before the registry existed, the menu bar triggered
"Delete" by dispatching a **synthetic `KeyboardEvent` at `window`** and hoping
the timeline's listener happened to be mounted.

---

## Conventions

| Rule                                          | Why                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| One command per action, ever                  | The whole point of the registry                                                            |
| `enabled` is cheap and synchronous            | It is called on every menu render                                                          |
| `run` is synchronous, or fires-and-forgets    | The registry does not await                                                                |
| Ids are `area.verb`                           | `edit.*`, `tool.*`, `playback.*`, `timeline.*`, `marker.*`, `source.*`, `file.*`, `view.*` |
| One document edit per `run`                   | One command should be one undo step                                                        |
| No shortcut is better than an unreachable one | Many modifier combinations are taken by the browser or the OS                              |

Source: [`src/commands/registry.ts`](../../src/commands/registry.ts),
[`src/commands/keys.ts`](../../src/commands/keys.ts),
[`src/commands/definitions.ts`](../../src/commands/definitions.ts).

---

**See also:** [Keyboard Reference](../keyboard-reference.md) ·
[Panels API](panels.md)
