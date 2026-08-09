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

The remedy is cheap and is now scheduled: a handful of tests that mount a real
panel, put a clip on a real timeline, and assert a picture appears **without
priming anything**. Not more coverage — coverage was fine — but coverage of the
join.

The same shape is worth watching for elsewhere. Any place a test constructs
state the app is responsible for constructing is a place a whole feature can be
missing without a red test.

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

- **`getVideoMetadata` is still the old `<video>`-based sniffer.** The media
  engine's `probeMedia` reports codecs and decodability properly, but the media
  pool's import path has not been switched over to it, so `hasAudio` there is
  still guessed from `mozHasAudio` / `webkitAudioDecodedByteCount`. Harmless
  today because the audio engine asks the engine directly, but two sources of
  truth about the same file.
- **Menu hover-then-click toggles the menu shut.** Hovering across the menu bar
  while a menu is open switches to the hovered menu; the subsequent click then
  toggles it closed. Cosmetic, pre-existing.
