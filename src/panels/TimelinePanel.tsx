import {
  Component,
  For,
  Show,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
} from "solid-js";
import {
  projectState,
  addClipToTrack,
  removeClip,
  moveClip,
  splitClipAtTime,
  trimClipLeft,
  trimClipRight,
  getClipAt,
  snapToNearest,
  setPlayhead,
  togglePlayback,
  toggleTrackMute,
  toggleTrackLock,
  addTextClip,
  reorderTrack,
  type Clip,
} from "@/stores/project-store";
import { mediaState } from "@/stores/media-store";
import {
  timelineState,
  selectClip,
  clearSelection,
  selectAllClips,
  isClipSelected,
  startDrag,
  endDrag,
  startTrim,
  endTrim,
  toggleSnap,
  startTrackDrag,
  updateTrackDropIndex,
  endTrackDrag,
} from "@/stores/timeline-store";
import { uiState, setSelectedTool } from "@/stores/ui-store";
import { pushAction } from "@/stores/history-store";
import { formatDuration, getFileFromHandle } from "@/lib/fs-access";
import {
  getCachedWaveform,
  getWaveform,
  waveformToSvgPath,
} from "@/lib/waveform";
import { getCachedThumbnail, getClipThumbnail } from "@/lib/clip-thumbnails";

const TRACK_HEIGHT = 44;
const HEADER_WIDTH = 120;
const TRIM_HANDLE_WIDTH = 6;
const SNAP_THRESHOLD_PX = 8;

const TimelinePanel: Component = () => {
  const [zoom, setZoom] = createSignal(1);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  const [snapLine, setSnapLine] = createSignal<number | null>(null);
  const [waveformVersion, setWaveformVersion] = createSignal(0);
  let tracksContainerRef: HTMLDivElement | undefined;

  // Trigger waveform generation for a clip's media
  const ensureWaveform = (mediaId: string) => {
    if (getCachedWaveform(mediaId)) return;
    const entry = mediaState.entries.find((e) => e.id === mediaId);
    if (!entry) return;
    getFileFromHandle(entry.handle)
      .then((file) => getWaveform(mediaId, file))
      .then(() => setWaveformVersion((v) => v + 1))
      .catch(() => {});
  };

  // Trigger thumbnail generation for a clip's media
  const ensureThumbnail = (mediaId: string) => {
    if (getCachedThumbnail(mediaId)) return;
    const entry = mediaState.entries.find((e) => e.id === mediaId);
    if (!entry) return;
    getFileFromHandle(entry.handle)
      .then((file) => getClipThumbnail(mediaId, file))
      .then(() => setWaveformVersion((v) => v + 1)) // reuse version signal to trigger re-render
      .catch(() => {});
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * projectState.fps);
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
  };

  const activeTool = () => uiState.selectedTool;

  // ── Pixel ↔ Time conversion ──────────────────────────────────────

  const getTrackContentWidth = (): number => {
    if (!tracksContainerRef) return 600;
    const firstTrackContent = tracksContainerRef.querySelector(
      "[data-track-content]",
    ) as HTMLElement;
    return firstTrackContent?.clientWidth || 600;
  };

  const pxToTime = (px: number): number => {
    const width = getTrackContentWidth();
    return (px / width) * projectState.duration;
  };

  const timeToPct = (time: number): number => {
    return (time / projectState.duration) * 100;
  };

  const snapThresholdTime = (): number => {
    return pxToTime(SNAP_THRESHOLD_PX);
  };

  // ── Ruler ticks ──────────────────────────────────────────────────

  const rulerTicks = createMemo(() => {
    const dur = projectState.duration;
    const step = Math.max(5, Math.round(30 / zoom()));
    const ticks: { pos: number; label: string }[] = [];
    for (let t = 0; t <= dur; t += step) {
      ticks.push({ pos: (t / dur) * 100, label: formatDuration(t) });
    }
    return ticks;
  });

  // ── Clip label ───────────────────────────────────────────────────

  const getClipLabel = (clip: Clip): string => {
    if (clip.mediaId === "__text__" && clip.textOverlay) {
      const txt = clip.textOverlay.text;
      return txt.length > 20 ? txt.slice(0, 20) + "…" : txt || "Text";
    }
    const entry = mediaState.entries.find((e) => e.id === clip.mediaId);
    return entry?.name || "Clip";
  };

  // ── Ruler scrub ──────────────────────────────────────────────────

  let rulerDragging = false;

  const rulerTimeFromEvent = (e: MouseEvent): number => {
    const target = (e.currentTarget || e.target) as HTMLElement;
    const rulerEl = target.closest("[data-ruler]") as HTMLElement;
    if (!rulerEl) return 0;
    const rect = rulerEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    return pct * projectState.duration;
  };

  const handleRulerMouseDown = (e: MouseEvent) => {
    rulerDragging = true;
    setPlayhead(rulerTimeFromEvent(e));
    const onMove = (ev: MouseEvent) => {
      if (!rulerDragging) return;
      const rulerEl = document.querySelector("[data-ruler]") as HTMLElement;
      if (!rulerEl) return;
      const rect = rulerEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      setPlayhead(pct * projectState.duration);
    };
    const onUp = () => {
      rulerDragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Playhead drag from track area ───────────────────────────────

  const handlePlayheadMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const timeFromClientX = (clientX: number): number => {
      const trackContent = tracksContainerRef?.querySelector(
        "[data-track-content]",
      ) as HTMLElement | null;
      if (!trackContent) return projectState.playheadPosition;
      const rect = trackContent.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * projectState.duration;
    };

    setPlayhead(timeFromClientX(e.clientX));

    const onMove = (ev: MouseEvent) => {
      setPlayhead(timeFromClientX(ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Drop media onto track ────────────────────────────────────────

  const handleTrackDrop = (trackId: string, e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);

    // Skip media drop if this is a track reorder drag
    if (e.dataTransfer?.getData("application/x-vide-os-track")) return;

    const mediaData = e.dataTransfer?.getData("application/x-vide-os-media");
    if (mediaData) {
      try {
        const data = JSON.parse(mediaData);
        const duration = data.duration || 10;
        const clip = addClipToTrack(trackId, data.id, data.name, duration);
        pushAction(
          `Add ${data.name}`,
          "➕",
          () => removeClip(trackId, clip.id),
          () =>
            addClipToTrack(
              trackId,
              data.id,
              data.name,
              duration,
              clip.startTime,
            ),
        );
      } catch {}
      return;
    }

    const fileData = e.dataTransfer?.getData("application/x-vide-os-file");
    if (fileData) {
      const handle = (window as any).__dragFileHandle as
        | FileSystemFileHandle
        | undefined;
      if (handle) {
        import("@/stores/media-store").then(({ importFileHandle }) => {
          importFileHandle(handle).then((entry) => {
            if (entry) {
              const duration = entry.duration || 10;
              const clip = addClipToTrack(
                trackId,
                entry.id,
                entry.name,
                duration,
              );
              pushAction(
                `Add ${entry.name}`,
                "➕",
                () => removeClip(trackId, clip.id),
                () =>
                  addClipToTrack(
                    trackId,
                    entry.id,
                    entry.name,
                    duration,
                    clip.startTime,
                  ),
              );
            }
          });
        });
        (window as any).__dragFileHandle = undefined;
      }
    }
  };

  const handleTrackDragOver = (trackId: string, e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    setDropTarget(trackId);
  };

  const handleTrackDragLeave = () => setDropTarget(null);

  // ── Clip interaction: click, drag, trim ──────────────────────────

  const handleClipMouseDown = (trackId: string, clip: Clip, e: MouseEvent) => {
    e.stopPropagation();
    const tool = activeTool();

    // Razor tool: split at click position
    if (tool === "razor") {
      const trackContent = (e.currentTarget as HTMLElement).parentElement!;
      const rect = trackContent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickTime = pxToTime(x);
      const newClip = splitClipAtTime(trackId, clip.id, clickTime);
      if (newClip) {
        pushAction(
          `Split ${getClipLabel(clip)}`,
          "✂",
          () => {
            // Undo: merge clips back
            removeClip(trackId, newClip.id);
            // Restore original duration
            const origDur = clip.duration + newClip.duration;
            moveClip(trackId, clip.id, clip.startTime);
            // We'd need to restore duration — simplified undo
          },
          () => splitClipAtTime(trackId, clip.id, clickTime),
        );
      }
      return;
    }

    // Select
    selectClip({ trackId, clipId: clip.id }, e.shiftKey || e.metaKey);

    // Check if clicking on trim handle
    const clipEl = e.currentTarget as HTMLElement;
    const clipRect = clipEl.getBoundingClientRect();
    const localX = e.clientX - clipRect.left;

    if (localX <= TRIM_HANDLE_WIDTH) {
      // Left trim
      handleTrimStart(trackId, clip, "left", e);
      return;
    }
    if (localX >= clipRect.width - TRIM_HANDLE_WIDTH) {
      // Right trim
      handleTrimStart(trackId, clip, "right", e);
      return;
    }

    // Drag clip (select tool or hand tool)
    if (tool === "select" || tool === "hand") {
      handleDragStart(trackId, clip, e);
    }
  };

  // ── Clip drag ────────────────────────────────────────────────────

  const handleDragStart = (trackId: string, clip: Clip, e: MouseEvent) => {
    const track = projectState.tracks.find((t) => t.id === trackId);
    if (track?.locked) return;

    const origStartTime = clip.startTime;
    const startX = e.clientX;
    startDrag(startX, origStartTime);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dt = pxToTime(dx);
      let newTime = origStartTime + dt;

      if (timelineState.snapEnabled) {
        newTime = snapToNearest(newTime, snapThresholdTime(), clip.id);
        const endSnap = snapToNearest(
          newTime + clip.duration,
          snapThresholdTime(),
          clip.id,
        );
        if (
          Math.abs(endSnap - (newTime + clip.duration)) < snapThresholdTime()
        ) {
          newTime = endSnap - clip.duration;
          setSnapLine(endSnap);
        } else if (
          Math.abs(
            newTime - snapToNearest(newTime, snapThresholdTime(), clip.id),
          ) < 0.01
        ) {
          setSnapLine(newTime);
        } else {
          setSnapLine(null);
        }
      }

      moveClip(trackId, clip.id, Math.max(0, newTime));
    };

    const onUp = () => {
      endDrag();
      setSnapLine(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      const finalTime =
        projectState.tracks
          .find((t) => t.id === trackId)
          ?.clips.find((c) => c.id === clip.id)?.startTime ?? origStartTime;

      if (Math.abs(finalTime - origStartTime) > 0.01) {
        pushAction(
          `Move ${getClipLabel(clip)}`,
          "↔",
          () => moveClip(trackId, clip.id, origStartTime),
          () => moveClip(trackId, clip.id, finalTime),
        );
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Trim ─────────────────────────────────────────────────────────

  const handleTrimStart = (
    trackId: string,
    clip: Clip,
    side: "left" | "right",
    e: MouseEvent,
  ) => {
    const track = projectState.tracks.find((t) => t.id === trackId);
    if (track?.locked) return;

    startTrim(side, { trackId, clipId: clip.id });
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDuration = clip.duration;
    const origInPoint = clip.inPoint;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dt = pxToTime(dx);

      if (side === "left") {
        let newStart = origStart + dt;
        if (timelineState.snapEnabled) {
          newStart = snapToNearest(newStart, snapThresholdTime(), clip.id);
        }
        trimClipLeft(trackId, clip.id, newStart);
      } else {
        let newEnd = origStart + origDuration + dt;
        if (timelineState.snapEnabled) {
          newEnd = snapToNearest(newEnd, snapThresholdTime(), clip.id);
        }
        trimClipRight(trackId, clip.id, newEnd);
      }
    };

    const onUp = () => {
      endTrim();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      pushAction(
        `Trim ${getClipLabel(clip)}`,
        "⟷",
        () => {
          // Restore original
          if (side === "left") {
            trimClipLeft(trackId, clip.id, origStart);
          } else {
            trimClipRight(trackId, clip.id, origStart + origDuration);
          }
        },
        () => {
          // Re-apply current state (already applied)
        },
      );
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Track content click (deselect / razor on empty) ──────────────

  const handleTrackClick = (trackId: string, e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;

    // Text tool: add a text clip at click position
    if (activeTool() === "text") {
      const track = projectState.tracks.find((t) => t.id === trackId);
      if (!track || track.type !== "video") return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const xPct = (e.clientX - rect.left) / rect.width;
      const time = xPct * projectState.duration;
      const clip = addTextClip(trackId, Math.max(0, time), 5, "Title");
      selectClip({ trackId, clipId: clip.id });
      pushAction(
        "Add Text Clip",
        "T",
        () => {},
        () => removeClip(trackId, clip.id),
      );
      return;
    }

    clearSelection();
  };

  // ── Track reorder drag ─────────────────────────────────────────────

  const handleTrackHeaderDragStart = (trackId: string, e: DragEvent) => {
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("application/x-vide-os-track", trackId);
    startTrackDrag(trackId);
  };

  const handleTrackHeaderDragOver = (trackIndex: number, e: DragEvent) => {
    if (!timelineState.trackDragId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    // Determine if drop should go above or below this track
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dropIdx = e.clientY < midY ? trackIndex : trackIndex + 1;
    updateTrackDropIndex(dropIdx);
  };

  const handleTrackHeaderDrop = (e: DragEvent) => {
    e.preventDefault();
    const trackId = timelineState.trackDragId;
    const dropIdx = timelineState.trackDropIndex;
    if (trackId && dropIdx !== null) {
      const fromIndex = projectState.tracks.findIndex((t) => t.id === trackId);
      // Adjust target index when dragging downward
      const targetIdx = dropIdx > fromIndex ? dropIdx - 1 : dropIdx;
      if (fromIndex !== targetIdx) {
        reorderTrack(trackId, targetIdx);
        pushAction(
          "Reorder track",
          "↕",
          () => reorderTrack(trackId, fromIndex),
          () => reorderTrack(trackId, targetIdx),
        );
      }
    }
    endTrackDrag();
  };

  const handleTrackHeaderDragEnd = () => {
    endTrackDrag();
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't capture if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlayback();
        break;
      case "Delete":
      case "Backspace":
        if (timelineState.selectedClips.length > 0) {
          e.preventDefault();
          deleteSelectedClips();
        }
        break;
      case "Home":
        e.preventDefault();
        setPlayhead(0);
        break;
      case "End":
        e.preventDefault();
        setPlayhead(projectState.duration);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (e.shiftKey) {
          nudgeSelectedClips(-1);
        } else {
          setPlayhead(projectState.playheadPosition - 1 / projectState.fps);
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (e.shiftKey) {
          nudgeSelectedClips(1);
        } else {
          setPlayhead(projectState.playheadPosition + 1 / projectState.fps);
        }
        break;
      case "j":
      case "J":
        setPlayhead(projectState.playheadPosition - 5);
        break;
      case "k":
      case "K":
        togglePlayback();
        break;
      case "l":
      case "L":
        setPlayhead(projectState.playheadPosition + 5);
        break;
      case "s":
      case "S":
        if (!e.metaKey && !e.ctrlKey) {
          toggleSnap();
        }
        break;
      case "a":
      case "A":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          selectAllClips();
        }
        break;
      case "z":
      case "Z":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          if (e.shiftKey) {
            import("@/stores/history-store").then(({ redo }) => redo());
          } else {
            import("@/stores/history-store").then(({ undo }) => undo());
          }
        }
        break;
      case "=":
      case "+":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          setZoom((z) => Math.min(4, z + 0.25));
        }
        break;
      case "-":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          setZoom((z) => Math.max(0.25, z - 0.25));
        }
        break;
      // Tool shortcuts
      case "v":
      case "V":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("select");
        break;
      case "c":
      case "C":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("razor");
        break;
      case "t":
      case "T":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("trim");
        break;
      case "y":
      case "Y":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("slip");
        break;
      case "u":
      case "U":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("slide");
        break;
      case "h":
      case "H":
        if (!e.metaKey && !e.ctrlKey) setSelectedTool("hand");
        break;
    }
  };

  const deleteSelectedClips = () => {
    const clips = [...timelineState.selectedClips];
    // Store clip data for undo
    const clipData: { trackId: string; clip: Clip }[] = [];
    for (const ref of clips) {
      const track = projectState.tracks.find((t) => t.id === ref.trackId);
      const clip = track?.clips.find((c) => c.id === ref.clipId);
      if (clip) clipData.push({ trackId: ref.trackId, clip: { ...clip } });
    }

    for (const ref of clips) {
      removeClip(ref.trackId, ref.clipId);
    }
    clearSelection();

    pushAction(
      `Delete ${clips.length} clip${clips.length > 1 ? "s" : ""}`,
      "🗑",
      () => {
        // Undo: re-add clips
        for (const { trackId, clip } of clipData) {
          addClipToTrack(
            trackId,
            clip.mediaId,
            "",
            clip.duration,
            clip.startTime,
          );
        }
      },
      () => {
        for (const { trackId, clip } of clipData) {
          removeClip(trackId, clip.id);
        }
      },
    );
  };

  const nudgeSelectedClips = (seconds: number) => {
    for (const ref of timelineState.selectedClips) {
      const track = projectState.tracks.find((t) => t.id === ref.trackId);
      const clip = track?.clips.find((c) => c.id === ref.clipId);
      if (clip) {
        moveClip(ref.trackId, ref.clipId, clip.startTime + seconds);
      }
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  // ── Clip cursor based on tool ────────────────────────────────────

  const getClipCursor = (): string => {
    const tool = activeTool();
    if (tool === "razor") return "crosshair";
    if (tool === "trim") return "col-resize";
    return "pointer";
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div
      class="h-full flex flex-col text-sm select-none"
      style={{ "min-height": "0" }}
    >
      {/* Transport bar */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "4px 12px",
          "border-bottom": "1px solid var(--color-border)",
          background: "var(--color-card)",
          "flex-shrink": "0",
        }}
      >
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            style={{
              padding: "2px 8px",
              "font-size": "12px",
              "border-radius": "4px",
              background: "var(--color-secondary)",
              color: "var(--color-foreground)",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => setPlayhead(0)}
            title="Go to start (Home)"
          >
            ⏮
          </button>
          <button
            style={{
              padding: "2px 8px",
              "font-size": "12px",
              "border-radius": "4px",
              background: projectState.isPlaying
                ? "var(--color-destructive)"
                : "var(--color-primary)",
              color: "var(--color-primary-foreground)",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => togglePlayback()}
            title="Play/Pause (Space)"
          >
            {projectState.isPlaying ? "⏸" : "▶"}
          </button>
          <button
            style={{
              padding: "2px 8px",
              "font-size": "12px",
              "border-radius": "4px",
              background: "var(--color-secondary)",
              color: "var(--color-foreground)",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => setPlayhead(projectState.duration)}
            title="Go to end (End)"
          >
            ⏭
          </button>
        </div>
        <span
          style={{
            "font-family": "monospace",
            "font-size": "11px",
            color: "var(--color-muted-foreground)",
          }}
        >
          {formatTime(projectState.playheadPosition)} /{" "}
          {formatTime(projectState.duration)}
        </span>
        <div style={{ flex: "1" }} />
        {/* Snap toggle */}
        <button
          style={{
            padding: "2px 6px",
            "font-size": "10px",
            "border-radius": "3px",
            background: timelineState.snapEnabled
              ? "var(--color-primary)"
              : "var(--color-secondary)",
            color: timelineState.snapEnabled
              ? "var(--color-primary-foreground)"
              : "var(--color-muted-foreground)",
            border: "none",
            cursor: "pointer",
          }}
          onClick={() => toggleSnap()}
          title="Toggle snapping (S)"
        >
          🧲 Snap
        </button>
        {/* Zoom */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "font-size": "11px",
            color: "var(--color-muted-foreground)",
          }}
        >
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              "font-size": "14px",
            }}
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          >
            −
          </button>
          <span>{Math.round(zoom() * 100)}%</span>
          <button
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              "font-size": "14px",
            }}
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
          >
            +
          </button>
        </div>
      </div>

      {/* Ruler */}
      <div
        style={{
          display: "flex",
          "flex-shrink": "0",
          height: "22px",
          "border-bottom": "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            width: `${HEADER_WIDTH}px`,
            "flex-shrink": "0",
            background: "var(--color-card)",
            "border-right": "1px solid var(--color-border)",
          }}
        />
        <div
          data-ruler
          style={{
            flex: "1",
            position: "relative",
            background: "rgba(20,20,20,1)",
            cursor: "pointer",
          }}
          onMouseDown={handleRulerMouseDown}
        >
          <For each={rulerTicks()}>
            {(tick) => (
              <span
                style={{
                  position: "absolute",
                  bottom: "2px",
                  left: `${tick.pos}%`,
                  "font-size": "9px",
                  color: "#888",
                  "white-space": "nowrap",
                  "padding-left": "2px",
                  "pointer-events": "none",
                }}
              >
                {tick.label}
              </span>
            )}
          </For>
          {/* Playhead marker */}
          <div
            style={{
              position: "absolute",
              top: "0",
              bottom: "0",
              left: `${timeToPct(projectState.playheadPosition)}%`,
              width: "2px",
              background: "var(--color-primary, #6366f1)",
              "z-index": "10",
              "pointer-events": "none",
            }}
          />
        </div>
      </div>

      {/* Tracks */}
      <div
        ref={tracksContainerRef}
        class="flex-1 overflow-y-auto"
        style={{ "min-height": "0" }}
      >
        <For each={projectState.tracks}>
          {(track, trackIdx) => (
            <div
              style={{
                display: "flex",
                height: `${TRACK_HEIGHT}px`,
                "border-bottom": "1px solid var(--color-border)",
                position: "relative",
                opacity: timelineState.trackDragId === track.id ? "0.4" : "1",
                transition: "opacity 0.15s",
              }}
              onDragOver={(e) => handleTrackHeaderDragOver(trackIdx(), e)}
              onDrop={handleTrackHeaderDrop}
            >
              {/* Track reorder drop indicator */}
              <Show
                when={
                  timelineState.trackDragId &&
                  timelineState.trackDropIndex === trackIdx()
                }
              >
                <div
                  style={{
                    position: "absolute",
                    top: "-1px",
                    left: "0",
                    right: "0",
                    height: "2px",
                    background: "var(--color-primary, #6366f1)",
                    "z-index": "30",
                    "pointer-events": "none",
                  }}
                />
              </Show>
              {/* Track header */}
              <div
                draggable={true}
                onDragStart={(e) => handleTrackHeaderDragStart(track.id, e)}
                onDragEnd={handleTrackHeaderDragEnd}
                style={{
                  width: `${HEADER_WIDTH}px`,
                  "flex-shrink": "0",
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "0 8px",
                  background: "var(--color-card)",
                  "border-right": "1px solid var(--color-border)",
                  cursor: "grab",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    "border-radius": "50%",
                    "flex-shrink": "0",
                    background: track.type === "video" ? "#3b82f6" : "#22c55e",
                  }}
                />
                <span
                  style={{
                    "font-size": "11px",
                    "font-weight": "500",
                    color: "var(--color-foreground)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    flex: "1",
                  }}
                >
                  {track.name}
                </span>
                <button
                  onClick={() => toggleTrackMute(track.id)}
                  style={{
                    "font-size": "10px",
                    color: track.muted
                      ? "var(--color-destructive)"
                      : "var(--color-muted-foreground)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0",
                  }}
                  title={
                    track.muted
                      ? track.type === "video"
                        ? "Show"
                        : "Unmute"
                      : track.type === "video"
                        ? "Hide"
                        : "Mute"
                  }
                >
                  {track.type === "video"
                    ? track.muted
                      ? "👁‍🗨"
                      : "👁"
                    : track.muted
                      ? "🔇"
                      : "🔊"}
                </button>
                <button
                  onClick={() => toggleTrackLock(track.id)}
                  style={{
                    "font-size": "10px",
                    color: track.locked
                      ? "#eab308"
                      : "var(--color-muted-foreground)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0",
                  }}
                  title={track.locked ? "Unlock" : "Lock"}
                >
                  {track.locked ? "🔒" : "🔓"}
                </button>
              </div>
              {/* Track content */}
              <div
                data-track-content
                style={{
                  flex: "1",
                  position: "relative",
                  background:
                    dropTarget() === track.id
                      ? "rgba(99,102,241,0.08)"
                      : track.locked
                        ? "rgba(234,179,8,0.03)"
                        : "rgba(255,255,255,0.02)",
                  transition: "background 0.15s",
                }}
                onDrop={(e) => handleTrackDrop(track.id, e)}
                onDragOver={(e) => handleTrackDragOver(track.id, e)}
                onDragLeave={handleTrackDragLeave}
                onClick={(e) => handleTrackClick(track.id, e)}
              >
                <For each={track.clips}>
                  {(clip) => {
                    const selected = () => isClipSelected(track.id, clip.id);
                    const isVideo = track.type === "video";
                    const isTextClip = clip.mediaId === "__text__";
                    const bgColor = isTextClip
                      ? "168,85,247" // purple for text clips
                      : isVideo
                        ? "59,130,246"
                        : "34,197,94";

                    // Trigger waveform/thumbnail generation
                    if (track.type === "audio" && !isTextClip)
                      ensureWaveform(clip.mediaId);
                    if (isVideo && !isTextClip) ensureThumbnail(clip.mediaId);

                    const thumbUrl = () => {
                      waveformVersion(); // reactive dependency
                      return getCachedThumbnail(clip.mediaId);
                    };

                    const waveformPath = () => {
                      waveformVersion(); // reactive dependency
                      const data = getCachedWaveform(clip.mediaId);
                      if (!data) return null;
                      const entry = mediaState.entries.find(
                        (e) => e.id === clip.mediaId,
                      );
                      const totalDur = entry?.duration || clip.duration;
                      const startFrac = clip.inPoint / totalDur;
                      const endFrac = clip.outPoint / totalDur;
                      return waveformToSvgPath(
                        data,
                        1000,
                        TRACK_HEIGHT - 8,
                        startFrac,
                        endFrac,
                      );
                    };

                    return (
                      <div
                        style={{
                          position: "absolute",
                          left: `${timeToPct(clip.startTime)}%`,
                          width: `${timeToPct(clip.duration)}%`,
                          top: "3px",
                          bottom: "3px",
                          "border-radius": "3px",
                          background: selected()
                            ? `rgba(${bgColor},0.55)`
                            : `rgba(${bgColor},0.3)`,
                          border: selected()
                            ? `2px solid rgba(${bgColor},0.9)`
                            : `1px solid rgba(${bgColor},0.5)`,
                          display: "flex",
                          "align-items": "center",
                          overflow: "hidden",
                          cursor: getClipCursor(),
                          "z-index": selected() ? "5" : "1",
                          "box-shadow": selected()
                            ? `0 0 8px rgba(${bgColor},0.4)`
                            : "none",
                          transition:
                            "background 0.1s, border 0.1s, box-shadow 0.1s",
                        }}
                        onMouseDown={(e) =>
                          handleClipMouseDown(track.id, clip, e)
                        }
                        title={`${getClipLabel(clip)} (${formatDuration(clip.duration)})`}
                      >
                        {/* Left trim handle */}
                        <div
                          style={{
                            position: "absolute",
                            left: "0",
                            top: "0",
                            bottom: "0",
                            width: `${TRIM_HANDLE_WIDTH}px`,
                            cursor: "col-resize",
                            background: selected()
                              ? `rgba(${bgColor},0.6)`
                              : "transparent",
                            "border-radius": "3px 0 0 3px",
                            transition: "background 0.15s",
                          }}
                        />
                        {/* Transition indicator */}
                        <Show when={clip.transition}>
                          <div
                            style={{
                              position: "absolute",
                              left: `${TRIM_HANDLE_WIDTH}px`,
                              top: "0",
                              bottom: "0",
                              width: "20%",
                              "max-width": "40px",
                              background: `linear-gradient(90deg, rgba(168,85,247,0.5) 0%, transparent 100%)`,
                              "pointer-events": "none",
                              "border-radius": "2px 0 0 2px",
                              "z-index": "1",
                            }}
                            title={`${clip.transition!.type} (${clip.transition!.duration.toFixed(1)}s)`}
                          />
                        </Show>
                        {/* Video thumbnail overlay */}
                        <Show when={isVideo && thumbUrl()}>
                          <div
                            style={{
                              position: "absolute",
                              left: `${TRIM_HANDLE_WIDTH}px`,
                              top: "0",
                              bottom: "0",
                              width: `${TRACK_HEIGHT - 6}px`,
                              "background-image": `url(${thumbUrl()})`,
                              "background-size": "cover",
                              "background-position": "center",
                              opacity: selected() ? "0.5" : "0.35",
                              "border-radius": "2px",
                              "pointer-events": "none",
                            }}
                          />
                        </Show>
                        {/* Waveform overlay for audio clips */}
                        <Show when={track.type === "audio" && waveformPath()}>
                          <svg
                            viewBox={`0 0 1000 ${TRACK_HEIGHT - 8}`}
                            preserveAspectRatio="none"
                            style={{
                              position: "absolute",
                              left: `${TRIM_HANDLE_WIDTH}px`,
                              right: `${TRIM_HANDLE_WIDTH}px`,
                              top: "0",
                              bottom: "0",
                              width: `calc(100% - ${TRIM_HANDLE_WIDTH * 2}px)`,
                              height: "100%",
                              "pointer-events": "none",
                              opacity: selected() ? "0.6" : "0.4",
                            }}
                          >
                            <path
                              d={waveformPath()!}
                              fill={`rgba(${bgColor},0.7)`}
                            />
                          </svg>
                        </Show>
                        {/* Clip label */}
                        <span
                          style={{
                            "font-size": "9px",
                            color: "var(--color-foreground)",
                            "white-space": "nowrap",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "padding-left": `${TRIM_HANDLE_WIDTH + 4}px`,
                            "padding-right": `${TRIM_HANDLE_WIDTH + 4}px`,
                            "pointer-events": "none",
                            "z-index": "2",
                            position: "relative",
                          }}
                        >
                          {getClipLabel(clip)}
                        </span>
                        {/* Right trim handle */}
                        <div
                          style={{
                            position: "absolute",
                            right: "0",
                            top: "0",
                            bottom: "0",
                            width: `${TRIM_HANDLE_WIDTH}px`,
                            cursor: "col-resize",
                            background: selected()
                              ? `rgba(${bgColor},0.6)`
                              : "transparent",
                            "border-radius": "0 3px 3px 0",
                            transition: "background 0.15s",
                          }}
                        />
                      </div>
                    );
                  }}
                </For>
                {/* Snap line */}
                <Show when={snapLine() !== null}>
                  <div
                    style={{
                      position: "absolute",
                      top: "0",
                      bottom: "0",
                      left: `${timeToPct(snapLine()!)}%`,
                      width: "1px",
                      background: "#eab308",
                      "z-index": "20",
                      "pointer-events": "none",
                    }}
                  />
                </Show>
                {/* Playhead line (draggable) */}
                <div
                  style={{
                    position: "absolute",
                    top: "0",
                    bottom: "0",
                    left: `${timeToPct(projectState.playheadPosition)}%`,
                    width: "9px",
                    "margin-left": "-4px",
                    "z-index": "15",
                    cursor: "col-resize",
                    display: "flex",
                    "justify-content": "center",
                  }}
                  onMouseDown={handlePlayheadMouseDown}
                >
                  <div
                    style={{
                      width: "1px",
                      height: "100%",
                      background: "var(--color-primary)",
                      opacity: "0.5",
                      "pointer-events": "none",
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </For>
        {/* Drop indicator below last track */}
        <Show
          when={
            timelineState.trackDragId &&
            timelineState.trackDropIndex === projectState.tracks.length
          }
        >
          <div
            style={{
              height: "2px",
              background: "var(--color-primary, #6366f1)",
              "pointer-events": "none",
            }}
          />
        </Show>
      </div>

      {/* Status bar */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "2px 12px",
          "border-top": "1px solid var(--color-border)",
          background: "var(--color-card)",
          "flex-shrink": "0",
          "font-size": "10px",
          color: "var(--color-muted-foreground)",
        }}
      >
        <span>
          {timelineState.selectedClips.length > 0
            ? `${timelineState.selectedClips.length} clip${timelineState.selectedClips.length > 1 ? "s" : ""} selected`
            : "No selection"}
        </span>
        <span>·</span>
        <span>Tool: {activeTool()}</span>
        <Show when={timelineState.snapEnabled}>
          <span>· 🧲 Snap</span>
        </Show>
      </div>
    </div>
  );
};

export default TimelinePanel;
