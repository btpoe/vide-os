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
- Timeline decorations rewritten: waveform peaks as a mip pyramid analysed in a
  worker and cached to OPFS, filmstrip thumbnails through Mediabunny's
  `CanvasSink`, and a preview quality ladder above both.
- A panel system that can be driven from the keyboard, and dialogs that
  announce themselves, close on Escape, and give focus back.
- Performance budgets in CI, and a debug HUD showing what the engine is doing.

638 tests (439 unit, 196 browser, 3 perf). Typecheck, lint, format, unit tests,
perf budgets, and build are green in CI — and so, for the first time, is the
browser job, which had been exiting 1 while reporting every test as passed.

Phases 0–6 and Phase 8 are delivered. Phase 7, the desktop shell, is what is
left.

---

## Carried forward

Work the earlier phases specified and did not deliver. None of it was recorded
at the time, which is why it is called out here rather than left in the phase
descriptions where it would read as done.

### 1. Timeline decorations — **done**

Phase 2's exit criteria included "a 1-hour audio file's waveform appears in
under a second and is accurate at every zoom level", and the design called for a
mip pyramid computed in a worker and cached to OPFS, plus filmstrip thumbnails
via Mediabunny's `CanvasSink`. Only the job queue had been built; both generators
it called were pre-rewrite originals — a fixed 200 peaks per file, and a
`<video>` element per media file.

Both are rewritten, and the shape is in
[`architecture.md`](architecture.md#timeline-decorations):

- `lib/waveform.ts` is now pure pyramid arithmetic — min/max byte pairs over
  128-sample buckets, halved repeatedly, queried at the level matching the pixel
  column so drawing costs O(columns) rather than O(file).
- `media/waveform-analysis.ts` streams through `AudioSampleSink` instead of
  handing the whole file to `decodeAudioData`, and runs in
  `media/waveform-worker.ts`.
- `lib/clip-thumbnails.ts` produces a single-row sprite sheet through
  `CanvasSink`, plus the `posterFrame` call that let the media pool's `<video>`
  thumbnail — the same pre-rewrite path, one file further out than the review
  spotted — be deleted too.
- Both cache to OPFS through `platform.cache`, so a second launch decodes
  nothing. `media-previews.ts`'s docblock now describes what it does.

Trade-offs taken are in [`findings.md`](findings.md) under Phase 8a: bucket size
and the memory it implies, the one-pixel generosity of a zoomed-out envelope, and
the 120-tile cap on a filmstrip.

### 2. The worker question — **decided**

Waveform analysis runs in a worker. The media engine does not, and that is now a
recorded decision rather than a slip: `VideoDecoder` already does its work in the
browser's media process, so moving the engine would marshal `VideoFrame`s across
a boundary on the preview's hot path to relocate the thin JS around it. The
facade's async shape stays as insurance against that judgement changing.

The measurement the plan asked for is which part is actually JS. Peak analysis is
hundreds of millions of samples of arithmetic; video decode is a handful of calls
into the platform.

### 3. Preview quality ladder — **done**

`playback/preview-quality.ts` is a pure function of measured cost; the scheduler
applies it and owns every `resizeCompositor` call, while the panel owns the base
size and the canvas. Three rungs of the base — 1/1, 1/2, 1/4 — with hysteresis
both ways and full quality restored whenever the playhead settles.

Two departures from the specification, both in `findings.md`: the rungs are
fractions of the preview's base rather than of the sequence, because the preview
fix had already made the base half the sequence and a 1/1-of-sequence top rung
would have reintroduced the 4K allocation that fix removed; and the ladder
watches the interval between rendered frames as well as the time inside
`renderFrame`, because scaling render targets buys GPU fill rate and GPU time is
invisible to `performance.now()`.

### 4. The verification tiers

- **Golden-frame diffing stays unbuilt, deliberately, and its dependencies are
  gone.** `pixelmatch`, `pngjs` and `@types/pngjs` are removed. Reference images
  would have to be regenerated on every GPU and driver the suite runs on, whereas
  a probe saying "the pixel above the plate is lit after the blur" survives that
  and reads as an assertion about the feature. Written up in
  [`architecture.md`](architecture.md), along with the other half of the
  convention: where a probe will not do, the material carries the assertion — the
  fixtures burn in a frame counter, so "the filmstrip shows successive frames" is
  a strictly increasing sequence of decoded numbers.

- **The join tests exist.** `test/browser/preview.test.tsx` mounts the real panel
  and scrubs the way the timeline does; `test/browser/timeline-decorations.test.tsx`
  puts a clip on a real lane and waits for a decoration to appear. Neither primes
  anything. The second one caught its own version of the bug it exists to prevent
  — see `findings.md`.

- **The Playwright E2E tier does not exist**, and still should not. Playwright is
  present only as the driver for Vitest browser mode. The five E2E flows the plan
  listed are largely covered by browser-mode tests that mount real components and
  dispatch real pointer events — but "import a file through the OS picker" is not,
  and cannot be.

- **CI has perf budgets now.** Scene build under 2 ms at 1000 clips, in its own
  Node project (`pnpm test:perf`); a whole preview frame under a display frame at
  half resolution, in the browser suite where there is real GL. Both print their
  numbers on every run and both scale by `VITE_PERF_ALLOWANCE`, which CI sets
  because its runners have no GPU.

  Writing them turned up the reason a budget in the browser suite would not have
  meant anything: `pnpm test:browser` had been exiting 1 on every run since it
  was written, while reporting every test as passed. See `findings.md`.

---

## Sequencing

The decoration work was done before Phase 7, as recommended. The reasons are kept
here because they are the argument for the ordering, not just a note about it:

- A waveform at 18 seconds per bar makes audio editing guesswork, and it is
  visible within the first minute of a real edit. Everything shipped through
  Phase 6 assumes you can see where the sound is.
- Both generators were the last code in the app still using the pre-rewrite media
  path. Leaving them would have meant carrying the `<video>`-element decode path
  that Phase 3 deleted everywhere else into the desktop build and making it work
  there too.
- Phase 7 is the first phase the existing suites cannot verify. Starting it with
  known-broken subsystems underneath makes any failure ambiguous between the new
  shell and the old code.

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

## Phase 8 — Hardening — **done**

Was the home for the carried-forward items above; that weight landed ahead of
Phase 7, for the reasons under Sequencing, and the rest of the phase has now
landed with it. Phase 7, the desktop shell, is what is left.

Done:

- ✓ Rewrite the waveform and thumbnail generators (item 1).
- ✓ Decide the worker question explicitly (item 2): waveform analysis moved into
  one, the media engine deliberately not, recorded either way.
- ✓ Preview quality ladder (item 3).
- ✓ Drop `pixelmatch`/`pngjs`/`@types/pngjs`, which implied a golden-image tier
  that was deliberately not built (item 4).
- ✓ Add the join tests: mount a panel, put a clip on the timeline, assert a
  picture appears without the test priming the cache (item 4).

- ✓ CI-enforced perf budgets, and the discovery that the browser job they would
  have run in had been exiting 1 on every run since it was written.
- ✓ Debug HUD: decoder count, cache bytes and hit rate, the frame-leak counter,
  dropped frames, and the preview's quality rung and render size. `Shift+D`.
- ✓ Cap the preview's base size by the displayed canvas — a discrete ladder with
  a dead band, so a splitter drag crosses a step at most once.
- ✓ Accessibility pass on the panel system: tablists with a roving tabindex and
  arrow-key navigation, splitters as focusable separators that resize with the
  arrow keys, a focus ring inside the shadow root, and dialogs that are dialogs.
- ✓ Onboarding and a keyboard map. The shortcut sheet is generated from the
  command registry, so a new command documents itself; the hand-written one it
  replaced had drifted far enough to be misleading.

Remaining:

- Nothing in this phase. The CI perf allowances are still guesses until a real
  run reports its numbers, which is logged in [`findings.md`](findings.md)
  rather than tracked here.

---

## Phase 8c — the open items — **done**

Not a planned phase. It is what clearing the list of open and deferred items
turned into, and it is written up in [`findings.md`](findings.md) because one of
them was not the small thing it had been recorded as.

- ✓ **The import path opens the file in the media engine.** Nothing but relinking
  ever did, so no imported clip could decode a frame — the preview was black for
  every file the application itself brought in. The probe is now the single
  source of truth for duration, dimensions and audio, and `getVideoMetadata` and
  `getAudioDuration` are gone. `test/browser/media-import.test.ts` goes in
  through `importFileHandle` and primes nothing.
- ✓ **`hasAudio` is read from the demuxer.** The `<video>` sniffer answered "no"
  for every file, because `webkitAudioDecodedByteCount` is 0 until playback.
- ✓ **The menu bar's hover-then-click bug.** A hover-switch and the click that
  ends it are one gesture.
- ✓ **`F6` / `⇧+F6` cycle panel regions**, as commands rather than layout keys.
- ✓ **Export, relink and recovery are real dialogs.** They were never converted
  to `Overlay` and had no role, no Escape and no focus trap. `@kobalte/core`,
  `class-variance-authority` and `lucide-solid` are removed — nothing imported
  any of them.

---

## Open items

Tracked in [`findings.md`](findings.md) rather than duplicated here. What is
left: retime does not preserve pitch and deliberately does not pretend to, and
the subtitle parser has never met a real-world file. Both need work that is
larger than the item — a time-stretcher sharing the offline render's code path,
and a corpus of files this project does not have.

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
