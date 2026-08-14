# Onboarding

Two audiences, in order: someone editing a video with this, and someone editing
this. Both are short on purpose. The long-form reasoning lives in
[`architecture.md`](architecture.md) and [`findings.md`](findings.md).

---

## Using it

The app opens on an empty timeline and a black preview, and nothing on screen
says what to do first. **Help → Getting Started** is the same six steps as
below, in the app; **Help → Keyboard Shortcuts** (`⇧?`) is generated from the
command registry, so it is never out of date.

1. **Bring in media.** Media Pool → Import, or drop files onto the pool. Files
   stay where they are on disk — the project records where they live rather than
   copying them, and identifies them by a hash of their bytes, so a project
   reopens on another machine once you point it at the files again.
2. **Put it on the timeline.** Drag from the pool onto a track, or open a clip
   in the Source monitor, mark in and out (`I` / `O`) and insert at the playhead
   (`,` to insert, `.` to overwrite).
3. **Move around.** Space plays. `←` / `→` step a frame. `J` and `L` shuttle.
   `Home` and `End` go to the ends. The ruler scrubs, and `⌘=` / `⌘-` zoom
   around the cursor.
4. **Edit.** `V` selects, `C` razors, `T` trims a cut from either side, `Y`
   slips, `U` slides. Hold Alt while trimming to ripple. Every edit is one undo
   step — including a whole drag.
5. **Adjust.** Properties holds transform, opacity, crop, blend and speed;
   Effects adds filters. The diamond beside any value keyframes it.
6. **Export.** File → Export (`⌘E`). One frame is written per timeline frame,
   timestamped from its frame index, so two exports of one project are identical
   files.

Work autosaves to the browser's origin-private filesystem as you go, and a crash
offers to restore. `⌘S` writes a portable `.videos` bundle.

**Requirements:** a Chromium browser. WebGL2 and WebCodecs are load-bearing;
the File System Access API is what makes opening a folder possible.

**When something looks wrong:** `⇧D` opens the debug HUD over the preview —
decoders in use, frame cache size and hit rate, open frames, dropped frames, and
what resolution the preview is actually rendering at.

---

## Working on it

```sh
pnpm install
pnpm dev                       # http://localhost:5173
pnpm exec playwright install chromium   # once, for the browser suite
```

| Command             | What it runs                                    |
| ------------------- | ----------------------------------------------- |
| `pnpm test`         | Unit and property tests, in Node                |
| `pnpm test:browser` | Anything needing real WebGL2, WebCodecs or OPFS |
| `pnpm test:perf`    | The performance budgets                         |
| `pnpm check`        | typecheck + lint + test + build                 |

### Where things are

`src/model/` is the document and is pure — no Solid, no DOM. Everything else
depends on it and it depends on nothing. Times are **integer frames** and the
frame rate is **rational**; float seconds are derived, never stored.

`src/platform/` is the boundary to the host. Its whole surface is
`read(ref, range)` and `createWritable(ref)`. Nothing outside
`src/platform/web/` may touch a `FileSystemFileHandle` — that rule is what makes
the Tauri build a second implementation rather than a rewrite.

`src/renderer/` is split in two on a hard rule: `buildScene` is pure data with
no GL and no async, and `composeFrame` is synchronous GL. All decoding resolves
before either runs. Preview and export share both, and differ in exactly one
hook.

### The four rules worth knowing before writing anything

1. **Every user action is a command.** `src/commands/definitions.ts` holds one
   `{id, label, shortcut, enabled, run}` per action; menus, buttons and keys all
   dispatch through it. Adding a shortcut means adding a command — which also
   adds it to the reference sheet, because that sheet is generated from the
   registry.
2. **Every document mutation goes through `applyEdit`.** It validates against
   the invariants and records one undo step. Undo is a snapshot, so no operation
   needs an inverse; every hand-written inverse this project ever had was wrong.
3. **Decoded frames are refcounted and counted.** Borrow, then release in a
   `finally`. `openFrameCount()` is created-minus-closed and is asserted to
   return to zero after dispose in the browser tests, because hoping for
   `.close()` discipline does not work.
4. **Drive real components in tests.** Every UI bug found here was invisible to
   a unit test and obvious the moment a test dispatched a real event.

### Two traps in browser-mode tests

**No stylesheet is loaded**, so Tailwind classes do not apply and everything
measures at the origin. Assert on inline offsets or on relative motion, never on
rendered rectangles.

**The render target is the composite framebuffer**, not the canvas: the drawing
buffer is created with `preserveDrawingBuffer: false` and is cleared as soon as
the browser composites, so reading it from a later task returns black whatever
was drawn.

### Adding things

- **A panel:** a Solid component in `src/panels/`, plus an entry in
  `builtInPanels` in `App.tsx`. The docking layout takes it from there.
- **An effect:** a fragment shader and a definition in
  `renderer/effects-pipeline.ts`. Spatial radii are expressed as a fraction of
  frame height so a half-resolution preview matches a full-resolution export.
- **A command:** `commands/definitions.ts`. Give it a category; that is what
  groups it in the shortcut sheet.
- **A migration:** bump `DOC_FORMAT_VERSION` and add a step to the chain in
  `model/migrate.ts`. Old projects open or say why.
