import { Component, createSignal, For, Show, onMount } from "solid-js";
import {
  type FSEntry,
  readDirectory,
  openDirectoryPicker,
  getFileIcon,
  isMediaFile,
  formatFileSize,
  saveDirectoryHandle,
  loadDirectoryHandle,
  verifyPermission,
} from "@/lib/fs-access";
import { importFileHandle } from "@/stores/media-store";

const FileTreeItem: Component<{
  entry: FSEntry;
  depth: number;
  onImport: (handle: FileSystemFileHandle) => void;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<FSEntry[]>([]);
  const [loading, setLoading] = createSignal(false);

  const toggleExpand = async () => {
    if (props.entry.kind === "directory") {
      if (!expanded()) {
        setLoading(true);
        try {
          const dirHandle = props.entry.handle as FileSystemDirectoryHandle;
          const items = await readDirectory(dirHandle, props.entry.path);
          setChildren(items);
        } finally {
          setLoading(false);
        }
      }
      setExpanded(!expanded());
    }
  };

  const handleDoubleClick = () => {
    if (props.entry.kind === "file" && isMediaFile(props.entry.name)) {
      props.onImport(props.entry.handle as FileSystemFileHandle);
    }
  };

  const handleDragStart = (e: DragEvent) => {
    if (props.entry.kind === "file" && isMediaFile(props.entry.name)) {
      e.dataTransfer?.setData(
        "application/x-vide-os-file",
        JSON.stringify({
          name: props.entry.name,
          path: props.entry.path,
          mediaType: props.entry.mediaType,
        }),
      );
      // Store handle reference for same-page drag
      (window as any).__dragFileHandle = props.entry.handle;
    }
  };

  const isMedia = props.entry.kind === "file" && isMediaFile(props.entry.name);

  return (
    <div>
      <div
        class={`flex items-center gap-1 py-0.5 cursor-pointer text-xs transition-colors ${
          isMedia
            ? "text-foreground hover:bg-primary/10"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
        style={{
          "padding-left": `${props.depth * 14 + 8}px`,
          "padding-right": "8px",
        }}
        onClick={toggleExpand}
        onDblClick={handleDoubleClick}
        draggable={isMedia}
        onDragStart={handleDragStart}
      >
        <span class="w-3.5 text-center shrink-0 text-[10px]">
          {props.entry.kind === "directory"
            ? loading()
              ? "⏳"
              : expanded()
                ? "▾"
                : "▸"
            : ""}
        </span>
        <span class="shrink-0">
          {props.entry.kind === "directory"
            ? expanded()
              ? "📂"
              : "📁"
            : getFileIcon(props.entry.name)}
        </span>
        <span class="truncate flex-1">{props.entry.name}</span>
        <Show when={props.entry.kind === "file" && props.entry.size}>
          <span class="text-[9px] text-muted-foreground shrink-0 ml-1">
            {formatFileSize(props.entry.size!)}
          </span>
        </Show>
      </div>
      <Show when={expanded()}>
        <For each={children()}>
          {(child) => (
            <FileTreeItem
              entry={child}
              depth={props.depth + 1}
              onImport={props.onImport}
            />
          )}
        </For>
        <Show when={expanded() && children().length === 0 && !loading()}>
          <div
            class="text-[10px] text-muted-foreground italic"
            style={{ "padding-left": `${(props.depth + 1) * 14 + 24}px` }}
          >
            Empty folder
          </div>
        </Show>
      </Show>
    </div>
  );
};

const FileBrowserPanel: Component = () => {
  const [entries, setEntries] = createSignal<FSEntry[]>([]);
  const [dirName, setDirName] = createSignal<string>("");
  const [dirHandle, setDirHandle] =
    createSignal<FileSystemDirectoryHandle | null>(null);
  const [fileCount, setFileCount] = createSignal(0);

  const loadDir = async (handle: FileSystemDirectoryHandle) => {
    setDirHandle(handle);
    setDirName(handle.name);
    const items = await readDirectory(handle);
    setEntries(items);
    setFileCount(items.filter((e) => e.kind === "file").length);
  };

  // Try to restore last opened directory on mount
  onMount(async () => {
    try {
      const saved = await loadDirectoryHandle("last-dir");
      if (saved) {
        const ok = await verifyPermission(saved);
        if (ok) {
          await loadDir(saved);
        }
      }
    } catch {
      // Permission denied or handle invalid
    }
  });

  const openDirectory = async () => {
    const handle = await openDirectoryPicker();
    if (!handle) return;
    await loadDir(handle);
    // Persist for next session
    await saveDirectoryHandle("last-dir", handle).catch(() => {});
  };

  const handleImport = async (handle: FileSystemFileHandle) => {
    await importFileHandle(handle);
  };

  const importAllMedia = async () => {
    const handle = dirHandle();
    if (!handle) return;
    const items = await readDirectory(handle);
    const mediaFiles = items.filter(
      (e) => e.kind === "file" && isMediaFile(e.name),
    );
    for (const f of mediaFiles) {
      await importFileHandle(f.handle as FileSystemFileHandle);
    }
  };

  return (
    <div class="h-full flex flex-col text-sm">
      <div class="p-2 border-b border-border flex gap-1.5">
        <button
          onClick={openDirectory}
          class="flex-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Open Folder
        </button>
        <Show when={dirHandle()}>
          <button
            onClick={importAllMedia}
            class="px-2 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-accent transition-colors"
            title="Import all media files to pool"
          >
            + All
          </button>
        </Show>
      </div>
      <Show when={dirName()}>
        <div class="flex items-center justify-between px-2 py-1 border-b border-border">
          <span class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider truncate">
            {dirName()}
          </span>
          <span class="text-[9px] text-muted-foreground shrink-0 ml-2">
            {fileCount()} files
          </span>
        </div>
      </Show>
      <div class="flex-1 overflow-auto">
        <Show
          when={entries().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2 p-4 text-center">
              <span class="text-xl">📁</span>
              <span>Open a folder to browse files</span>
              <span class="text-[10px]">
                Double-click or drag media files to import
              </span>
            </div>
          }
        >
          <For each={entries()}>
            {(entry) => (
              <FileTreeItem entry={entry} depth={0} onImport={handleImport} />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default FileBrowserPanel;
