# Source

Where you decide what part of a shot to use, before it reaches the timeline.

---

## Loading a source

**Double-click** anything in the [Media Pool](media-pool.md). The Source panel
takes over and shows that file from its first frame.

Until then it says so, rather than showing a black rectangle you have to guess
about.

## The controls

```
┌────────────────────────────────────┐
│                                    │
│           the shot                 │
│                                    │
├────────────────────────────────────┤
│ shot-a.mp4            00:00:03:11  │
│ ▓▓▓░░░░░████████████░░░░░░░░░░░░▓▓ │  ← scrubber, marked range shaded
│ ⟦ In   Out ⟧   Clear    00:00:07:00│  ← marks and marked length
│ [    Insert    ][   Overwrite    ] │
└────────────────────────────────────┘
```

| Control       | Shortcut | What it does                                                         |
| ------------- | -------- | -------------------------------------------------------------------- |
| Scrubber      | —        | Click or drag to move through the source                             |
| **⟦ In**      | `I`      | Mark the in point at the current source position                     |
| **Out ⟧**     | `O`      | Mark the out point                                                   |
| **Clear**     | —        | Drop both marks and use the whole clip                               |
| **Insert**    | `,`      | Insert the marked range at the playhead, pushing everything after it |
| **Overwrite** | `.`      | Overwrite at the playhead                                            |

The shaded band on the scrubber is the marked range; the red line is the source
position. The timecode on the right of the marks row is the **length** of the
marked range, which is what will land on the timeline.

Insert and Overwrite are disabled until the marked range is at least one frame
long.

---

## Three-point editing

This is the fast way to assemble a sequence, and it is worth learning.

Three points define the edit:

1. **In** on the source — where the shot starts.
2. **Out** on the source — where it ends.
3. The **timeline playhead** — where it lands.

The fourth point (where it ends on the timeline) follows from the length, so it
never needs to be stated.

**Insert** pushes everything after the playhead down the track to make room.
**Overwrite** replaces whatever is there.

### Which track it lands on

The **target track** — the one whose 🎬 / 🎵 badge is highlighted in the
[Timeline](timeline.md#the-track-header) header. Click a different badge to arm
a different track.

Audio-only media goes to the armed audio track; everything else goes to the
armed video track.

### The playhead moves to the end

After an insert or overwrite, the new clip is selected and the playhead jumps to
its end. That is what makes assembling a rough cut a matter of: load a shot,
`I`, `O`, `,` — repeat. The next edit is already lined up.

---

## Notes

- The Source panel draws to a plain 2D canvas rather than through the render
  graph. A source has no transform, no effects and nothing underneath it, so
  there is nothing for the compositor to do that `drawImage` does not.
- It gets its **own decoder instance**, keyed to a stable synthetic clip id. The
  media engine decodes per clip instance rather than per file, which is what
  stops the source monitor and a timeline clip of the same file fighting over a
  position.
- Scrubbing shows the last decoded frame until a new one arrives, rather than
  flashing black between positions.
- There is no separate transport for the source; the scrubber and the mark keys
  are the interface. Frame-stepping in the source panel is not implemented.

Source: `src/panels/SourceMonitorPanel.tsx`, `src/stores/source-store.ts`,
`src/commands/source-edits.ts`, `src/model/edits.ts` (`threePointEdit`).

---

**See also:** [Media Pool](media-pool.md) · [Timeline](timeline.md) ·
[Preview](preview.md)
