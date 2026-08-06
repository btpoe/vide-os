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

  attributeChangedCallback(_name: string, _old: string, _value: string) {
    // Title/icon are now handled by the layout tab header
  }

  connectedCallback() {
    // No-op — header is managed by ve-panel-layout
  }
}

customElements.define("ve-panel", VePanel);
