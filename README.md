# VideOS

An open, web-standards video editor. Runs in the browser today; a Tauri desktop
shell is planned for real filesystem access and native codec fallbacks.

Built with SolidJS, WebGL2, and native Web Components for the docking layout.

## Status

**Pre-alpha.** The shell is real — a DaVinci-style dockable panel system, a
multi-track timeline, a WebGL2 shader pipeline with 8 effects and 4 transitions.
Playback is frame-accurate and export matches the timeline exactly.

Specifically, as of now:

| Area                            | State                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel layout, docking, tab drag | Works                                                                                                                                                                                                                                                                                      |
| Timeline editing                | Works. Drag, trim, razor, snapping, ripple/roll/slip/slide, multi-select drag across tracks, cut/copy/paste/duplicate. All undoable; Escape aborts a drag.                                                                                                                                 |
| Timeline zoom & scroll          | Works. Cursor-anchored zoom from ~4 hours down to a single frame, horizontal scroll, fit-to-window, resizable track lanes.                                                                                                                                                                 |
| Playback                        | Frame-accurate. One clock derived from AudioContext, WebCodecs decode per clip instance, synchronous rendering. J/K/L shuttle.                                                                                                                                                             |
| Export                          | Works, and is deterministic. One frame written per timeline frame, timestamped from its frame index; audio mixed once up front. Codecs are negotiated with the real encoder and the file is named from what was actually written. Streams to disk for exports too large to hold in memory. |
| Audio                           | Works. Per-clip volume, pan and fades; track mute/solo; a mixer with meters. Audio-only files play. The offline mix shares one code path with preview.                                                                                                                                     |
| Effects + keyframes             | Work. Eight effects, reorderable, individually bypassable, every parameter keyframable. Blur is separable and resolution-independent.                                                                                                                                                      |
| Undo / redo                     | Works. Document snapshots, so every edit undoes and redoes exactly.                                                                                                                                                                                                                        |
| Save / open                     | Works. `.videos` bundles are portable and carry a media table; older `.videos.json` files migrate on open.                                                                                                                                                                                 |
| Transitions                     | Work. Crossfade, dip-to-black and wipes, refused rather than faked when a clip has no handles to overlap into.                                                                                                                                                                             |
| Titles / text clips             | Work. Rasterised at sequence resolution and composited as ordinary layers, so they inherit transform, opacity and effects.                                                                                                                                                                 |
| Transform / opacity / crop      | Work, and keyframe. Position, scale, rotation, anchor, opacity, crop and blend mode, with bezier easing on any of them.                                                                                                                                                                    |
| Media persistence               | Works. Handles survive a lapsed permission; a banner offers a one-click re-grant, and moved media relinks by file or folder, verified by content hash.                                                                                                                                     |

Nothing in the UI claims to do something it doesn't: unimplemented controls are
disabled or labelled, not silently inert.

See [`docs/architecture.md`](docs/architecture.md) for where this is going, and
[`docs/findings.md`](docs/findings.md) for the running log of defects found and
trade-offs taken.

## Requirements

A browser with WebGL2 and the File System Access API. That currently means
Chromium (Chrome, Edge, Arc, Brave). Firefox and Safari can render but cannot
open folders.

## Development

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

| Command             | What it does                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`          | Vite dev server                                                                           |
| `pnpm build`        | Production build to `dist/`                                                               |
| `pnpm typecheck`    | `tsc --noEmit` over `src/` and the config files                                           |
| `pnpm lint`         | ESLint (type-checked rules)                                                               |
| `pnpm format`       | Prettier, write                                                                           |
| `pnpm test`         | Unit + property tests (Node)                                                              |
| `pnpm test:browser` | Golden-frame and export-determinism tests (needs `pnpm exec playwright install chromium`) |
| `pnpm check`        | typecheck + lint + test + build — what CI runs                                            |

## Layout

```
src/
  model/           the project document: types, edit operations,
                   invariants, snapshot undo, file format, migration.
                   Pure — no Solid, no DOM.
  platform/        the boundary to the host: file access, persistent
                   handles, cache. `web/` is the only place that touches
                   FileSystemFileHandle.
  commands/        every user-triggerable action; menus, buttons and
                   shortcuts all dispatch through here
  panels/          one Solid component per dockable panel
  renderer/        WebGL2 compositor, effect and transition shaders
  stores/          Solid wiring over the model, plus UI layout, media,
                   and timeline interaction state
  lib/             timecode, keyframe evaluation, filesystem helpers,
                   waveforms, thumbnails
  web-components/  <ve-panel> and <ve-panel-layout>, the docking system
test/
  unit/            Node-mode tests
  browser/         tests needing real WebGL2 / WebCodecs
```

### The document

`src/model/doc.ts` is the source of truth. All times are **integer frames**
and the frame rate is **rational** (`{num: 30000, den: 1001}` for 29.97) —
float seconds made split and trim approximate and drifted over long timelines.
Media is referenced by a **content key** derived from the file's bytes, which
is what makes a saved project reopenable on another machine.

Edits go through `applyEdit`, which mutates a draft, validates the result
against the document invariants in development, and records one undo step.
Undo is a document snapshot with structural sharing, not a hand-written
inverse.

`stores/project-store.ts` also exposes a **compatibility projection** of the
document in the older seconds-based shape, so the timeline and renderer keep
working until their own rewrites land. It is temporary and marked as such.

### Commands

Keyboard shortcuts, menu items, and toolbar buttons resolve to one `Command`
object in `src/commands/definitions.ts`. Adding an action means adding a command
— never a second implementation of one that already exists. Shortcuts are
written as chord specs like `Mod+Shift+Z`, where `Mod` is Cmd on macOS and Ctrl
elsewhere.

## License

Not yet chosen.
