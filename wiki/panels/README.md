# Panels

Every window in VideOS is a panel: a self-contained tile in a resizable,
tabbable, dockable tree. This section documents each one in full — what it
shows, what every control does, and the reasoning behind the ones that are not
obvious.

---

## The panel system itself

Panels are custom elements (`<ve-panel>`) laid out by another custom element
(`<ve-panel-layout>`), each rendering a SolidJS component inside. That
separation is what makes a panel a plug-in point rather than a hard-coded
region — see [Developer ▸ Panels API](../developer/panels.md).

| Action              | How                                             |
| ------------------- | ----------------------------------------------- |
| Resize              | Drag a splitter                                 |
| Retab               | Drag a panel's tab into another group           |
| Close               | ✕ on the tab                                    |
| Show / hide         | **View** menu — every panel is a checkable item |
| Restore the default | **View ▸ Reset Layout**                         |

The arrangement lives in `localStorage`, not in the project file. It follows the
browser, not the edit.

**Known limitation:** the docking layout has no keyboard navigation. It is a
custom shadow-DOM layout and an accessibility pass is a scheduled item on the
[Roadmap](../roadmap.md).

---

## The panels

### Bringing media in

| Panel                           | One line                                                              |
| ------------------------------- | --------------------------------------------------------------------- |
| [File Browser](file-browser.md) | A real folder on disk, browsable, with import by drag or double-click |
| [Media Pool](media-pool.md)     | The project's media, with thumbnails, metadata and offline status     |
| [Source](source-monitor.md)     | Watch a shot, mark in and out, insert or overwrite                    |

### Editing

| Panel                   | One line                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| [Preview](preview.md)   | The program monitor, the transport, and an adaptive quality ladder |
| [Timeline](timeline.md) | Tracks, clips, trims, markers, captions — the edit itself          |
| [Tools](tools.md)       | Which gesture your pointer performs                                |

### Shaping the picture and the sound

| Panel                       | One line                                                   |
| --------------------------- | ---------------------------------------------------------- |
| [Effects](effects.md)       | Eight GPU effects, searchable, applied to the selection    |
| [Properties](properties.md) | Everything about one clip, and every parameter keyframable |
| [Mixer](mixer.md)           | Per-track meters, mute and solo                            |

### Structure and text

| Panel                   | One line                                                      |
| ----------------------- | ------------------------------------------------------------- |
| [Markers](markers.md)   | The marker list, and chapter export for YouTube and WebVTT    |
| [Captions](captions.md) | Subtitle list, SRT/VTT import and export, styling and burn-in |
| [History](history.md)   | Every edit as an entry you can jump to                        |

### Not panels, but part of the UI

| Surface                                                           | One line                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| [Export dialog](dialogs.md#export)                                | Container negotiation, presets, streaming to disk         |
| [Reconnect media](dialogs.md#reconnect-media)                     | Re-grant permission, relink by folder or by file          |
| [Recovery dialog](dialogs.md#recovery)                            | Offered only after a crash, and only when useful          |
| [Debug HUD](dialogs.md#debug-hud)                                 | `Shift+D` — decoders, cache, dropped frames, quality rung |
| [Menu bar and status bar](dialogs.md#the-menu-bar-and-status-bar) | Commands, media warnings, sequence readout                |

---

## A convention worth knowing before you start

**Selection drives almost everything.** Effects apply to the selected clips.
Properties shows the selected clip. Delete, copy, duplicate and nudge all act on
the selection. Clicking empty track space clears the selection _and_ moves the
playhead, which is what every NLE does.

One subtlety, because it is easy to trip over: clicking a clip that is _already
selected_ narrows the selection to just that clip — but **dragging** it moves the
whole group. VideOS therefore decides which happened on pointer-_up_, not
pointer-down. That is deliberate: on pointer-down there is no way to tell a
click from the start of a drag.
