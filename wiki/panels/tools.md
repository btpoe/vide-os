# Tools

Seven buttons that decide what your pointer does on the timeline. The active
tool is also shown in the top-right of the menu bar.

---

| Tool       | Key | Icon | What a pointer gesture becomes                                                   |
| ---------- | --- | ---- | -------------------------------------------------------------------------------- |
| **Select** | `V` | ⬚    | Move clips by the body; trim by an edge. Hold `Alt` on an edge to ripple.        |
| **Razor**  | `C` | ✂    | Click a clip to split it at that frame.                                          |
| **Trim**   | `T` | ⟷    | Drag a cut to **roll** it: one clip grows by exactly what the other loses.       |
| **Slip**   | `Y` | ⇔    | Drag a clip body to change **what it shows** without moving it.                  |
| **Slide**  | `U` | ⇹    | Drag a clip **between its neighbours**, which absorb the difference.             |
| **Text**   | `X` | T    | Click a track to create a title clip there.                                      |
| **Hand**   | `H` | ✋   | Reserved for panning. _Selecting it is inert today_ — use `Shift`-scroll to pan. |

Hovering a tool shows its name, its shortcut, and a one-line note about what the
gesture does.

The selected tool persists between sessions.

---

## The four edge operations, and why they share one handle

Every clip has exactly two grab handles — one at each edge, eight pixels wide
and deliberately larger than they look. Which of four operations a drag performs
is decided by the tool and the modifier, not by hunting for a different handle:

| Tool + modifier         | Operation       | Sequence length | Neighbour                        |
| ----------------------- | --------------- | --------------- | -------------------------------- |
| Select                  | **Trim**        | changes         | untouched; a gap opens or closes |
| Select + `Alt`          | **Ripple trim** | changes         | everything after shifts to match |
| Trim                    | **Roll**        | unchanged       | grows by what this one loses     |
| Razor (click, not drag) | **Split**       | unchanged       | untouched                        |

And two operations are grabs of the clip **body**, because the whole clip is the
handle:

| Tool  | Operation | Clip position | Clip duration | Clip content | Neighbours          |
| ----- | --------- | ------------- | ------------- | ------------ | ------------------- |
| Slip  | **Slip**  | unchanged     | unchanged     | **changes**  | untouched           |
| Slide | **Slide** | **changes**   | unchanged     | unchanged    | **absorb the move** |

Slip dragging **right** shows **later** material — the same convention as every
other NLE, which means the picture appears to move leftward under a fixed
window.

## Bounds

None of these operations can produce something the media cannot support:

- A trim cannot push a clip's in or out point past the ends of its source.
- A ripple cannot pull material that does not exist out of a neighbour.
- A slide is bounded by how much spare handle each neighbour actually has.
- A roll stops at whichever side runs out of frames first.

When an operation would exceed the material, it clamps rather than producing a
freeze frame. Getting this exactly right at fractional speeds was the source of
four separate bugs, all found by a property test asserting "every clip stays
inside its source" — the details are in
[`docs/findings.md`](../../docs/findings.md).

## Escape aborts

Any drag can be cancelled mid-gesture with `Escape`. The document is restored to
its pre-drag state and no undo entry is recorded.

Source: `src/panels/ToolsPanel.tsx`, `src/panels/timeline/interactions.ts`,
`src/panels/timeline/ClipView.tsx`.

---

**See also:** [Timeline](timeline.md) · [Keyboard Reference](../keyboard-reference.md)
