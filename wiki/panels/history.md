# History

Every edit, in order, with a click to go back to any of them.

---

## The list

Each entry shows an icon, a label describing the edit, and the time it happened.

- The **current** position is highlighted.
- Entries **after** it — the ones you have undone — are dimmed but still there.
  Click one to redo forward to it.
- Click any earlier entry to undo back to it.

The header carries ↩ and ↪ buttons, and a count. `⌘Z` and `⌘⇧Z` do the same
thing from anywhere.

Labels come from the edit itself: _Move 3 clips_, _Ripple trim_, _Split clip_,
_Set opacity_, _Import captions.srt_. A whole drag — however many pointer moves
it took — is **one** entry.

---

## Why undo cannot be subtly wrong

Undo in VideOS is a **document snapshot with structural sharing**, not a
hand-written inverse per operation.

Command-based undo requires every mutation to ship a correct inverse. That is a
promise every new feature gets a fresh chance to break, and the bugs are
invisible until a user hits them. In this codebase three inverses were already
wrong before the change: split-undo was stubbed, trim-redo was empty, and
delete-undo minted new ids while dropping effects, in/out points and
transitions. Undo was silently corrupting projects.

A snapshot cannot be got wrong. Six phases of new edit operations have since
landed and not one of them needed an inverse written by hand.

The cost is memory, and structural sharing pays it: an edit to one track shares
every other track by reference, so a step on a large project costs kilobytes
rather than megabytes.

## What is and is not undoable

| Undoable                                              | Not undoable                    |
| ----------------------------------------------------- | ------------------------------- |
| Every clip, track, marker, caption and parameter edit | Panel layout changes            |
| Transitions, effects, keyframes, speed, fades         | Zoom, scroll and track height   |
| Caption import, marker changes, sequence settings     | Media pool import (see below)   |
|                                                       | Playhead position and selection |

**Importing media is not an undo step.** Making it one would put an entry in the
history per file and would desync from the media pool, which has no undo of its
own. The known consequence: an asset registered _after_ an undo is lost on the
subsequent redo, because the redo snapshot predates it. It is re-registered the
next time the media is used.

A drag that returns to exactly where it started records nothing, because the
document is compared by value rather than by reference. (Every frame of a drag
produces a new document object, so a reference comparison recorded an undo step
that did nothing.)

Source: `src/panels/HistoryPanel.tsx`, `src/model/history.ts`,
`src/stores/history-store.ts`.

---

**See also:** [Timeline](timeline.md) · [Recovery](dialogs.md#recovery)
