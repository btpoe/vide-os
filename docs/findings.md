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
| P1  | Export timestamps frames by wall-clock render time, not frame index (`export-engine.ts:146,211-259`)                  | A 60 s timeline rendering at ~8 fps exports as ~225 s of slow motion                             | Phase 5                                       |
| P2  | Offline audio mixdown played into the recorder in real time while video renders at render speed                       | Audio can never line up with picture                                                             | Phase 5                                       |
| P3  | `mixTimelineAudio` sums all tracks with no type filter, and every video clip has an auto-created duplicate audio clip | Every clip's audio mixed twice at 2× amplitude, clipping                                         | Phase 1c (duplicate removed), Phase 3 (mixer) |
| P4  | `.mp4` extension chosen from the _requested_ format while the mime falls back to WebM                                 | A WebM file named `.mp4`; the fallback mime also has no audio codec                              | Phase 5                                       |
| P5  | Compositor built at `projectState.width/height`, ignoring export settings                                             | The 4K export preset renders 1080p and upscales                                                  | Phase 5                                       |
| P6  | Seeks within 0.02 s are skipped (`frame-source.ts:73`) — wider than a frame at 60 fps                                 | Duplicate frames; playback is not frame-accurate                                                 | Phase 3                                       |
| P7  | `seeked` handlers not keyed to a specific seek                                                                        | Overlapping seeks resolve against each other                                                     | Phase 3                                       |
| P8  | One `<video>` element per _media file_ rather than per _clip_                                                         | Two clips of one source fight over `currentTime`                                                 | Phase 3                                       |
| P9  | `renderFrame()` called without `await`, next rAF scheduled immediately                                                | Concurrent renders stomp shared GL state                                                         | Phase 3                                       |
| P10 | Two clocks: rAF wall-clock advance plus `video.play()` plus independent drift correction                              | Playhead and audio disagree                                                                      | Phase 3                                       |
| P11 | `requestPermission()` called from `onMount`, and its failure path **deleted the stored handle**                       | First reload after a permission lapse permanently destroyed every media reference in the project | Phase 1b + follow-up                          |
| P12 | Project files saved no media list; clip ids were `Date.now()`-based                                                   | Saved projects could not be reopened anywhere, including on the machine that wrote them          | Phase 1b                                      |
| P13 | Split-undo stubbed, trim-redo empty, delete-undo minting new ids and dropping effects/in-out/transitions              | Undo silently corrupts the project                                                               | Phase 1a                                      |
| P14 | Timeline zoom affects only ruler tick density; clip geometry is a percentage of total duration                        | A 20 s edit occupies ~6% of the panel with no way to zoom in                                     | Phase 2                                       |
| P15 | `renderTransition` called from nowhere; compositor has no text path                                                   | Transitions and titles are stored, shown in the timeline, and never rendered                     | Phase 4                                       |
| P16 | `PropInput` had no `onInput`; opacity/volume were static divs reading "100%"                                          | Six controls that looked functional and did nothing                                              | Phase 0 (removed)                             |
| P17 | Extension whitelist advertised avi/mkv/flv/wmv/heic as supported                                                      | Those import with an icon and a duration, then render black with the decode rejection swallowed  | Phase 0 (partial), Phase 3 (real probe)       |
| P18 | `trimClipRight` clamped only the minimum                                                                              | Dragging right forever pushes the out-point past the media into a silent freeze frame            | Phase 1a                                      |
| P19 | `splitClipAtTime` pushed the new clip to the end of the array; nothing kept clips sorted                              | Render order depended on edit history                                                            | Phase 1a                                      |
| P20 | Y-flip baked into several vertex shaders                                                                              | With ≥2 visible video tracks, alternating layers render upside down                              | Phase 4                                       |

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

---

## Open items not yet scheduled

- **Audio detection is unreliable.** `getVideoMetadata` sniffs `mozHasAudio` /
  `webkitAudioDecodedByteCount` / `audioTracks`, none of which are dependable —
  a file with a real AAC track probes as `hasAudio: false` in headless Chromium.
  Real per-track probing lands with the media engine in Phase 3.
- **Menu hover-then-click toggles the menu shut.** Hovering across the menu bar
  while a menu is open switches to the hovered menu; the subsequent click then
  toggles it closed. Cosmetic, pre-existing.
- **No relink UI.** Handles are no longer destroyed, and `reconnectPendingMedia`
  exists, but nothing calls it yet. Phase 3.
