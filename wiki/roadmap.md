# Roadmap

What is planned, what is deliberately refused, and where help is most useful.

This page tracks [`docs/plan.md`](../docs/plan.md) and
[`docs/findings.md`](../docs/findings.md). Where they disagree, they are right
and this page is out of date.

---

## Where the project is

Phases 0–6 are delivered, plus the decoration and preview-quality work that was
pulled forward out of Phase 8.

| Delivered                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integer-frame document, rational frame rate, snapshot undo, portable `.videos` bundles, migration chain v1 → v4                                                                    |
| Platform seam whose whole surface is `read(ref, range)` + `createWritable(ref)`                                                                                                    |
| Media engine on WebCodecs, decoding per clip instance, refcounted frames asserted in tests                                                                                         |
| One clock derived from `AudioContext`; synchronous rendering; frame-accurate preview and shuttle                                                                                   |
| Pure scene builder feeding a synchronous WebGL2 graph: transform, crop, opacity, blend, keyframed effects, transitions, titles, burned-in captions                                 |
| Deterministic export with real codec negotiation and streaming to disk                                                                                                             |
| Ripple / roll / slip / slide, clipboard, retime, markers with chapter export, subtitles with SRT/VTT, three-point editing with a source monitor, OPFS autosave with crash recovery |
| Waveform mip pyramids analysed in a worker and cached to OPFS; filmstrip sprite sheets; adaptive preview quality ladder; debug HUD                                                 |

Roughly 580 tests. Typecheck, lint, format and build green in CI.

---

## Phase 7 — Desktop shell (next)

A Tauri v2 build: `src-tauri/` plus `src/platform/tauri/` implementing the same
`Platform` interface, with `tauri-plugin-{dialog,fs,shell}`.

| Item                                               | Why it matters                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Native file dialogs and arbitrary filesystem paths | No more permission prompts, no more Chromium-only                                       |
| **ffmpeg sidecar behind `platform.transcode`**     | One-click conversion for formats WebCodecs will not take, and optional proxy generation |
| Window title reflecting the project                |                                                                                         |
| Close-request guard on unsaved changes             |                                                                                         |
| Frame-cache budget scaled to available RAM         | Rather than the current fixed number                                                    |

**Exit criteria:** the same UI runs as a desktop app, opens a 4K H.265 file from
an arbitrary path, and exports it. Unsupported formats offer one-click
conversion.

**Cost to be aware of:** this adds a Rust toolchain and a second build, and it is
the first phase the existing test suites cannot verify — neither Vitest browser
mode nor the web platform implementation can exercise it.

The seam has held up well enough that this should be a port. `read(ref, range)`
has already absorbed a demuxer, a relink flow and a streaming muxer without
changing shape.

---

## Phase 8 — Hardening

Most of this landed early. What remains:

| Item                                                                                                              | State                   |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **CI-enforced perf budgets** — scene build under 2 ms at 1000 clips, preview frame under 16 ms at half resolution | Not started             |
| **Cap the preview base by the displayed canvas**, or measure that it does not matter                              | Deferred, deliberately  |
| **Accessibility pass on the panel system** — it has no keyboard navigation at all                                 | Not started             |
| **Onboarding and the rest of `docs/`**                                                                            | In progress — this wiki |
| ~~Debug HUD~~                                                                                                     | ✓ Done                  |
| ~~Preview quality ladder~~                                                                                        | ✓ Done                  |
| ~~Waveform and thumbnail rewrite~~                                                                                | ✓ Done                  |
| ~~Decide the worker question explicitly~~                                                                         | ✓ Decided               |
| ~~Join tests: mount a panel, put a clip down, assert a picture appears~~                                          | ✓ Done                  |

The preview base cap is deferred rather than forgotten: a 4K project renders
1920×1080 targets into a canvas that may be 600 px wide, and the ladder only
reclaims that under load. The existing code argues against reallocating on every
splitter drag, and that trade-off deserves a measurement rather than a guess.

---

## Open items, not yet scheduled

Each of these is a known, recorded gap rather than an oversight.

| Item                                           | Detail                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retime does not preserve pitch**             | A slowed clip sounds lower. Web Audio resamples and offers no `preservesPitch` on a buffer source, so this needs a time-stretcher (WSOLA or a phase vocoder) sharing one code path with the offline render, as the rest of the audio graph does. Deliberately not faked with a checkbox in the meantime. |
| **Subtitle parsing has never met a real file** | The SRT/VTT fixtures are hand-written to cover the cases known to break. That is not the same as a file from Premiere, Rev, YouTube or a fansub group. Needs a pass with real files.                                                                                                                     |
| **Two sources of truth about media**           | `getVideoMetadata` in the import path is still an old `<video>`-based sniffer, so `hasAudio` in the media pool is guessed rather than probed. Harmless today; still two answers to one question.                                                                                                         |
| **Menu hover-then-click bug**                  | Hovering across the menu bar while a menu is open switches menus; the subsequent click then toggles it shut. Cosmetic, pre-existing.                                                                                                                                                                     |
| **No Playwright E2E tier**                     | And still the right call for everything except "import a file through the OS picker", which no browser-mode test can cover.                                                                                                                                                                              |
| **Licence not chosen**                         | A genuine open question that needs settling. See [Contributing](contributing.md#licence).                                                                                                                                                                                                                |

---

## Beyond the current plan

Not scheduled and not committed to — but consistent with the project's direction,
and the sort of thing a contributor could reasonably take on.

### A plugin loader

The registries are already the extension surface: panels, commands, effects and
transitions all go through them, and nothing in the app has a private path
around them. What does not exist is a way to **load** third-party code — a
manifest, a sandbox, a versioned API contract.

Documenting the registries precisely (see the
[Developer Guide](developer/README.md)) is deliberate groundwork for that. It
turns a loader into a loading mechanism rather than a redesign.

Open questions a serious proposal would have to answer: what a plugin can reach,
how a plugin that touches the document participates in undo, what happens to a
project that references a plugin the opener does not have, and whether shader
code from a plugin can be trusted to a GL context shared with the editor.

### Smaller, self-contained items

Each of these is a plausible first contribution:

| Item                                        | Notes                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Track faders in the Mixer                   | The audio graph already has per-track gain and pan nodes. Wiring, not architecture.    |
| Colour pickers for `vec3` effect uniforms   | Would let the chroma key's key colour be exposed, which it currently is not.           |
| An effect preset or copy-chain mechanism    | There is no way to move an effect chain between clips other than duplicating the clip. |
| Frame stepping in the Source monitor        | It has a scrubber and mark keys, and nothing else.                                     |
| A light theme                               | The token set exists; nothing hard-codes colours.                                      |
| Safe-area and guide overlays in the Preview |                                                                                        |
| Waveform overlay on video clips             | A scope decision, not a wiring one: it means analysing audio for every video clip.     |
| Making the in-app shortcut sheet generated  | It is hand-written and already wrong in two places; the registry has the truth.        |

---

## Deliberately refused

These are decisions with reasons, not gaps. Changing one is a legitimate
conversation — but it starts from "here is why the boundary is in the wrong
place", not from "it would be nice".

| Not doing                                | Why                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Colour scopes and grading wheels**     | A grading suite is its own product. VideOS gives you an effects chain.                                                                                                                                                                                                                                                         |
| **Masks and motion tracking**            | Compositing depth belongs in a compositor.                                                                                                                                                                                                                                                                                     |
| **Nested sequences, multicam**           | Enormous surface area, narrow audience, deep consequences for the document model.                                                                                                                                                                                                                                              |
| **EDL / OTIO interchange**               | Worth doing eventually; not what stops anyone editing today.                                                                                                                                                                                                                                                                   |
| **Golden-frame image diffing**           | Reference images would have to be regenerated on every GPU and driver the suite runs on. A named pixel probe survives that and reads as an assertion about the feature. Its dependencies have been removed.                                                                                                                    |
| **Running the media engine in a worker** | `VideoDecoder` already works in the browser's media process. Moving the engine would marshal `VideoFrame`s across a boundary on the preview's hot path to relocate the thin JS around it. Waveform analysis _is_ in a worker, because it genuinely is JS. The facade stays async as insurance against that judgement changing. |
| **A pitch-preservation checkbox**        | Until a time-stretcher exists, it would be a control that lies. The panel says the audio is pitched instead.                                                                                                                                                                                                                   |
| **A frame-rate option in Export**        | It comes from the sequence. Offering 24/30/60 regardless of the timeline is an invitation to pick a number that means resampling, which nothing implements.                                                                                                                                                                    |

---

## Where help is most useful right now

1. **Real-world files** — subtitles especially, but also odd footage. See
   [Contributing](contributing.md#1-use-it-and-report-what-breaks).
2. **The accessibility pass.** Self-contained, badly needed, and nobody has
   started it.
3. **Perf budgets in CI.** The counters already exist; nothing asserts on them.
4. **Effects.** Adding one is appending an object with a fragment shader to a
   registry.
5. **The licence conversation.**

---

**See also:** [`docs/plan.md`](../docs/plan.md) ·
[`docs/findings.md`](../docs/findings.md) · [Contributing](contributing.md)
