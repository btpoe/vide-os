# Getting Started

Everything you need to go from an empty machine to an exported video.

---

## 1. Requirements

VideOS leans hard on new web platform APIs. That buys a real media pipeline with
no plugins and no native code — and it costs browser compatibility.

| Requirement            | Detail                                                  |
| ---------------------- | ------------------------------------------------------- |
| **Browser**            | Chromium-based: Chrome, Edge, Arc, Brave, Vivaldi.      |
| **WebGL2**             | Required. Every frame you see is composited on the GPU. |
| **WebCodecs**          | Required. Decoding and encoding both go through it.     |
| **File System Access** | Required to open folders and write files in place.      |
| **Node.js**            | 22 or newer, to build and run it.                       |
| **pnpm**               | The package manager this repo uses.                     |

**Firefox and Safari** can render the interface but cannot open folders, so they
are not usable for editing today.

> **On formats:** the browser decodes what the browser decodes. H.264/AAC in
> `.mp4` or `.mov`, VP8/VP9/Opus in `.webm`, and common audio and image formats
> are reliable. `.avi`, `.mkv`, `.flv`, `.wmv` and HEVC are shown as
> _needs conversion_ rather than imported and left to render black. A bundled
> ffmpeg fallback is planned for the desktop build — see the
> [Roadmap](roadmap.md).

---

## 2. Install and run

There is **no packaged release or hosted instance yet.** VideOS is run from
source. That is a real limitation of a pre-alpha project, and it is first on the
list of things a desktop build fixes.

```sh
git clone <repository-url> vide-os
cd vide-os

pnpm install
pnpm dev            # http://localhost:5173
```

Open the printed URL in a Chromium browser. That is the whole installation.

### Build a static bundle

```sh
pnpm build          # production build into dist/
pnpm preview        # serve dist/ locally
```

`dist/` is a plain static site. Any static host will serve it — but note that
File System Access requires a **secure context**, so it must be `https://` or
`localhost`.

### The other scripts

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `pnpm dev`          | Vite dev server with hot reload                    |
| `pnpm build`        | Production build to `dist/`                        |
| `pnpm typecheck`    | `tsc --noEmit` over the app and the config files   |
| `pnpm lint`         | ESLint, with type-checked rules                    |
| `pnpm format`       | Prettier, write                                    |
| `pnpm format:check` | Prettier, check only — what CI runs                |
| `pnpm test`         | Unit and property tests, in Node                   |
| `pnpm test:browser` | Tests needing real WebGL2 / WebCodecs, in Chromium |
| `pnpm test:perf`    | Performance budgets                                |
| `pnpm check`        | typecheck + lint + test + build — the full gate    |

Browser tests need Chromium installed once:

```sh
pnpm exec playwright install chromium
```

---

## 3. The layout

VideOS uses a DaVinci-style dockable panel system. Every panel is a tile in a
resizable tree, panels can be tabbed together, and the arrangement is saved
between sessions.

```
┌──────────────────────────────────────────────────────────────────────┐
│ VideOS   File  Edit  View  Help                              SELECT  │  ← menu bar
├──────────────┬──────────────────────────────────┬────────────────────┤
│ File Browser │                                  │ Tools              │
│              │            Preview               ├────────────────────┤
├──────────────┤                                  │ Effects │ Props    │  ← tabs
│ Media Pool   │                                  │                    │
│              ├──────────────────────────────────┤                    │
│              │                                  ├────────────────────┤
│              │            Timeline              │ Mixer │ History    │
│              │                                  │                    │
├──────────────┴──────────────────────────────────┴────────────────────┤
│ Ready          1920×1080          30.00 fps                          │  ← status bar
└──────────────────────────────────────────────────────────────────────┘
```

That is the default. Every part of it moves.

### Working with panels

| Action                    | How                                              |
| ------------------------- | ------------------------------------------------ |
| **Resize**                | Drag the splitter between two panels.            |
| **Switch tab**            | Click a tab in a tabbed group.                   |
| **Move a panel**          | Drag its tab onto another group.                 |
| **Close a panel**         | Click the ✕ on its tab.                          |
| **Reopen / show a panel** | **View** menu — every panel is a checkable item. |
| **Start over**            | **View ▸ Reset Layout**.                         |

The layout is stored in `localStorage` and restored on the next launch. It is
per-browser, not part of the project file — the same project opens into whatever
arrangement you last used.

### From the keyboard

The docking layout is navigable without a pointer. Tab bars are `tablist`s with a
roving tabindex, and splitters are real `separator`s that resize with the arrow
keys.

| Key            | Action                                 |
| -------------- | -------------------------------------- |
| `←` / `→`      | Move between panel tabs                |
| `Home` / `End` | First / last tab                       |
| `Delete`       | Close the focused panel                |
| Arrow keys     | Resize a split, with a divider focused |
| `⇧` + arrow    | Resize in larger steps                 |

### The panels

| Panel                                  | What it is for                                          |
| -------------------------------------- | ------------------------------------------------------- |
| [File Browser](panels/file-browser.md) | Browse a folder on disk and pull media in               |
| [Media Pool](panels/media-pool.md)     | The project's media, with thumbnails and status         |
| [Source](panels/source-monitor.md)     | View a shot and mark in/out before it hits the timeline |
| [Preview](panels/preview.md)           | The program monitor and transport                       |
| [Timeline](panels/timeline.md)         | Where the edit happens                                  |
| [Tools](panels/tools.md)               | Select, razor, trim, slip, slide, text, hand            |
| [Effects](panels/effects.md)           | The effect library                                      |
| [Properties](panels/properties.md)     | Everything about the selected clip, and every keyframe  |
| [Mixer](panels/mixer.md)               | Track meters, mute and solo                             |
| [Markers](panels/markers.md)           | The marker list and chapter export                      |
| [Captions](panels/captions.md)         | Subtitle list, import, export and styling               |
| [History](panels/history.md)           | Every edit, with a click to jump back to any of them    |

---

## 4. Your first edit

### Bring in media

Two routes, and they meet in the same place:

1. **File Browser ▸ Open Folder**, then double-click a media file — or drag it
   into the Media Pool, or use **+ All** to import every media file in the
   folder at once.
2. Drag a file from the File Browser **straight onto a timeline track**, which
   imports it and places a clip in one gesture.

The browser will ask permission for the folder. Grant it once; VideOS
remembers the folder and re-opens it next session.

Anything the browser cannot decode is flagged in the pool rather than imported
and left to fail later.

### Put it on the timeline

- **Drag** a clip from the Media Pool onto a track. It lands where you drop it.
- Or **double-click** it in the pool to load it into the
  [Source monitor](panels/source-monitor.md), mark **In** (`I`) and **Out**
  (`O`), then **Insert** (`,`) or **Overwrite** (`.`) at the playhead. This is
  three-point editing, and it is faster once it is in your fingers.

A new project starts with two video tracks and two audio tracks. Add more from
the timeline toolbar (**+ Video**, **+ Audio**).

### Move around

| Want to               | Do this                                              |
| --------------------- | ---------------------------------------------------- |
| Scrub                 | Drag in the ruler, or click empty track space        |
| Play / pause          | `Space`                                              |
| Step one frame        | `←` / `→`                                            |
| Shuttle               | `J` slower/backwards, `L` faster/forwards, `K` stops |
| Zoom                  | `⌘`-scroll or pinch, or `⌘+` / `⌘−`                  |
| Pan                   | `Shift`-scroll                                       |
| Fit the whole edit    | `Shift+Z`                                            |
| Zoom to single frames | `⌘0`                                                 |

Zoom is cursor-anchored: the frame under the pointer stays put. That is the
difference between a timeline that feels right and one that does not.

### Cut it together

With the **Select** tool (`V`):

- **Drag a clip body** to move it. Drag several by selecting them first
  (`Shift`-click or `⌘`-click) — the group keeps its internal spacing.
- **Drag an edge** to trim. Hold `Alt` while dragging to _ripple_, closing the
  gap behind the trim.
- Press `C` for the **Razor** and click a clip to split it, or use the other
  [tools](panels/tools.md) for roll, slip and slide.
- `S` toggles snapping, which sticks clip edges to other clips, to markers and
  to frame zero.
- `Escape` **aborts a drag in progress** and restores the document.

Every edit is one undo step, whatever it touched. `⌘Z` and `⇧⌘Z`, or jump to any
point in the [History](panels/history.md) panel.

### Make it look and sound right

Select a clip and open **[Properties](panels/properties.md)**:

- Transform, crop, opacity, blend and fit for video.
- Volume, pan and fades for anything with audio.
- A speed slider with presets, which retimes the clip.
- A transition into this clip — crossfade, dip to black, or a wipe.

Any numeric parameter can be **keyframed**: click the ⏱ stopwatch beside it to
start animating, and the ◇ diamond to add a key at the playhead. Add effects by
selecting a clip and clicking one in the **[Effects](panels/effects.md)** panel.

### Save

`⌘S` writes a `.videos` bundle — a zip containing the document as plain JSON
plus a media table recording where each asset lives. It is portable: another
machine can open it and relink the media by content.

`⌘⇧S` saves to a new location. After the first save, `⌘S` writes back to the
same file rather than downloading a fresh copy.

You do not need to save constantly. VideOS autosaves to browser storage a couple
of seconds after each edit, keeps the last ten revisions, and restores the
newest one silently on reload.

### Export

`⌘E` opens the [Export dialog](panels/dialogs.md#export).

Pick a container, a size preset and a quality. The frame rate is **not** an
option — it comes from your sequence, and the dialog shows it. Both containers
are probed with the real encoder at the real resolution, so a format that
cannot be produced on your machine is greyed out with the reason.

Two buttons:

- **Export** builds the file in memory and downloads it. Fine for short pieces.
- **Save to File…** picks a destination first and streams to disk. Use this for
  anything long or 4K, which will not fit in memory.

---

## 5. When something goes wrong

| Symptom                                     | What it means and what to do                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Amber bar: "_n_ media files cannot be used" | A permission lapsed or a file moved. Click **Reconnect media** — see [dialogs](panels/dialogs.md#reconnect-media). |
| A clip shows ⚠ and its name is "Offline"    | Same cause. The clip and all its edits are intact; only the link is broken.                                        |
| A pool item badged **UNSUPPORTED**          | The file is present but the browser cannot decode it. It needs converting.                                         |
| Preview is black at the very start          | Give the first decode a moment. If it persists, check the browser console for a WebGL2 failure.                    |
| "The editor closed unexpectedly"            | A crash was detected. The newest autosave is already open; pick an older one if that is not what you want.         |
| A format button is greyed out in Export     | Hover it — the tooltip says which codec is missing at this resolution.                                             |

For anything else, the **Debug HUD** (`Shift+D`) shows decoder count, frame
cache bytes, the open-frame counter, dropped frames and the preview's current
quality rung. It is described in [dialogs](panels/dialogs.md#debug-hud).

---

**Next:** [The panels, in depth →](panels/README.md)
