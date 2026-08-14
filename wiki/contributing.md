# Contributing

VideOS is early. That is the good news: the decisions that shape it are still
being made, and most of them are one well-argued pull request away from being
made differently.

---

## Ways to help, in rough order of usefulness right now

### 1. Use it and report what breaks

The single most valuable thing. This is pre-alpha software with about 580
automated tests and very few human hours of real editing behind it. Every bug
found by someone actually cutting a video is worth ten found by staring at code.

Especially valuable:

- **Real subtitle files.** The SRT/VTT parser has never met a file produced by
  Premiere, Rev, YouTube auto-captions or a fansub group. Its fixtures are
  hand-written. A file it mangles is a gift.
- **Real footage.** Odd frame rates, variable frame rate phone video, long
  recordings, unusual containers, 4K.
- **Long sessions.** Memory behaviour over an hour of editing is barely
  characterised. The [Debug HUD](panels/dialogs.md#debug-hud) (`Shift+D`) makes
  it observable — if the **open** counter climbs away from the cache count,
  that is a frame leak and a serious bug.

### 2. Write documentation

Including this wiki. If a page confused you, that is a defect in the page.

### 3. Fix something on the roadmap

The [Roadmap](roadmap.md) marks the items that are self-contained enough to pick
up without a long conversation first.

### 4. Build an effect or a panel

Self-contained, low-risk, and immediately useful to everyone. See
[Effects and Transitions](developer/effects-and-transitions.md) and the
[Panels API](developer/panels.md).

### 5. Argue with a decision

The repository's engineering log records the reasoning behind every significant
trade-off, specifically so it can be challenged later with the context intact.
If one of them is wrong, say so and say why. Bring a case, not a preference.

---

## Reporting a bug

A good report has:

1. What you did, in enough detail to repeat.
2. What you expected, and what happened.
3. Browser and version, and whether it is reproducible from a fresh project.
4. The media involved, if the media is relevant — codec, container, resolution,
   frame rate. `.mp4` is not a codec.
5. Console output, and the Debug HUD (`Shift+D`) if it is a playback or memory
   problem.

If it is a rendering problem, say what you saw _and where_: "black frame in the
preview but the export is correct" and "black in both" are different bugs in
different subsystems.

### Reporting a documentation bug

If a page in this wiki disagrees with the app, the app is right and the page is
wrong. Quote the line and say what actually happens.

The wiki is meant to be updated in the same change as the code — see
[`CLAUDE.md`](../CLAUDE.md) for the mapping from source area to wiki page. A page
that has drifted is a defect, not a chore for later.

---

## Setting up

```sh
git clone <repository-url> vide-os
cd vide-os
pnpm install
pnpm dev

pnpm exec playwright install chromium   # once, for browser-mode tests
```

Before you push:

```sh
pnpm check          # typecheck + lint + format check + test + build
pnpm test:browser   # anything touching WebGL2, WebCodecs, or a panel
pnpm test:perf      # the performance budgets
```

CI runs both on every push and pull request. It will not merge red.

---

## The conventions that are load-bearing

These are not style preferences. Each one exists because its absence caused a
specific, documented bug.

### Every user action is a command

Adding an action means adding a `Command`, never a second implementation of one
that exists. See [Commands API](developer/commands.md).

### Every document mutation goes through `applyEdit`

Not through a store setter, not by mutating a signal. `applyEdit` validates
against the invariants in development and records one undo step. If your feature
needs state that is _not_ undoable — a playhead, a selection, a zoom level — it
belongs in a UI store, not in the document.

### One drag is one undo step

`beginInteraction()` … live edits … `commitInteraction(label)`. And `Escape`
must abort. Users expect both.

### Times are integer frames

If you are writing a `number` that means seconds, stop and check.

### No floating promises

`no-floating-promises` is an **error**, not a warning. It alone would have caught
the un-awaited `renderFrame()` that let concurrent renders corrupt shared GL
state — the single worst bug in this codebase's history.

### Iterate stable ids in `For`, not objects

Structural sharing means every edit produces a new object and Solid compares by
reference. Iterating objects rebuilds the DOM node and takes any focused input's
caret with it. This has happened in two separate panels.

### Explain the "why" in the code

The codebase is unusually heavily commented, and the comments are about
_reasoning_, not mechanics. `// increment i` is noise. `// Compared by id: track()
returns a fresh draft proxy on each call, so identity comparison took the
cross-track path` is why the next person does not reintroduce the bug.

### A phase is not complete until its gaps are written down

If you deliver 90% of something, the missing 10% goes in the engineering log
before you call it done. The failure mode this prevents is real: four specified
items were once never built, never recorded, and therefore read as done for
months.

---

## Testing

Six tiers, and it is usually obvious which one a change needs.

| Tier            | What it covers                                                                             | Where                     |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| **Unit**        | Keyframe evaluation, geometry round-trips, timecode, subtitle formats, chord parsing       | `test/unit/`              |
| **Property**    | Random sequences of split/trim/move/delete; invariants hold, and undo returns the original | `test/unit/edits.test.ts` |
| **Render**      | Real WebGL2, probing named pixels; layer stacking, Y orientation, frame-leak assertions    | `test/browser/`           |
| **Determinism** | Export, demux the result, assert exact frame count, timestamps, and burned-in counters     | `test/browser/`           |
| **Component**   | Mount the real panel, dispatch real pointer events, assert on the document                 | `test/browser/*.test.tsx` |
| **Perf**        | Budgets: scene build under 2 ms at 1000 clips, a preview frame under a display frame       | `test/perf/`              |

Timing assertions are made non-flaky three ways: the **median** rather than the
worst sample, numbers **always printed** whether they pass or fail, and a
`VITE_PERF_ALLOWANCE` multiplier for slower machines. CI sets it — 3× for the
Node suite, 5× for the browser one, where the runner has no GPU and Chromium
falls back to software rasterization. The budget still catches what it exists
for: a frame that has started costing an order of magnitude more than it did.

### Two rules about tests

**A test whose setup performs a step the application must also perform is not
testing the application.**

This one was earned. Every renderer test warmed the decoder cache by awaiting
`getExact` before rendering — which is the one thing the app did _not_ do. So the
preview could be black on every launch with the whole suite green: the
compositor was proven correct, and nothing was proven to ask it for anything. The
fix was not more coverage. It was coverage of the _join_: mount the real panel,
put a clip on a real lane, and wait for a picture without priming anything.

Watch for this shape anywhere. Any place a test constructs state the app is
responsible for constructing is a place a whole feature can go missing with no
red test.

**A fixture has to be robust to the transformation under test.**

The first frame-counter fixture encoded each frame's number in its fill colour.
H.264 is lossy and 4:2:0, so frame 3 decoded as 514 and six frame-accuracy tests
failed for that reason alone — none of them because the engine was wrong. It now
encodes the number as black-and-white blocks read by luma threshold, because
maximum contrast is precisely what a codec preserves best.

### Traps in browser-mode tests

- **No stylesheet is loaded.** Tailwind's `absolute` never applies and every
  element measures at the origin. Assert on inline offsets or on _relative_
  motion, never on rendered rectangles.
- **Panels are in shadow DOM.** Synthetic events need `composed: true` or they
  never cross the boundary and your handler silently does not run.
- **Do not read the preview canvas.** `preserveDrawingBuffer` is false; reading
  it from a later task returns black whatever was drawn. Read the composite
  framebuffer.
- **Restart the dev server after editing source.** Vite HMR forks module
  instances, so a test importing a store can bind to a stale copy and conclude
  the UI is not reactive.

Two of those four were initially diagnosed as product bugs. They are not.

### Test media

Generated, never committed. `test/fixtures/make-media.ts` encodes a short clip
with a burned-in binary frame counter and a test tone. That makes
frame-accuracy assertions trivial and keeps binaries out of git.

---

## Pull requests

- **One concern per PR.** A refactor and a feature in one diff cannot be
  reviewed properly.
- **Say what you changed and why.** Link the finding or the roadmap item.
- **Include the test.** If the change is not testable, say why in the PR.
- **Record trade-offs in the engineering log** if you took any — including
  "I left this worse than ideal because X".
- **Update the documentation in the same PR.** The architecture notes once
  drifted far enough to mislead, marking eight built systems as "planned" and
  describing two deleted files in the present tense. A document that is wrong
  about what exists is worse than no document, because it gets consulted instead
  of the code.

Prettier and ESLint settle formatting. Do not argue about it; run `pnpm format`.

---

## Deciding scope

The [Introduction](introduction.md#what-it-is-not) lists what VideOS explicitly
will not do. Those refusals are what let a small project ship something good
rather than half of something enormous.

If you want to change one, that is a legitimate conversation — open an issue and
make the case. "It would be cool" is not the case. "Here is who needs it, here is
what it costs the model, here is why the boundary is in the wrong place" is.

---

## Licence

**Not yet chosen.** This is a genuine open question and it needs settling before
the project can meaningfully accept large contributions. If you have an informed
opinion about the right licence for an open editor that wants a plugin ecosystem
around it, that is a useful conversation to have now rather than later.

---

**See also:** [Developer Guide](developer/README.md) · [Roadmap](roadmap.md)
