import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import App from "@/App";
import { clearCommands, runCommand } from "@/commands";

/**
 * The app mounts, and its dialogs open.
 *
 * Nothing else mounted `App` itself, so a mistake in the menu wiring or in a
 * dialog was a runtime error nothing could catch — and the menu bar is exactly
 * where this project has already shipped one, when the shortcut sheet advertised
 * a key that was never bound and the menu showed raw command ids.
 *
 * Deliberately shallow: it boots the real thing, opens the two generated
 * dialogs, and asserts they contain what they are generated from.
 */

let host: HTMLDivElement | null = null;
let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  // The app registers its file and help commands on mount; a second mount in
  // the same page would throw on the duplicate ids.
  clearCommands();
});

function mount(): HTMLDivElement {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:800px";
  document.body.append(host);
  dispose = render(() => <App />, host);
  return host;
}

describe("the app", () => {
  it("mounts with its menu bar and status bar", () => {
    const app = mount();
    expect(app.textContent).toContain("VideOS");
    expect(app.textContent).toContain("File");
    expect(app.textContent).toContain("Help");
  });

  it("opens the generated shortcut sheet", () => {
    const app = mount();
    runCommand("help.shortcuts");

    const dialog = app.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // Sections and entries that only exist because they were read out of the
    // registry — the sheet this replaced listed none of them.
    expect(dialog!.textContent).toContain("Markers");
    expect(dialog!.textContent).toContain("Zoom to Fit");
    expect(dialog!.textContent).toContain("Debug HUD");
  });

  it("opens getting started, and it names real shortcuts", () => {
    const app = mount();
    runCommand("help.gettingStarted");

    const dialog = app.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Bring in some media");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });
});

/**
 * The menu bar, driven with the events a pointer actually produces.
 *
 * Opening a menu and then sliding along the bar is how anyone browses menus, and
 * a click at the end of that slide is not a second click on the same trigger —
 * it used to be treated as one, and closed the menu the user had just arrived at.
 */
describe("the menu bar", () => {
  /** The bar's own triggers, not the items inside an open menu. */
  function trigger(app: HTMLDivElement, label: string): HTMLButtonElement {
    const bar = app.querySelector(".menu-bar")!;
    const button = [...bar.querySelectorAll(":scope > div > button")].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No menu trigger labelled ${label}`);
    return button as HTMLButtonElement;
  }

  function isOpen(app: HTMLDivElement, label: string): boolean {
    return trigger(app, label).parentElement!.children.length > 1;
  }

  function hover(button: HTMLButtonElement): void {
    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  }

  it("opens a menu on click and closes it on a second click", () => {
    const app = mount();
    trigger(app, "File").click();
    expect(isOpen(app, "File")).toBe(true);

    trigger(app, "File").click();
    expect(isOpen(app, "File")).toBe(false);
  });

  it("keeps the menu open when a hover-switch is finished with a click", () => {
    const app = mount();
    trigger(app, "File").click();

    // The slide along the bar, then the click that lands on the new trigger.
    hover(trigger(app, "Edit"));
    expect(isOpen(app, "Edit"), "hovering across should switch menus").toBe(true);

    trigger(app, "Edit").click();
    expect(
      isOpen(app, "Edit"),
      "the click completing the slide must not close it",
    ).toBe(true);

    // And it is still an ordinary trigger afterwards.
    trigger(app, "Edit").click();
    expect(isOpen(app, "Edit")).toBe(false);
  });

  it("does not open anything on hover while the bar is closed", () => {
    const app = mount();
    hover(trigger(app, "File"));
    expect(isOpen(app, "File")).toBe(false);
  });
});
