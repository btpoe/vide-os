# Captions

Subtitles: import them, write them, time them, style them, and decide whether
they are burned into the picture.

---

## The toolbar

| Button        | What it does                                     |
| ------------- | ------------------------------------------------ |
| **+ Caption** | Adds a cue at the playhead                       |
| **Import**    | Opens a file picker for `.srt`, `.vtt` or `.txt` |
| **.srt**      | Downloads the captions as SubRip                 |
| **.vtt**      | Downloads them as WebVTT                         |
| **Style**     | Toggles the styling section                      |

Import **replaces** the caption list in one undo step. If some blocks could not
be parsed, it says how many rather than swallowing the problem — a file that
half-parsed usually has a real problem in it.

## The list

One row per cue, in time order, with the active cue highlighted as the playhead
passes through it.

| Element        | What it does                                           |
| -------------- | ------------------------------------------------------ |
| Start timecode | Click to seek there                                    |
| End timecode   | Editable. Type a timecode; an unparseable one reverts. |
| ✂              | Split this cue at the playhead                         |
| ✕              | Delete it                                              |
| Text area      | The caption text, edited live                          |

Timing can also be adjusted directly on the
[caption lane](timeline.md#the-caption-lane): drag a cue's body to move it, or
its edges to change how long it is on screen.

## Style

One style for every caption, as in every player.

| Control      | Range / values           | Notes                                        |
| ------------ | ------------------------ | -------------------------------------------- |
| **Burn in**  | on / off                 | See below                                    |
| **Size**     | 2% – 14% of frame height | Resolution-independent                       |
| **Position** | 10% – 98% down the frame | Vertical placement                           |
| **Colour**   | colour picker            |                                              |
| **Bold**     | on / off                 |                                              |
| **Plate**    | on / off                 | A semi-transparent black box behind the text |

### Burn in

When **on** (the default), captions are drawn into the picture — in the preview
_and_ in the exported file. What you see is what you ship.

When **off**, the captions stay in the project and can still be exported as a
sidecar `.srt` or `.vtt`, but the video itself has none.

Captions are composited **last**, over everything including a transition.

---

## Why captions are a list, not clips on a track

A caption has no in-point, no speed, and nothing to trim against. Importing an
hour of dialogue as clips would mint two thousand clips, each carrying a
transform, a crop and an effects chain it would never use.

So captions are a plain list on the document, kept sorted by start frame. The
timeline lane exists to _see_ them — a caption overrunning a shot, or a silence
with nothing over it — not to be the primary way of editing them.

## Import formats

SRT and WebVTT, with the usual real-world variations handled: comma or dot
decimal separators, optional hours, CRLF line endings, a byte-order mark, cue
settings, missing indices, and a missing trailing newline.

> **Honest caveat:** the parser's fixtures are hand-written to cover the cases
> known to break. It has never been tested against a file produced by Premiere,
> Rev, YouTube auto-captions or a fansub group. If you hit a file it mangles,
> that is a genuinely useful bug report — see [Contributing](../contributing.md).

Source: `src/panels/CaptionsPanel.tsx`, `src/panels/timeline/SubtitleLane.tsx`,
`src/model/subtitles.ts`, `src/renderer/text-renderer.ts`.

---

**See also:** [Timeline ▸ caption lane](timeline.md#the-caption-lane) ·
[Markers](markers.md)
