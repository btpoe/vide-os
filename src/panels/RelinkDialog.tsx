import { Component, For, Show, createSignal } from "solid-js";
import Overlay from "./Overlay";
import {
  mediaProblems,
  permissionProblems,
  relinkProblems,
  type MediaProblem,
} from "@/stores/media-problems";
import { regrantPermissions, relinkFromFolder, relinkOne } from "@/media/relink";

/**
 * Reconnecting media.
 *
 * The three problem kinds get three different remedies, because offering
 * "relink" for a file that is present but in an unsupported codec would send
 * the user hunting for a file that is already there.
 */
const KIND_LABEL: Record<MediaProblem["kind"], string> = {
  offline: "Missing",
  "needs-permission": "Needs permission",
  undecodable: "Unsupported format",
};

const RelinkDialog: Component<{ open: boolean; onClose: () => void }> = (props) => {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [note, setNote] = createSignal<string | null>(null);

  const grantAll = () => {
    setBusy("Requesting permission…");
    void regrantPermissions()
      .then((count) =>
        setNote(
          count > 0
            ? `Reconnected ${count} file${count === 1 ? "" : "s"}.`
            : "No files could be reconnected. They may have moved — use Relink instead.",
        ),
      )
      .finally(() => setBusy(null));
  };

  const relinkFolder = () => {
    const ids = relinkProblems().map((p) => p.assetId);
    if (ids.length === 0) return;
    setBusy("Searching folder…");
    void relinkFromFolder(ids, (done, total) =>
      setBusy(`Checking ${done} of ${total}…`),
    )
      .then((result) => {
        const found = result.reconnected.length;
        setNote(
          found > 0
            ? `Relinked ${found} file${found === 1 ? "" : "s"}.` +
                (result.unmatched.length
                  ? ` Still missing: ${result.unmatched.join(", ")}.`
                  : "")
            : "Nothing in that folder matched the missing media.",
        );
      })
      .finally(() => setBusy(null));
  };

  const relinkSingle = (problem: MediaProblem) => {
    setBusy(`Relinking ${problem.name}…`);
    void relinkOne(problem.assetId)
      .then((ok) =>
        setNote(
          ok
            ? `Relinked ${problem.name}.`
            : // Content keys make a wrong-file relink detectable rather than
              // silently accepted.
              `That file is not the same media as ${problem.name}.`,
        ),
      )
      .finally(() => setBusy(null));
  };

  return (
    <Show when={props.open}>
      <Overlay title="Media" onClose={props.onClose} width="w-[560px]">
        <Show
          when={mediaProblems().length > 0}
          fallback={
            <div class="px-5 py-8 text-center text-xs text-muted-foreground">
              All media is connected.
            </div>
          }
        >
          <div class="flex gap-2 px-5 py-3 border-b border-border">
            <Show when={permissionProblems().length > 0}>
              <button
                class="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={grantAll}
                disabled={busy() !== null}
              >
                Reconnect {permissionProblems().length} file
                {permissionProblems().length === 1 ? "" : "s"}
              </button>
            </Show>
            <Show when={relinkProblems().length > 0}>
              <button
                class="px-3 py-1.5 text-xs rounded bg-secondary text-foreground hover:bg-accent disabled:opacity-50"
                onClick={relinkFolder}
                disabled={busy() !== null}
              >
                Relink from folder…
              </button>
            </Show>
          </div>

          <div class="flex-1 overflow-auto">
            <For each={mediaProblems()}>
              {(problem) => (
                <div class="flex items-start gap-3 px-5 py-2.5 border-b border-border/40">
                  <span class="text-sm shrink-0 mt-0.5">
                    {problem.kind === "undecodable" ? "⛔" : "⚠"}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs text-foreground truncate">{problem.name}</div>
                    <div class="text-[10px] text-muted-foreground">
                      {KIND_LABEL[problem.kind]} · used by {problem.clipCount} clip
                      {problem.clipCount === 1 ? "" : "s"}
                    </div>
                    <div class="text-[10px] text-muted-foreground/70 mt-0.5">
                      {problem.detail}
                    </div>
                  </div>
                  {/* No relink button for a codec problem: the file is
                        already here, and pointing at it again changes nothing. */}
                  <Show when={problem.kind !== "undecodable"}>
                    <button
                      class="px-2 py-1 text-[10px] rounded bg-secondary hover:bg-accent shrink-0 disabled:opacity-50"
                      onClick={() => relinkSingle(problem)}
                      disabled={busy() !== null}
                    >
                      Relink…
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={busy() ?? note()}>
          <div class="px-5 py-2 border-t border-border text-[11px] text-muted-foreground">
            {busy() ?? note()}
          </div>
        </Show>
      </Overlay>
    </Show>
  );
};

export default RelinkDialog;
