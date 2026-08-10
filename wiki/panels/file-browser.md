# File Browser

A real folder on your disk, browsable inside the editor.

---

## What it does

Click **Open Folder** and grant permission. The panel then shows that folder as
an expandable tree — directories you can drill into, files with icons and sizes.
Media files are shown in full contrast; everything else is dimmed but still
listed, so you can see where things are.

| Control         | What it does                                                                           |
| --------------- | -------------------------------------------------------------------------------------- |
| **Open Folder** | Opens the OS directory picker                                                          |
| **+ All**       | Imports every media file in the top level of the current folder                        |
| Folder row      | Click to expand or collapse; children load on first expand                             |
| File row        | Double-click a media file to import it                                                 |
| Drag            | Drag a media file to the [Media Pool](media-pool.md) or straight onto a timeline track |

The header strip shows the folder name and how many files are in it.

## Persistence

The chosen folder is remembered and re-opened on the next launch, provided the
permission is still granted. VideOS **queries** permission on startup and never
requests it there — a permission request outside a user gesture always fails,
and the code that used to do it treated that failure as "this handle is dead".

If the grant has lapsed, the panel simply comes up empty; click **Open Folder**
again.

## Why it exists at all

A browser-based editor could get by with a file input. It would also mean:

- No stable reference to a file, so nothing survives a reload.
- No folder context, so relinking a moved project means picking files one at a
  time.
- No writing back to the file you opened, so every save is a fresh download and
  you end up with a folder full of `Project (3).videos`.

The File System Access API solves all three, and the File Browser is what makes
that visible. It is also the reason VideOS is Chromium-only today.

## Notes

- Directory listing is **non-recursive**; children load when you expand a
  folder. A deep tree costs nothing until you open it.
- **+ All** imports the top level only, not subfolders.
- A `FileSystemFileHandle` cannot ride inside a `DataTransfer`, so drag payloads
  carry a marker and the handle is stashed module-side for the drop target to
  collect. If you are writing a drop target, see
  [`src/lib/drag-payload.ts`](../../src/lib/drag-payload.ts).

Source: `src/panels/FileBrowserPanel.tsx`, `src/lib/fs-access.ts`,
`src/platform/web/`.

---

**See also:** [Media Pool](media-pool.md) ·
[Developer ▸ The Platform Seam](../developer/platform.md)
