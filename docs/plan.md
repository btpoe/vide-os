# VideOS — Implementation Plan

Revised after Phase 6. Supersedes the original plan-mode document, which
described a codebase that no longer exists.

Companion documents: [`architecture.md`](architecture.md) for how the pieces
fit, [`findings.md`](findings.md) for the running log of defects found and
trade-offs taken.

---

## Where this is

The original plan opened with an audit of a prototype whose media core was
"best-effort where it needs to be exact": wall-clock export timestamps, seeks
skipped within 0.02 s, a timeline that could not zoom, six controls that did
nothing, undo that corrupted the project, and media references deleted on
reload. All of that is gone. Phases 0–6 are delivered; that audit is now
history and lives in `findings.md`.

What exists today:

- Integer-frame document with rational frame rate, snapshot undo, portable
  `.videos` bundles, and a versioned migration chain (v1 → v4).
- A platform seam whose whole surface is `read(ref, range)` plus
  `createWritable(ref)`. Nothing outside `src/platform/web/` touches
  `FileSystemFileHandle`.
- Media engine on WebCodecs via Mediabunny, decoding per clip instance, with
  refcounted frames whose create/close balance is asserted in tests.
- One clock derived from `AudioContext`, synchronous rendering, frame-accurate
  preview and shuttle.
- A pure scene builder feeding a synchronous WebGL2 graph: transform, crop,
  opacity, blend, keyframed effects, transitions, titles, burned-in captions.
- Deterministic export — one frame written per timeline frame, timestamped from
  its frame index — with real codec negotiation and streaming to disk.
- Editing depth: ripple/roll/slip/slide, clipboard, retime, markers with
  chapter export, subtitles with SRT/VTT, three-point editing with a source
  monitor, OPFS autosave with crash recovery.

532 tests (393 unit, 139 browser). Typecheck, lint, format, and build are green
in CI.

---

## Carried forward

Work the earlier phases specified and did not deliver. None of it was recorded
at the time, which is why it is called out here rather than left in the phase
descriptions where it would read as done.

### 1. Timeline decorations were never rebuilt (from Phase 2)

Phase 2's exit criteria included "a 1-hour audio file's waveform appears in
under a second and is accurate at every zoom level", and the design called for
a mip pyramid computed in a worker and cached to OPFS, plus filmstrip
thumbnails via Mediabunny's `CanvasSink`.

What was actually built was the _job queue_ — `lib/media-previews.ts`, which
moved decoration requests out of the JSX render body into a
concurrency-limited queue. That part is real and good. The two generators it
calls are untouched originals:

- **`lib/waveform.ts`** still produces a fixed 200 peaks per file, however long
  it is. On a one-hour recording each bar is 18 seconds — the exact defect
  Phase 2 set out to remove. It also calls `decodeAudioData` on the whole file,
  which loads an hour of PCM into memory to draw a 200-pixel strip. The cache
  is an in-memory `Map`, so it is recomputed on every reload.
- **`lib/clip-thumbnails.ts`** still creates a `<video>` element per media
  file. Phase 3 deleted `frame-source.ts` specifically to stop doing that —
  `<video>` elements leak toward Chrome's decoder cap and cannot seek
  accurately — and this path survived the cull because nothing pointed at it.
  It produces one 80×45 data URL, not a filmstrip.

`media-previews.ts`'s own docblock says "filmstrip thumbnails", which is
aspirational rather than true. Worth fixing along with the code.

**Do:** rewrite both generators on the media engine, add the mip pyramid, cache
to OPFS through `platform.cache` (which already exists and is used by
autosave), and correct the docblock.

### 2. No worker anywhere (from Phases 2 and 5)

There is no `Worker` in the codebase. Phase 2 wanted waveform analysis in one;
Phase 5 wanted the media engine in one, and the engine facade was made async
from day one specifically so that could be a transport swap rather than a
rewrite. That option is still open and still unexercised.

This is a responsiveness item, not a correctness one — which is why it keeps
slipping, and why it should be scheduled explicitly or dropped explicitly.

**Do:** take the waveform analysis first, since the rewrite in item 1 has to
touch it anyway and analysing an hour of audio is the longest single block of
main-thread work in the app. Judge the media engine separately afterwards, on
a measurement rather than on principle: if decode is not stalling frames, the
async facade is insurance and should be recorded as such rather than cashed in
for a transport that has to marshal `VideoFrame`s across a boundary.

### 3. No preview quality ladder (from Phase 4)

Phase 4 specified a quality ladder driven by measured frame time (1/1, 1/2,
1/4). `ResizeObserver` and DPR handling landed; the ladder did not. Preview
renders at full sequence resolution regardless of how long a frame takes, so a
4K project previews at 4K.

**Do:** measure frame time in the scheduler, which already owns the loop, and
scale the compositor's render targets — not the canvas — by 1/1, 1/2 or 1/4,
presenting upscaled. Two details decide whether it feels right rather than
merely faster: hysteresis, so a frame near the threshold does not oscillate
between rungs and shimmer; and dropping back to full resolution whenever the
playhead settles, because a paused frame has all the time it needs and is the
one people actually look at. The `settleFrame` path added with the preview fix
is the natural place for that.

### 4. The verification tiers drifted

- **Golden-frame diffing was not built as designed.** `pixelmatch` and `pngjs`
  are declared dependencies and imported nowhere. What the browser tests
  actually do is probe specific pixels and assert relationships — "the pixel
  above the plate is transparent before the blur and lit after it". That is
  arguably the better trade (no reference images to regenerate, and each
  assertion says what it is checking), but the plan should say so and the three
  unused dependencies should go.

  **Do:** delete `pixelmatch`, `pngjs` and `@types/pngjs`. The convention
  itself is already written up in
  [`architecture.md`](architecture.md); what remains is removing the three
  dependencies that imply the other approach. Reference images would have to be
  regenerated on every GPU and driver the suite runs on, whereas a probe saying
  "the pixel above the plate is lit after the blur" survives that and reads as
  an assertion about the feature.

- **The Playwright E2E tier does not exist.** There is no
  `playwright.config.ts`; Playwright is present only as the driver for
  Vitest browser mode. The five E2E flows the plan listed are largely covered
  by browser-mode tests that mount real components and dispatch real pointer
  events — but "import a file through the OS picker" is not, and cannot be.
- **CI has no perf budgets.** Phase 8 item, not started.

- **Nothing tested that the application asks the renderer for anything.** The
  renderer suites all warm the decoder cache themselves before rendering, which
  is exactly the step the app was missing — so the preview could be black on
  every launch with every test green. Found by the preview work, recorded in
  [`findings.md`](findings.md), and the reason the two smoke flows below are
  worth more than their size suggests.

  **Do:** add browser tests that mount a panel, put a clip on the timeline, and
  assert the picture appears _without_ the test priming anything — one for the
  preview, one for a scrub, one for playback. Anywhere a test's setup performs
  a step the application must also perform, the test is proving the wrong
  thing.

---

## Sequencing

**Do the carried-forward decoration work before Phase 7**, not after. The
recommendation is not about tidiness:

- A waveform at 18 seconds per bar makes audio editing guesswork, and it is
  visible within the first minute of a real edit. Everything shipped through
  Phase 6 assumes you can see where the sound is.
- Both generators are the last code in the app still using the pre-rewrite
  media path. Leaving them means the `<video>`-element decode path that Phase 3
  deleted everywhere else has to be carried into the desktop build and made to
  work there too.
- Phase 7 is the first phase the existing suites cannot verify. Starting it
  with known-broken subsystems underneath makes any failure ambiguous between
  the new shell and the old code.

Phase 8's remaining items — perf budgets, the debug HUD, accessibility — can
stay after Phase 7. They do not block a real edit.

---

## Phase 7 — Tauri v2 desktop shell

Unchanged in intent. It needs only the Phase 1 platform seam, which has held
up: adding positioned writes for the export streaming path in Phase 5 was a
clean extension rather than a redesign.

`src-tauri/` plus `src/platform/tauri/` implementing the same interface, with
`tauri-plugin-{dialog,fs,shell}`. An ffmpeg sidecar behind the optional
`platform.transcode`, for ingest WebCodecs will not take and for optional proxy
generation. Native dialogs, a window title reflecting the project, a
close-request guard on unsaved changes, and a frame-cache budget scaled to
available RAM rather than a fixed number.

**Exit:** the same UI runs as a desktop app, opens a 4K H.265 file from an
arbitrary path, and exports it. Unsupported formats offer one-click conversion.

**Note before starting:** this adds a Rust toolchain and a second build. It is
also the first phase that cannot be verified by the existing test suites, since
neither Vitest browser mode nor the web platform implementation can exercise
it. Budget for that.

---

## Phase 8 — Hardening

Now also the home for the carried-forward items above, which is most of its
weight.

- Rewrite the waveform and thumbnail generators (carried forward, item 1).
- Decide the worker question explicitly (item 2): either move the media engine
  and waveform analysis into workers, or record that the facade's async shape
  is insurance rather than a plan.
- Preview quality ladder (item 3).
- Drop `pixelmatch`/`pngjs`/`@types/pngjs`, which imply a golden-image tier
  that was deliberately not built (item 4).
- Add the join tests: mount a panel, put a clip on the timeline, assert a
  picture appears without the test priming the cache (item 4).
- CI-enforced perf budgets: scene build under 2 ms at 1000 clips, preview frame
  under 16 ms at half resolution.
- Debug HUD: decoder count, cache bytes, frame-leak counter, dropped frames.
  The counters already exist; nothing surfaces them.
- Accessibility pass on the panel system — it is a custom docking layout in
  shadow DOM with no keyboard navigation at all.
- Onboarding, a keyboard map, and the rest of `docs/`.

---

## Open items

Tracked in [`findings.md`](findings.md) rather than duplicated here. In short:
retime does not preserve pitch and deliberately does not pretend to; the
subtitle parser has never met a real-world file; `getVideoMetadata` is a second
source of truth about media alongside the engine's probe; and a menu bar
hover-then-click bug.

---

## What has held up

Worth stating, because these are the decisions to keep making:

- **Snapshot undo.** Six phases of new edit operations and not one of them
  needed an inverse written by hand. Every hand-written inverse that survived
  into Phase 6 was wrong.
- **The platform seam being one function.** `read(ref, range)` absorbed a
  demuxer, a relink flow, and a streaming muxer without changing shape.
- **Frames as integers, rational rate.** Whole classes of bug never appeared.
  The 29.97 export test passes because there was never a float to accumulate.
- **Driving real components in tests.** Every UI bug this project has found —
  menus showing raw command ids, a marker name field losing focus per
  keystroke, a selection collapsing before a drag — was invisible to unit tests
  and obvious the moment a test dispatched a real event.
- **Writing down what was refused.** `findings.md` records the plan's chroma-key
  ghosting that turned out to be impossible, and the pitch toggle that would
  have been a lie. Both would otherwise have been quietly implemented or
  quietly skipped.
