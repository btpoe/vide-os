# Timeline

The edit itself. Tracks, clips, trims, markers, captions, and the playhead.

---

## Anatomy

```
┌────────────────────────────────────────────────────────────────────────┐
│ 00:00:04:12 / 00:01:23:07 │ +Video +Audio │ Snap │  Fit Frame − 16px/s +│  toolbar
├──────────────┬─────────────────────────────────────────────────────────┤
│              │ 0s      5s      10s     15s     20s     25s             │  ruler
│──────────────┼─────────────────────────────────────────────────────────┤
│ Markers      │      ◆Intro          ◆Pickup                            │  marker lane
│──────────────┼─────────────────────────────────────────────────────────┤
│ Captions     │  ▭ so anyway ▭ and then                                 │  caption lane
│──────────────┼─────────────────────────────────────────────────────────┤
│ 🎬 Video 1 🔊🔓│  ▓▓▓▓ shot-a.mp4 ▓▓▓▓│▓▓▓ shot-b.mp4 ▓▓▓              │  track
│ 🎬 Video 2 🔊🔓│              ▓ title ▓                                 │
│ 🎵 Audio 1 🔊🔓│  ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿                          │
└──────────────┴─────────────────────────────────────────────────────────┘
   sticky headers                          one horizontal scroller
```

Structurally this is **one** horizontally scrolling strip containing the ruler,
every lane, and a single playhead overlay. Track headers are `position: sticky`
to its left edge rather than a separate column — which is what makes it
impossible for the ruler, the lanes and the headers to drift out of alignment.

---

## The toolbar

| Control                     | What it does                                                                  |
| --------------------------- | ----------------------------------------------------------------------------- |
| `00:00:04:12 / 00:01:23:07` | Playhead timecode, and the end of the _content_ — not a fixed project length. |
| **+ Video** / **+ Audio**   | Appends a track.                                                              |
| **Snap**                    | Toggles snapping (`S`). Highlighted when on.                                  |
| **Fit**                     | Fits the whole edit in the panel (`Shift+Z`).                                 |
| **Frame**                   | Zooms until individual frames are addressable (`⌘0`).                         |
| **− / +** and `16 px/s`     | Zoom out and in. The readout is pixels per second.                            |

> Zoom is shown as pixels-per-second rather than a percentage, because a
> percentage of _what_ was never defined — and the old percentage readout was
> decoration anyway, since zoom used to affect only ruler tick density.

---

## Navigating

### Scrubbing

Drag in the **ruler**, or click empty space on any track. Both move the
playhead; clicking a lane also clears the selection.

Dragging past the left or right edge auto-scrolls, so you can scrub beyond the
visible range without letting go.

### Zoom and pan

| Gesture                       | Result                                          |
| ----------------------------- | ----------------------------------------------- |
| `⌘`-scroll, or trackpad pinch | Zoom, anchored at the pointer                   |
| `Shift`-scroll                | Pan horizontally                                |
| Plain scroll                  | Scroll normally (vertical, or horizontal wheel) |
| `⌘+` / `⌘−`                   | Zoom in / out about the centre                  |
| `Shift+Z`                     | Fit the whole edit                              |
| `⌘0`                          | Zoom to frame level                             |

The range runs from **0.5 px/s** — roughly four hours across a wide panel — to
**600 px/s**, which is a single frame several pixels wide.

Zoom is **cursor-anchored**: the frame under the pointer stays under the
pointer. The one exception is at the very start of the timeline, where holding
the anchor would mean scrolling to a negative position; the view pins to the
left edge instead.

Zoom level and scroll position persist between sessions. Losing your place on
reload is annoying.

### Timecode and the ruler

Ruler ticks are generated only for what is on screen, at a spacing that keeps
labels readable, so the cost does not grow with project length. Labels show
full timecode (`HH:MM:SS:FF`) once a frame is at least three pixels wide, and
coarse durations when zoomed further out.

---

## Tracks

A new project has **Video 1, Video 2, Audio 1, Audio 2**. Video tracks composite
top-down in the order shown; audio tracks all mix together.

### The track header

| Control       | What it does                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 🎬 / 🎵 badge | Kind indicator _and_ the **target track**. Click to arm it: three-point edits from the Source monitor land here. Highlighted when armed. |
| Name          | The track's name.                                                                                                                        |
| 🔊 / 🔇       | Mute. A muted track contributes nothing to the mix.                                                                                      |
| 🔓 / 🔒       | Lock.                                                                                                                                    |
| Bottom edge   | Drag to change lane height, between 28 px and 240 px. Stored per track, per browser.                                                     |

Solo lives in the [Mixer](mixer.md), because solo is a mix decision.

### Track kinds

A clip cannot be dragged from a video track to an audio track or the reverse —
the move is simply refused rather than producing something meaningless.

---

## Clips

### What a clip shows you

| Element       | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| Colour        | Blue = video, green = audio, purple = title. Brighter and outlined = selected. |
| Name          | The source file, or the title's own text. Hidden below 28 px wide.             |
| ⚠ before name | The media is offline. The clip and its edits are intact; the link is not.      |
| Filmstrip     | Video clips. Frames from the source, spanning what the clip actually shows.    |
| Waveform      | Audio clips. Min/max envelope, in the bottom half of the lane.                 |
| Faded         | The clip is disabled (**Properties ▸ Compositing ▸ Visible**).                 |

Decorations are skipped below 48 px wide, where they would cost more than they
convey.

#### Why the decorations follow your edits

Both the waveform and the filmstrip are indexed by **source time**, not by
position on the timeline. Trim a clip and you reveal a different part of the
waveform rather than stretching it; slip it and the filmstrip slides; change its
speed and both re-map. Nothing is regenerated, because nothing needs to be.

Past the end of the media, peaks read as silence and filmstrip tiles hold the
last frame — a clip overrunning its source should _look_ like what it is.

Peaks are computed once per file, in a worker, as a mip pyramid, and cached to
browser storage. Drawing costs one column per pixel whether the file is two
seconds or an hour long, and the second time you open a project the decorations
appear without decoding anything.

Filmstrips are one sprite sheet per file, capped at 120 tiles. On an hour-long
file that means a tile every thirty seconds, so at high zoom consecutive tiles
repeat — the alternative was unbounded decoding for a decoration.

Video clips do not show a waveform. Which decoration a clip gets is decided by
its **track**, not by what happens to be cached, so a video clip cannot sprout a
waveform just because a copy of the same file is sitting on an audio track.

### Selecting

| Gesture                   | Result                                    |
| ------------------------- | ----------------------------------------- |
| Click a clip              | Select it                                 |
| `Shift`-click / `⌘`-click | Add to or remove from the selection       |
| `⌘A`                      | Select every clip                         |
| `Escape`                  | Deselect all                              |
| Click empty track space   | Deselect all, and move the playhead there |

Clicking a clip that is _already_ selected narrows the selection to it. Dragging
it moves the whole group. VideOS decides which happened on pointer-**up**,
because on pointer-down there is no way to tell.

### Moving

Drag a clip body. If the grabbed clip is part of the selection, the whole
selection moves — and it moves **as a group**, so butted clips stay butted
rather than shoving each other out of the way.

Drag vertically to change track. The target track is read from the lane under
the pointer rather than from a pixel calculation, so it stays correct after you
have resized lanes.

`Shift+←` / `Shift+→` nudges the selection by **one frame**.

### The four things you can do to an edge

One handle, four operations, chosen by tool and modifier:

| Gesture                               | Operation       | What happens                                                                                     |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| **Select** tool, drag an edge         | **Trim**        | This clip's edge moves. A gap opens or closes.                                                   |
| **Select** tool + `Alt`, drag an edge | **Ripple trim** | The edge moves and everything after it shifts to match.                                          |
| **Trim** tool, drag an edge           | **Roll**        | The cut moves. One clip grows by exactly what the other loses; the sequence length is unchanged. |
| **Razor** tool, click a clip          | **Split**       | One clip becomes two at that frame.                                                              |

And two that are grabs of the clip **body** rather than an edge:

| Tool      | Operation | What happens                                                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| **Slip**  | Slip      | What the clip _shows_ changes; where it sits and how long it is do not. Dragging right shows later material. |
| **Slide** | Slide     | The clip moves between its neighbours, which absorb the difference. Its content and duration are unchanged.  |

Four operations on one handle beats four handles. Every one of them is bounded
by the material actually available: you cannot trim a clip past the end of its
source, and a slide is limited by how much handle each neighbour has.

### While dragging

- A **snap guide** appears when an edge is about to land on a snap target.
- `Escape` **aborts** and restores the document to before the drag.
- The whole drag is **one** undo step, however many pointer moves it took.

### Snapping

`S` toggles it. Snap targets are every clip start and end, every marker, and
frame zero. The threshold is measured in **pixels**, not frames, so snapping
feels identical at every zoom level — a frame-based threshold would be
unusably sticky zoomed out and useless zoomed in.

While dragging a clip, either edge can snap — whichever is closer. Butting a
clip up against the next one is as common as aligning its head.

### Clipboard and deletion

| Shortcut       | Action                                       |
| -------------- | -------------------------------------------- |
| `⌘C`           | Copy                                         |
| `⌘X`           | Cut                                          |
| `⌘V`           | Paste at the playhead                        |
| `⌘D`           | Duplicate                                    |
| `Delete` / `⌫` | Delete, leaving a gap                        |
| `Shift+Delete` | **Ripple delete** — remove and close the gap |

Copies are deep: every effect and keyframe id inside a pasted clip is minted
fresh, so no two clips ever share a nested id.

---

## Adding clips

| Route                                            | Result                                               |
| ------------------------------------------------ | ---------------------------------------------------- |
| Drag from the [Media Pool](media-pool.md)        | A clip at the drop position                          |
| Drag from the [File Browser](file-browser.md)    | Imports the file, then places a clip                 |
| [Source monitor](source-monitor.md) Insert (`,`) | Inserts at the playhead, pushing everything after it |
| Source monitor Overwrite (`.`)                   | Overwrites at the playhead                           |
| **Text** tool (`X`), click a track               | Creates a title clip there                           |

The lane you are dragging over highlights as a drop target.

---

## The marker lane

Markers belong to the _sequence_, not to a clip, so they get their own lane
between the ruler and the tracks. Moving a clip does not move a note about the
edit.

| Gesture                     | Result                                      |
| --------------------------- | ------------------------------------------- |
| `M`                         | Drop a marker at the playhead               |
| Drag a pin                  | Move it, snapping to clip edges             |
| Double-click or right-click | Open the editor: name, note, colour, delete |
| `Shift+M` / `Shift+Alt+M`   | Jump to the next / previous marker          |

Six colours, named, because "the red ones are pickups" is how people actually
use them. The full list, and chapter export, live in the
[Markers panel](markers.md).

## The caption lane

Only appears when the project has captions. Drag a cue to move it, drag its
edges to change how long it stays on screen. Writing the text happens in the
[Captions panel](captions.md); this lane is for seeing a caption overrun a shot
or a silence with nothing over it.

---

## Performance

Only clips intersecting the viewport are rendered, with a margin either side so
edges scrolling in are already drawn. This is _culling_, not virtualisation —
one filter per track, and it does not break dragging a clip across the boundary
of a recycled row.

Content width comes from the actual last clip end. Project duration is not a
layout input at all, which is why an empty timeline behaves and a four-hour one
does not need a setting.

---

## Under the hood

Worth knowing if you are debugging or contributing:

- Positions are **pixels-per-frame plus a scroll offset**, not a percentage of
  project duration. That single change is what made zoom possible.
- Zoom limits are expressed per _second_, so 24 fps and 60 fps material zoom to
  the same visible duration rather than the same pixels-per-frame.
- There are two coordinate spaces and confusing them is silent: _content x_ is
  measured inside the scrolling strip and is what clips and ticks position in;
  _viewport x_ is measured against the panel. Content x = 0 sits one track-header
  width to the right of the strip's left edge.
- Every drag applies edits live and commits one undo step on release, via
  `beginInteraction` / `commitInteraction` / `abortInteraction`.
- Slip, slide and roll are applied in **absolute** form. A live drag reports its
  total offset and re-applies on every pointer move, so a relative operation
  would accumulate — a ten-frame drag becoming fifty-five frames of edit.

Source: `src/panels/TimelinePanel.tsx`, `src/panels/timeline/`,
`src/lib/timeline-geometry.ts`, `src/model/edits.ts`.

---

**See also:** [Tools](tools.md) · [Properties](properties.md) ·
[Markers](markers.md) · [Captions](captions.md)
