# Developer Guide

How VideOS is put together, and how to build on it.

---

## First: what "plugin" means here today

**There is no plugin loader.** VideOS does not download, sandbox, or dynamically
import third-party code. There is no manifest format, no `plugins/` directory,
and no published npm package to build against.

What there _is_ — and it is genuinely the extension surface, not a
consolation prize — is a set of **registries** that the app itself uses for
everything it does:

| Registry                | You register           | Used by                                | Documented in                                         |
| ----------------------- | ---------------------- | -------------------------------------- | ----------------------------------------------------- |
| Panel registry          | `PanelDefinition`      | the docking layout and the View menu   | [Panels API](panels.md)                               |
| Command registry        | `Command`              | menus, buttons, keyboard shortcuts     | [Commands API](commands.md)                           |
| Effect definitions      | `EffectDefinition`     | the Effects panel and the GPU pipeline | [Effects and Transitions](effects-and-transitions.md) |
| Transition definitions  | `TransitionDefinition` | Properties and the render graph        | [Effects and Transitions](effects-and-transitions.md) |
| Platform implementation | `Platform`             | everything that touches a file         | [The Platform Seam](platform.md)                      |

Every built-in panel, command, effect and transition goes through these. Nothing
in the app has a private path around them. So an extension you write is a
first-class citizen in every respect except one: **today it is compiled in**.

That means a fork or a branch, not a drop-in bundle. It is a real limitation and
it is on the [Roadmap](../roadmap.md). Documenting the registries now — with
their exact signatures and their invariants — is what makes a future loader a
loading mechanism rather than a redesign.

If you are building something now, build against these interfaces. When the
loader lands, that is the code it will load.

---

## The shape of the app

```
index.tsx ──> App.tsx ──> <ve-panel-layout>   docking, shadow DOM
                 │              └─> <ve-panel> × N ──> Solid components
                 ├─> commands/   every user action, one registry
                 └─> stores/     project, ui, media, timeline, source, view

model/          the document: frames, edits, invariants, snapshot history, io
platform/       one interface; web implementation (FS Access, OPFS, IndexedDB)
media/          WebCodecs decode per clip instance, refcounted frame cache
audio/          one graph function, shared by live playback and offline render
playback/       one clock, derived from AudioContext
renderer/       scene (pure data) ──> graph (synchronous WebGL2)
export/         codec negotiation, deterministic frame loop, muxing
lib/            timecode, keyframes, geometry, waveforms, thumbnails
```

Full detail, including the reasoning behind each boundary, is in the
architecture notes kept with the source. The five rules below are the ones you
need before writing any code.

### 1. The document is the single source of truth

Everything the project _is_ lives in one immutable `ProjectDoc`. Every mutation
goes through `applyEdit`, which mutates a draft, validates the result against
the document invariants in development, and records one undo step.

There is no second place to write state that affects the output. UI preferences
(layout, zoom, selected tool) are separate stores and are explicitly _not_ part
of the document.

→ [The Document](document.md)

### 2. All times are integer frames

The frame rate is rational (`{num: 30000, den: 1001}` for 29.97). Seconds are a
derived view. If you find yourself adding a `number` field that means seconds,
stop and check whether it should be frames.

### 3. The render graph is synchronous and pure

```
buildScene(doc, timeFrames) -> Scene       // pure, no GL, no async
composeFrame(gl, scene, frames, target)    // synchronous GL only
```

All decoding resolves _before_ the graph runs. `Scene` is plain data — ordered
layer operations with already-evaluated numeric parameters — which makes it
snapshot-testable and worker-transferable.

Preview and export are two schedulers over the same graph, differing in exactly
one hook. That is what makes "the export matches the preview" structural rather
than aspirational.

### 4. Every user action is a command

Menus, toolbar buttons and keyboard shortcuts all dispatch through one registry,
so an action has exactly one implementation and one enabled-state predicate.
Adding an action means adding a command, never a second implementation of one
that exists.

→ [Commands API](commands.md)

### 5. Nothing outside `platform/web/` touches `FileSystemFileHandle`

The whole host boundary is `platform.fs.read(ref, range)` plus
`createWritable(ref)`. A byte-range reader is everything a demuxer needs, which
is why the desktop port is a port.

→ [The Platform Seam](platform.md)

---

## Getting set up

```sh
pnpm install
pnpm dev
pnpm check      # typecheck + lint + test + build — the full gate
```

Path alias: `@/` maps to `src/`.

Stack: SolidJS 1.9, TypeScript 5.7, Vite 6, Tailwind 4, Mediabunny (demux/mux),
mutative (drafts), fflate (zip), Vitest 4 (+ Playwright as the browser-mode
driver).

---

## Where to start reading

| If you want to…           | Read this first                                                              |
| ------------------------- | ---------------------------------------------------------------------------- |
| Add a panel               | [`src/web-components/registry.ts`](../../src/web-components/registry.ts)     |
| Add an action or shortcut | [`src/commands/definitions.ts`](../../src/commands/definitions.ts)           |
| Add an effect             | [`src/renderer/effects-pipeline.ts`](../../src/renderer/effects-pipeline.ts) |
| Change how an edit works  | [`src/model/edits.ts`](../../src/model/edits.ts)                             |
| Understand playback       | [`src/playback/clock.ts`](../../src/playback/clock.ts), then `scheduler.ts`  |
| Understand rendering      | [`src/renderer/scene.ts`](../../src/renderer/scene.ts), then `graph.ts`      |
| Understand decoding       | [`src/media/engine.ts`](../../src/media/engine.ts)                           |
| Port to a new host        | [`src/platform/types.ts`](../../src/platform/types.ts)                       |

---

## Sections

- **[Panels API](panels.md)** — register a dockable panel
- **[Commands API](commands.md)** — actions, shortcuts, menus, enabled state
- **[Effects and Transitions](effects-and-transitions.md)** — write a shader
- **[The Document](document.md)** — edits, undo, keyframes, and the stores
- **[The Platform Seam](platform.md)** — files, cache, transcode
