import { Component, For, Show, createSignal } from "solid-js";
import {
  mediaState,
  selectMedia,
  removeMediaEntry,
  importFileHandle,
  type MediaEntry,
} from "@/stores/media-store";
import { formatFileSize, formatDuration } from "@/lib/fs-access";
import { takeDragFileHandle } from "@/lib/drag-payload";

const TYPE_ICONS: Record<string, string> = {
  video: "🎬",
  audio: "🎵",
  image: "🖼️",
};

const MediaGridItem: Component<{ entry: MediaEntry; selected: boolean }> = (props) => {
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer?.setData(
      "application/x-vide-os-media",
      JSON.stringify({
        id: props.entry.id,
        name: props.entry.name,
        type: props.entry.type,
        duration: props.entry.duration,
      }),
    );
    e.dataTransfer!.effectAllowed = "copy";
  };

  return (
    <div
      class={`relative rounded border overflow-hidden cursor-pointer transition-all group ${
        props.selected
          ? "border-primary ring-1 ring-primary/50"
          : "border-border hover:border-primary/40"
      }`}
      onClick={(e) => selectMedia(props.entry.id, e.shiftKey || e.metaKey)}
      draggable={true}
      onDragStart={handleDragStart}
    >
      {/* Thumbnail */}
      <div class="aspect-video bg-card flex items-center justify-center overflow-hidden">
        <Show
          when={props.entry.thumbnailUrl}
          fallback={
            <span class="text-xl text-muted-foreground">
              {props.entry.importing ? "⏳" : TYPE_ICONS[props.entry.type] || "📄"}
            </span>
          }
        >
          <img
            src={props.entry.thumbnailUrl}
            alt={props.entry.name}
            class="w-full h-full object-cover"
          />
        </Show>
        {/* Duration badge */}
        <Show when={props.entry.duration}>
          <span class="absolute bottom-0.5 right-0.5 px-1 py-px text-[9px] bg-black/70 text-white rounded">
            {formatDuration(props.entry.duration!)}
          </span>
        </Show>
        {/* Type badge */}
        <span class="absolute top-0.5 left-0.5 px-1 py-px text-[8px] bg-black/50 text-white rounded uppercase">
          {props.entry.type}
        </span>
      </div>
      {/* Name */}
      <div class="px-1.5 py-1 bg-card">
        <div class="text-[10px] truncate text-foreground">{props.entry.name}</div>
      </div>
      {/* Remove button on hover */}
      <button
        class="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-destructive/80 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          removeMediaEntry(props.entry.id);
        }}
      >
        ×
      </button>
    </div>
  );
};

const MediaListItem: Component<{ entry: MediaEntry; selected: boolean }> = (props) => {
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer?.setData(
      "application/x-vide-os-media",
      JSON.stringify({
        id: props.entry.id,
        name: props.entry.name,
        type: props.entry.type,
        duration: props.entry.duration,
      }),
    );
    e.dataTransfer!.effectAllowed = "copy";
  };

  return (
    <div
      class={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors group ${
        props.selected
          ? "bg-primary/15 text-foreground"
          : "hover:bg-accent text-muted-foreground hover:text-foreground"
      }`}
      onClick={(e) => selectMedia(props.entry.id, e.shiftKey || e.metaKey)}
      draggable={true}
      onDragStart={handleDragStart}
    >
      {/* Mini thumbnail */}
      <div class="w-10 h-7 rounded overflow-hidden bg-card shrink-0 flex items-center justify-center">
        <Show
          when={props.entry.thumbnailUrl}
          fallback={
            <span class="text-xs">
              {props.entry.importing ? "⏳" : TYPE_ICONS[props.entry.type] || "📄"}
            </span>
          }
        >
          <img
            src={props.entry.thumbnailUrl}
            alt=""
            class="w-full h-full object-cover"
          />
        </Show>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] truncate">{props.entry.name}</div>
        <div class="text-[9px] text-muted-foreground flex gap-2">
          <span>{props.entry.type}</span>
          <span>{formatFileSize(props.entry.size)}</span>
          <Show when={props.entry.duration}>
            <span>{formatDuration(props.entry.duration!)}</span>
          </Show>
          <Show when={props.entry.width}>
            <span>
              {props.entry.width}×{props.entry.height}
            </span>
          </Show>
        </div>
      </div>
      <button
        class="w-4 h-4 rounded text-destructive text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          removeMediaEntry(props.entry.id);
        }}
      >
        ×
      </button>
    </div>
  );
};

const MediaPoolPanel: Component = () => {
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  const [dragOver, setDragOver] = createSignal(false);

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Handle drag from File Browser
    const fileData = e.dataTransfer?.getData("application/x-vide-os-file");
    if (fileData) {
      const handle = takeDragFileHandle();
      if (handle) {
        await importFileHandle(handle);
      }
      return;
    }

    // Handle native file drop
    if (e.dataTransfer?.files?.length) {
      // Native file drops don't give us FileSystemFileHandle, skip for now
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  return (
    <div
      class="h-full flex flex-col text-sm"
      onDrop={(e) => void handleDrop(e)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div class="flex items-center justify-between p-2 border-b border-border">
        <span class="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
          Media ({mediaState.entries.length})
        </span>
        <div class="flex gap-1">
          <button
            onClick={() => setViewMode("grid")}
            class={`px-1.5 py-0.5 text-[10px] rounded ${
              viewMode() === "grid"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⊞
          </button>
          <button
            onClick={() => setViewMode("list")}
            class={`px-1.5 py-0.5 text-[10px] rounded ${
              viewMode() === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ☰
          </button>
        </div>
      </div>
      <div
        class={`flex-1 overflow-auto p-2 transition-colors ${dragOver() ? "bg-primary/5 ring-2 ring-inset ring-primary/30" : ""}`}
      >
        <Show
          when={mediaState.entries.length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 text-center">
              <span class="text-2xl">🎞️</span>
              <span>Drag media here or import from File Browser</span>
              <span class="text-[10px]">
                Double-click files in the browser to add them
              </span>
            </div>
          }
        >
          <Show when={viewMode() === "grid"}>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={mediaState.entries}>
                {(entry) => (
                  <MediaGridItem
                    entry={entry}
                    selected={mediaState.selectedIds.includes(entry.id)}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={viewMode() === "list"}>
            <div class="flex flex-col gap-0.5">
              <For each={mediaState.entries}>
                {(entry) => (
                  <MediaListItem
                    entry={entry}
                    selected={mediaState.selectedIds.includes(entry.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default MediaPoolPanel;
