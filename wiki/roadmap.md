# Roadmap

What is planned, what is deliberately refused, and where help is most useful.

This page tracks the phase plan and the engineering log kept in the repository.
Where they disagree with it, they are right and this page is out of date.

---

## Where the project is

Phases 0–6 and Phase 8 are delivered. Phase 7, the desktop shell, is what is
left.

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
| A keyboard-navigable panel system, and dialogs that are announced, close on Escape, trap focus and give it back                                                                    |

638 tests (439 unit, 196 browser, 3 perf). Typecheck, lint, format, perf budgets
and build green in CI.

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

## Phase 8 — Hardening — done

| Item                                                                                                       | State     |
| ---------------------------------------------------------------------------------------------------------- | --------- |
| ~~Cap the preview base by the displayed canvas~~                                                           | ✓ Done    |
| ~~CI-enforced perf budgets~~ — scene build under 2 ms at 1000 clips, a preview frame under a display frame | ✓ Done    |
| ~~Accessibility pass on the panel system~~                                                                 | ✓ Done    |
| ~~Onboarding~~ — a short orientation document, an in-app Getting Started, and this wiki                    | ✓ Done    |
| ~~Debug HUD~~                                                                                              | ✓ Done    |
| ~~Preview quality ladder~~                                                                                 | ✓ Done    |
| ~~Waveform and thumbnail rewrite~~                                                                         | ✓ Done    |
| ~~Decide the worker question explicitly~~                                                                  | ✓ Decided |
| ~~Join tests: mount a panel, put a clip down, assert a picture appears~~                                   | ✓ Done    |

The perf budgets run in CI with a `VITE_PERF_ALLOWANCE` multiplier — 3× on the
Node suite, 5× on the browser one, where the runner has no GPU and Chromium
falls back to software rasterization. Relaxed rather than removed: it still
catches a frame that has started costing an order of magnitude more than it did.

The accessibility pass gave the docking layout real `tablist` and `separator`
semantics with keyboard navigation, and made the shortcut sheet generated from
the command registry so it cannot drift.

The preview base is capped by the displayed canvas: a 4K project used to render
1920×1080 targets into a canvas that might be 600 px wide, and the quality ladder
only reclaimed that under load — which a parked playhead never is. The cap is a
discrete ladder with a dead band, so dragging a splitter crosses a step at most
once rather than reallocating render targets on every pointer move.

**Phase 8c** then cleared the open items, and the smallest of them turned out to
be the largest defect in the project's history: nothing but relinking ever opened
an imported file in the media engine, so no clip the application itself imported
could decode a frame. The full account is in the engineering log.

---

## Open items, not yet scheduled

Each of these is a known, recorded gap rather than an oversight.

| Item                                           | Detail                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retime does not preserve pitch**             | A slowed clip sounds lower. Web Audio resamples and offers no `preservesPitch` on a buffer source, so this needs a time-stretcher (WSOLA or a phase vocoder) sharing one code path with the offline render, as the rest of the audio graph does. Deliberately not faked with a checkbox in the meantime. |
| **Subtitle parsing has never met a real file** | The SRT/VTT fixtures are hand-written to cover the cases known to break. That is not the same as a file from Premiere, Rev, YouTube or a fansub group. Needs a pass with real files.                                                                                                                     |
| **No Playwright E2E tier**                     | And still the right call for everything except "import a file through the OS picker", which no browser-mode test can cover.                                                                                                                                                                              |
| **Licence not chosen**                         | A genuine open question that needs settling. See [Contributing](contributing.md#licence).                                                                                                                                                                                                                |

---

## Beyond the current plan

Not scheduled and not committed to — but consistent with the project's direction,
and the sort of thing a contributor could reasonably take on.

### Colour grading

**Not built.** Nothing in `src/` grades today; the colour controls are the
`brightness_contrast`, `saturation` and `hue_rotate` effects in the existing
chain, and there is nothing to measure a picture against.

This was previously listed as a refusal — "a grading suite is its own product" —
and that refusal has been withdrawn. What has not changed is the reason behind
it: a full grading suite, with secondaries, qualifiers and tracked windows, is a
different product and would drag in the masking and tracking that remain
refused. What changed is the judgement that _primary_ correction is not that
product. It is a handful of shader passes and a measurement panel, and an editor
that cannot match two shots from the same shoot is missing something ordinary
rather than something specialist.

The shape it would take, and the reason it is a fit rather than a new subsystem:

| Piece                                                         | Where it lands                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Lift / gamma / gain, temperature and tint, saturation, curves | `EFFECT_DEFINITIONS` — keyframable for free, and already composited by the same graph the export uses                  |
| Scopes: waveform, vectorscope, histogram, RGB parade          | A new panel reading the composite framebuffer, the way the Preview already does rather than reading the preview canvas |
| Colour pickers for `vec3` uniforms                            | Listed under the smaller items below; a prerequisite, not a separate feature                                           |

Open questions a serious proposal would have to answer:

- **Where in the chain a grade sits.** Effects are an ordered list per clip
  today. A grade that has to run before or after every other effect is an
  ordering rule the model does not have.
- **Whether grading needs more than 8-bit.** The graph's render targets are
  `RGBA8`. Stacked corrections band on a gradient, and moving to `RGBA16F`
  is a change to every pass and to the export path, not to one shader.
- **What the scopes measure.** Reading back a framebuffer every frame on the
  preview's hot path is exactly the kind of stall the quality ladder exists to
  avoid. It probably has to be a downscaled, throttled read, and the panel has to
  say so rather than implying a per-frame measurement it is not making.
- **Track- or project-level grades.** Out of scope for a first pass; per-clip
  only. Anything else is a document-model change.

Nothing here is scheduled. Phase 7, the desktop shell, is still next.

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

| Item                                        | Notes                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Track faders in the Mixer                   | The audio graph already has per-track gain and pan nodes. Wiring, not architecture.                                    |
| Colour pickers for `vec3` effect uniforms   | Would let the chroma key's key colour be exposed, which it currently is not. Also a prerequisite for grading controls. |
| An effect preset or copy-chain mechanism    | There is no way to move an effect chain between clips other than duplicating the clip.                                 |
| Frame stepping in the Source monitor        | It has a scrubber and mark keys, and nothing else.                                                                     |
| A light theme                               | The token set exists; nothing hard-codes colours.                                                                      |
| Safe-area and guide overlays in the Preview |                                                                                                                        |
| Waveform overlay on video clips             | A scope decision, not a wiring one: it means analysing audio for every video clip.                                     |

---

## Deliberately refused

These are decisions with reasons, not gaps. Changing one is a legitimate
conversation — but it starts from "here is why the boundary is in the wrong
place", not from "it would be nice".

| Not doing                                | Why                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
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
2. **Effects.** Adding one is appending an object with a fragment shader to a
   registry.
3. **A screen-reader pass over panel _contents_.** The docking layout itself is
   now navigable; the panels inside it have had no audit.
4. **Keeping the wiki true.** Every change to the app should update it in the
   same commit — see [`CLAUDE.md`](../CLAUDE.md).
5. **The licence conversation.**

---

**See also:** [Contributing](contributing.md) ·
[Developer Guide](developer/README.md)
