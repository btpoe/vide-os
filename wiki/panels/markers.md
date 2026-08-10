# Markers

Notes on the sequence, and the panel that gets them out of the app.

The [marker lane](timeline.md#the-marker-lane) on the timeline is for _placing_
markers. This panel is for _reading_ them — a shot list, a note pass, a chapter
breakdown — and for exporting them.

---

## The list

Every marker, sorted by time, showing its colour, its name, its note and its
timecode. The marker at the playhead is highlighted.

| Gesture                | Result                                          |
| ---------------------- | ----------------------------------------------- |
| Click a row            | Seek there, scrolling the timeline to reveal it |
| Type in the name field | Rename, live                                    |
| Hover a row            | Six colour dots and a ✕ appear                  |
| **+ Marker**           | Add one at the playhead (same as `M`)           |

Notes are edited from the timeline lane — double-click or right-click a pin to
open its editor, which has the name, the note, the colours and a delete button.

## Colours

Six, named: Yellow, Red, Green, Blue, Purple, Orange. Enough to mean something,
few enough to remember. The convention is yours; "the red ones are pickups" is
how people actually use them.

## Navigation

| Shortcut      | Action              |
| ------------- | ------------------- |
| `M`           | Add at the playhead |
| `Shift+M`     | Next marker         |
| `Shift+Alt+M` | Previous marker     |

Both jumps move the playhead and scroll the timeline to show it.

---

## Export

Click **Export** to open a panel with three formats and a copy button.

| Format      | Looks like                      | For                               |
| ----------- | ------------------------------- | --------------------------------- |
| **YouTube** | `0:00 Intro`                    | Pasting into a video description  |
| **WebVTT**  | A `WEBVTT` chapters track       | Players that read a chapters file |
| **Plain**   | Tab-separated timecode and name | Notes, spreadsheets, scripts      |

The text is shown in a read-only textarea, so if clipboard access is refused you
can still select it by hand.

Chapters are derived from markers rather than being a separate concept. A
marker's name is the chapter title; a chapter runs until the next marker.

---

## Why markers are not attached to clips

A marker belongs to the **sequence**. Moving a clip should not move a note about
the edit — the note was about the moment in the cut, not about the shot.

That is also why markers get their own lane between the ruler and the tracks,
rather than hanging off whatever happens to be underneath them.

Markers are snap targets, so a clip edge can be aligned to a note.

Source: `src/panels/MarkersPanel.tsx`, `src/panels/timeline/MarkerLane.tsx`,
`src/model/chapters.ts`.

---

**See also:** [Timeline ▸ marker lane](timeline.md#the-marker-lane) ·
[Captions](captions.md)
