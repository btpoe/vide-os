# VideOS Architecture

This describes how the pieces fit. Everything below is built unless marked
**Not built**, in which case the design is settled and the code is not there
yet — recorded so new work is written toward it rather than around it.

For what is left to do, see [`plan.md`](plan.md); for the log of defects found
and trade-offs taken, [`findings.md`](findings.md).

The target is a "solid creator NLE" — frame-accurate playback, deterministic
export, real timeline navigation, multi-track A/V with per-clip volume and
fades, transform, titles, transitions, keyframed effects, speed, markers, and
subtitles. Explicitly _not_ in scope: colour scopes and grading wheels, masks,
motion tracking, nested sequences, multicam, EDL/OTIO interchange.

---

## Current shape

```
index.tsx ──> App.tsx ──> <ve-panel-layout>  (docking, shadow DOM)
                 │              └─> <ve-panel> × N ──> Solid panel components
                 ├─> commands/   (all user actions, one registry)
                 └─> stores/     (project, ui, media, timeline, source, view)

model/          the document: frames, edits, invariants, snapshot history, io
platform/       one interface, web implementation (FS Access, OPFS, IndexedDB)
media/          WebCodecs decode per clip instance, refcounted frame cache
audio/          one graph function, shared by live playback and offline render
playback/       one clock, derived from AudioContext
renderer/       scene (pure data) ──> graph (synchronous WebGL2)
export/         codec negotiation, deterministic frame loop, muxing
```

The document is the single source of truth; every mutation goes through
`applyEdit` and is therefore both undoable and validated. UI preferences are
Solid stores persisted to `localStorage`; the project itself autosaves to OPFS,
which has no 5 MB ceiling to fail silently against.

---

## Design

### Commands

`src/commands/` holds one registry of `{id, label, shortcut, enabled, run}`.
Menus, toolbar buttons, and keyboard shortcuts all dispatch through it, so an
action has exactly one implementation and one enabled-state predicate.

Shortcuts are chord specs — `Mod+Shift+Z` — where `Mod` is Cmd on macOS and
Ctrl elsewhere. `keys.ts` owns parsing, matching, and display formatting, and
exposes `setPlatformIsMac()` so tests behave identically on a developer's Mac
and on Linux CI.

A disabled command still _swallows_ its shortcut, so Backspace with nothing
selected doesn't fall through to browser back-navigation.

### One render graph, two schedulers

Split rendering into three layers, with a hard rule: **the graph is synchronous
and pure; all decoding resolves before it runs.**

```
buildScene(doc, timeFrames) -> Scene       // pure, no GL, no async
composeFrame(gl, scene, frames, target)    // synchronous GL only
```

`Scene` is plain data — ordered layer operations with already-evaluated numeric
parameters, plus a flat list of frame requests. Being plain data makes it
snapshot-testable and worker-transferable.

Two schedulers consume it:

|            | Preview                                 | Export                                                     |
| ---------- | --------------------------------------- | ---------------------------------------------------------- |
| driver     | timeline clock                          | `for (frame = 0..N)`                                       |
| frames     | non-blocking; uses nearest available    | awaits the exact frame                                     |
| resolution | quality ladder from measured frame time | full export resolution                                     |
| in-flight  | exactly one render, enforced            | serial by construction                                     |
| audio      | live `AudioContext`                     | `OfflineAudioContext`, rendered once up front              |
| output     | canvas present                          | sample with `timestamp = frame × 1e6 × fpsDen / fpsNum` µs |

This structurally removes the wall-clock export bug and the overlapping-render
race: there is no wall clock in the export path and never more than one render
outstanding. The two schedulers differ in exactly one place — a `FrameLookup`
hook on `renderFrame`. Scene building, compositing, effects and transitions are
literally the same code, so the exported file cannot drift from the preview.

**Not built:** the quality ladder. Preview renders at full sequence resolution
however long a frame takes.

### The clock: audio is master, unconditionally

```
playing: now() = anchorSec + (audioCtx.currentTime - anchorCtxTime) × rate
paused:  now() = anchorSec
```

Audio is master **even when the timeline has no audio** — an `AudioContext` is a
monotonic, drift-free clock regardless of what is connected to it. Making that
unconditional removes the branch and the entire two-clocks class of bug.

`now()` is continuous, but everything displayed or rendered uses
`snapToFrame(now())`. Frame stepping is integer arithmetic on a frame index,
never repeated float addition of `1/fps`.

### Media engine: decode per clip instance

The unit of decode is a clip on the timeline, not a file on disk. Two clips of
one source get two decoders and never interfere.

```
AssetRegistry   contentKey -> one demuxer + sync-sample index (shared, cheap)
ClipDecoder     one per active clip, ring of ~0.5 s lookahead
DecoderPool     budgeted activation, LRU eviction
FrameCache      refcounted VideoFrame LRU with a byte budget
```

Three request modes: an awaiting exact fetch (export), a synchronous
never-blocking fetch (preview), and a sync-samples-only fetch for scrubbing that
upgrades to exact after the drag settles.

Frame lifetime is refcounted and _measured_: `openFrameCount()` tracks
`framesCreated - framesClosed` and is asserted in browser tests. Hoping for
`.close()` discipline does not work. Note what the counter means — a _cached_
frame is legitimately open, so zero is only expected once whatever owns the
cache has been disposed. Export therefore owns its own decoder pool, which also
stops a long export evicting the frames the editor is showing.

The engine facade is async from the start specifically so it can move into a
worker by swapping transport rather than rewriting call sites. **Not built:**
that move. No worker exists yet.

### Audio engine

Per voice: `AudioBufferSourceNode` → clip gain → clip pan → track gain → track
pan → master → destination + analyser.

Automation is written as absolute-time ramps on the clip gain node. **Because
every ramp is scheduled at an absolute `AudioContext` time, sync is exact by
construction — there is no per-frame audio sync step at all.**

Offline export builds voices with the _same_ function, passed an
`OfflineAudioContext`. One code path means preview and export cannot diverge.

The auto-created duplicate audio clip is gone, replaced by a `linkedAudio` flag
on the video clip. That duplicate was why export mixed every video's audio
twice, at 2× amplitude.

Speed changes resample, so a retimed clip is pitched. **Not built:** a
time-stretcher. `AudioBufferSourceNode` has no `preservesPitch`, and the UI
says the audio is pitched rather than offering a toggle that does nothing.

### Timeline geometry

Pixels-per-second plus a scroll offset, replacing percentage-of-duration:

```
timeToX(t) = t * pxPerSecond - scrollLeftPx
xToTime(x) = (x + scrollLeftPx) / pxPerSecond
zoomAt(clientX, factor)   // cursor-anchored — this is the feel of a timeline
```

Layout rules that keep one coordinate system: **one** horizontal scroller
wrapping the ruler and all lanes, with track headers `position: sticky` inside
it rather than a sibling column, so they cannot desync; **one** playhead in an
overlay layer rather than one per track.

Project duration stops being a layout input entirely — content width derives
from the actual last clip end.

Culling (a memo over the visible time range per track) rather than
virtualization: at this scale it holds 60 fps without the interaction pain of
dragging across a virtualized boundary.

Two coordinate spaces, kept distinct on purpose and easy to confuse: content x
is measured inside the scrolling strip and is what clips and ruler ticks are
positioned in; viewport x is measured against the panel. The sticky track
headers mean content x = 0 is a header-width to the right of the strip's left
edge, which is worth remembering before doing arithmetic on a pointer event.

**Not built:** the decoration generators. `lib/media-previews.ts` — the
concurrency-limited job queue that requests them — is real, but the waveform
and thumbnail generators it calls are pre-rewrite originals: a fixed 200 peaks
per file however long it is, and a `<video>` element per media file. Neither
the mip pyramid nor the Mediabunny filmstrip exists. See `plan.md`.

### Project document and undo

**All times become integer frames.** Float seconds are derived. This removes a
whole class of gap, overlap, and snap bugs and makes split and trim exact. Frame
rate becomes rational so 29.97 and 23.976 work.

**Undo becomes document snapshots with structural sharing**, replacing
command-based undo with hand-written inverses. The current model requires every
mutation to ship a correct inverse and three already don't; every new feature is
another chance to get it wrong, and the bugs are invisible until a user hits
them. Snapshot undo cannot be got wrong. Structural sharing keeps a step on a
large project to a few kilobytes.

**Media is identified by content hash**, not `Date.now()`. Projects save as a
zip bundle carrying an asset table, thumbnails, and waveform pyramids, so a
project file is portable. Nothing is ever deleted implicitly: a lapsed
permission produces a "Reconnect media" banner whose click performs the
re-grant, never a silent handle deletion.

### Effects and pipeline order

Per layer, in this order:

1. **Decode** → frame, image, text raster, or solid
2. **Crop** — in source UV space, folded into the upload pass
3. **Effects** — ping-pong FBOs, cleared at the start of each pass; spatial
   radii expressed as a fraction of height so half-res preview matches full-res
   export. Separable kernels run twice, with the pipeline supplying the
   direction rather than the user
4. **Transform + fit** — one quad draw with a matrix composing fit mode, anchor,
   scale, rotation, position. After effects, so effects see undistorted pixels
   and rotation isn't double-filtered
5. **Opacity + blend** — composited with the evaluated opacity

**Y-flip, canonically:** exactly one flip, at texture upload, via
`UNPACK_FLIP_Y_WEBGL`. The original design here called for flipping twice and
cancelling out; one flip in one place proved simpler to reason about and easier
to test, and the compositor test pins a single orientation. The code this
replaced baked flips into several vertex shaders, which cancelled out with one
video track and inverted alternating layers with two or more.

**Blending** is disabled globally; all compositing is explicit in-shader with
premultiplied alpha. Never fixed-function blend on top of hand-written
alpha-over math.

**Transitions become edges** between two clips rather than a property of one, so
the scene builder can emit an operation with two fully-rendered sub-graphs and a
progress value.

**Titles and captions** rasterize to an offscreen canvas keyed by their content,
then enter the graph as ordinary layers — inheriting transform, opacity,
effects and keyframes for free. Captions are added last, over everything
including a transition, and are burned in rather than overlaid so the preview
shows exactly what the exported file will contain.

### Platform seam

One `Platform` interface with a web implementation (File System Access, OPFS,
IndexedDB) and a Tauri implementation, selected at build time.

**The seam is `platform.fs.read(ref, range)`**, plus `createWritable(ref)` for
output. A byte-range source built on the first lets the demuxer work
identically on both targets; the second returns _positioned_ chunks, because
MP4 patches its header once the sizes are known and an append-only stream
cannot express that. No file outside `src/platform/web/` touches
`FileSystemFileHandle`.

Only the web implementation exists. Tauri is Phase 7.

`platform.transcode` is optional, which is what makes an ffmpeg fallback a clean
add-on: the same "this file needs conversion" prompt lazy-loads wasm on web or
invokes a native sidecar on desktop, from one call site.

---

## Testing

| Tier        | Covers                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | keyframe evaluation, timeline geometry round-trips and cursor-anchored zoom, timecode, subtitle and chapter formats, chord parsing and dispatch                                                     |
| Property    | random sequences of split/trim/move/delete, asserting clips stay sorted and non-overlapping with valid in/out points; then undo everything and assert deep equality with the original               |
| Render      | render in real WebGL2 and probe specific pixels — "transparent above the plate before the blur, lit after it". Layer stacking and Y orientation across multiple tracks, plus a frame-leak assertion |
| Determinism | export a synthetic timeline, demux the result, assert exact frame count, exact presentation timestamps, and burned-in frame counters in order                                                       |
| Component   | mount the real panel, dispatch real pointer and input events, assert on the document. Every UI bug this project has found was invisible without this                                                |

Test media is **generated, not committed** — a fixture script encodes a short
clip with a burned-in frame counter and a test tone, which makes frame-accuracy
assertions trivial and keeps binaries out of git. The counter is encoded as
black-and-white blocks read by luma threshold, not as a colour: the fixtures
are lossy 4:2:0 H.264, and exact channel values do not survive a round trip.

Two things to know before writing a browser-mode test. **No stylesheet is
loaded**, so Tailwind's `absolute` never applies and every element measures at
the origin — assert on inline offsets, or on relative motion, not on rendered
rectangles. And **the render target is the composite framebuffer**, not the
canvas: the drawing buffer is created with `preserveDrawingBuffer: false` and
is cleared as soon as the browser composites, so reading it from a later task
returns black.

The render tier deliberately does not diff against reference images. Probing
named pixels states what is being checked and has no goldens to regenerate when
an unrelated shader changes. (`pixelmatch` and `pngjs` are still declared as
dependencies and used nowhere — see `plan.md`.)

**Not built:** a standalone Playwright E2E suite. Playwright is present only as
the driver for Vitest browser mode, which covers most of what the E2E tier was
for by mounting real components. What it cannot cover is anything behind an OS
dialog, such as importing through the file picker.

CI runs typecheck, lint, format check, unit tests, and build on every push;
browser-mode tests run in a separate job with Chromium. `no-floating-promises`
is an error — it alone would have caught the un-awaited `renderFrame()` that
lets concurrent renders corrupt GL state.
