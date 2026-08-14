# Dialogs and overlays

The parts of the interface that are not dockable panels: the export dialog, the
media reconnection dialog, crash recovery, the debug HUD, and the chrome around
everything.

---

## The menu bar and status bar

### Menus

| Menu     | Contains                                                                                   |
| -------- | ------------------------------------------------------------------------------------------ |
| **File** | New, Open, up to five recent projects, Save, Save As, Export                               |
| **Edit** | Undo, Redo · Cut, Copy, Paste, Duplicate · Select All, Deselect All, Delete, Ripple Delete |
| **View** | Reset Layout, Debug HUD, and a checkable item per panel                                    |
| **Help** | Keyboard Shortcuts, About VideOS                                                           |

Menu items are built from the **command registry**, so a label, its shortcut
glyph and its enabled state all come from one definition. There is no second
implementation of an action behind a menu item.

The top-right of the menu bar shows the active [tool](tools.md).

With one menu open, moving the pointer across the bar switches to the menu you
move onto. A click that lands at the end of that move keeps it open — it is the
end of one gesture, not a second click on the trigger. Clicking a trigger whose
menu is already open still closes it.

### The recent projects list

Up to five, remembered across sessions. Opening one re-requests permission
inside your click — a stored file reference needs the grant renewed, and that
can only happen in a user gesture. If the file has moved or been deleted, you
are told and the entry is dropped rather than failing with no explanation.

### Saving

`⌘S` writes back to the file the project was last saved to or opened from.
`⌘⇧S` picks a new location. Without that memory every save was a fresh download
and you ended up with a folder of `Project (3).videos`.

If no picker is available or you cancel it, the save falls back to a download
rather than being lost.

A `.videos` file is a zip:

```
project.json          the document
media.json            asset table with relink hints
thumbnails/<key>.jpg  optional, regenerable
waveforms/<key>.bin   optional, regenerable
```

A bare `project.json` is also valid input, so the bundle is a strict superset
and a project stays diffable and hand-editable. Older `.videos.json` files
migrate on open, and anything the migration had to change is reported in a
"Project opened with changes" dialog rather than swallowed.

### The status bar

Shows the sequence dimensions and frame rate.

### The media warning bar

When any media cannot be used, an amber bar appears under the menus with a
count and a **Reconnect media** button. It is a bar rather than a silent state
because the alternative is discovering the problem as a black clip.

---

## Export

`⌘E`, or **File ▸ Export…**

| Control           | Options                                                      |
| ----------------- | ------------------------------------------------------------ |
| **Format**        | MP4 and WebM, each shown available or disabled with a reason |
| **Size**          | 1080p, 4K, 720p, 1080 Square, 1080 Vertical                  |
| **Quality**       | Medium (6 Mbps), High (12), Very high (24)                   |
| **Include audio** | checkbox                                                     |

Below the format buttons, the actual codecs that will be used. Below the size
buttons, the resolution, frame rate, exact frame count and duration.

### Two things the dialog deliberately does not offer

**A frame rate.** It comes from the sequence, and is displayed rather than asked
for. Offering 24/30/60 regardless of the timeline is an invitation to pick a
number that means resampling — which nothing implements.

**A format that cannot be produced.** Both containers are probed with the _real_
encoder at the _real_ resolution, and re-probed whenever the size or bitrate
changes, because a codec that encodes 1080p can fail at 4K on the same machine.
A container with no usable codec is shown disabled with the reason, rather than
silently substituting another and producing a WebM file named `.mp4`.

### Export vs Save to File…

| Button            | Behaviour                                                                         |
| ----------------- | --------------------------------------------------------------------------------- |
| **Export**        | Builds the file in memory and downloads it. Fine for short pieces.                |
| **Save to File…** | Picks a destination first, then **streams to disk**. Use for anything long or 4K. |

The destination is picked _before_ any work starts — the picker needs your
click, and asking after a five-minute render would be worse than useless.

Streaming needs _positioned_ writes rather than an append-only stream, because
MP4 patches its header once the sizes are known and has to seek backwards.

### While exporting

A phase label — Preparing, Mixing audio, Rendering frame _n_ of _N_, Writing the
file — a progress bar, elapsed time and an estimate. **Cancel Export** stops it
cleanly.

### Why the file matches the preview

Export and preview differ in exactly **one** place: a frame-lookup hook. Export
awaits the exact frame; preview never waits. Scene building, compositing,
effects, transitions and captions are literally the same code.

Timing is exact rational arithmetic — `frame × den / num` — not accumulated
float seconds. One frame is written per timeline frame, timestamped from its
frame index, never from wall-clock render time. Audio is mixed once up front
through an `OfflineAudioContext` using the same graph function as live playback.

Export also gets its **own** decoder pool with a smaller budget, so a background
export cannot starve the editor's frame cache.

---

## Reconnect media

Opened from the amber warning bar, or when you want to check the state of the
project's media.

Three problem kinds, three different remedies — because offering "relink" for a
file that is present but in an unsupported codec would send you hunting for a
file that is already there:

| Kind                   | What it means                              | Remedy                                           |
| ---------------------- | ------------------------------------------ | ------------------------------------------------ |
| **Needs permission**   | The file is where it was; the grant lapsed | **Reconnect _n_ files** — one click              |
| **Missing**            | The file has moved or been deleted         | **Relink from folder…**, or **Relink…** per file |
| **Unsupported format** | Present, but the browser cannot decode it  | None offered — it needs converting               |

**Relink from folder** narrows candidates by name and size, because hashing
every file in a folder would read the whole folder — but the **content key** is
what decides. Pointing at a different recording that happens to share a filename
is reported, not silently accepted. That matters: the failure would otherwise
show up much later, as the wrong footage in an export.

---

## Recovery

_"The editor closed unexpectedly."_

VideOS autosaves the document to browser storage (OPFS) a couple of seconds
after each edit, and keeps the last ten revisions.

A **normal reload silently restores the newest autosave**. No dialog — that is
what anyone would expect, and prompting every launch is how people learn to
dismiss the dialog that matters.

This dialog appears only when **both**: the previous session did not close
cleanly, **and** there is an older revision to go back to. Its job is to let you
go _further back_ than the newest autosave — which is exactly what you want when
the state that crashed the editor is the state it saved.

| Control             | Effect                              |
| ------------------- | ----------------------------------- |
| A revision row      | Restore that version                |
| **Keep the newest** | Dismiss; the newest is already open |
| **Discard all**     | Delete every autosaved revision     |

Each row shows the project name, how long ago it was saved, and its size.

Autosave uses OPFS rather than `localStorage` because `localStorage` is a ~5 MB
quota that throws on overflow — a project with a few keyframed effects silently
stopped being saved, with the error warned to a console nobody was reading.

---

## Debug HUD

`Shift+D`, or **View ▸ Debug HUD**. An overlay in the corner of the
[Preview](preview.md).

| Row          | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| **render**   | Time inside the last render call, and the gap since the previous rendered frame          |
| **quality**  | Current render target size and the ladder rung (`full`, `1/2`, `1/4`). Amber below full. |
| **dropped**  | Dropped frames, out of the total attempted                                               |
| **held**     | Passes that found nothing decoded and held the previous picture. Amber above zero.       |
| **decoders** | Active decoders against the pool budget                                                  |
| **frames**   | Cached frames, and cache bytes against the byte budget                                   |
| **hit rate** | Frame cache hit rate                                                                     |
| **open**     | `VideoFrame`s created minus closed, with both totals                                     |

The **held** counter is the decoder failing to keep up, seen from the inside. It
is what the [preview](preview.md#a-frame-the-decoder-has-not-caught-up-with)
does instead of flashing black, so a climbing number here is the symptom that
used to be visible as flicker.

The **open** counter is the one measurement that says whether the `.close()`
discipline the media engine depends on is actually being kept. A cached frame is
legitimately open, so a non-zero number is expected — what matters is that it
tracks the cache rather than climbing away from it. It turns amber when it does.

The HUD polls four times a second rather than reacting per frame: fast enough to
watch a leak climb, slow enough to read, and cheap enough not to distort what it
is measuring.

---

## Getting Started, Keyboard Shortcuts and About

**Help ▸ Getting Started** opens the same six first steps as
[Getting Started](../getting-started.md), in the app — because the editor opens
on an empty timeline and a black preview, and nothing else on screen says what
to do first.

**Help ▸ Keyboard Shortcuts** (`⇧?`) opens the reference sheet. It is
**generated from the command registry**: every command carrying a shortcut
appears in its own category with the chord formatted for your platform, so a new
command cannot be added without documenting itself.

That matters because the sheet used to be a hand-written list, and it had
drifted — `J` and `L` were described as five-second jumps long after they became
shuttle controls, and markers, three-point editing, `Escape` and the zoom
commands were missing entirely. A reference that is wrong is worse than none,
because the reader believes it.

The one section that is not generated is the panel layout's own keys, which are
handled by the docking layout rather than the registry.

**Help ▸ About VideOS** shows the build's stack and browser requirements.

---

## Every dialog is a dialog

All of them — export, media reconnection, crash recovery, the shortcut sheet,
Getting Started, About, and the notes from opening an older project — are built
from one `Overlay` component, and therefore all get the same behaviour:

- `role="dialog"` with `aria-modal` and a heading that names it, so it is
  announced rather than being an anonymous box.
- **Escape closes it**, and so does clicking the backdrop.
- **Tab cycles inside it.** Focus moves into the dialog when it opens and back
  to whatever had it when the dialog closes.
- Keystrokes do not reach the app behind it, so `Space` cannot start playback
  under an open dialog.

Six of these were converted to it and three were not, which is why this is
stated rather than assumed: export, relink and recovery stayed plain `div`s over
a backdrop — nothing announced, no way out but the mouse — for as long as the
component existed without them using it.

**The export dialog refuses to close while it is rendering.** Escape, the
backdrop and the ✕ are blocked together by one flag, because a dialog that
ignores Escape while still showing an enabled close button is a control that
lies. **Cancel Export** is the way to stop a render, and it says so.

Source: `src/App.tsx`, `src/panels/ShortcutSheet.tsx`,
`src/panels/GettingStarted.tsx`, `src/panels/ExportDialog.tsx`,
`src/panels/RelinkDialog.tsx`, `src/panels/RecoveryDialog.tsx`,
`src/panels/Overlay.tsx`, `src/panels/DebugHud.tsx`, `src/lib/autosave.ts`, `src/model/io.ts`,
`src/export/`.
