/**
 * Module-scoped hand-off for drag payloads that can't ride in the DataTransfer.
 *
 * `FileSystemFileHandle` is not cloneable into `dataTransfer.setData`, so a
 * file dragged out of the File Browser has to be stashed somewhere the drop
 * target can reach. This used to be `window.__dragFileHandle`, cast through
 * `any` at five call sites with no type and no discipline about clearing it.
 */

let fileHandle: FileSystemFileHandle | undefined;

export function setDragFileHandle(handle: FileSystemFileHandle): void {
  fileHandle = handle;
}

/** Reads the pending handle and clears it — a payload is consumed once. */
export function takeDragFileHandle(): FileSystemFileHandle | undefined {
  const handle = fileHandle;
  fileHandle = undefined;
  return handle;
}

/** Clears without consuming, for drag-end/cancel paths. */
export function clearDragFileHandle(): void {
  fileHandle = undefined;
}
