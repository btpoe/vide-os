import { Component, For, Show, createMemo, createSignal } from "solid-js";
import {
  doc,
  sequenceFrameRate,
  playheadFrame,
  setPlayheadFrame,
  addCueAtPlayhead,
  removeCue,
  updateCue,
  splitCueAtPlayhead,
  replaceCues,
  setSubtitleStyle,
  setBurnInSubtitles,
} from "@/stores/project-store";
import { revealFrame } from "@/stores/timeline-view-store";
import { framesToTimecode, timecodeToFrames } from "@/lib/timecode";
import { parseSubtitles, toSrt, toVtt } from "@/model/subtitles";

/**
 * The caption list.
 *
 * A list rather than a strip of clips, because that is how captions are
 * written: read down the column, fix the wording, nudge the timing. The
 * timeline lane is for seeing where they fall.
 */

const CaptionsPanel: Component = () => {
  const [importWarning, setImportWarning] = createSignal<string | null>(null);
  const [showStyle, setShowStyle] = createSignal(false);

  const cues = createMemo(() => doc().subtitles);
  const cueIds = createMemo(() => cues().map((c) => c.id));
  const cueById = (id: string) => cues().find((c) => c.id === id);
  const style = () => doc().sequence.subtitleStyle;
  const rate = () => sequenceFrameRate();

  const goTo = (frame: number) => {
    setPlayheadFrame(frame);
    revealFrame(frame);
  };

  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".srt,.vtt,.txt";
    input.onchange = () =>
      void (async () => {
        const file = input.files?.[0];
        if (!file) return;

        const { cues: parsed, skipped } = parseSubtitles(await file.text(), rate());
        if (parsed.length === 0) {
          setImportWarning(`No captions found in ${file.name}.`);
          return;
        }

        replaceCues(parsed, `Import ${file.name}`);
        // Reported rather than swallowed: a file that half-parsed is usually a
        // file with a real problem in it.
        setImportWarning(
          skipped > 0
            ? `Imported ${parsed.length} captions; ${skipped} block${skipped > 1 ? "s" : ""} could not be read.`
            : null,
        );
      })();
    input.click();
  };

  const download = (text: string, extension: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc().name || "captions"}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div class="h-full flex flex-col text-sm">
      <div class="flex flex-wrap items-center gap-1 p-1.5 border-b border-border">
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground"
          onClick={() => addCueAtPlayhead()}
        >
          + Caption
        </button>
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground"
          onClick={importFile}
        >
          Import
        </button>
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground disabled:opacity-40"
          disabled={cues().length === 0}
          onClick={() => download(toSrt(cues(), rate()), "srt")}
        >
          .srt
        </button>
        <button
          class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground disabled:opacity-40"
          disabled={cues().length === 0}
          onClick={() => download(toVtt(cues(), rate()), "vtt")}
        >
          .vtt
        </button>
        <button
          class="ml-auto px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent border border-border text-foreground"
          classList={{ "bg-primary/20 border-primary text-primary": showStyle() }}
          onClick={() => setShowStyle(!showStyle())}
        >
          Style
        </button>
      </div>

      <Show when={importWarning()}>
        {(message) => (
          <div class="px-2 py-1.5 text-[10px] text-yellow-500 border-b border-border flex items-start gap-2">
            <span class="flex-1">{message()}</span>
            <button
              class="text-muted-foreground hover:text-foreground"
              onClick={() => setImportWarning(null)}
            >
              ✕
            </button>
          </div>
        )}
      </Show>

      <Show when={showStyle()}>
        <div class="p-2 border-b border-border space-y-2">
          <label class="flex items-center gap-2 text-[10px] text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={doc().sequence.burnInSubtitles}
              onChange={(e) => setBurnInSubtitles(e.currentTarget.checked)}
              class="accent-primary"
            />
            Burn captions into the picture
          </label>
          <div class="text-[9px] text-muted-foreground -mt-1">
            When off, captions stay in the project and export as a sidecar file, but the
            video has none.
          </div>

          <div class="flex items-center gap-2">
            <label class="text-[10px] text-muted-foreground w-14 shrink-0">Size</label>
            <input
              type="range"
              min={0.02}
              max={0.14}
              step={0.002}
              value={style().fontSize}
              onInput={(e) =>
                setSubtitleStyle({ fontSize: parseFloat(e.currentTarget.value) })
              }
              class="flex-1 h-1 accent-primary cursor-pointer"
            />
            <span class="text-[10px] font-mono text-muted-foreground w-10 text-right">
              {(style().fontSize * 100).toFixed(1)}%
            </span>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-[10px] text-muted-foreground w-14 shrink-0">
              Position
            </label>
            <input
              type="range"
              min={0.1}
              max={0.98}
              step={0.01}
              value={style().y}
              onInput={(e) =>
                setSubtitleStyle({ y: parseFloat(e.currentTarget.value) })
              }
              class="flex-1 h-1 accent-primary cursor-pointer"
            />
            <span class="text-[10px] font-mono text-muted-foreground w-10 text-right">
              {(style().y * 100).toFixed(0)}%
            </span>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-[10px] text-muted-foreground w-14 shrink-0">
              Colour
            </label>
            <input
              type="color"
              value={style().color}
              onInput={(e) => setSubtitleStyle({ color: e.currentTarget.value })}
              class="w-6 h-6 rounded border border-border cursor-pointer"
            />
            <label class="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={style().bold}
                onChange={(e) => setSubtitleStyle({ bold: e.currentTarget.checked })}
                class="accent-primary"
              />
              Bold
            </label>
            <label class="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={style().backgroundColor !== ""}
                onChange={(e) =>
                  setSubtitleStyle({
                    backgroundColor: e.currentTarget.checked ? "rgba(0,0,0,0.65)" : "",
                  })
                }
                class="accent-primary"
              />
              Plate
            </label>
          </div>
        </div>
      </Show>

      <Show
        when={cues().length > 0}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 p-4 text-center">
            <span class="text-2xl">💬</span>
            <span>No captions</span>
            <span class="text-[10px]">
              Import an .srt or .vtt file, or add one at the playhead.
            </span>
          </div>
        }
      >
        <div class="flex-1 overflow-auto">
          <For each={cueIds()}>
            {(cueId) => {
              const cue = () => cueById(cueId);
              const active = () => {
                const current = cue();
                if (!current) return false;
                return (
                  playheadFrame() >= current.startFrame &&
                  playheadFrame() < current.endFrame
                );
              };

              return (
                <Show when={cue()}>
                  {(entry) => (
                    <div
                      class="px-2 py-1.5 border-b border-border/40"
                      classList={{ "bg-accent/50": active() }}
                    >
                      <div class="flex items-center gap-1 mb-1">
                        <button
                          class="text-[10px] font-mono text-muted-foreground hover:text-foreground tabular-nums"
                          onClick={() => goTo(entry().startFrame)}
                          title="Go to this caption"
                        >
                          {framesToTimecode(entry().startFrame, rate())}
                        </button>
                        <span class="text-[10px] text-muted-foreground">→</span>
                        <input
                          type="text"
                          value={framesToTimecode(entry().endFrame, rate())}
                          onChange={(e) => {
                            const frames = timecodeToFrames(
                              e.currentTarget.value,
                              rate(),
                            );
                            if (frames !== null) updateCue(cueId, { endFrame: frames });
                            else
                              e.currentTarget.value = framesToTimecode(
                                entry().endFrame,
                                rate(),
                              );
                          }}
                          class="w-24 bg-transparent text-[10px] font-mono text-muted-foreground focus:text-foreground focus:outline-none tabular-nums"
                        />
                        <button
                          class="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => splitCueAtPlayhead(cueId)}
                          title="Split at the playhead"
                        >
                          ✂
                        </button>
                        <button
                          class="text-[10px] text-destructive/70 hover:text-destructive"
                          onClick={() => removeCue(cueId)}
                          title="Delete caption"
                        >
                          ✕
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={entry().text}
                        placeholder="Caption text"
                        onInput={(e) =>
                          updateCue(cueId, { text: e.currentTarget.value })
                        }
                        class="w-full px-1.5 py-1 text-xs bg-input border border-border rounded text-foreground resize-none"
                      />
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

export default CaptionsPanel;
