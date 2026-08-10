# The Document

The project document is the single source of truth. Everything the exported file
depends on is in it, every mutation goes through one function, and undo is a
snapshot rather than an inverse.

---

## The shape

```ts
// src/model/doc.ts

interface ProjectDoc {
  formatVersion: number; // currently 4
  name: string;
  sequence: Sequence;
  assets: Asset[];
  tracks: Track[];
  markers: Marker[];
  subtitles: SubtitleCue[]; // a list, not clips on a track
}

interface Sequence {
  frameRate: FrameRate; // { num: 30000, den: 1001 } for 29.97
  width: number;
  height: number;
  sampleRate: number;
  subtitleStyle: SubtitleStyle;
  burnInSubtitles: boolean;
}

interface Track {
  id: string;
  name: string;
  kind: "video" | "audio";
  clips: Clip[]; // always sorted, always non-overlapping
  transitions: Transition[]; // edges between adjacent clips
  muted: boolean;
  soloed: boolean;
  locked: boolean;
  heightPx: number;
}

interface Clip {
  id: string;
  source: ClipSource; // asset | text | solid

  startFrame: number; // position on the timeline
  durationFrames: number; // always > 0
  inPointFrames: number; // first source frame shown, always >= 0

  speed: number; // 2 plays twice as fast, consumes 2x source
  linkedAudio: boolean;
  enabled: boolean;

  opacity: Animatable<number>;
  volume: Animatable<number>;
  pan: Animatable<number>; // -1 hard left … +1 hard right
  fadeInFrames: number;
  fadeOutFrames: number;

  transform: Transform;
  crop: Crop;
  fit: FitMode; // contain | cover | fill | none
  blend: BlendMode; // normal | add | screen | multiply
  effects: ClipEffect[];
}

type ClipSource =
  | { type: "asset"; assetId: ContentKey }
  | { type: "text"; style: TextStyle }
  | { type: "solid"; color: string };
```

### Two rules that shape everything

**1. All times are integer frames.** Seconds are a derived view. Float seconds
made split, trim and snap approximate: butted clips developed sub-frame gaps,
and a value that survived a save could differ from the one that produced it. The
frame rate is rational so 29.97 and 23.976 are exact.

**2. Media is referenced by content key.** An `Asset.id` is a SHA-256 over the
first and last megabyte of the file plus its length — what the media _is_, not
an id minted at import. That is what makes a project file reopenable on another
machine and relinkable by identity.

### Constructors and queries

```
createEmptyDoc(name?)                     // 2 video + 2 audio tracks, 1080p30
createClip(source, startFrame, durationFrames, overrides?)
createTrack(kind, name, overrides?)
cloneClip(clip, newId)                    // deep; every nested id minted fresh

clipEndFrame(clip)                        // exclusive: [start, end)
clipSourceSpan(clip)                      // duration × speed, rounded
sourceFrameAt(clip, timelineFrame)
findTrack(doc, trackId)
findClip(doc, clipId)                     // → { track, clip }
findAsset(doc, assetId)
clipAt(track, frame)
contentEndFrame(doc)                      // last frame any clip occupies
snapFrames(doc, excludeClipId?)           // clip edges + markers + 0
assetDurationFrames(asset, rate)          // null when unknown — do not clamp
```

---

## Making an edit

Every mutation goes through `applyEdit`. It hands you a **mutative draft**,
validates the result against the document invariants in development, and records
exactly one undo step.

```ts
import { applyEdit } from "@/stores/project-store";
import * as edits from "@/model/edits";

applyEdit(
  "Split clip",
  (draft) => {
    edits.splitClip(draft, trackId, clipId, frame);
  },
  { icon: "✂" },
);
```

```ts
interface ApplyOptions {
  icon?: string;
  /** Edits sharing a key within the coalesce window collapse into one step.
   *  Use for continuous input — slider drags, typing. */
  coalesceKey?: string;
  /** Selection to record with this step. */
  selection?: readonly ClipRef[];
  /** Overrides the clock, for tests. */
  now?: number;
}
```

The recipe's return value is ignored. Mutate the draft.

### Drags: one gesture, one step

```ts
beginInteraction(); // start of the drag
// … applyEdit repeatedly, live, on every pointer move …
commitInteraction("Move clip", "↔"); // one undo entry
// or
abortInteraction(); // Escape: restore the pre-drag doc
```

A drag that returns to exactly where it started records nothing. The comparison
is by **value**, not by reference — every frame of a drag produces a new document
object, so a reference comparison recorded an undo step that did nothing. The
value comparison short-circuits on reference identity at every level, so it walks
only what the drag actually touched.

### A rule for live drags: make the operation absolute

A live drag reports its **total** offset from the gesture's start and re-applies
on every pointer move. A relative operation therefore accumulates — a ten-frame
drag becoming fifty-five frames of edit. That is why `edits.ts` exposes
`slipClipTo`, `slideClipTo` and `rollEditTo` alongside the relative forms.

---

## The edit vocabulary

All of these take a draft as their first argument and live in
[`src/model/edits.ts`](../../src/model/edits.ts).

### Clips

```
insertClip(doc, trackId, options)          removeClip(doc, trackId, clipId)
removeClips(doc, refs)                     rippleDelete(doc, refs)
moveClip(doc, trackId, clipId, options)    moveClips(doc, moves)
nudgeClips(doc, refs, deltaFrames)         splitClip(doc, trackId, clipId, frame)
trimClipStart(...)                         trimClipEnd(...)
slipClip / slipClipTo                      slideClip / slideClipTo
rollEdit / rollEditTo                      rippleTrim(doc, trackId, clipId, side, frame)
setClipSpeed(...)                          setClipSettings(...)
copyClips / pasteClips / duplicateClips
threePointEdit(doc, trackId, spec)
```

`moveClips` takes the **whole set at once**. Looping over `moveClip` scatters a
group: each move sees the others still in place and shoves itself past them, so
dragging three butted clips one frame right pushes them apart. `moveClips`
detaches the set first, so each clip is placed against what is _staying_.

### Tracks, markers, captions, sequence

```
addTrack / removeTrack / reorderTrack / setTrackFlag / setTrackHeight
addMarker / removeMarker / updateMarker
addCue / removeCue / updateCue / setCues / splitCue
setSubtitleStyle / setBurnInSubtitles
setSequence / renameProject
upsertAsset / setAssetProblem / pruneUnusedAssets
addTransition / removeTransition
```

### Invariants

Checked after every edit under `import.meta.env.DEV`, so a broken edit surfaces
at the operation that caused it rather than as a rendering oddity three actions
later. Each invariant corresponds to a bug that existed when it was merely
assumed:

| Invariant                       | The bug it prevents                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Clips sorted by start frame     | Split pushed the new clip to the end, so render order depended on edit history                                 |
| Clips non-overlapping           | Move had no overlap check; the compositor picked whichever it scanned first                                    |
| In/out points inside the source | Trim clamped only the minimum, so a clip could be dragged past the end of its media into a silent freeze frame |
| Duration > 0                    | Zero-length clips divide by zero in transition progress                                                        |

```ts
validateDoc(doc): Violation[]
isDocValid(doc): boolean
assertDocValid(doc, context?): void   // throws
```

---

## Animatable parameters

Twelve clip properties and every effect uniform are the same thing: a number (or
vector) with optional keyframes.

```ts
interface Animatable<T = number> {
  value: T; // the base value, used when there are no keys
  keys?: Keyframe<T>[];
}

interface Keyframe<T = number> {
  id: string;
  timeFrames: number; // CLIP-relative, not timeline-relative
  value: T;
  interp: "hold" | "linear" | "bezier";
  out?: [number, number]; // bezier handles
  in?: [number, number];
}
```

Keyframe times are **clip-relative**, which is why moving a clip moves its
animation with it.

### Addressing a parameter

```ts
type ParamTarget =
  | { kind: "clip"; path: ClipParamPath }
  | { kind: "effect"; effectId: string; uniform: string };

clipParamPath("transform.x"); // → ParamTarget
effectParam(effectId, "u_radius"); // → ParamTarget
```

`ClipParamPath` covers `opacity`, `volume`, `pan`, `transform.{x,y,scaleX,scaleY,rotation}`
and `crop.{left,right,top,bottom}`.

**Anchor is deliberately not animatable.** It defines what position, scale and
rotation are relative to.

### Reading and writing from a panel

```ts
readParam(trackId, clipId, target): ParamView | null
writeParam(trackId, clipId, target, value, label?)
toggleParamAnimation(trackId, clipId, target)
toggleParamKey(trackId, clipId, target)
setParamKeyInterp(trackId, clipId, target, keyId, interp)
clearParamKeys(trackId, clipId, target)
seekToAdjacentKey(trackId, clipId, target, direction)

interface ParamView {
  value: ParamValue;    // evaluated at the playhead
  animated: boolean;
  keys: readonly Keyframe<ParamValue>[];
  keyedHere: boolean;   // a key sits exactly on the playhead
  inRange: boolean;     // the playhead is inside the clip
}
```

Three behaviours are load-bearing:

- **`writeParam` writes a keyframe when the parameter is animated.** Otherwise
  it would change the base value and nothing would move on screen, because the
  keys win. This branch is the only subtle thing in the parameter API, which is
  why there is exactly **one** setter rather than twelve.
- **The stopwatch and the diamond are separate operations.** Conflating them is
  how a parameter ends up marked animated with no keyframes behind it.
- **Switching animation off freezes the value at the playhead** rather than
  reverting to the base value.

`writeParam` coalesces by `param:<clipId>:<target>`, so a slider drag is one
undo step.

---

## Undo

Undo is a **document snapshot with structural sharing**. There are no
hand-written inverses, and there will not be.

```ts
undo(): boolean          redo(): boolean
canUndo(): boolean       canRedo(): boolean
historyEntries()         goToEntry(index)
```

Command-based undo requires every mutation to ship a correct inverse — a promise
every new feature gets a chance to break. Three inverses were already wrong when
this changed. A snapshot cannot be got wrong; six phases of new operations have
since landed and none needed one written by hand.

The cost is memory, and structural sharing pays it: an edit to one track shares
every other track by reference, so a step on a large project costs kilobytes.

**One known limitation:** registering an asset is not an undo step. Making it one
would put an entry per file in the history and desync from the media pool, which
has no undo of its own. So an asset registered after an undo is lost on the
subsequent redo, and re-registered the next time the media is used.

---

## The stores

Solid wiring over the model. Panels read these; nothing else should hold state
that affects the output.

| Store                 | Owns                                               | Undoable |
| --------------------- | -------------------------------------------------- | -------- |
| `project-store`       | the document, the playhead, every document mutator | the doc  |
| `history-store`       | the undo/redo view                                 | —        |
| `timeline-store`      | selection, snap toggle, target track               | no       |
| `timeline-view-store` | zoom, scroll, viewport width, track heights        | no       |
| `ui-store`            | panel layout, selected tool, theme, debug HUD flag | no       |
| `media-store`         | the media pool's entries and file handles          | no       |
| `media-problems`      | derived: which assets cannot currently be used     | no       |
| `source-store`        | the source monitor's asset, position and marks     | no       |
| `recent-projects`     | the File menu's recent list                        | no       |

**The playhead is not in the document.** A playhead position is not an edit and
must not be undoable.

Persistence: UI preferences and timeline view go to `localStorage`; the document
autosaves to OPFS; project files are written through the platform layer.

---

## The file format

A `.videos` file is a zip:

```
project.json          the document
media.json            asset table with relink hints
thumbnails/<key>.jpg  optional, regenerable
waveforms/<key>.bin   optional, regenerable
```

A bare `project.json` is also valid input, so the bundle is a strict superset and
a project stays diffable and hand-editable.

```ts
packBundle({ doc, media, extras? }): Bytes
readProjectFile(bytes): { doc, media, warnings }
serializeDoc(doc) / parseDoc(bytes)
mediaTableFromDoc(doc)
projectFileName(name)
```

`readProjectFile` runs the migration chain (v1 → v4) and validates against the
invariants **before** anything is swapped in. Anything the migration had to
change comes back as a warning and is shown to the user, because most warnings
mean there is something to fix.

If you add a field to the document, add a migration step. The chain is in
[`src/model/migrate.ts`](../../src/model/migrate.ts).

---

## Testing an edit

Edit operations are covered by **property tests**: random sequences of
split/trim/move/delete, asserting clips stay sorted and non-overlapping with
valid in/out points — then undoing everything and asserting deep equality with
the original.

Three of the four rounding bugs in this codebase's history were found by a single
property, _"every clip stays inside its source"_, each at a different random
seed. One run of 300 sequences was not enough to surface them all. The suite
therefore runs a **20,000-sequence sweep before each commit that touches
`edits.ts`**. If you change that file, run it.

Source: [`src/model/`](../../src/model/),
[`src/stores/project-store.ts`](../../src/stores/project-store.ts),
[`src/lib/animation.ts`](../../src/lib/animation.ts).

---

**See also:** [Commands API](commands.md) · [Panels API](panels.md) ·
[Contributing](../contributing.md)
