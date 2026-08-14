# Engineering log

A record of bugs found, decisions made, and compromises taken, with enough
context to judge them later. Newest phase last.

Two kinds of entry:

- **Found** — a defect discovered in existing code or in code written during
  the same session. What it was, how it surfaced, why it mattered.
- **Decided** — a choice with a real trade-off, including the ones that leave
  something worse than ideal in the tree.

---

## Pre-existing defects (audited before Phase 0)

Found by reading the code that came with the repo, and confirmed by grep or by
running it. All of these predate this work; each links to the phase that fixes
it.

| #   | Defect                                                                                                                | Consequence                                                                                      | Fixed in                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| P1  | Export timestamps frames by wall-clock render time, not frame index (`export-engine.ts:146,211-259`)                  | A 60 s timeline rendering at ~8 fps exports as ~225 s of slow motion                             | Phase 5 ✓                                     |
| P2  | Offline audio mixdown played into the recorder in real time while video renders at render speed                       | Audio can never line up with picture                                                             | Phase 5 ✓                                     |
| P3  | `mixTimelineAudio` sums all tracks with no type filter, and every video clip has an auto-created duplicate audio clip | Every clip's audio mixed twice at 2× amplitude, clipping                                         | Phase 1c (duplicate removed), Phase 3 (mixer) |
| P4  | `.mp4` extension chosen from the _requested_ format while the mime falls back to WebM                                 | A WebM file named `.mp4`; the fallback mime also has no audio codec                              | Phase 5 ✓                                     |
| P5  | Compositor built at `projectState.width/height`, ignoring export settings                                             | The 4K export preset renders 1080p and upscales                                                  | Phase 5 ✓                                     |
| P6  | Seeks within 0.02 s are skipped (`frame-source.ts:73`) — wider than a frame at 60 fps                                 | Duplicate frames; playback is not frame-accurate                                                 | Phase 3                                       |
| P7  | `seeked` handlers not keyed to a specific seek                                                                        | Overlapping seeks resolve against each other                                                     | Phase 3                                       |
| P8  | One `<video>` element per _media file_ rather than per _clip_                                                         | Two clips of one source fight over `currentTime`                                                 | Phase 3                                       |
| P9  | `renderFrame()` called without `await`, next rAF scheduled immediately                                                | Concurrent renders stomp shared GL state                                                         | Phase 3                                       |
| P10 | Two clocks: rAF wall-clock advance plus `video.play()` plus independent drift correction                              | Playhead and audio disagree                                                                      | Phase 3                                       |
| P11 | `requestPermission()` called from `onMount`, and its failure path **deleted the stored handle**                       | First reload after a permission lapse permanently destroyed every media reference in the project | Phase 1b + follow-up                          |
| P12 | Project files saved no media list; clip ids were `Date.now()`-based                                                   | Saved projects could not be reopened anywhere, including on the machine that wrote them          | Phase 1b                                      |
| P13 | Split-undo stubbed, trim-redo empty, delete-undo minting new ids and dropping effects/in-out/transitions              | Undo silently corrupts the project                                                               | Phase 1a                                      |
| P14 | Timeline zoom affects only ruler tick density; clip geometry is a percentage of total duration                        | A 20 s edit occupies ~6% of the panel with no way to zoom in                                     | Phase 2                                       |
| P15 | `renderTransition` called from nowhere; compositor has no text path                                                   | Transitions and titles are stored, shown in the timeline, and never rendered                     | Phase 4 ✓                                     |
| P16 | `PropInput` had no `onInput`; opacity/volume were static divs reading "100%"                                          | Six controls that looked functional and did nothing                                              | Phase 0 (removed), Phase 4 (built) ✓          |
| P17 | Extension whitelist advertised avi/mkv/flv/wmv/heic as supported                                                      | Those import with an icon and a duration, then render black with the decode rejection swallowed  | Phase 0 (partial), Phase 3 (real probe)       |
| P18 | `trimClipRight` clamped only the minimum                                                                              | Dragging right forever pushes the out-point past the media into a silent freeze frame            | Phase 1a                                      |
| P19 | `splitClipAtTime` pushed the new clip to the end of the array; nothing kept clips sorted                              | Render order depended on edit history                                                            | Phase 1a                                      |
| P20 | Y-flip baked into several vertex shaders                                                                              | With ≥2 visible video tracks, alternating layers render upside down                              | Phase 4 ✓                                     |

---

## Phase 0 — tooling, commands, dead code

### Found

**0.1 — `parseChord(" ")` matched nothing.** A shortcut written as a literal
space trimmed to the empty string, so it could never fire. Not hit in practice
because the spec is written `"Space"`, but a trap for the next person. Surfaced
by a test written to assert the behaviour worked.

**0.2 — menus displayed raw command ids.** `menuItems` was built in the
component body, which runs _before_ `onMount` registers the commands, so
`getCommand(id)?.label` was always undefined and every item fell back to its id
(`edit.undo`). Every field became a getter. Surfaced only by driving the real
UI in a browser — typecheck and unit tests were both green.

**0.3 — `FileSystemHandle` narrowing was papered over by `any`.** Removing the
`any` cast around the drag payload exposed that `handle.kind === "file"` does
not narrow, because lib.dom models `FileSystemHandle` as a base class rather
than a discriminated union. Needed an explicit type predicate.

### Decided

**0.4 — `eslint-plugin-solid` dropped.** It has no ESLint 10 support. Pinning
ESLint to 9 to keep Solid-specific reactivity lint was considered and rejected:
`no-floating-promises` from typescript-eslint is the rule that would have caught
the real bug in this codebase (P9), and it works on 10. Cost: no automated
check for reactivity mistakes such as side effects in a render body — which is
a real gap, since that pattern exists in `TimelinePanel` and is on the Phase 2
list to fix by hand.

**0.5 — the platform is injectable in `keys.ts`.** `Mod` resolves to Cmd on
macOS and Ctrl elsewhere, derived from `navigator.platform`. Left as a module
constant, the same assertion passes on a developer's Mac and fails on Linux CI.
`setPlatformIsMac()` exists purely so tests can pin it.

**0.6 — disabled commands still swallow their shortcut.** Backspace with
nothing selected must not fall through to browser back-navigation, so
`handleKeyDown` calls `preventDefault` before checking `enabled`.

---

## Phase 1 — document model, undo, project format

### Found

All six of these were in code written during the same session and would have
shipped without the property tests.

**1.1 — split at fractional speed overran the source.** The tail's in-point was
computed as `parentIn + round(offset × speed)`. That rounds each half's source
span independently, so at a fractional speed both halves can round up and the
pair consumes one more source frame than the parent did — pushing the tail past
the end of the media. Fixed by anchoring the tail's source range to end where
the parent's did (`tailInPoint`). The two halves may now overlap by one source
frame at the seam, which is invisible; overrunning the source is a freeze frame,
which is not.

Counterexample: `insert(start=2, len=108)`, `speed=0.5`, `slip(+383)`,
`split(at=75)` → tail reads frames 229..301 of a 300-frame asset.

**1.2 — `setClipSpeed` rounded duration up past the media.** Then, separately,
at high speed even the one-frame minimum clip can overrun: at 4×, one timeline
frame consumes four source frames, so a clip whose in-point sits three frames
from the end cannot be shortened enough to fit. Shrinking the duration is not
sufficient — the in-point has to retreat. Both handled by a shared
`fitToSource`.

Counterexample: `insert(len=1)`, `slip(+293)`, `trimEnd(to=6)`, `speed=4` →
reads 297..301 of 300.

**1.3 — `slideClip` grew a neighbour with no material to grow into.** Sliding
left lengthens the next clip and shortens its in-point; the implementation
clamped the in-point to zero _afterwards_, which left the clip reading past the
end. Fixed by bounding the slide by each neighbour's available handles up
front.

**1.4 — `commitInteraction` compared documents by reference.** Every frame of a
drag produces a new document object, so a drag that returns to its starting
position is never reference-equal to the base and recorded an undo step that
did nothing. Needed a value comparison — but one that short-circuits on
reference identity at every level, so it walks only what the drag actually
touched rather than the whole document.

**1.5 — `projectFileName("///")` produced `_.videos`.** Sanitising replaced the
separators with `_`, which is truthy, so the empty-name fallback never fired.

**1.6 — `structuredClone` cannot clone a `mutative` draft.** Every object in a
draft is a Proxy and `structuredClone` rejects it with `DataCloneError`.
Replaced with an explicit `cloneClip`, which has the side benefit that a newly
added clip field has to be considered rather than silently shared by reference
between the two halves of a cut.

### Decided

**1.7 — the compatibility projection (the significant compromise).**

`project-store` exposes `projectState`, a projection of the document into the
_old_ seconds-based shape: `type` for `kind`, transitions hung off the
right-hand clip, titles as a `textOverlay` on a `"__text__"` clip. It is
rebuilt and reconciled on every document change.

This is a second representation of the same data — normally the thing to avoid.
It exists because the alternative was landing the model rewrite, the timeline
rewrite and the renderer rewrite in one commit, across 111 read sites in 14
files. Instead the model landed on its own, verifiably, with the app working at
every step.

Mitigations: it is derived, never authoritative; writing to it does nothing
useful and says so; `reconcile` keyed by id preserves fine-grained reactivity;
and it is marked temporary at the top of the file. Each consumer drops it as
that consumer is rebuilt — Phase 2 for the timeline, Phase 4 for the renderer.
**It should be deleted by the end of Phase 4**; if it is still there, that is a
signal something went wrong.

**1.8 — asset registration is not undoable.** Importing media mutates the
document (the asset table) but records no history step. Making it undoable
would put one entry per file in the history and would desync from the media
pool, which has no undo of its own. Known limitation: an asset registered after
an undo is lost on the subsequent redo, because the redo snapshot predates it.
It is re-registered the next time the media is used.

**1.9 — snapshots over command inverses.** Command-based undo requires every
mutation to ship a correct inverse; three already did not (P13), and every new
feature is another chance to add a fourth. A snapshot cannot be wrong. Cost is
memory, mitigated by structural sharing: an edit to one track shares every other
track by reference, so a step on a large project costs kilobytes.

**1.10 — content keys sample both ends of the file.** SHA-256 over the first
and last megabyte plus the byte length, rather than the whole file, so importing
from a 40 GB camera card does not read it end to end. Documented consequence,
asserted in a test: two files of identical size that share a head and tail but
differ in the middle collide. Acceptable for matching media; not a
content-integrity check.

**1.11 — `duration` keeps a 60-second floor in the projection.** The old
percentage geometry divides by project duration, so an empty project would
divide by zero. Phase 2 removes the whole concept.

---

## Post-Phase-1 — media import

### Found

**1.12 — dropping media on the timeline threw.** A regression from Phase 1c.
Importing a file added an entry to `media-store` but never registered an asset
in the _document_, so the resulting clip referenced an asset the document had
never heard of and the invariant check rejected it. Production would have
limped along, because the renderer looks media up in `media-store` rather than
the document — which is itself the smell that caused this: two media tables,
only one of them authoritative.

Caught by the user asking whether the feature worked yet, not by any test. Now
covered by three tests asserting the contract directly.

**1.13 — the handle-destroying bug had a second home.** P11 was fixed in the
platform layer in Phase 1b, but `media-store` still called
`fs-access.verifyFilePermission` directly — and that function fell through from
`queryPermission` to `requestPermission`, so it prompted. Called from
`restoreMedia` on mount, outside a user gesture, it always failed, and the
caller deleted the handle. Fixing an issue behind a new abstraction does not fix
the call sites that bypass it. `verifyFilePermission` now only queries;
`requestFilePermission` is separate and documented as gesture-only.

---

## Phase 2 — timeline geometry

### Found

**2.1 — `trimClipStart` overran the source at fractional speeds.** The fourth
member of the rounding family (1.1, 1.2, 1.3). Advancing the in-point by
`round(delta × speed)` rounds independently of the shrinking span: trimming 21
timeline frames off a 0.5× clip advanced the in-point by `round(10.5) = 11`
while the span shrank by only 10, gaining a frame. `clearRange`'s head-trim
path had the identical shape.

Fixed by reusing the split anchoring — but that exposed a second bug in the
anchor helper itself. `tailInPoint` clamped the result at _no lower than the
parent's in-point_, which is correct for a split (the tail is always shorter)
but wrong for a trim: dragging the left edge outward reveals earlier material,
so the in-point must be free to move down. Pinned there while the span grew, it
was itself an overrun. Renamed `anchoredInPoint` and clamped only at zero.

Lesson worth keeping: three of these four were found by the same property
("every clip stays inside its source"), each at a different seed. A single run
of 300 sequences was not enough to surface them — 2.1 only appeared once
Phase 2's tests changed the seed. The suite now runs a 20,000-sequence sweep
before each commit that touches `edits.ts`.

### Decided

**2.2 — geometry is frame-first, zoom limits are per-second.** `TimelineView`
holds `pxPerFrame`, because the document counts in frames and a frame is the
smallest position a clip edge can take. But the zoom limits are expressed in
pixels _per second_, so 24fps and 60fps material zoom to the same visible
duration rather than the same pixels-per-frame.

**2.3 — snapping threshold is in pixels, not frames.** Snapping engages when
the target is visually close, so it feels identical at every zoom. A
frame-based threshold would be unusably sticky zoomed out and useless zoomed in.

**2.5 — two coordinate spaces, and a gutter between them.** Positions inside
the scrolling strip must be _content_ coordinates measured from frame zero,
because the browser has already translated the strip; subtracting the scroll
offset again moved clips twice as far as the scrollbar. And content x zero is
not the strip's left edge — the sticky track headers occupy the first 128px, so
pointer positions need that gutter subtracted too. Both are now named
explicitly in the geometry (`frameToContentX` vs `frameToX`) with the
distinction documented, because getting it wrong is silent: everything still
renders, just in the wrong place.

**2.4 — the anchor invariant yields at frame zero.** Cursor-anchored zoom keeps
the frame under the pointer fixed, except when holding it would require
scrolling past the start of the timeline. There is nothing before frame zero to
show, so the view pins to the left edge instead. Asserted explicitly rather
than left as an unexplained gap in the property test.

---

### Testing notes

**2.6 — two Playwright harness traps, both of which looked like product bugs.**
Worth recording because each cost real time and each will recur:

1. _Vite HMR forks module instances._ After editing source without restarting
   the dev server, the app runs re-timestamped module URLs while a test's
   `import("/src/stores/…")` binds to the original — so the test reads a stale
   store and concludes the UI is not reactive. Restart the dev server before
   driving the app.
2. _Synthetic events need `composed: true`._ Panels live inside a web
   component's shadow DOM and Solid delegates from `document`. Without
   `composed: true` a dispatched event never crosses the boundary and the
   handler silently does not run.

Neither was a defect in the app. Both were initially diagnosed as one.

---

## Phase 3 — media engine

### Found

**3.1 — the frame-counter fixture could not survive its own codec.** The first
version of the test fixture encoded each frame's number in its fill colour and
read the RGB back. H.264 is lossy and 4:2:0, so exact channel values do not
survive a round trip — frame 3 decoded as 514. Six frame-accuracy tests failed
for that reason alone, none of them because the engine was wrong.

Replaced with a row of black and white blocks encoding the number in binary,
read by thresholding luma. Maximum contrast is precisely what a video codec
preserves best. Worth remembering generally: a fixture has to be robust to the
transformation under test, or it tests the fixture.

### Decided

**3.2 — decode per clip instance, demux per file.** Parsing a container and
building its sync-sample index is worth doing once per file; decoding is not
shareable, because two clips of one source sit at different timestamps. The old
code shared a single `<video>` element per file, so a split clip's two halves
fought over `currentTime` and the last seek won. Registry and decoder pool are
therefore keyed differently — by content key and by clip id respectively.

**3.3 — three ways to ask for a frame.** `getExact` waits and is the only one
that can be deterministic, so export uses it. `tryGet` never waits, which is
what lets the preview loop render at a steady rate and repeat a frame when the
decoder is behind — the old loop awaited mid-render, which is why concurrent
renders overlapped and corrupted shared GL state. A nearest-frame fallback
serves scrubbing, and reports `exact: false` so callers can tell.

**3.4 — frame leaks are counted, not hoped about.** `VideoFrame` holds memory
the garbage collector will not reclaim, and exhausting decoders fails silently
mid-edit. Every frame is refcounted and the create-minus-close tally is
asserted to be zero at the end of each browser test.

**3.5 — WebGL readback is empty from a later task.** The compositor's context
is created with `preserveDrawingBuffer: false`, so the default drawing buffer
is cleared as soon as the browser composites. Reading it back from any later
task returns black regardless of what was drawn — which twice looked like "the
preview is not rendering". The compositor tests read the _composite
framebuffer_ instead, which is not subject to that.

**3.6 — which way up the composite lands is still undecided.** The quad bakes a
V-flip and the GL read is bottom-up, so the frame-marker test accepts either
orientation for now. That is not a workaround so much as an honest admission:
the Y-flip accounting is the known defect the render graph rewrite settles
canonically, and pinning an orientation here would just encode today's
accident. Once it is fixed the test tightens to one orientation.

### Phase 3d

**3.10 — `MediaEntry.handle` was about to become a lie.** Relinking adopts a
file through the platform layer, which yields a `FileRef` rather than a
`FileSystemFileHandle` — and the first draft filled the field with
`undefined as unknown as FileSystemFileHandle`. That typechecks and crashes on
the first thumbnail. The entry now carries whichever it has and exposes
`entryFile()`; nothing reads `handle` directly.

**3.11 — relink is verified by content, not by name.** Candidates in a folder
are narrowed by name and size because hashing every file would read the whole
folder, but the content key is what decides. Pointing at a different recording
that happens to share a filename is reported rather than silently accepted —
which matters because the failure would otherwise appear much later as the
wrong footage in an export.

### Phase 3c

**3.7 — AAC decodes longer than it encodes.** A two-second fixture comes back
as ~2.07s of audio: AAC carries encoder priming and pads to a frame boundary.
Harmless here, because the offline render places clips by timeline position and
sizes the output from the timeline, so the overhang is never used — but it is
the kind of thing that silently becomes an A/V sync bug if a later encoder ever
derives duration from the decoded buffer instead.

**3.8 — one graph, two contexts.** `buildVoice` takes the context as a
parameter so live preview (`AudioContext`) and export (`OfflineAudioContext`)
run the same code. The old export had a completely separate mixdown path, and
then played it into a MediaRecorder in real time while video rendered at render
speed — it could not line up even in principle. Sharing the function is what
makes "what you hear is what you get" structural rather than aspirational.

**3.9 — no per-frame audio sync step, deliberately.** Every gain ramp and voice
start is scheduled at an absolute `AudioContext` time. There is nothing
anywhere that compares audio position to video position and corrects it,
because there is nothing to correct: a ramp scheduled at a time happens at that
time. The old code had drift correction at a 0.15s threshold precisely because
it had two clocks.

---

## Phase 4 — render graph

### Found

- **The Gaussian blur was one horizontal pass.** `u_direction` was declared,
  hidden from the UI, and defaulted to `[1, 0]`; nothing ever set it. Every
  "blur" in the app was a one-dimensional smear. The offsets were also in
  pixels (`i / u_resolution`), so the same radius meant a different amount of
  blur at preview resolution than at export resolution.
- **The predicted chroma-key ghosting does not exist.** The plan called for
  clearing ping-pong targets each pass because chroma key was expected to
  blend against stale buffer contents. It cannot: `gl.BLEND` is disabled
  graph-wide and every effect pass draws a full-coverage quad, so a pass
  overwrites the target completely. The clear was added anyway — it costs
  nothing and it matters the moment an effect uses `discard` or draws less
  than the whole frame — but it is insurance, not a fix, and the test beside
  it pins render idempotency rather than claiming to catch a ghost.
- **`Transform & Opacity` was still an "unbuilt" placeholder.** Phase 0
  replaced the six fake controls with an honest note; by Phase 4 the renderer
  supported all of them and the note had become the lie instead.
- **`clip-edits.ts` still carried hand-written undo inverses.** Snapshot undo
  landed in Phase 1, but `deleteSelectedClips` kept its `pushAction` pair, so
  deleting four clips pushed four broken entries beside the four correct
  snapshot entries. `EffectsPanel` did the same on add-effect. `pushAction` had
  already been reduced to a dev-warning no-op, so the damage was noise rather
  than corruption.
- **Nudge moved clips by one second.** `nudgeSelectedClips(-1)` took seconds;
  the shortcut is Shift+Arrow, which every NLE binds to one frame.

### Decided

- **One `ParamTarget` for clip properties and effect uniforms.** They are the
  same thing — an `Animatable` hanging off a clip — and they had two parallel
  APIs, one of which spoke seconds. Unifying them is what makes a single
  `ParamRow` able to drive twelve clip properties and every effect uniform,
  with the stopwatch, keyframe diamond, strip and easing picker on all of them
  rather than only on effects.
- **Setting a parameter writes a keyframe when the parameter is animated.**
  Otherwise the base value changes and nothing moves on screen, because the
  keys win. That branch is the only subtle thing in the whole parameter API,
  which is why the panel has exactly one setter rather than twelve.
- **Switching animation off freezes the value at the playhead** rather than
  reverting to the base value. Turning off the stopwatch should not move the
  picture.
- **Anchor is not animatable.** It defines what position, scale and rotation
  are relative to; animating the origin of a rotation is a way to confuse
  yourself, and no creator-tier editor offers it.
- **Blur radius is a fraction of frame height.** Resolution-independent by
  construction, so a blur set while previewing at half resolution is the same
  blur in a full-resolution export. The horizontal pass corrects for aspect so
  the result is round rather than stretched.
- **The Y-flip happens once, at texture upload**, via
  `UNPACK_FLIP_Y_WEBGL` — not the plan's "flip twice, once at upload and once
  at final blit". One flip in one place is simpler to reason about and easier
  to prove; the compositor browser test pins a single orientation, closing P20.

### The compatibility projection is nearly gone

§1.7 recorded `projectState` as a deliberate temporary: a seconds-based,
`mediaId`-keyed projection of the document, so the Phase 1 model rewrite did
not have to land at the same time as rewriting 111 read sites across 14 files.

It now has **one** consumer left: `renderer/export-engine.ts`, which Phase 5
deletes outright. Migrating it first would be work thrown away, so instead
`test/unit/no-compat-projection.test.ts` holds an exemption list of exactly two
files and fails if any other file reads the projection. When the list can be
emptied, the projection and that test go together.

---

## Phase 5 — deterministic export

### Found

- **`sanitise("///")` produced `_.mp4`.** Exactly the bug fixed in Phase 1 for
  `projectFileName`, written again from scratch in the new exporter, and caught
  by a test copied from the same instinct. The two now share `safeFileStem`.
- **Export was using the editor's decoder pool.** The engine's own comment said
  export should create its own with a smaller budget so a background export
  cannot starve the editor — and it did not. Fixed, and it is what makes the
  leak assertion meaningful: export disposes its decoders when it finishes, so
  `openFrameCount()` is zero the moment it returns rather than "eventually,
  after the caches are dropped".

### Decided

- **The frame rate is not an export setting.** It comes from the sequence. The
  old dialog offered 24/30/60 regardless of the timeline, which means
  resampling, which nothing implemented. The dialog shows the rate instead of
  asking for it.
- **Containers are probed with the real encoder, at the real resolution.** A
  codec that encodes 1080p can fail at 4K on the same machine, so the question
  is asked per combination and re-asked whenever the size changes. A container
  with no usable codec is shown disabled with the reason rather than silently
  substituted — which is how a WebM file ended up named `.mp4`.
- **Timestamps are exact rational arithmetic.** `frame × den / num` in a
  double, not accumulated float seconds. Over any timeline anyone will build
  the error stays far below a microsecond, so the value the muxer stores is
  exact. The 29.97 case is tested specifically, since that is where accumulated
  float error shows up first.
- **Positioned writes, not append-only.** MP4 patches its header once the sizes
  are known, so streaming to disk needs seeking. `platform.fs.createWritable`
  returns a `WritableStream<PositionedChunk>` — the shape
  `FileSystemWritableFileStream` already accepts — and the test reassembles a
  sparse file from the chunks and demuxes it, because an append-only sink would
  produce a corrupt file that still looks plausible.
- **Export awaits every frame; preview never does.** The two schedulers now
  differ in exactly one place, a `FrameLookup` hook on `renderFrame`.
  Everything else — scene building, compositing, effects, transitions — is
  literally the same code, so the preview cannot drift from the file.

### The compatibility projection is gone

Deleting `renderer/export-engine.ts` removed the last reader, so `projectState`
and the whole seconds-shaped shadow model went with it, along with the
seconds-based keyframe API (`addKeyframe`/`updateKeyframe`/`removeAllKeyframes`
/`getEffectValueAtTime`/`interpolateKeyframes`) and a handful of other compat
helpers that no longer had callers. §1.7 is closed, and
`test/unit/no-compat-projection.test.ts` — the ratchet that kept it from
growing new readers — has been deleted along with the thing it guarded.

What remains from that era is a dozen seconds-based operations in the project
store. They are thin wrappers onto frame-based edits rather than a parallel
model, and they are what the timeline panel still calls; they go when it is
rewritten.

### Deferred

- **The media engine does not run in a worker.** The plan listed it under this
  phase. It is a responsiveness improvement, not a correctness one — the
  facade is already async precisely so this can be a transport swap — and none
  of the phase's exit criteria depend on it.

---

## Phase 6 — editing depth

### Found

- **Ripple-extending an edge silently did nothing.** The plain trim refuses to
  cross its neighbour, which is exactly what a ripple is supposed to push out
  of the way. The neighbour clamp is now optional and lifted only for ripple.
- **`cloneClip` reused the effect and keyframe ids of the clip it copied.** A
  pasted or split clip therefore shared ids with its original. Nothing looks
  those up across clips today, which is why it was invisible — and why the
  first feature that does would have been the one to find it. Every nested id
  is minted fresh now.
- **`moveClip` compared tracks by identity.** `track()` returns a fresh
  mutative draft proxy on each call, so a same-track move passed explicitly as
  `toTrackId` compared unequal and took the _cross-track_ path — removing the
  clip from one proxy of the array and pushing it onto another. Whichever write
  landed second won, and three clips became one. Compared by id now.
- **Moving a group by looping over `moveClip` scatters it.** Each move sees the
  others still in place and shoves itself past them, so dragging three butted
  clips one frame right pushed them apart. `moveClips` detaches the whole set
  first, so each clip is placed against what is _staying_.
- **Marker and caption rows lost focus on every keystroke.** Structural sharing
  means every edit produces a new object, and Solid's `For` compares by
  reference, so the row was rebuilt mid-word and took the caret with it. Both
  lists iterate stable ids now, and the test asserts the input element survives
  the edit rather than checking the text.
- **Nudge moved clips by one second.** Shift+Arrow is one frame in every NLE.
- **`clip-edits.ts` and `EffectsPanel` still pushed hand-written undo
  inverses** beside the snapshot history, left over from Phase 1.

### Decided

- **Grab target, not tool, decides which edge edit happens.** Select trims,
  Select+Alt ripples, the Trim tool rolls, and slip and slide are grabs of the
  clip body. Four operations on one handle beats four handles.
- **Slip, slide and roll get absolute forms.** A live drag reports its _total_
  offset and applies an edit on every pointer move, so a relative operation
  would accumulate — a ten-frame drag becoming fifty-five frames of edit.
- **Selection is decided on pointer-up, not pointer-down.** Clicking an
  already-selected clip narrows the selection to it; _dragging_ one moves the
  whole group. On pointer-down there is no way to tell which is happening.
- **Captions are a list on the document, not clips on a track.** A caption has
  no in-point, no speed and nothing to trim against, and importing an hour of
  dialogue would otherwise mint two thousand clips each carrying a transform, a
  crop and an effects chain it will never use.
- **Recovery is quiet.** A normal reload silently restores the newest autosave;
  the dialog appears only after a crash _and_ only when there is an older
  revision to choose. Prompting every launch is how people learn to dismiss the
  dialog that matters.
- **No pitch-preservation toggle on retime.** `AudioBufferSourceNode.playbackRate`
  resamples and has no `preservesPitch` — that is an `HTMLMediaElement`
  property. Keeping pitch needs a time-stretcher, which is not built, so the
  panel says the audio is pitched rather than offering a checkbox that lies.
  Listed under open items.

### Testing notes

- **Browser-mode tests load no stylesheet.** Tailwind's `absolute` never
  applies, so every element measures at the origin. The drag tests were
  unaffected because they use only _relative_ motion; a positional assertion
  has to read the inline offset instead.
- **`openFrameCount()` counts created-minus-closed, not borrowed-minus-released.**
  A cached frame is legitimately open. Asserting zero is only meaningful once
  whatever owns the cache has been disposed — which is what led to export
  getting its own decoder pool, as its own comment had said it should.

---

## The preview panel

### Found

- **The preview was black until you pressed play.** The scheduler only called
  `primeFrames` while playing, and the render pass uses `tryGet`, which never
  waits. So nothing ever decoded the frame under a stationary playhead: drop a
  clip on the timeline, look at the preview, see nothing. Every renderer test
  missed it because they all warm the cache by awaiting `getExact` themselves
  first — the one step the application does not do.
- **The preview did not follow the playhead.** It rendered `clock.nowFrame()`,
  but eight UI call sites — timeline scrub, marker list, caption list, keyframe
  navigation, source-monitor edits — move the playhead through the _store_ and
  never touch the clock. Scrubbing moved the playhead and left the picture
  where it was.
- **Playback restarted from wherever the clock was last anchored**, usually
  frame 0. Scrub to the middle, press play, jump back to the start.
- **The panel built its compositor at the sequence size and resized it after**,
  so a 4K project allocated a full set of 4K render targets on mount and threw
  them away a moment later.

### Decided

- **While paused, the store's playhead is the authority; while playing, the
  clock is.** Audio stays master during playback, which is the whole point of
  the clock, but a stationary playhead is wherever the UI put it.
- **A paused frame settles asynchronously.** `settleFrame` awaits everything
  the scene asks for and then marks the preview dirty. A token guards against a
  slow decode landing after the playhead has moved on and marking a stale frame
  ready — a scrub is a stream of positions, not one.
- **The clock adopts the playhead synchronously**, before the audio context is
  awaited. Doing it inside the `then` made the clock's position depend on
  whether `resume()` ever settles; in a headless browser it does not, which is
  how the test found it.
- **Which clips a frame needs comes from the scene, not from `clipAt` per
  track.** Mid-transition both sides are on screen and one is read from outside
  its own span, which the per-track version missed.

### Testing note

Do not read the preview canvas. The drawing buffer is created with
`preserveDrawingBuffer: false` and is cleared as soon as the browser
composites, so reading it from a later task returns black whatever was drawn —
these tests measured exactly that and "confirmed" a bug that was partly their
own. Read the composite framebuffer, as the compositor tests already did.

---

## Reviewing the plan against the code (after Phase 6)

### Found

- **Four specified items were never built, never recorded, and therefore read
  as done.** Not one of them was a decision to skip something; each was work
  that fell out of a phase whose other parts landed, and the phase was reported
  complete. They are listed with their remedies in
  [`plan.md`](plan.md#carried-forward): the timeline decoration generators
  (Phase 2), any worker at all (Phases 2 and 5), the preview quality ladder
  (Phase 4), and the golden-frame and E2E test tiers.

  The one that matters in use is the first: `lib/waveform.ts` still produces a
  fixed 200 peaks per file, so a bar is 18 seconds on an hour-long recording —
  the exact defect Phase 2 set out to remove — and `lib/clip-thumbnails.ts`
  still makes a `<video>` element per file, which is what Phase 3 deleted
  `frame-source.ts` to stop doing. That path survived the cull because nothing
  pointed at it.

- **`docs/architecture.md` had drifted badly enough to mislead.** It marked
  eight built systems "planned" and described `frame-source.ts` and
  `export-engine.ts` in the present tense, months after both were deleted. A
  document that is wrong about what exists is worse than no document, because
  it is consulted instead of the code.

### Decided

- **A phase is not complete until its gaps are written down.** The failure here
  was not skipping work — some of it was reasonable to defer — but skipping it
  silently, so nothing distinguished "deferred" from "done". Anything a phase
  specifies and does not deliver goes in this file before that phase is
  reported finished.
- **Architecture notes carry `**Not built:**` markers** where the design is
  settled and the code is not, so the two states are distinguishable at a
  glance rather than by reading the source.
- **One copy of the plan.** It lives at `docs/plan.md`; the plan-mode file is a
  pointer to it. Two copies drift, and the one outside the repository drifts
  faster because nothing reviews it.

---

## A rule the preview bug earned

A test whose setup performs a step the application must also perform is not
testing the application.

Every renderer test warmed the decoder cache by awaiting `getExact` before
rendering. That is the one thing the app did not do, so the preview could be
black on every launch with the whole suite green — the compositor was proven
correct and nothing was proven to ask it for anything. The suites were built
outward from the units, and the seam between them was the gap.

The remedy was cheap and is built: `test/browser/preview.test.tsx` mounts the
real panel, starts the real scheduler and scrubs the way the timeline does, and
`test/browser/timeline-decorations.test.tsx` does the same for the two clip
decorations — a clip on a real lane, and a wait for a picture to turn up. Neither
primes anything. Not more coverage — coverage was fine — but coverage of the join.

The same shape is worth watching for elsewhere. Any place a test constructs
state the app is responsible for constructing is a place a whole feature can be
missing without a red test.

---

## Phase 8a — the carried-forward decoration work

The four items the post-Phase-6 review found unbuilt and unrecorded. Three are
now done; the fourth is a judgement written down rather than a thing built.

### Found

- **The old waveform read the file twice over, in the worst possible way.**
  `decodeAudioData` on the whole file to produce 200 numbers: an hour of 48kHz
  stereo is 1.4 GB of resident float, held to draw a 200-pixel strip. Streaming
  the same data through `AudioSampleSink` costs the peaks and nothing else. The
  fixed count was the visible defect; the whole-file decode was the expensive one
  and nobody had noticed it, because nobody had imported an hour-long file.

- **`OfflineAudioContext` does not exist in a worker**, which decided the design
  rather than being an obstacle to it. The old generator used one for its
  `decodeAudioData`, and the natural port would have been to keep it and move the
  file — which cannot work. Peaks are computed from raw interleaved floats
  instead, which is also exactly what a pyramid wants, so the constraint improved
  the code.

- **`CanvasSink` yields an `HTMLCanvasElement` in a DOM context and an
  `OffscreenCanvas` elsewhere**, and only one of the two can encode itself.
  `posterFrame` typechecked with a cast and would have thrown on the first real
  import; it now copies into a canvas of its own.

- **A fire-and-forget cache write is a race a test cannot see.** The first draft
  of both generators wrote to OPFS without awaiting, on the reasoning that a
  background job should not block on disk. The consequence is that a caller
  cannot be told the result is cached, so the "second launch reads from disk"
  test failed against a real cache that simply had not finished writing. Both
  writes are awaited now — the job is already off the critical path, and a cache
  whose write completion is unobservable cannot be tested at all.

- **The join was where the feature could have gone missing again.** The generators
  had ten passing tests before anything checked that a clip on a timeline ever
  asked for one — the exact shape of the preview bug. The first version of that
  join test then passed for the wrong reason: its teardown cleared the media pool
  and its setup did not restore it, so the second case requested a decoration for
  a media id the pool had never heard of, got nothing, and would have failed —
  except it was reading the first case's result. Written down because "the test
  that guards against tests proving the wrong thing proved the wrong thing" is
  the kind of irony that recurs.

### Decided

- **Peaks are min/max byte pairs over 128-sample buckets.** Min and max rather
  than one mirrored magnitude, because an asymmetric signal's envelope is not
  symmetric and mirroring draws a waveform that does not match the sound. Bytes
  rather than floats because eight bits of amplitude across a twenty-pixel lane
  is already finer than the display. 128 samples is 2.7 ms at 48kHz, which is
  finer than a pixel column everywhere except the very top zoom stop, where one
  bucket spans about 1.6 px. The whole pyramid is at most twice its base, so an
  hour costs about 5.4 MB.

- **A query reads every bucket it overlaps, so a zoomed-out envelope can be a
  fraction of a column wide.** The chosen level's buckets are at most one column
  across, and column edges do not align with bucket edges, so a lone transient
  can light the neighbouring column at low zoom. The envelope is therefore never
  understated and occasionally a pixel generous — the right direction for a
  waveform, and the reason the browser test asserts on twenty columns rather than
  two.

- **The base level is the only thing serialised.** Halving on load is cheaper
  than storing what halving produces, and it means a cache entry cannot disagree
  with itself. One buffer with a magic and a version, so an entry is whole or
  absent; anything unrecognised is a miss rather than an error.

- **A worker for the waveform, and explicitly not for the media engine.** The
  plan asked for the worker question to be decided on a measurement rather than
  on principle, and the measurement is which part is actually JS. Peak analysis
  is hundreds of millions of samples of arithmetic on the main thread — the
  longest single block of work in the app. Video decode is not: `VideoDecoder`
  already runs in the browser's media process, so moving the engine would marshal
  `VideoFrame`s across a boundary on the preview's hot path to relocate the thin
  JS around it. The facade's async shape stays as insurance against that
  judgement changing; it is not a plan, and §Phase 5's "deferred" note should be
  read as closed rather than pending.

- **Filmstrips are one single-row sheet per file, capped at 120 tiles.** One
  image, one decode pass over sorted timestamps, one texture however many tiles a
  clip draws. A single row keeps tile indexing to one axis, and the cap keeps the
  sheet under Chrome's 16384 px canvas limit — a sheet that fails to allocate
  would be a decoration silently missing on exactly the longest files. The cost:
  on an hour-long file a tile is 30 seconds, so at high zoom consecutive tiles
  repeat. Unbounded tiles would mean unbounded decode for a decoration.

- **Both decorations are indexed by source time, not timeline position.** This is
  what makes them follow a trim, a slip and a speed change with nothing
  regenerated — the old waveform was stretched across the clip's width, so
  trimming stretched the waveform instead of revealing a different part of it.
  Past the end of the media, peaks read as silence and tiles hold the last frame:
  a clip overrunning its source should look like what it is, and a repeated last
  peak or a wrapped first tile would hide it.

- **Which decoration a clip gets is decided by its track, not by what happens to
  be cached.** Reading whichever cache had something would make a video clip
  sprout a waveform if — and only if — a copy of the same asset were also sitting
  on an audio track, which is behaviour nobody chose. The cost of the rule: a
  video clip shows no waveform, though several editors do overlay one. Doing that
  properly means analysing audio for every video clip, which is a scope decision
  rather than a wiring one.

- **The quality ladder watches the frame interval, not just the render call.**
  Scaling render targets buys GPU fill rate, and GPU time is invisible to
  `performance.now()` around a GL call — the calls return promptly and the next
  animation frame arrives late instead. A ladder measuring only `renderMs` would
  never engage on the case it exists for. Both signals are consulted, and there
  is a test for the GPU-bound shape specifically.

- **Rungs are fractions of the preview's base size, not of the sequence.** The
  plan described a preview rendering a 4K project at 4K; the preview fix had
  already made that half, so a ladder topping out at 1/1 of the sequence would
  have reintroduced the full-size allocation the preview fix removed. The panel
  owns the base and the canvas; the scheduler owns the rung and every call to
  `resizeCompositor`. Two owners of the render-target size would fight each
  frame, one restoring what the other shrank.

- **Frames in between are neither a strike nor credit.** A frame at three
  quarters of the budget does not drop a rung, and — the part that matters —
  does not count toward climbing one. Counting it as credit is what walks a
  ladder up into a stutter and straight back down, which is the shimmer that
  makes adaptive resolution read as a rendering bug.

- **The last `<video>` element used for decoding is gone.** `clip-thumbnails.ts`
  was the file the review named, but `fs-access.generateVideoThumbnail` was the
  same pre-rewrite path serving the media pool, and leaving it would have carried
  it into the desktop build. `posterFrame` replaces it from one decoded frame.
  The `<img>`-based still thumbnail stays: no demuxer reads a JPEG, and an
  `<img>` is not a decoder. A browser test counts `<video>` elements after
  generating both decorations, so a regression has somewhere to fail.

- **Golden-image diffing stays unbuilt, and its dependencies are gone.**
  `pixelmatch`, `pngjs` and `@types/pngjs` are removed. Reference images would
  have to be regenerated on every GPU and driver the suite runs on, whereas "the
  pixel above the plate is lit after the blur" survives that and reads as an
  assertion about the feature. Where a probe will not do, the material carries
  the assertion instead: the fixtures burn in a frame counter, so "the filmstrip
  shows successive frames" is a strictly increasing sequence of decoded numbers.

### Deferred, and said so

- **The preview base does not track the panel size.** A 4K project previews at
  1920×1080 render targets presented into a canvas that may be 600 px wide, which
  is wasted fill rate the ladder only reaches under load. Capping the base by the
  displayed size is the obvious refinement; it was left alone because the existing
  comment argues against reallocating on every splitter drag, and that trade-off
  deserves a measurement rather than a guess.
- **Nothing surfaces the current rung.** The scheduler returns it, and the debug
  HUD that would show it is still a Phase 8 item.
- **CI perf budgets are still not written.** Scene build under 2 ms at 1000
  clips, preview frame under 16 ms at half resolution. Unstarted.
- **A Playwright E2E tier is still absent**, and remains the right call for
  everything except the OS file picker.

---

## Phase 8b — hardening

The rest of Phase 8: the budgets, the HUD, the preview base, the keyboard, and
the reference sheet. Four of the five items were things already being measured
or already known and simply not reachable.

### Found

- **The browser test job had never been able to fail.** `pnpm test:browser`
  printed "160 passed" and exited 1, on every run, on every machine, at every
  commit. Vitest resolves an environment package before it runs anything, the
  browser config named none, the default is `jsdom`, and jsdom is not installed —
  so the run set `process.exitCode = 1` and then went ahead and passed. A job
  that always fails is indistinguishable from a job nobody looks at, and the
  whole of Phase 8's "CI-enforced" work would have been enforced by it. Naming
  `environment: "node"` explicitly fixes it; the environment is ignored in
  browser mode, it just has to be resolvable.

- **A splitter drag rebuilt the entire panel tree on every `mousemove`.** The
  resize handler updated the layout node and called `_render()`, which tears down
  the shadow tree and reappends every panel. It was survivable only because panel
  elements are cached and reappending one keeps its state. It also made keyboard
  resizing impossible before it was attempted: the first arrow key destroyed the
  divider that had focus, so the second went nowhere. Sizes are now written
  straight onto the cells.

- **The tab bar existed twice.** `_buildTabs` and `_buildPanel` had separate
  copies of tab construction, and they had already drifted — the single-panel
  copy never set `data-tab-index`, so anything keyed off it worked in a tab group
  and not on a lone panel. Merged into one builder, which is also what let the
  ARIA wiring be written once.

- **`App` did not register the custom elements it renders.** Its import of
  `VePanelLayout` is used only in type position, so it was elided, and the panel
  layout element was upgraded only because `index.tsx` happened to import the
  module first. Mounting `App` anywhere else — a test, a future embed — produced
  a `<ve-panel-layout>` with no methods. Found by writing the first test that
  mounts the whole app, which is also the first thing that would have caught a
  mistake in the menu wiring.

- **The shortcut sheet was wrong, not merely incomplete.** It described J and L
  as five-second jumps long after they became shuttle controls, and omitted
  markers, three-point editing, zoom-to-fit, Escape, and the text tool. The Help
  menu advertised `?` for it, and `?` was not bound to anything: the chord matcher
  compares modifiers, and the event for "?" carries Shift, so a spec of `?` can
  never match. It is written `Shift+?` now.

- **`⌫` was printed for both Delete and Backspace**, which made the two bindings
  of one action read as the same shortcut listed twice. They are `⌦` and `⌫` on
  macOS and the words elsewhere, because Mac glyphs on a Windows keyboard are a
  puzzle rather than a reference.

- **The dialogs were a `div` with a click handler.** Three of them — the shortcut
  sheet, About, and the notes from opening an older project. No role, so nothing
  was announced; no Escape, so the only way out was the ✕; and focus stayed
  behind the backdrop, which is how a keyboard user ends up typing into a panel
  they cannot see.

### Decided

- **The budget is the median, and the numbers are printed on every run.** A
  single sample catches a garbage collection and calls it a regression, and a
  budget that only speaks when it breaks says nothing about the run that was at
  95% of it. `[perf]` lines are logged pass or fail.

- **`gl.finish()` is inside the measured region of the preview frame budget.**
  Without it the measurement is submission time, which is the same trap the
  quality ladder needed a second signal to escape: GL calls return promptly and
  the GPU finishes whenever it finishes. A budget measuring submission would sit
  at a comfortable 1 ms while the preview stuttered.

- **One allowance knob, set in CI, rather than two budgets.**
  `VITE_PERF_ALLOWANCE` multiplies every budget, so a local run measures the real
  one and CI measures a relaxed one in a single documented place. CI runners have
  no GPU, so the browser budget there is measured against software
  rasterization — worth an order-of-magnitude check and not a tight one. The
  starting values (3 for Node, 5 for the browser job) are provisional: the logged
  numbers from the first real runs are what should set them.

- **The perf fixture asserts it is not empty.** A budget met by a document that
  turned out to have no clips in it is worse than no budget, because it reports
  success. One test builds the 1000-clip timeline and checks the scene it
  produces before any timing is taken.

- **A second, absolute-number-free budget: the build must not get slower further
  along the timeline.** The regression actually worth catching is a linear scan
  creeping back into the scene builder, and a ratio between the start and the end
  of a long timeline catches that whatever the machine's absolute speed.

- **The preview base is chosen from a discrete ladder of the sequence, with a
  dead band.** The deferred note above asked for a measurement rather than a
  guess; the answer is that the objection — reallocating on every splitter drag —
  is an argument against a _continuous_ base, not against any base. Three steps
  (1/2, 1/4, 1/8 of the sequence, capped at half) and a 5% dead band mean a drag
  crosses a threshold at most once and jitter across one crosses it never. A test
  wiggles the panel across a step fifty times and asserts the base does not move.

- **The canvas is sized by CSS and the buffer fitted inside it.** It had
  `max-w-full`, so its layout size came from its own drawing buffer — which meant
  a smaller buffer drew a smaller picture, and, once the buffer started following
  the panel, would have shrunk itself away one step per frame. The base is
  measured from the container for the same reason.

- **The HUD is polled at 4 Hz, not made reactive.** These counters change on the
  render loop's schedule; driving Solid's reactivity from a 60 Hz loop to update
  text nobody is reading closely would cost more than the thing it measures. Fast
  enough to watch a leak climb, slow enough to read.

- **Dropped frames are counted, not derived.** At 60 Hz on a 30 fps sequence the
  loop legitimately draws the same frame twice, and at 30 Hz on a 60 fps sequence
  it legitimately cannot draw them all; neither is a dropped frame. What the HUD
  shows is sequence frames the playhead passed over with nothing drawn, and only
  while playing — counting a scrub would make the number a measure of how much
  the user moved the mouse.

- **`Shift+D` for the HUD, a plain letter like the tools.** Every modifier
  combination a HUD toggle would naturally want is taken by the browser or the
  window manager, and a shortcut the page cannot receive is worse than none.

- **Tabs get a roving tabindex; the close ✕ is hidden from assistive
  technology.** One tab stop for a whole bar, arrow keys within it — otherwise
  moving past the layout costs one press per panel in the app. The ✕ sits inside
  the tab's own button, where announcing it would read as part of the panel's
  name, so Delete on the focused tab is the keyboard path and it is listed in the
  reference sheet.

- **Activation follows focus in the tab bars.** Correct here because switching
  tabs only changes which panel is shown and costs nothing; it would be the wrong
  choice if switching loaded something.

- **The shortcut sheet is generated from the registry, and merges by function
  identity.** Two bindings for one action are one line — merged on the `run`
  reference, which is exact, rather than on the label, which would be a guess.
  The one hand-written section is the panel layout's own keys, which are handled
  by the tablists and separators rather than by commands; a keyboard user still
  needs to be told they exist.

- **Onboarding is six steps in a dialog, not a tour.** The app opens on an empty
  timeline and a black preview and nothing on screen says how to get material in.
  Six lines fixes that. Anything longer belongs in `docs/`, which it points at.

### Deferred, and said so

- **Panel focus does not cycle.** There is no F6-style "move to the next panel
  region" key. Tab reaches each tab bar and each panel body, which is a real path
  through the layout, but it is not a fast one in a twelve-panel workspace.
  _Resolved in Phase 8c: `F6` and `⇧+F6`._
- **The Kobalte dialog primitive is still unused.** `@kobalte/core` is a
  dependency and its `Dialog` would have brought the focus trap, the roles and
  the escape handling for free; the overlays got a small hand-written version
  instead, because converting the three existing ones plus the export and relink
  dialogs is its own change. _Resolved in Phase 8c, in the other direction: the
  remaining dialogs were converted to `Overlay` and the unused dependency was
  removed._
- **The perf allowances are guesses until CI has run once.** Deliberately
  logged rather than silent, so the first real numbers arrive without anyone
  having to go looking for them.

---

## Phase 8c — clearing the open items

The four items that had been carried as "open" or "deferred and said so" and did
not need the desktop shell underneath them. Going after the smallest one first
turned up the largest defect in the project's history.

### Found

- **No imported file was ever opened in the media engine, so no clip could
  decode.** The engine keeps a registry of demuxers, keyed by content key;
  `DecoderPool.acquire` looks the asset up there and returns `null` if it is
  absent, at which point `tryGet`, `getExact` and `prefetch` all return null and
  the clip renders as nothing. The only call that ever populated that registry
  in application code was in `relink.ts` — the _repair_ path. Import did not,
  restore-after-reload did not, and the permission re-grant did not.

  So: import a file, drop it on the timeline, and the preview is black. Forever.
  The single most basic thing the application does.

  Three things hid it, and each is worth naming because each is a general trap:

  1. **The tests primed the very step the app omitted.** Every media test opens
     with `mediaEngine.openBlob(ASSET_ID, blob)` in its setup. `preview.test.tsx`
     was written specifically to avoid this class of mistake — its docblock says
     so, and it does not prime the frame _cache_ — but it still handed the engine
     the blob itself, because there was no other way to get an asset in without
     an OS file picker. It tested everything downstream of the missing step.
  2. **The decorations still worked.** Waveforms, filmstrips and poster frames
     open their own throwaway `Input` rather than going through the registry, so
     a clip that could not decode a single frame for the preview still drew a
     correct thumbnail and a correct waveform on the timeline. The symptom read
     as "the preview is broken", never as "the file was never opened".
  3. **The problem reporter could not report it.** `media-problems.ts` classifies
     an asset as offline only when it is absent from the pool. An imported file
     is in the pool, has no registered probe to carry a problem, and is not
     awaiting permission — so it produced no `MediaProblem`, the relink dialog
     listed nothing, and the one code path that _would_ have registered the
     asset was unreachable for exactly the assets that needed it.

  The fix is one call in one place — `mediaEngine.openBlob` in the media store's
  ingest step — and the test that pins it, `test/browser/media-import.test.ts`,
  goes in through `importFileHandle` with a stub `FileSystemFileHandle` and
  primes nothing. It failed on three assertions before the fix.

- **`hasAudio` was false for every file with audio.** The `<video>`-element
  sniffer tried `mozHasAudio`, then `webkitAudioDecodedByteCount > 0`. Chromium
  defines the second and leaves it at `0` until something has actually played, so
  the check ran, answered "no", and never reached the "assume yes" fallback the
  code was written around. A fixture encoded _with_ a tone imported as silent.
  This was the item on the list — "two sources of truth" — but it was not the
  harmless duplication it had been recorded as; the second source was simply
  wrong.

- **Three dialogs were never converted to `Overlay`.** Export, relink and
  recovery were still a `div` over a backdrop: no `role`, no `aria-modal`,
  no Escape, no focus trap, no focus restore. `Overlay` was written in Phase 8b
  to fix exactly this and three of the six dialogs were left behind — which is
  the failure mode a shared component is supposed to prevent, and does not, if
  adopting it is a separate step nobody schedules.

### Decided

- **The import path registers with the engine, and the probe is the only source
  of truth.** `describeThroughEngine` opens the file and reads duration,
  dimensions, audio presence and decodability off one `ProbeResult`.
  `getVideoMetadata` and `getAudioDuration` are deleted. Registering at import
  rather than at first decode is the right seam because the demuxer is wanted
  either way and the answer to "what is in this file" is a by-product of opening
  it — one step, not two that can disagree.

- **Registration goes through `openBlob`, not a `FileRef`.** The store reaches an
  entry's bytes through `entryFile`, which returns a `File` for a handle-backed
  entry and a `Blob` for a relinked one; `createBlobSource` reads ranges with
  `blob.slice`, which for a handle-backed `File` is lazy disk access, not memory.
  The alternative — exporting a handle-to-`FileRef` conversion through the
  platform index — would have put `FileSystemFileHandle` in the platform's public
  surface, which is the one thing that seam exists to prevent, and Phase 7 would
  have had to unpick it.

- **Import, restore and re-grant share one `ingest`.** They had two identical
  copies of the metadata block and would have needed a third. That the copies
  were identical is the only reason the missing registration was one bug rather
  than three subtly different ones.

- **The extension guess survives, but only as a stand-in.** `getDecodeSupport`
  still labels a `.mkv` before the probe returns, because the entry is droppable
  on the timeline in that gap. Once probed, the probe's answer replaces it —
  `probed` on the entry distinguishes "nothing wrong" from "not asked yet".

- **A hover-switch across the menu bar is one gesture, not two.** The click that
  lands at the end of it used to hit the same toggle as an opening click, find
  the menu already open, and close it. The bar now remembers that hover opened
  this menu and lets that click through; a genuine second click on a trigger
  still closes. Pinned by a test that fails on the old code.

- **`F6` cycles panel regions, and it is a command rather than a layout key.**
  The other layout keys are handlers on the element and only work with focus
  already inside it; this one has to work from the menu bar too. It lives in
  `web-components/panel-focus.ts`, deliberately apart from the element module:
  importing the element into the command registry evaluates a class extending
  `HTMLElement` and takes every Node unit test down with it. The registry must
  stay loadable without a DOM — it is what the shortcut sheet is generated from.

  On a Mac laptop `F6` may need `Fn`. Recorded in the keyboard reference rather
  than worked around, because a non-standard chord would cost every other
  platform the convention, and `F6` is what a screen-reader user tries first.

- **The dialogs were converted to `Overlay`; Kobalte was removed instead of
  adopted.** The deferred item read "the Kobalte dialog primitive is still
  unused", and the honest resolution turned out to be the other direction: the
  roles, the trap, the Escape handling and the focus restore are all written and
  now tested, six dialogs share them, and `@kobalte/core` was a dependency with
  zero imports implying a design that was not there. Removed, along with
  `class-variance-authority` and `lucide-solid`, which had none either — the same
  call made for `pixelmatch` and `pngjs` in Phase 8a, for the same reason.

- **`Overlay` gained one flag rather than three.** `closeDisabled` blocks Escape,
  the backdrop and the ✕ together, for the export dialog mid-render. Blocking
  them separately is how you end up with a dialog that ignores Escape while still
  showing an enabled close button, which is a control that lies.

### Deferred, and said so

- **Nothing verifies that a _new_ dialog uses `Overlay`.** Six do, and the tests
  assert on the six. A seventh built as a bare `div` would pass everything. A
  lint rule could catch it; the taste question of what counts as a dialog is why
  there is not one yet.
- **The import path re-demuxes for decorations.** The poster frame, the filmstrip
  and the waveform each open their own `Input` over the same bytes the registry
  has now already opened. Cheap relative to decoding and it keeps the waveform
  worker independent of the registry, but it is three demuxes where one would do.

---

## The preview, a third time — low resolution and flicker

Reported as "showing something now, but very low res and flickering black".
Both halves were real, both were in code the tests covered, and neither could
have been found by reading a green suite. They were found by driving the running
app in Playwright and reading the debug HUD while it played.

### Found

- **Every 24 and 30 fps timeline previewed at an eighth of its resolution, on
  any machine.** The quality ladder's two signals — time inside the render call,
  and the gap between rendered frames — were both measured against
  `FRAME_BUDGET_MS`, one frame of the _display_. That is right for the render
  call and a category error for the gap: the loop draws only when the sequence
  frame under the playhead changes, so on a 30 fps timeline consecutive renders
  are 33 ms apart **by design**. Against a 16.7 ms budget, `tooSlow`
  (`interval > budget × 1.5` = 25 ms) was true on literally every frame, and
  `comfortable` (`interval < budget × 1.2` = 20 ms) was unreachable, so the
  ladder fell three rungs within a third of a second of pressing play and could
  never climb back.

  Measured on an idle machine, a 1080p sequence: paused, `960×540 · full` at
  5.5 ms per render; 400 ms into playback, `240×135 · 1/4` at 6.7 ms per render.
  The renderer was using a third of its budget the whole time. Only a sequence
  running at exactly the refresh rate escaped, which is why a 60 fps fixture
  would have hidden it.

  The interval now has its own budget, `expectedIntervalMs(sequenceFps)`, floored
  at the display frame. The unit tests that already existed all passed before and
  after, because every one of them supplied a `FrameCost` by hand — the defect
  was in what the scheduler _fed_ the ladder, not in the ladder's arithmetic.

- **A frame the decoder had not caught up with was presented as a black frame.**
  `composeFrame` cleared the accumulator up front and called `present`
  unconditionally, so a pass where every layer resolved to null presented a hole.
  `renderLayer` returning false was documented as letting the caller "leave the
  accumulator untouched rather than compositing a hole over it" — but untouched
  already meant cleared, so for a single-layer scene the protection was
  illusory. Every such pass was a black flash on screen.

  It is not reachable by scrubbing _forwards_, which is why it survived: the
  nearest-earlier fallback in `tryGet` finds a cached frame from behind the
  playhead and stands in. Jumping **backwards** past everything in the cache
  leaves it with nothing to return, and that is when the picture drops out.

  The clear is now deferred to the first layer that actually draws, so a pass
  with nothing ready leaves the previous picture on screen. `composeFrame` and
  `renderFrame` return whether the presented picture is this frame's.

### Decided

- **A late frame holds; an empty scene clears.** These look like the same
  "nothing drew" case and are opposites. A gap in the timeline is legitimately
  black, and holding the previous clip's last frame across it would be a worse
  bug than the flicker being fixed — so `scene.nodes.length === 0` is the one
  path that still clears, and it is the only thing distinguishing the two.

- **A held pass is not fed to the ladder, and is not recorded as rendered.**
  It did no work, so its render time is meaningless — feeding it in would read a
  stalled decoder as a fast GPU and climb the ladder for the wrong reason. And
  `lastRenderedFrame` stays where it was, so the loop's "nothing can have
  changed" early return does not skip the frame that is still owed.

- **The HUD gained a `held` row.** The counter existed as soon as the render pass
  returned a verdict, and it is the one number that says "the decoder is behind"
  as distinct from "frames are being skipped". Without it the fix would be
  unobservable, which is how the black flicker went unnoticed in the first place.

- **Tests were run against the old code before being kept.** Both new tests —
  the graph holding its last picture, and the panel never presenting black
  across a backwards jump — were confirmed to fail with the previous behaviour
  restored. This project has already shipped a test that passed for the wrong
  reason twice; a regression test nobody has seen fail is a guess.

### The shape of the miss, again

The rule at the top of this file — _a test whose setup performs a step the
application must also perform is not testing the application_ — has a sibling
worth naming, because both defects here are instances of it:

**A test that supplies a value the application computes is not testing the
computation.** Every ladder test built its own `FrameCost`, so the ladder was
proven correct against inputs the scheduler never produced. Every renderer test
warmed the cache first, so the render pass was never asked what to do with a
frame that was not there. The units were right; the values flowing into them
were not, and nothing looked at the join.

What actually found both was driving the built application and reading its own
instrumentation — the HUD that Phase 8b added and that nothing had yet been used
for. That is the cheapest tool in the project for this class of bug and it had
never been pointed at a running preview.

---

## Open items not yet scheduled

- **Retime does not preserve pitch.** A slowed clip sounds lower. Web Audio
  resamples and offers no `preservesPitch` on a buffer source, so this needs a
  time-stretcher (WSOLA or a phase vocoder) sharing one code path with the
  offline render, as the rest of the audio graph does. Deliberately not faked
  with a checkbox in the meantime.
- **Subtitle parsing has never met a real file.** The SRT/VTT fixtures are
  hand-written to cover the cases I know break — comma versus dot, optional
  hours, CRLF, BOM, cue settings, missing index, no trailing newline. That is
  not the same as a file produced by Premiere, Rev, YouTube's auto-captions or
  a fansub group. Needs a pass with real files before the format layer can be
  called done.

---

## Scope change — colour grading is no longer refused

**Decided.** "Colour scopes and grading wheels" had been a refusal since the
first architecture document, on the grounds that a grading suite is its own
product. That is still true of a _suite_ — secondaries, qualifiers, tracked
windows — which needs the masks and motion tracking that remain refused. It was
never true of primary correction: wheels, temperature and tint, and curves are
shader passes that the existing effect chain already knows how to keyframe and
composite, and scopes are a panel that measures the framebuffer the export path
already produces. The refusal was drawn around the wrong thing, so it has been
withdrawn for the primary half and kept for the rest.

Nothing is built and nothing is scheduled; Phase 7 is still next. Recorded here
because a refusal that quietly becomes a feature is exactly the kind of drift
this log exists to prevent, and because the four open design questions —
chain position, 8-bit render targets, the cost of a per-frame framebuffer
readback, and per-clip versus track-level grades — are the reason it is not
simply a matter of appending to `EFFECT_DEFINITIONS`. They are written out in
[`wiki/roadmap.md`](../wiki/roadmap.md#colour-grading).

The 8-bit question is the one likely to bite: the graph's render targets are
`RGBA8`, and stacked corrections band on a gradient. Moving to `RGBA16F` touches
every pass and the export path, not one shader.

---

## The wiki no longer references `docs/`

**Decided.** Seventeen references from `wiki/` into `docs/` — links to
`findings.md`, `plan.md` and `architecture.md`, plus bare filenames in prose —
have been removed. Where the reference carried meaning, the meaning stayed and
the path went: "the engineering log", "the architecture notes", "the phase
plan". No obligation was dropped; the contributing rules still say to record
trade-offs and to update the documentation in the same PR.

The trade-off, stated plainly: a reader of the wiki who wants the reasoning
behind a decision is now told that a log exists but not where it is. That is the
cost of the wiki not depending on files outside itself. `wiki/README.md` says
the notes live alongside the source, which is as far as it goes without naming a
path.

Two things this is _not_. It is not a claim that the wiki is self-contained — it
still links into `src/` throughout, and to `CLAUDE.md` twice, and those links
were deliberately left alone. And it is not a change to what `docs/` is for; the
four documents keep their audiences and their lanes, and `docs/` still links
into `wiki/`. The dependency is now one-way.

The rule is written into `CLAUDE.md` under the wiki-prose rules, because the
failure mode is obvious: the next change that wants to cite a finding will add
the link straight back.
