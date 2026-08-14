import { describe, it, expect, afterEach, beforeAll } from "vitest";
// Bare imports: both modules define their custom element as a side effect, and
// the named import below is used only in type position, so it is elided.
import "@/web-components/ve-panel-layout";
import "@/web-components/ve-panel";
import type { VePanelLayout, LayoutNode } from "@/web-components/ve-panel-layout";
import { focusAdjacentPanel } from "@/web-components/panel-focus";

/**
 * The docking layout, from the keyboard.
 *
 * It is a custom control in a shadow root, so none of this comes for free: a
 * `div` with a click handler is invisible to a screen reader and unreachable
 * without a mouse, and until this test existed every tab bar and every splitter
 * in the app was exactly that. The assertions are about what a keyboard user
 * can do — switch panels, close one, resize a split — rather than about
 * attributes for their own sake.
 *
 * Real key events, dispatched at the element that has focus, because the point
 * is whether focus goes where it should. Calling the handlers directly would
 * pass with no keyboard support at all.
 */

let host: VePanelLayout | null = null;

function layout(): LayoutNode {
  return {
    type: "row",
    id: "root",
    sizes: [50, 50],
    children: [
      { type: "panel", id: "left", panelId: "timeline" },
      {
        type: "tabs",
        id: "right",
        activeTab: 0,
        children: [
          { type: "panel", id: "fx", panelId: "effects" },
          { type: "panel", id: "props", panelId: "properties" },
          { type: "panel", id: "hist", panelId: "history" },
        ],
      },
    ],
  };
}

function mount(): VePanelLayout {
  const element = document.createElement("ve-panel-layout") as VePanelLayout;
  element.style.cssText = "position:fixed;left:0;top:0;width:800px;height:600px";
  document.body.append(element);
  for (const id of ["timeline", "effects", "properties", "history"]) {
    element.registerPanelFactory(id, () => {
      const panel = document.createElement("ve-panel");
      panel.setAttribute("title", id);
      return panel;
    });
  }
  element.setLayout(layout());
  host = element;
  return element;
}

/** The shadow root, which is where all of this lives. */
function root(element: VePanelLayout): ShadowRoot {
  return element.shadowRoot!;
}

function tabs(element: VePanelLayout, nodeId: string): HTMLElement[] {
  return [
    ...root(element).querySelectorAll<HTMLElement>(
      `.layout-tab[data-tabs-node-id="${nodeId}"]`,
    ),
  ];
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  target.focus();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, composed: true, ...init }),
  );
}

afterEach(() => {
  host?.remove();
  host = null;
});

beforeAll(() => {
  // Registered as a side effect of importing the module; the import above is
  // what pulls both custom elements in.
  expect(customElements.get("ve-panel-layout")).toBeTruthy();
});

describe("a tab bar", () => {
  it("is a tablist, with one tab stop for the whole bar", () => {
    const element = mount();
    const header = root(element).querySelector('[data-tabs-id="right"]')!;
    expect(header.getAttribute("role")).toBe("tablist");

    const [first, second, third] = tabs(element, "right");
    expect(first.getAttribute("role")).toBe("tab");
    expect(first.getAttribute("aria-selected")).toBe("true");
    // The other two are reachable with the arrow keys, not with Tab. Otherwise
    // moving past the layout takes one press per panel in the app.
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(third.getAttribute("tabindex")).toBe("-1");
  });

  it("switches panels with the arrow keys, and takes focus with it", () => {
    const element = mount();
    press(tabs(element, "right")[0], "ArrowRight");

    const after = tabs(element, "right");
    expect(after[1].getAttribute("aria-selected")).toBe("true");
    expect(after[0].getAttribute("aria-selected")).toBe("false");
    // Activating a tab rebuilds the subtree, so focus has to be put back
    // deliberately — without it the second arrow press goes nowhere.
    expect(root(element).activeElement).toBe(after[1]);

    press(after[1], "ArrowRight");
    expect(root(element).activeElement).toBe(tabs(element, "right")[2]);
  });

  it("wraps around, and Home and End jump to the ends", () => {
    const element = mount();
    press(tabs(element, "right")[0], "ArrowLeft");
    expect(tabs(element, "right")[2].getAttribute("aria-selected")).toBe("true");

    press(tabs(element, "right")[2], "Home");
    expect(tabs(element, "right")[0].getAttribute("aria-selected")).toBe("true");

    press(tabs(element, "right")[0], "End");
    expect(tabs(element, "right")[2].getAttribute("aria-selected")).toBe("true");
  });

  it("closes the focused panel with Delete", () => {
    // The × is a mouse-only affordance inside the tab button, and is hidden
    // from assistive technology for that reason. This is the other path.
    const element = mount();
    const closed: string[] = [];
    element.addEventListener("panel-close", ((e: CustomEvent) => {
      closed.push(e.detail.panelId);
    }) as EventListener);

    press(tabs(element, "right")[0], "Delete");
    expect(closed).toEqual(["effects"]);
  });

  it("names the panel it shows, and points the tab at it", () => {
    const element = mount();
    const tab = tabs(element, "right")[0];
    const panel = root(element).querySelector(
      `#${CSS.escape(tab.getAttribute("aria-controls")!)}`,
    )!;

    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    // Focusable, so the panel body is reachable without tabbing through every
    // control that comes before it.
    expect(panel.getAttribute("tabindex")).toBe("0");
    expect(tab.textContent).toContain("Effects");
  });

  it("gives a lone panel the same tab bar as a tabbed one", () => {
    // These were two copies of the same code and had already drifted: the lone
    // panel's tab carried no index, so nothing keyed off it worked there.
    const element = mount();
    const [only] = tabs(element, "left");
    expect(only.getAttribute("role")).toBe("tab");
    expect(only.getAttribute("data-tab-index")).toBe("0");
    expect(only.getAttribute("tabindex")).toBe("0");
  });
});

describe("a splitter", () => {
  function divider(element: VePanelLayout): HTMLElement {
    return root(element).querySelector<HTMLElement>(".layout-divider")!;
  }

  it("is a separator that says what it is between and where it is", () => {
    const element = mount();
    const bar = divider(element);

    expect(bar.getAttribute("role")).toBe("separator");
    expect(bar.getAttribute("tabindex")).toBe("0");
    // A row lays its panels out left to right, so the bar between them is
    // vertical. It is the separator's orientation, not the container's.
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    expect(bar.getAttribute("aria-label")).toContain("Timeline");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("resizes with the arrow keys and keeps focus between presses", () => {
    const element = mount();
    const bar = divider(element);

    press(bar, "ArrowRight");
    press(bar, "ArrowRight");

    // Both presses landed, which they cannot do if the first one rebuilt the
    // tree and dropped focus — the bug that made in-place sizing necessary.
    expect(root(element).activeElement).toBe(bar);
    expect(element.getLayout()!.sizes).toEqual([54, 46]);
    expect(bar.getAttribute("aria-valuenow")).toBe("54");
  });

  it("moves further with Shift, and stops at the minimum", () => {
    const element = mount();
    const bar = divider(element);

    press(bar, "ArrowLeft", { shiftKey: true });
    expect(element.getLayout()!.sizes).toEqual([40, 60]);

    for (let i = 0; i < 20; i++) press(bar, "ArrowLeft", { shiftKey: true });
    const [left, right] = element.getLayout()!.sizes!;
    expect(left).toBeGreaterThanOrEqual(5);
    expect(left + right).toBeCloseTo(100);
  });

  it("reports the change so the layout can be persisted", () => {
    const element = mount();
    let seen: number[] | undefined;
    element.addEventListener("layout-change", ((e: CustomEvent) => {
      seen = e.detail.layout.sizes;
    }) as EventListener);

    press(divider(element), "ArrowRight");
    expect(seen).toEqual([52, 48]);
  });
});

describe("moving between panels", () => {
  function slots(element: VePanelLayout): HTMLElement[] {
    return [...root(element).querySelectorAll<HTMLElement>(".panel-slot")];
  }

  it("cycles forward through the panel regions and wraps", () => {
    // Tab reaches every region eventually. F6 is the one-key path, which is
    // what makes a twelve-panel workspace navigable rather than merely legal.
    const element = mount();
    const [first, second] = slots(element);

    expect(focusAdjacentPanel(1)).toBe(true);
    expect(root(element).activeElement).toBe(first);

    focusAdjacentPanel(1);
    expect(root(element).activeElement).toBe(second);

    // Two regions here — the lone panel and the active tab of the group.
    focusAdjacentPanel(1);
    expect(root(element).activeElement).toBe(first);
  });

  it("cycles backward, and enters at the far end from outside", () => {
    const element = mount();
    const regions = slots(element);

    expect(focusAdjacentPanel(-1)).toBe(true);
    expect(root(element).activeElement).toBe(regions[regions.length - 1]);

    focusAdjacentPanel(-1);
    expect(root(element).activeElement).toBe(regions[regions.length - 2]);
  });

  it("finds the current region from a control inside the panel", () => {
    // Focus is usually on something within a panel, not on the region itself,
    // and that something is in `<ve-panel>`'s light DOM — a shadow root deeper
    // than `document.activeElement` reports.
    const element = mount();
    const [first, second] = slots(element);

    const button = document.createElement("button");
    first.querySelector("ve-panel")!.append(button);
    button.focus();

    focusAdjacentPanel(1);
    expect(root(element).activeElement).toBe(second);
  });

  it("does nothing, rather than throwing, with no layout mounted", () => {
    expect(focusAdjacentPanel(1)).toBe(false);
  });
});
