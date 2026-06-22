export type InspectorFieldType = "number" | "color" | "select" | "button";

export interface InspectorField {
  label: string;
  key: string;
  type: InspectorFieldType;
  value?: string | number;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  wrap?: boolean;
}

export interface InspectorConfig {
  id: string;
  title?: string;
}

export interface InspectorChangeDetail {
  id: string;
  title: string;
  values: Record<string, string | number>;
}

export interface InspectorActionDetail {
  id: string;
  action: string;
}

export class ORC_Inspector {
  parent: HTMLElement;
  id: string;
  title: string;
  schema: InspectorField[];
  eventTarget: EventTarget;
  state: Record<string, string | number> = {};
  elements: Record<string, HTMLElement> = {};
  container: HTMLDivElement;

  constructor(parent: HTMLElement, config: InspectorConfig, schema: InspectorField[], eventTarget: EventTarget = window) {
    if (!config?.id) throw new Error("ORC_Inspector Error: 'config.id' is compulsory for event routing.");
    this.parent = parent;
    this.id = config.id;
    this.title = config.title ?? "";
    this.schema = schema;
    this.eventTarget = eventTarget;

    this.container = document.createElement("div");
    this.container.className = "inspector-container";
    this.container.style.display = "none";

    if (this.title) {
      const header = document.createElement("div");
      header.className = "panel-title";
      header.textContent = this.title;
      this.container.appendChild(header);
    }

    this.schema.forEach((field) => this.createField(field));
    this.parent.appendChild(this.container);
  }

  private createField(field: InspectorField): void {
    this.state[field.key] = field.value !== undefined ? field.value : field.type === "number" ? 0 : "#ffffff";

    if (field.type === "button") {
      const btn = document.createElement("button");
      btn.className = "action-btn dest-btn";
      btn.textContent = "✖ " + field.label;
      btn.style.width = "100%";
      btn.style.marginTop = "12px";
      btn.style.display = "none";
      btn.addEventListener("click", () => {
        this.eventTarget.dispatchEvent(
          new CustomEvent<InspectorActionDetail>("orc_inspector_action", {
            detail: { id: this.id, action: field.key },
          }),
        );
      });
      this.elements[field.key] = btn;
      this.container.appendChild(btn);
      return;
    }

    const row = document.createElement("div");
    row.className = "prop-row";

    const label = document.createElement("label");
    label.textContent = field.label;
    row.appendChild(label);

    let input: HTMLInputElement | HTMLSelectElement;

    if (field.type === "number") {
      const i = document.createElement("input");
      i.type = "number";
      i.className = "tool-input";
      i.value = String(this.state[field.key]);
      if (field.min !== undefined) i.min = String(field.min);
      if (field.max !== undefined && !field.wrap) i.max = String(field.max);
      if (field.step !== undefined) i.step = String(field.step);
      i.addEventListener("input", (e) => {
        let val = parseFloat((e.target as HTMLInputElement).value);
        if (isNaN(val)) return;
        if (field.wrap && field.max !== undefined) {
          const min = field.min ?? 0;
          const range = field.max - min;
          val = ((((val - min) % range) + range) % range) + min;
        } else {
          if (field.min !== undefined) val = Math.max(field.min, val);
          if (field.max !== undefined) val = Math.min(field.max, val);
        }
        this.state[field.key] = val;
        this.emitChangeEvent();
      });
      i.addEventListener("change", (e) => {
        (e.target as HTMLInputElement).value = String(this.state[field.key]);
      });
      input = i;
    } else if (field.type === "color") {
      const i = document.createElement("input");
      i.type = "color";
      i.style.cssText = "background: transparent; border: none; cursor: pointer; width: 32px; height: 24px;";
      i.value = String(this.state[field.key]);
      i.addEventListener("input", (e) => {
        this.state[field.key] = (e.target as HTMLInputElement).value;
        this.emitChangeEvent();
      });
      input = i;
    } else {
      const s = document.createElement("select");
      s.className = "tool-input";
      s.style.width = "100px";
      (field.options ?? []).forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        if (this.state[field.key] === opt) option.selected = true;
        s.appendChild(option);
      });
      s.addEventListener("change", (e) => {
        this.state[field.key] = (e.target as HTMLSelectElement).value;
        this.emitChangeEvent();
      });
      input = s;
    }

    this.elements[field.key] = input;
    row.appendChild(input);
    this.container.appendChild(row);
  }

  setValues(valueMap: Record<string, string | number>): void {
    for (const [key, newValue] of Object.entries(valueMap)) {
      const el = this.elements[key];
      if (el && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) {
        this.state[key] = newValue;
        el.value = String(newValue);
      }
    }
  }

  toggleVisibility(key: string, isVisible: boolean): void {
    const el = this.elements[key];
    if (!el) return;
    const parent = el.parentElement;
    const target = parent && parent.classList.contains("prop-row") ? parent : el;
    (target as HTMLElement).style.display = isVisible ? "flex" : "none";
  }

  getValues(): Record<string, string | number> {
    return { ...this.state };
  }

  show(): void { this.container.style.display = "flex"; }
  hide(): void { this.container.style.display = "none"; }

  private emitChangeEvent(): void {
    this.eventTarget.dispatchEvent(
      new CustomEvent<InspectorChangeDetail>("orc_inspector_change", {
        detail: { id: this.id, title: this.title, values: this.getValues() },
      }),
    );
  }

  destroy(): void { this.container.remove(); }
}
