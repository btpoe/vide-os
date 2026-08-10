# Media Pool

The project's media: everything that has been imported, with thumbnails,
metadata, and an honest account of what can and cannot currently be used.

---

## Layout

A header showing `Media (n)` and two view buttons, over a scrollable list.

| View     | Button | Shows                                                           |
| -------- | ------ | --------------------------------------------------------------- |
| **Grid** | ⊞      | Two-column thumbnails with duration, type and status badges     |
| **List** | ☰     | Rows with name, type, file size, duration and source dimensions |

Empty, it tells you how to fill it: drag media in, or import from the File
Browser.

## Getting media in

| Route                                                      | Result                          |
| ---------------------------------------------------------- | ------------------------------- |
| Double-click a file in the [File Browser](file-browser.md) | Imported                        |
| Drag a file from the File Browser into the pool            | Imported                        |
| **+ All** in the File Browser                              | Every media file in that folder |
| Drag onto a timeline track                                 | Imported _and_ placed as a clip |

A file being imported shows ⏳ until its probe and thumbnail finish.

> Dropping files from the OS desktop directly onto the pool is **not** supported.
> A native file drop does not give the app a `FileSystemFileHandle`, and without
> one the reference cannot survive a reload. Use the File Browser.

## What each item tells you

| Badge / element         | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| Thumbnail               | A real decoded frame from the file (or the image itself)        |
| Duration, bottom-right  | Source duration                                                 |
| Type, top-left          | `VIDEO`, `AUDIO` or `IMAGE`                                     |
| **OFFLINE** (amber)     | The file cannot currently be read — moved, or permission lapsed |
| **UNSUPPORTED** (amber) | The file is present but the browser cannot decode it            |
| ⚠ (list view)           | Either of the above; hover for the detail                       |
| ✕ on hover              | Remove from the pool                                            |

## Actions

| Gesture                   | Result                                            |
| ------------------------- | ------------------------------------------------- |
| Click                     | Select                                            |
| `Shift`-click / `⌘`-click | Add to the selection                              |
| **Double-click**          | Load into the [Source monitor](source-monitor.md) |
| Drag                      | Onto a timeline track, to create a clip           |
| ✕                         | Remove the entry from the pool                    |

---

## How media is identified

Every asset is keyed by a **content key** — a SHA-256 over the first and last
megabyte of the file plus its byte length — rather than by a path or an id
minted at import time.

That is what makes a saved project reopenable on another machine, and what lets
a relink be _verified_ rather than assumed: pointing at a different recording
that happens to share a filename is reported, not silently accepted.

Sampling the two ends rather than hashing the whole file means importing from a
40 GB camera card does not read it end to end. The documented consequence, and
it is asserted in a test: two files of identical size sharing a head and a tail
but differing in the middle will collide. That is acceptable for matching media
and is explicitly _not_ a content-integrity check.

## Offline and unsupported media

Nothing is ever silently deleted. When a file cannot be used, the asset stays in
the document, every clip keeps every edit, and the problem is surfaced:

1. An amber bar appears across the top of the app.
2. The pool item is badged.
3. Clips on the timeline show ⚠.

Click **Reconnect media** to open the [relink dialog](dialogs.md#reconnect-media),
which offers three different remedies for the three different causes — because
offering "relink" for a file that is present but in an unsupported codec would
send you hunting for a file that is already there.

This behaviour exists because the opposite behaviour used to exist: a permission
request fired on mount, outside a user gesture, always failed, and its failure
path _deleted the stored handle_. The first reload after a lapsed permission
permanently destroyed every media reference in the project.

## Formats

Classification and capability are separate questions. The pool will show you a
`.mkv` with a proper icon and a duration; it will also tell you the browser
cannot decode it.

| Reliable                                                 | Needs conversion                         |
| -------------------------------------------------------- | ---------------------------------------- |
| `.mp4` `.m4v` `.mov` (H.264/AAC), `.webm` (VP8/VP9/Opus) | `.avi` `.mkv` `.flv` `.wmv` `.ts` `.mts` |
| `.mp3` `.wav` `.aac` `.ogg` `.flac` `.m4a` `.opus`       | `.wma`                                   |
| `.png` `.jpg` `.gif` `.webp` `.svg` `.bmp` `.ico`        | `.heic` `.tiff`                          |

Codec-in-container mismatches — HEVC in an `.mp4`, ProRes in a `.mov` — are not
detectable from the filename, so those are caught by the real decode probe and
reported as **UNSUPPORTED**.

A one-click conversion path is planned with the desktop build's ffmpeg sidecar;
see the [Roadmap](../roadmap.md).

---

## Known rough edge

`getVideoMetadata` in the import path is still an older `<video>`-element
sniffer, so `hasAudio` in the pool is guessed rather than probed. It is harmless
today — the audio engine asks the media engine directly — but it is two sources
of truth about the same file, and it is tracked as an open item.

Source: `src/panels/MediaPoolPanel.tsx`, `src/stores/media-store.ts`,
`src/media/probe.ts`, `src/model/ids.ts`.

---

**See also:** [File Browser](file-browser.md) · [Source monitor](source-monitor.md) ·
[Reconnect media](dialogs.md#reconnect-media)
