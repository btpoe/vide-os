# VideOS Architecture

This describes how the pieces fit. Everything below is built unless marked
**Not built**, in which case the design is settled and the code is not there
yet — recorded so new work is written toward it rather than around it.

For what is left to do, see [`plan.md`](plan.md); for the log of defects found
and trade-offs taken, [`findings.md`](findings.md).

The target is a "solid creator NLE" — frame-accurate playback, deterministic
export, real timeline navigation, multi-track A/V with per-clip volume and
fades, transform, titles, transitions, keyframed effects, speed, markers, and
subtitles. Explicitly _not_ in scope: masks, motion tracking, nested sequences,
multicam, EDL/OTIO interchange.

Primary colour correction and scopes were refused and are now accepted into
scope — unbuilt and unscheduled, with the design questions written up in
[`wiki/roadmap.md`](../wiki/roadmap.md#colour-grading). Secondaries and tracked
windows stay refused, because they need the masking and tracking above.

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

The preview's quality ladder lives in `playback/preview-quality.ts` as a pure
function of measured cost, applied by the scheduler. Three rungs — 1/1, 1/2, 1/4
of the preview's base size — with hysteresis in both directions, and full
quality restored the moment the playhead settles, since a paused frame has all
the time it needs and is the one people look at.

The **base** those rungs are fractions of is chosen by the panel, from the same
module, and is likewise discrete: 1/2, 1/4 or 1/8 of the sequence, whichever is
the coarsest that still covers the picture's size on screen, with a 5% dead band
so a splitter drag crosses a step at most once. Half the sequence is the cap.
The canvas is sized by CSS with the drawing buffer fitted inside it by
`object-contain`, which is what keeps the two independent — while the element's
size came from its own buffer, a smaller buffer drew a smaller picture.

Who owns what, because two owners of the render-target size would fight every
frame: the panel owns the base and the canvas, the scheduler owns the rung and
therefore every call to `resizeCompositor`.

Two signals rather than one: time spent inside `renderFrame`, and the interval
between rendered frames. The second is the load-bearing one. Scaling render
targets buys GPU fill rate, and GPU time is not visible from `performance.now()`
around a GL call — the calls return promptly and the next animation frame
arrives late instead.

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

**Nothing decodes until the file is in the `AssetRegistry`, and the import path
is what puts it there.** `DecoderPool.acquire` looks the asset up by content key
and returns `null` if it is missing, which propagates as a `null` frame all the
way to a black preview — with no error anywhere, because a missing frame is a
legitimate answer while a decode is still in flight. For a long time the only
call that registered anything was the _relink_ path, so every file the app itself
imported rendered as nothing; the decorations kept working throughout, because
waveforms and filmstrips open their own throwaway demuxer rather than going
through the registry. Registering at import is also what makes the probe the
single source of truth for a file's duration, size and audio: opening it and
asking what is in it are one step, not two that can disagree.

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
that move, and now deliberately so rather than by omission. The decode itself
already runs off the main thread — `VideoDecoder` does its work in the browser's
media process — so what a worker would move is the JS around it, and the price is
marshalling `VideoFrame`s across a boundary on the preview's hot path. The async
facade is insurance against that judgement changing, not a plan.

Where a worker _does_ pay is waveform analysis, which is pure JS over hundreds of
millions of samples: `media/waveform-worker.ts`. That distinction — measured
rather than assumed — is the whole of the worker decision.

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

### Timeline decorations

Three layers, so the arithmetic is testable without a codec and the codec work
happens once per file ever:

```
lib/waveform.ts              pure: pyramid, query, SVG path
media/waveform-analysis.ts   streaming scan — no DOM, no Web Audio, worker-safe
lib/waveform-cache.ts        memory -> OPFS -> worker
lib/clip-thumbnails.ts       filmstrip sheet + poster, memory -> OPFS -> CanvasSink
lib/media-previews.ts        the concurrency-limited request queue
```

Waveform peaks are a **mip pyramid**: min/max pairs over 128-sample buckets, then
halved repeatedly. A query picks the level whose buckets are just finer than the
pixel column being drawn, so drawing costs O(columns) rather than O(file). An
hour at 48kHz is a 1.35M-bucket base and about 5.4 MB for every level together,
because a pyramid is at most twice its base. Analysis streams through
`AudioSampleSink` — never `decodeAudioData`, which would hold 1.4 GB of float to
draw a strip — and runs in a worker, falling back inline if one cannot start.

Both decorations are indexed by **source time**, not by position on the timeline,
which is what makes them follow a trim, a slip and a speed change with nothing
regenerated. Past the end of the media, peaks read as silence and tiles hold the
last frame: a clip overrunning its source should look like what it is.

Filmstrips are one single-row sprite sheet per file — up to 120 tiles, decoded in
one pass over sorted timestamps through Mediabunny's `CanvasSink` — so a clip
draws a strip from one image and one texture however many tiles it shows.
`posterFrame` decodes the single frame the media pool shows, which is what let
the last `<video>`-element decode path be deleted.

Both cache to OPFS through `platform.cache`, keyed by content key, so the second
launch of a project draws its decorations without decoding anything. The previous
implementation cached in an in-memory `Map` and re-decoded every file on every
reload.

### The panel system, and the keyboard

`web-components/ve-panel-layout.ts` is a custom element with its own shadow
root, which means nothing about it is navigable or announced unless it says so.
It says so:

- Every tab bar — including the one-tab bar a lone panel gets, built by the same
  code — is a `tablist` with a **roving tabindex**: one Tab stop for the whole
  bar, arrow keys within it, Home and End to the ends, Delete to close. Twelve
  panels each holding a tab stop would make moving past the layout a dozen
  presses. Activation follows focus, which is right when switching tabs only
  changes what is shown.
- Every splitter is a focusable `separator` carrying the sizes it controls, and
  resizes with the arrow keys — larger steps with Shift.
- Sizes are written **onto the cells**, never by re-rendering. Re-rendering
  destroyed the element that had focus, so the second arrow press went nowhere;
  it was also rebuilding the whole panel tree on every `mousemove` of a drag.
- The close ✕ inside a tab is `aria-hidden`: it lives inside the tab's own
  button, where announcing it would read as part of the panel's name. Delete on
  the focused tab is the keyboard path, and it is in the reference sheet.

`panels/Overlay.tsx` is the modal the app's own dialogs are built from — role,
Escape, a focus trap, and focus handed back on close — because the three that
existed before were each a `div` with a click handler.

The shortcut reference (`panels/ShortcutSheet.tsx`) is **generated from the
command registry**, grouping by category and merging two bindings of one action
onto a line by comparing `run` identity. The hand-written sheet it replaced had
drifted into describing shortcuts that no longer did what it said. The only
hand-written part is the panel layout's own keys, which are not commands.

### Diagnostics

`panels/DebugHud.tsx`, over the preview, on `Shift+D`: decoder count against the
pool budget, cache entries, bytes and hit rate, the frame-leak counter
(created minus closed), dropped frames, and the preview's current render size
and rung. Everything in it was already being counted and none of it was
reachable outside a test.

Polled at 4 Hz rather than made reactive — these counters change on the render
loop's schedule, and driving reactivity from a 60 Hz loop to update text would
cost more than what it measures. Dropped frames are counted, not derived from a
frame rate: at 60 Hz on a 30 fps sequence the loop legitimately draws a frame
twice, so what is reported is sequence frames the playhead passed with nothing
drawn, and only while playing.

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
| Performance | budgets, in their own Node project and in the browser suite: scene build under 2 ms at 1000 clips, a whole preview frame under a display frame at half resolution                                   |

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
an unrelated shader changes, or when the suite runs on a different GPU and
driver. `pixelmatch`, `pngjs` and `@types/pngjs` were declared for the tier that
was not built and are now removed, so the dependency list no longer implies an
approach the tests do not take.

Where a probe is not available, use the material under test as the assertion. The
video fixtures carry a burned-in frame counter, so "the filmstrip shows
successive frames" is a strictly increasing sequence of decoded numbers rather
than a subjective look at a strip.

**Not built:** a standalone Playwright E2E suite. Playwright is present only as
the driver for Vitest browser mode, which covers most of what the E2E tier was
for by mounting real components. What it cannot cover is anything behind an OS
dialog, such as importing through the file picker.

The performance tier is written so a timing assertion is not a flaky test: the
median of many runs rather than a sample, warm-up discarded, and the numbers
printed on every run whether it passes or not — a budget that only speaks when
it breaks gives no warning that it was about to. `VITE_PERF_ALLOWANCE` scales
every budget in one place, which is how CI runs the same tests on a machine with
no GPU. The preview budget calls `gl.finish()` inside the measured region,
because without it it measures submission and would sit comfortable while the
preview stuttered.

CI runs typecheck, lint, format check, unit tests, perf budgets, and build on
every push; browser-mode tests run in a separate job with Chromium.
`no-floating-promises` is an error — it alone would have caught the un-awaited
`renderFrame()` that lets concurrent renders corrupt GL state.

One thing to know about that browser job: it names `environment: "node"` in its
config, which browser mode ignores. It has to name _something_ resolvable —
left unset it resolved to `jsdom`, which is not installed, and Vitest set the
process exit code to 1 before running a thing. The job reported every test as
passing and failed anyway, on every run since it was written.
