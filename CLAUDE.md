# CLAUDE.md

Guidance for Claude Code, and for any agent working in this repository.

VideOS is an open, web-standards non-linear video editor. SolidJS + WebGL2 +
WebCodecs + Web Audio, with native Web Components for the docking layout. It
runs in Chromium today; a Tauri desktop shell is the next phase.

---

## The wiki is part of the definition of done

**`wiki/` documents the application as it actually is. Any change to behaviour,
UI, or a public interface must update the wiki in the same change.**

This is not a nice-to-have. This project has already been bitten twice by
documentation drifting out of sync with the code:

- `docs/architecture.md` once marked eight built systems as "planned" and
  described two deleted files in the present tense.
- Four specified items were never built, never recorded, and therefore read as
  done for months.

A document that is wrong about what exists is **worse than no document**,
because it gets consulted instead of the code. Treat a wiki page that contradicts
the app as a bug of the same severity as the code change that caused it.

### What to update, by what you touched

| If you changed…                                             | Update                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| A panel's UI, controls, or behaviour                        | `wiki/panels/<panel>.md`                                              |
| A dialog, overlay, menu, or the status bar                  | `wiki/panels/dialogs.md`                                              |
| `src/commands/definitions.ts` — any shortcut or command     | `wiki/keyboard-reference.md`, and the panel page that owns the action |
| Timeline gestures, tools, snapping, zoom                    | `wiki/panels/timeline.md`, `wiki/panels/tools.md`                     |
| `EFFECT_DEFINITIONS` or `TRANSITION_DEFINITIONS`            | `wiki/panels/effects.md`, `wiki/developer/effects-and-transitions.md` |
| The document model, `edits.ts`, undo, keyframes             | `wiki/developer/document.md`                                          |
| `PanelDefinition`, `Command`, or the layout element's API   | `wiki/developer/panels.md`, `wiki/developer/commands.md`              |
| `src/platform/types.ts` or the media engine                 | `wiki/developer/platform.md`                                          |
| Supported formats, requirements, install steps, npm scripts | `wiki/getting-started.md`                                             |
| What is planned, shipped, deferred, or refused              | `wiki/roadmap.md` (and `docs/plan.md`)                                |
| Test tiers, conventions, or contributor workflow            | `wiki/contributing.md`                                                |
| Scope — adding or removing a capability from the target     | `wiki/introduction.md`                                                |

Adding a **new** panel means a new `wiki/panels/<name>.md` plus entries in
`wiki/panels/README.md` and `wiki/README.md`.

### Rules for wiki prose

- **Describe what exists.** Where a design is settled and the code is not, mark
  it **Not built** rather than describing it in the present tense.
- **Never document a control that does nothing.** If the app has one, that is a
  bug in the app — fix it or label it, do not paper over it in prose.
- **Include the "why"** for anything non-obvious. A decision without its reason
  gets re-litigated or quietly reversed.
- Check claims against `src/`, not against `docs/plan.md`.
- Relative links only; they must resolve from the file they are in.
- **The wiki does not reference `docs/`** — not by link, not by filename. Where
  a page needs the material, describe it ("the engineering log", "the
  architecture notes") and leave the reader to the repository. Links into `src/`
  and to `CLAUDE.md` are still fine; only `docs/` is excluded.
- Run `pnpm exec prettier --write "wiki/**/*.md"` — CI runs `format:check` over
  the whole repo.

### The other documents, and who they are for

| Document               | Audience            | Contains                                                       |
| ---------------------- | ------------------- | -------------------------------------------------------------- |
| `wiki/`                | users and extenders | how to use it, every panel, the extension APIs, contributing   |
| `docs/onboarding.md`   | new arrivals        | the short version, both audiences                              |
| `docs/architecture.md` | implementers        | how the pieces fit, and why                                    |
| `docs/plan.md`         | implementers        | phases, what is left                                           |
| `docs/findings.md`     | implementers        | the engineering log: every defect found, every trade-off taken |
| `README.md`            | first contact       | status table, requirements, scripts                            |

Keep them in their lanes. One copy of anything — two copies drift, and the one
nobody reviews drifts faster.

**If you take a trade-off or leave something worse than ideal, record it in
`docs/findings.md` before calling the work done.** A phase is not complete until
its gaps are written down; that is what distinguishes "deferred" from "skipped".

---

## Commands

```sh
pnpm dev            # Vite dev server, http://localhost:5173
pnpm check          # typecheck + lint + test + build — what CI runs
pnpm test           # unit + property tests, in Node
pnpm test:browser   # real WebGL2 / WebCodecs / OPFS, in Chromium
pnpm test:perf      # performance budgets
pnpm format         # Prettier, write
```

`pnpm exec playwright install chromium` once, for the browser suite.

Run `pnpm check` before reporting work as complete. Run `pnpm test:browser` for
anything touching a panel, the renderer, the media engine, or playback.

---

## Architecture in one screen

```
index.tsx ──> App.tsx ──> <ve-panel-layout>   docking, shadow DOM
                 │              └─> <ve-panel> × N ──> Solid components
                 ├─> commands/   every user action, one registry
                 └─> stores/     project, ui, media, timeline, source, view

model/      the document: frames, edits, invariants, snapshot history, io
platform/   one interface; web implementation (FS Access, OPFS, IndexedDB)
media/      WebCodecs decode per clip instance, refcounted frame cache
audio/      one graph function, shared by live playback and offline render
playback/   one clock, derived from AudioContext
renderer/   scene (pure data) ──> graph (synchronous WebGL2)
export/     codec negotiation, deterministic frame loop, muxing
```

`@/` maps to `src/`.

---

## Conventions that are load-bearing

Each exists because its absence caused a specific, documented bug. Do not
quietly work around one.

**All times in the document are integer frames**, and the frame rate is
rational. Seconds are a derived view. Writing a `number` that means seconds is
almost always wrong.

**Every document mutation goes through `applyEdit`**, which validates against the
invariants in development and records one undo step. State that must not be
undoable — playhead, selection, zoom, layout — belongs in a UI store, not the
document.

**One gesture is one undo step.** `beginInteraction()` → live edits →
`commitInteraction(label)`, and `Escape` must abort. Live drags apply
**absolute** operations (`slipClipTo`, not `slipClip`), because a relative one
re-applied per pointer move accumulates.

**Every user action is a command.** Adding an action means adding a `Command` to
the registry — never a second implementation of one that exists. Menus and
buttons dispatch through `runCommand`.

**The render graph is synchronous and pure.** `buildScene` is plain data with no
GL and no async; all decoding resolves before `composeFrame` runs. Preview and
export are two schedulers over the same graph, differing in one hook — which is
what makes "the export matches the preview" structural.

**Nothing outside `src/platform/web/` touches `FileSystemFileHandle`.** The whole
host boundary is `read(ref, range)` plus `createWritable(ref)`.

**`requestPermission` must be called inside a user gesture**, and its failure
path must never delete a stored handle. `queryPermission` never prompts.

**`no-floating-promises` is an error.** It would have caught the un-awaited
`renderFrame()` that let concurrent renders corrupt shared GL state.

**Iterate stable ids in `For`, not objects.** Structural sharing means every edit
produces a new object and Solid compares by reference; iterating objects rebuilds
the DOM node and takes any focused input's caret with it.

**Never do work in a render body.** Requesting a decode or writing to a store
during render re-fires on every reconcile. Use `createEffect`.

**Nothing in the UI claims to do something it doesn't.** Unimplemented controls
are disabled or labelled, not silently inert. If a feature cannot be done
honestly, say so in the UI rather than shipping a control that lies.

**Comments explain reasoning, not mechanics.** `// increment i` is noise; the
reason a comparison is by id rather than by identity is why the next person does
not reintroduce the bug.

---

## Testing

| Tier            | Covers                                                                     | Where                     |
| --------------- | -------------------------------------------------------------------------- | ------------------------- |
| **Unit**        | keyframes, geometry, timecode, subtitle formats, chord parsing             | `test/unit/`              |
| **Property**    | random edit sequences; invariants hold and undo returns the original       | `test/unit/edits.test.ts` |
| **Render**      | real WebGL2, probing named pixels; frame-leak assertions                   | `test/browser/`           |
| **Determinism** | export, demux the result, assert exact frame count and timestamps          | `test/browser/`           |
| **Component**   | mount the real panel, dispatch real pointer events, assert on the document | `test/browser/*.test.tsx` |
| **Perf**        | budgets — scene build at 1000 clips, preview frame time                    | `test/perf/`              |

**A test whose setup performs a step the application must also perform is not
testing the application.** Every renderer test once warmed the decoder cache by
awaiting `getExact` — the one thing the app did not do — so the preview could be
black on every launch with the whole suite green. Cover the _join_, not just the
units.

**Test media is generated, never committed** (`test/fixtures/make-media.ts`), and
a fixture must be robust to the transformation under test.

Browser-mode traps, all of which have been mistaken for product bugs:

- **No stylesheet loads.** Every element measures at the origin. Assert on inline
  offsets or relative motion, never on rendered rectangles.
- **Panels are in shadow DOM.** Synthetic events need `composed: true`.
- **Do not read the preview canvas.** `preserveDrawingBuffer` is false; read the
  composite framebuffer instead.
- **Restart the dev server after editing source.** Vite HMR forks module
  instances, so a test can bind to a stale store.

If you touch `src/model/edits.ts`, run the 20,000-sequence property sweep. Three
of the four rounding bugs in this codebase's history were found by one property
at different seeds.

---

## Scope

`wiki/introduction.md` lists what VideOS deliberately will not do — masks,
motion tracking, nested sequences, multicam, EDL/OTIO. `wiki/roadmap.md` lists
refusals with their reasons, including golden-image diffing and a
pitch-preservation toggle.

Primary colour correction and scopes were refused and are now in scope, unbuilt
and unscheduled — `wiki/roadmap.md` has the design questions. A full grading
suite with secondaries is still refused, because it needs the masking and
tracking that are.

Do not implement a refused item without the user explicitly asking. If you think
one is wrong, say so and make the case; do not route around it.
