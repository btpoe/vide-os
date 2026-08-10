# Keyboard Reference

Every registered shortcut, taken from the command registry in
[`src/commands/definitions.ts`](../src/commands/definitions.ts) and
[`src/App.tsx`](../src/App.tsx).

`Mod` is **⌘ on macOS** and **Ctrl** everywhere else. Shortcuts never fire while
you are typing in a text field.

---

## File

| Shortcut  | Command      | Notes                                                |
| --------- | ------------ | ---------------------------------------------------- |
| `Mod+O`   | Open Project |                                                      |
| `Mod+S`   | Save Project | Writes back to the current file after the first save |
| `Mod+⇧+S` | Save As      |                                                      |
| `Mod+E`   | Export       |                                                      |

_New Project_ and _Reset Layout_ have no shortcut; they are menu items.

## Playback

| Shortcut | Command         | Notes                                                      |
| -------- | --------------- | ---------------------------------------------------------- |
| `Space`  | Play / Pause    |                                                            |
| `K`      | Stop            |                                                            |
| `J`      | Shuttle back    | Steps one rung down the ladder: 0.5×, 1×, 2×, 4× backwards |
| `L`      | Shuttle forward | Steps one rung up                                          |
| `←`      | Previous frame  | Exactly one frame                                          |
| `→`      | Next frame      |                                                            |
| `Home`   | Go to start     |                                                            |
| `End`    | Go to end       | End of the **content**, not a fixed project length         |

Shuttle ladder: `−4× −2× −1× −0.5× ⏸ 0.5× 1× 2× 4×`

## Editing

| Shortcut    | Command               | Enabled when            |
| ----------- | --------------------- | ----------------------- |
| `Mod+Z`     | Undo                  | there is history        |
| `Mod+⇧+Z`   | Redo                  |                         |
| `Mod+X`     | Cut                   | something is selected   |
| `Mod+C`     | Copy                  | something is selected   |
| `Mod+V`     | Paste                 | the clipboard has clips |
| `Mod+D`     | Duplicate             | something is selected   |
| `Mod+A`     | Select All            |                         |
| `Escape`    | Deselect All          | something is selected   |
| `Delete`    | Delete                | something is selected   |
| `Backspace` | Delete                | something is selected   |
| `⇧+Delete`  | Ripple Delete         | something is selected   |
| `⇧+←`       | Nudge left one frame  | something is selected   |
| `⇧+→`       | Nudge right one frame | something is selected   |

A **disabled** command still swallows its shortcut — otherwise `Backspace` with
nothing selected would fall through to browser back-navigation.

`Escape` also **aborts a drag in progress**, and that binding wins because it is
registered in the capture phase.

## Timeline

| Shortcut | Command             | Notes               |
| -------- | ------------------- | ------------------- |
| `S`      | Toggle Snapping     |                     |
| `Mod+=`  | Zoom In             |                     |
| `Mod+-`  | Zoom Out            |                     |
| `⇧+Z`    | Zoom to Fit         | Fits the whole edit |
| `Mod+0`  | Zoom to Frame Level |                     |

Mouse: `Mod`-scroll or pinch to zoom (cursor-anchored), `Shift`-scroll to pan.

## Tools

| Shortcut | Tool   |
| -------- | ------ |
| `V`      | Select |
| `C`      | Razor  |
| `T`      | Trim   |
| `Y`      | Slip   |
| `U`      | Slide  |
| `X`      | Text   |
| `H`      | Hand   |

## Source monitor

| Shortcut | Command               | Enabled when                  |
| -------- | --------------------- | ----------------------------- |
| `I`      | Mark In               | a source is loaded            |
| `O`      | Mark Out              | a source is loaded            |
| `,`      | Insert from Source    | the marked range is ≥ 1 frame |
| `.`      | Overwrite from Source | the marked range is ≥ 1 frame |

## Markers

| Shortcut  | Command         | Enabled when        |
| --------- | --------------- | ------------------- |
| `M`       | Add Marker      |                     |
| `⇧+M`     | Next Marker     | there is one ahead  |
| `⇧+Alt+M` | Previous Marker | there is one behind |

## View

| Shortcut | Command   | Notes                                                                                                                                                                                   |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `⇧+D`    | Debug HUD | A plain letter on purpose: the modifier combinations a HUD toggle would want are taken by the browser or the window manager, and a shortcut the page cannot receive is worse than none. |

---

## Modifiers on the timeline

| Held while…              | Effect                              |
| ------------------------ | ----------------------------------- |
| `Alt` + drag a clip edge | Ripple trim instead of trim         |
| `Shift` / `Mod` + click  | Add to or remove from the selection |
| `Mod` + scroll           | Zoom, anchored at the pointer       |
| `Shift` + scroll         | Pan horizontally                    |

---

## Adding or changing a shortcut

Shortcuts are chord specs — `Mod+Shift+Z` — parsed once at registration. There
is exactly one place to change one: the command's definition. See
[Developer ▸ Commands API](developer/commands.md).
