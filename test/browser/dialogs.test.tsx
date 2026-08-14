import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import ExportDialog from "@/panels/ExportDialog";
import RelinkDialog from "@/panels/RelinkDialog";
import RecoveryDialog from "@/panels/RecoveryDialog";
import Overlay from "@/panels/Overlay";
import type { RecoveryOffer } from "@/lib/autosave";

/**
 * Every dialog in the app is really a dialog.
 *
 * Three of them were not. The shortcut sheet, About and the version notes were
 * given roles, Escape and a focus trap when `Overlay` was written; Export,
 * Relink and Recovery were built the same way and were not converted, so they
 * stayed a `div` over a backdrop — nothing announced, no way out but the mouse,
 * and focus left behind whatever the person had been using.
 *
 * The assertions are deliberately about behaviour a keyboard-only user depends
 * on rather than about the attributes for their own sake, except where the
 * attribute *is* the announcement.
 */

let host: HTMLDivElement | null = null;
let dispose: (() => void) | null = null;

function mount(component: () => unknown): HTMLDivElement {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:900px;height:700px";
  document.body.append(host);
  dispose = render(component as never, host);
  return host;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error("No element with role=dialog was rendered");
  return found;
}

function pressEscape(): void {
  dialog().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
}

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const newest = { key: "rev-2", projectName: "Cut", savedAt: 1, bytes: 2048 };
/** Complete rather than cast: a partial one would compile and stop meaning anything
 *  the moment the dialog reads a second field. */
const offer: RecoveryOffer = {
  revision: newest,
  all: [newest, { key: "rev-1", projectName: "Cut", savedAt: 0, bytes: 1024 }],
  afterCrash: true,
  newerThanFile: true,
};

describe("the export dialog", () => {
  it("is announced as a modal dialog with its name", () => {
    mount(() => <ExportDialog open={true} onClose={() => {}} />);

    expect(dialog().getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog().getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe("Export Video");
  });

  it("closes on Escape", () => {
    let closed = false;
    mount(() => <ExportDialog open={true} onClose={() => (closed = true)} />);

    pressEscape();
    expect(closed).toBe(true);
  });
});

describe("the relink dialog", () => {
  it("is a dialog, and Escape gets out of it", () => {
    let closed = false;
    mount(() => <RelinkDialog open={true} onClose={() => (closed = true)} />);

    expect(dialog().getAttribute("aria-modal")).toBe("true");
    pressEscape();
    expect(closed).toBe(true);
  });
});

describe("the recovery dialog", () => {
  it("is a dialog, and still offers every revision", () => {
    mount(() => <RecoveryDialog offer={offer} onClose={() => {}} />);

    expect(dialog().getAttribute("aria-modal")).toBe("true");
    // The list is the whole point of the dialog; wrapping it must not drop it.
    expect(dialog().textContent).toContain("newest");
    expect(dialog().querySelectorAll("button").length).toBeGreaterThan(2);
  });

  it("takes focus into itself and gives it back on close", () => {
    // Focus staying behind the backdrop is how a keyboard user ends up typing
    // into a panel they cannot see.
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    mount(() => <RecoveryDialog offer={offer} onClose={() => {}} />);
    expect(dialog().contains(document.activeElement)).toBe(true);

    dispose?.();
    dispose = null;
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("a dialog that must not be dismissed", () => {
  it("refuses Escape, the backdrop and the ✕ together", () => {
    // One flag, because a dialog that ignores Escape while still showing an
    // enabled close button is a control that lies about what it does.
    let closed = false;
    mount(() => (
      <Overlay title="Busy" onClose={() => (closed = true)} closeDisabled={true}>
        <p>Working</p>
      </Overlay>
    ));

    pressEscape();
    expect(closed).toBe(false);

    const close = dialog().querySelector<HTMLButtonElement>('[aria-label^="Close"]')!;
    expect(close.disabled).toBe(true);

    dialog().parentElement!.click();
    expect(closed).toBe(false);
  });

  it("still closes when nothing blocks it", () => {
    let closed = false;
    mount(() => (
      <Overlay title="Idle" onClose={() => (closed = true)}>
        <p>Ready</p>
      </Overlay>
    ));

    pressEscape();
    expect(closed).toBe(true);
  });
});
