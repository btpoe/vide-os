# VideOS

An open, web-standards video editor. Runs in the browser today; a Tauri desktop
shell is planned for real filesystem access and native codec fallbacks.

Built with SolidJS, WebGL2, and native Web Components for the docking layout.

## Status

**Pre-alpha.** The shell is real — a DaVinci-style dockable panel system, a
multi-track timeline, a WebGL2 shader pipeline with 8 effects and 4 transitions.
The media engine underneath it is not yet trustworthy.

Specifically, as of now:

| Area                                        | State                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel layout, docking, tab drag             | Works                                                                                                                                                                                                        |
| Timeline editing (cut, trim, arrange, snap) | Works, but see below                                                                                                                                                                                         |
| **Timeline zoom**                           | **Not implemented.** Clip geometry is a percentage of the whole project duration, so a short edit occupies a sliver of the panel with no way to zoom in. This is the single biggest thing blocking real use. |
| Playback                                    | Best-effort, not frame-accurate. Seeks within 20 ms are skipped, so 60 fps content shows duplicate frames.                                                                                                   |
| **Export**                                  | **Produces wrong output.** Frames are timestamped by wall-clock render time rather than by frame index, so a 60 s timeline can export as several minutes of slow motion, with audio out of sync.             |
| Audio                                       | Mute/unmute only. No per-clip volume, fades, or pan. Audio-only files are silent in preview.                                                                                                                 |
| Effects + keyframes                         | Render in preview and export                                                                                                                                                                                 |
| Transitions                                 | Data model and UI exist; the renderer never draws them                                                                                                                                                       |
| Titles / text clips                         | Data model and editor exist; the compositor has no text path                                                                                                                                                 |
| Transform / opacity / crop                  | Not implemented                                                                                                                                                                                              |
| Media persistence                           | Fragile — a lapsed permission deletes the stored file handle, and project files contain no media list, so they are not portable                                                                              |

Nothing in the UI claims to do something it doesn't: unimplemented controls are
disabled or labelled, not silently inert.

See [`docs/architecture.md`](docs/architecture.md) for where this is going.

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
  commands/        every user-triggerable action; menus, buttons and
                   shortcuts all dispatch through here
  panels/          one Solid component per dockable panel
  renderer/        WebGL2 compositor, effect and transition shaders
  stores/          Solid stores: project document, UI layout, media,
                   timeline interaction, undo history
  lib/             filesystem access, waveforms, thumbnails, persistence
  web-components/  <ve-panel> and <ve-panel-layout>, the docking system
test/
  unit/            Node-mode tests
  browser/         tests needing real WebGL2 / WebCodecs
```

### Commands

Keyboard shortcuts, menu items, and toolbar buttons resolve to one `Command`
object in `src/commands/definitions.ts`. Adding an action means adding a command
— never a second implementation of one that already exists. Shortcuts are
written as chord specs like `Mod+Shift+Z`, where `Mod` is Cmd on macOS and Ctrl
elsewhere.

## License

Not yet chosen.
