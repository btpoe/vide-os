# VideOS Architecture

This describes where the codebase is going, not entirely where it is. Sections
marked **Planned** are design decisions that have been made but not yet built;
they exist here so that new code is written toward them rather than around them.

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
                 └─> stores/     (project, ui, media, timeline, history)

panels/PreviewPanel ──> renderer/compositor ──> renderer/effects-pipeline
                                    │                    (8 GLSL effects)
                                    └──> renderer/frame-source (<video> elements)
```

Stores are Solid `createStore`s persisted to `localStorage`. The renderer is
WebGL2 with a ping-pong FBO chain for effects and a per-track composite pass.

---

## Known defects this design is meant to remove

These are load-bearing context for the decisions below.

**Export is not deterministic.** `renderer/export-engine.ts` renders each frame
then calls `requestFrame()` on a `canvas.captureStream(0)` feeding a
`MediaRecorder`. MediaRecorder timestamps each frame at the moment it arrives,
so the output's duration equals wall-clock render time, not timeline time. The
`fps` setting is used only to pick sample times, never given to the recorder.
The offline audio mixdown is then played back in _real time_ into the same
stream, so it cannot line up. Filenames are chosen from the requested format
while the mime falls back to WebM.

**Playback is not frame-accurate.** `frame-source.ts` skips any seek within
0.02 s — wider than a frame at 60 fps. Its `seeked` handlers are not keyed to a
specific seek, so overlapping seeks resolve against each other. There is one
`<video>` element per _media file_ rather than per _clip_, so two clips of the
same source fight over `currentTime`. `playback-engine.ts` calls an async
`renderFrame()` without awaiting it and immediately schedules the next frame,
letting concurrent renders stomp shared GL state.

**Two clocks fight.** The playhead advances by rAF wall-clock delta while
`audio-manager.ts` separately calls `video.play()` and does its own drift
correction at a 0.15 s threshold.

**Media references are destroyed on reload.** `media-store.restoreMedia()` runs
in `onMount` and calls `requestPermission()`, which the browser only allows
inside a user gesture. It therefore always fails, and the failure path deletes
the stored handle from IndexedDB permanently.

**Undo has hand-written inverses that are wrong.** Split-undo is stubbed,
trim-redo is empty, and delete-undo re-adds clips with fresh ids while dropping
effects, in/out points, and transitions — so the paired redo, which removes by
the old id, is a no-op.

---

## Design

### Commands (built)

`src/commands/` holds one registry of `{id, label, shortcut, enabled, run}`.
Menus, toolbar buttons, and keyboard shortcuts all dispatch through it, so an
action has exactly one implementation and one enabled-state predicate.

Shortcuts are chord specs — `Mod+Shift+Z` — where `Mod` is Cmd on macOS and
Ctrl elsewhere. `keys.ts` owns parsing, matching, and display formatting, and
exposes `setPlatformIsMac()` so tests behave identically on a developer's Mac
and on Linux CI.

A disabled command still _swallows_ its shortcut, so Backspace with nothing
selected doesn't fall through to browser back-navigation.

### One render graph, two schedulers (planned)

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
outstanding.

### The clock: audio is master, unconditionally (planned)

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

### Media engine: decode per clip instance (planned)

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

Frame lifetime is refcounted and _measured_: a dev counter tracks
`framesCreated - framesClosed`, surfaced in a debug HUD and asserted at teardown
in every browser-mode test. Hoping for `.close()` discipline does not work.

The engine facade is async from the start specifically so it can move into a
worker by swapping transport rather than rewriting call sites.

### Audio engine (planned)

Per voice: `AudioBufferSourceNode` → clip gain → clip pan → track gain → track
pan → master → destination + analyser.

Automation is written as absolute-time ramps on the clip gain node. **Because
every ramp is scheduled at an absolute `AudioContext` time, sync is exact by
construction — there is no per-frame audio sync step at all.**

Offline export builds voices with the _same_ function, passed an
`OfflineAudioContext`. One code path means preview and export cannot diverge.

The auto-created duplicate audio clip goes away, replaced by a `linkedAudio`
flag on the video clip plus a real "Detach Audio" command. That duplicate is
why export currently mixes every video's audio twice at 2× amplitude.

### Timeline geometry (planned)

Replace percentage-of-duration with pixels-per-second plus a scroll offset:

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

### Project document and undo (built)

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

### Effects and pipeline order (planned)

Per layer, in this order:

1. **Decode** → frame, image, text raster, or solid
2. **Crop** — in source UV space, folded into the upload pass
3. **Effects** — ping-pong FBOs, cleared at the start of each pass; spatial
   radii expressed as a fraction of height so half-res preview matches full-res
   export
4. **Transform + fit** — one quad draw with a matrix composing fit mode, anchor,
   scale, rotation, position. After effects, so effects see undistorted pixels
   and rotation isn't double-filtered
5. **Opacity + blend** — composited with the evaluated opacity

**Y-flip, canonically:** all textures are stored bottom-up in GL convention, and
a flip happens exactly twice — once at source upload, once at the final blit.
The current code bakes flips into multiple vertex shaders, which cancels out
with one video track and inverts alternating layers with two or more.

**Blending** is disabled globally; all compositing is explicit in-shader with
premultiplied alpha. Never fixed-function blend on top of hand-written
alpha-over math.

**Transitions become edges** between two clips rather than a property of one, so
the scene builder can emit an operation with two fully-rendered sub-graphs and a
progress value.

**Titles** rasterize to an offscreen canvas keyed by their content hash, then
enter the graph as ordinary layers — inheriting transform, opacity, effects and
keyframes for free.

### Platform seam (built, web only)

One `Platform` interface with a web implementation (File System Access, OPFS,
IndexedDB) and a Tauri implementation, selected at build time.

**The entire seam is `platform.fs.read(ref, range)`.** A byte-range source built
on it lets the demuxer work identically on both targets. After the seam lands,
no file outside the web implementation touches `FileSystemFileHandle`.

`platform.transcode` is optional, which is what makes an ffmpeg fallback a clean
add-on: the same "this file needs conversion" prompt lazy-loads wasm on web or
invokes a native sidecar on desktop, from one call site.

---

## Testing

| Tier         | Covers                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit         | keyframe evaluation, timeline geometry round-trips and cursor-anchored zoom, timecode, chord parsing and dispatch                                                                                                              |
| Property     | random sequences of split/trim/move/delete, asserting clips stay sorted and non-overlapping with valid in/out points; then undo everything and assert deep equality with the original                                          |
| Golden frame | render a scene in real WebGL2, compare against a reference within tolerance. Layer stacking and Y orientation across 1/2/3 tracks is mandatory — that is exactly the bug that shipped. Plus a frame-leak assertion at teardown |
| Determinism  | export a synthetic timeline, demux the result, assert exact frame count, exact presentation timestamps, and a burned-in frame counter matching                                                                                 |
| E2E          | import → arrange → play → export, save/reload round-trip                                                                                                                                                                       |

Test media is **generated, not committed** — a fixture script encodes a short
clip with a burned-in frame counter and a test tone, which makes frame-accuracy
assertions trivial and keeps binaries out of git.

CI runs typecheck, lint, format check, unit tests, and build on every push;
browser-mode tests run in a separate job with Chromium. `no-floating-promises`
is an error — it alone would have caught the un-awaited `renderFrame()` that
lets concurrent renders corrupt GL state.
