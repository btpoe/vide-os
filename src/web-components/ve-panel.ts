const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--color-panel, #1a1a1a);
    }

    .panel-body {
      flex: 1;
      overflow: hidden;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    ::slotted(*) {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
  </style>
  <div class="panel-body" part="body">
    <slot></slot>
  </div>
`;

export class VePanel extends HTMLElement {
  static get observedAttributes() {
    return ["panel-id", "title", "icon"];
  }

  private _shadow: ShadowRoot;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._shadow.appendChild(template.content.cloneNode(true));
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    // Title and icon are drawn by the layout's tab header. The title is still
    // worth carrying here as the region's accessible name: the tab labels the
    // tabpanel, and this labels the panel element inside it, which is what a
    // screen reader lands on when the content is reached any other way.
    if (name === "title") this._label(value);
  }

  connectedCallback() {
    this.setAttribute("role", "group");
    this._label(this.getAttribute("title"));
  }

  private _label(title: string | null) {
    if (title) this.setAttribute("aria-label", title);
    else this.removeAttribute("aria-label");
  }
}

customElements.define("ve-panel", VePanel);
