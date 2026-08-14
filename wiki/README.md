# The VideOS Wiki

Training material for people who use VideOS, and for people who want to build on
it or help build it.

VideOS is an open, web-standards non-linear video editor. It runs in a browser
today; a desktop shell is planned. It is **pre-alpha** — everything documented
here works, and this wiki says plainly where it stops.

---

## Start here

| If you are…                    | Read                                        |
| ------------------------------ | ------------------------------------------- |
| New, and want to know why      | [Introduction](introduction.md)             |
| Ready to install and edit      | [Getting Started](getting-started.md)       |
| Looking for a specific control | [Panels](panels/README.md)                  |
| Trying to remember a key       | [Keyboard Reference](keyboard-reference.md) |
| Writing a plugin or an effect  | [Developer Guide](developer/README.md)      |
| Wanting to help                | [Contributing](contributing.md)             |
| Wondering what is coming       | [Roadmap](roadmap.md)                       |

---

## Contents

### For editors

1. **[Introduction](introduction.md)** — what VideOS is for, and the values the
   project is built on.
2. **[Getting Started](getting-started.md)** — requirements, installation, the
   layout, and a first edit end to end.
3. **[Panels](panels/README.md)** — a deep dive on every panel:
   - [Preview](panels/preview.md) · [Timeline](panels/timeline.md) ·
     [Media Pool](panels/media-pool.md) · [File Browser](panels/file-browser.md) ·
     [Source](panels/source-monitor.md)
   - [Tools](panels/tools.md) · [Effects](panels/effects.md) ·
     [Properties](panels/properties.md) · [Mixer](panels/mixer.md)
   - [Markers](panels/markers.md) · [Captions](panels/captions.md) ·
     [History](panels/history.md)
   - [Dialogs and overlays](panels/dialogs.md) — Export, Reconnect Media,
     Recovery, the Debug HUD
4. **[Keyboard Reference](keyboard-reference.md)** — every registered shortcut,
   generated from the command registry.

### For developers

5. **[Developer Guide](developer/README.md)** — how the app is put together and
   what the extension surface actually is today.
   - [Panels API](developer/panels.md) — add a dockable panel
   - [Commands API](developer/commands.md) — add an action, a shortcut, a menu item
   - [Effects and Transitions](developer/effects-and-transitions.md) — write a shader
   - [The Document](developer/document.md) — edits, undo, keyframes, stores
   - [The Platform Seam](developer/platform.md) — file access, cache, transcode

### For contributors

6. **[Contributing](contributing.md)** — how to get involved, how the codebase
   is reviewed, and the conventions that are load-bearing.
7. **[Roadmap](roadmap.md)** — what is planned, what is deliberately refused,
   and where help is most useful.

---

## How this wiki is written

Three rules, borrowed from the codebase itself:

- **Nothing here claims a feature that does not exist.** Where a design is
  settled and the code is not, it is marked **Not built**.
- **The "why" is included.** A decision without its reason gets re-litigated or
  quietly reversed. If something looks odd, the reason it is that way is
  usually one paragraph down.
- **It is checked against the source.** These pages describe
  `src/` as it stands, not as the plan once described it. If a page and the code
  disagree, the code is right and the page is a bug — please
  [report it](contributing.md#reporting-a-documentation-bug).

Keeping that true is a rule, not an aspiration: any change to the application
updates the wiki in the same change. [`CLAUDE.md`](../CLAUDE.md) at the
repository root carries the mapping from source area to the page that documents
it.

The repository also carries implementer-facing notes that this wiki does not
duplicate — how the pieces fit and why, the phase plan and what is left, and an
engineering log of every defect found and every trade-off taken. They live
alongside the source in the repository, not in these pages.
