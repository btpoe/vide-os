import { Component, For, Show, createMemo, createSignal } from "solid-js";
import {
  doc,
  sequenceFrameRate,
  playheadFrame,
  setPlayheadFrame,
  removeMarker,
  updateMarker,
  addMarkerAtPlayhead,
} from "@/stores/project-store";
import { revealFrame } from "@/stores/timeline-view-store";
import { framesToTimecode } from "@/lib/timecode";
import { toYouTubeChapters, toVttChapters, toMarkerList } from "@/model/chapters";
import { MARKER_COLORS } from "./timeline/MarkerLane";

/**
 * The marker list.
 *
 * The lane on the timeline is for placing markers; this is for reading them —
 * a shot list, a note pass, a chapter breakdown. It is also where they leave
 * the app, which is the point of writing them down.
 */

type ExportFormat = "youtube" | "vtt" | "list";

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "youtube", label: "YouTube", hint: "Paste into a video description" },
  { id: "vtt", label: "WebVTT", hint: "For a chapters track" },
  { id: "list", label: "Plain", hint: "Tab-separated, for notes" },
];

const MarkersPanel: Component = () => {
  const [format, setFormat] = createSignal<ExportFormat>("youtube");
  const [showExport, setShowExport] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const markers = createMemo(() =>
    [...doc().markers].sort((a, b) => a.frame - b.frame),
  );

  /**
   * Rows are keyed by id, not by the marker object.
   *
   * Every edit produces a new marker object — that is what structural sharing
   * means — and `For` compares by reference, so iterating the objects rebuilt
   * the row on every keystroke and the name field lost focus after each
   * letter. Iterating stable ids keeps the row, and its caret, alive.
   */
  const markerIds = createMemo(() => markers().map((m) => m.id));
  const markerById = (id: string) => markers().find((m) => m.id === id);

  const exported = createMemo(() => {
    const document_ = doc();
    switch (format()) {
      case "youtube":
        return toYouTubeChapters(document_);
      case "vtt":
        return toVttChapters(document_);
      case "list":
        return toMarkerList(document_);
    }
  });

  const goTo = (frame: number) => {
    setPlayheadFrame(frame);
    revealFrame(frame);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the textarea below is still there to
      // select from, so this is not worth an error dialog.
      setCopied(false);
    }
  };

  return (
    <div class="h-full flex flex-col text-sm">
      <div class="flex items-center gap-1 p-1.5 border-b border-border">
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground"
          onClick={() => addMarkerAtPlayhead()}
          title="Add a marker at the playhead (M)"
        >
          + Marker
        </button>
        <span class="text-[10px] text-muted-foreground">
          {markers().length} marker{markers().length === 1 ? "" : "s"}
        </span>
        <button
          class="ml-auto px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground"
          classList={{ "bg-primary/20 border-primary text-primary": showExport() }}
          onClick={() => setShowExport(!showExport())}
          disabled={markers().length === 0}
        >
          Export
        </button>
      </div>

      <Show when={showExport()}>
        <div class="p-1.5 border-b border-border space-y-1.5">
          <div class="flex gap-1">
            <For each={FORMATS}>
              {(option) => (
                <button
                  class={`px-2 py-0.5 text-[10px] rounded border ${
                    format() === option.id
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
                  }`}
                  title={option.hint}
                  onClick={() => setFormat(option.id)}
                >
                  {option.label}
                </button>
              )}
            </For>
            <button
              class="ml-auto px-2 py-0.5 text-[10px] rounded bg-secondary hover:bg-accent border border-border"
              onClick={() => void copy()}
            >
              {copied() ? "Copied" : "Copy"}
            </button>
          </div>
          <textarea
            readonly
            rows={6}
            value={exported()}
            class="w-full px-1.5 py-1 text-[10px] font-mono bg-input border border-border rounded text-foreground resize-none"
          />
        </div>
      </Show>

      <Show
        when={markers().length > 0}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 p-4 text-center">
            <span class="text-2xl">🔖</span>
            <span>No markers yet</span>
            <span class="text-[10px]">
              Press M to drop one at the playhead, or double-click one in the timeline
              to name it.
            </span>
          </div>
        }
      >
        <div class="flex-1 overflow-auto">
          <For each={markerIds()}>
            {(markerId) => {
              const marker = () => markerById(markerId);
              const current = () =>
                Math.abs((marker()?.frame ?? -1) - playheadFrame()) < 1;
              return (
                <Show when={marker()}>
                  {(entry) => (
                    <div
                      class="group flex items-start gap-2 px-2 py-1.5 border-b border-border/40 cursor-pointer hover:bg-accent/40"
                      classList={{ "bg-accent/60": current() }}
                      onClick={() => goTo(entry().frame)}
                    >
                      <div
                        class="mt-1 w-2.5 h-2.5 rotate-45 shrink-0 border border-black/30"
                        style={{ background: entry().color }}
                      />
                      <div class="flex-1 min-w-0">
                        <input
                          type="text"
                          value={entry().name}
                          placeholder="Unnamed"
                          onClick={(e) => e.stopPropagation()}
                          onInput={(e) =>
                            updateMarker(markerId, { name: e.currentTarget.value })
                          }
                          class="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                        />
                        <Show when={entry().note}>
                          <div class="text-[10px] text-muted-foreground truncate">
                            {entry().note}
                          </div>
                        </Show>
                      </div>
                      <span class="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                        {framesToTimecode(entry().frame, sequenceFrameRate())}
                      </span>
                      <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                        <For each={MARKER_COLORS}>
                          {(color) => (
                            <button
                              class="w-2.5 h-2.5 rounded-full border border-black/30"
                              style={{ background: color.value }}
                              title={color.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateMarker(markerId, { color: color.value });
                              }}
                            />
                          )}
                        </For>
                        <button
                          class="ml-1 text-[10px] text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMarker(markerId);
                          }}
                          title="Delete marker"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default MarkersPanel;
