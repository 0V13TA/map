import { TOOLS, ACTIONS, DEFAULT_KEY_BINDINGS } from "./enums_actions.js";
import { State, saveEditorStateToStorage } from "./state_persistence.js";
import { exportMapData, importMapData } from "./serialization.js";

// ============================================================================
// ORC_Inspector: Generic, Agnostic UI Component Library
// ============================================================================
export class ORC_Inspector {
  /**
   * @param {HTMLElement} parentElement - Container to append into.
   * @param {Object} config - Configuration object containing { id, title }.
   * @param {Array<Object>} schema - Blueprint configuration array for fields.
   * @param {EventTarget} [eventTarget=window] - Injected event bus for portability.
   */
  constructor(parentElement, config, schema, eventTarget = window) {
    if (!config || !config.id) {
      throw new Error(
        "ORC_Inspector Error: 'config.id' is compulsory for event routing.",
      );
    }

    this.parent = parentElement;
    this.id = config.id;
    this.title = config.title || "";
    this.schema = schema;
    this.eventTarget = eventTarget; // Dependency Injection!

    this.state = {};
    this.elements = {};

    this.container = document.createElement("div");
    this.container.className = "inspector-container";
    this.container.style.cssText =
      "display: none; flex-direction: column; width: 100%;";

    if (this.title) {
      const header = document.createElement("div");
      header.className = "panel-title";
      header.style.cssText =
        "color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;";
      header.textContent = this.title;
      this.container.appendChild(header);
    }

    this.schema.forEach((field) => this.createField(field));

    this.parent.appendChild(this.container);
  }

  /**
   * Internal Field Factory: Handles creation and validation logic agnostically.
   */
  createField(field) {
    // Seed initial state
    this.state[field.key] =
      field.value !== undefined
        ? field.value
        : field.type === "number"
          ? 0
          : "#ffffff";

    const row = document.createElement("div");
    row.className = "prop-row";
    row.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; color: #a0a5b5; font-size: 12px;";

    const label = document.createElement("label");
    label.textContent = field.label;
    row.appendChild(label);

    let input;

    if (field.type === "number") {
      input = document.createElement("input");
      input.type = "number";
      input.className = "tool-input";
      input.value = this.state[field.key];

      // Generic Validation Attributes
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;

      input.addEventListener("input", (e) => {
        let val = parseFloat(e.target.value) || 0;
        // Enforce limits agnostically
        if (field.min !== undefined) val = Math.max(field.min, val);
        if (field.max !== undefined) val = Math.min(field.max, val);
        this.state[field.key] = val;
        this.emitChangeEvent();
      });
    } else if (field.type === "color") {
      input = document.createElement("input");
      input.type = "color";
      input.style.cssText =
        "background: transparent; border: none; cursor: pointer; width: 32px; height: 24px;";
      input.value = this.state[field.key];

      input.addEventListener("input", (e) => {
        this.state[field.key] = e.target.value;
        this.emitChangeEvent();
      });
    } else if (field.type === "select") {
      input = document.createElement("select");
      input.className = "tool-input";
      input.style.width = "75px";
      field.options.forEach((opt) => {
        let option = document.createElement("option");
        option.value = opt;
        option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        if (this.state[field.key] === opt) option.selected = true;
        input.appendChild(option);
      });

      input.addEventListener("change", (e) => {
        this.state[field.key] = e.target.value;
        this.emitChangeEvent();
      });
    }

    if (field.readOnly) {
      input.disabled = true;
      input.style.opacity = "0.5";
      input.style.cursor = "not-allowed";
    }

    this.elements[field.key] = input;
    if (input) row.appendChild(input);
    this.container.appendChild(row);
  }

  /**
   * Bulk updates the inspector state programmatically.
   * @param {Object} valueMap - Dictionary of key/value pairs to update.
   */
  setValues(valueMap) {
    for (const [key, newValue] of Object.entries(valueMap)) {
      if (this.elements[key]) {
        this.state[key] = newValue;
        this.elements[key].value = newValue;
      }
    }
  }

  getValues() {
    return { ...this.state };
  }
  show() {
    this.container.style.display = "flex";
  }
  hide() {
    this.container.style.display = "none";
  }

  emitChangeEvent() {
    const eventPayload = {
      id: this.id, // Emits the stable logic ID
      title: this.title, // Emits the UI title (optional context)
      values: this.getValues(),
    };
    const changeEvent = new CustomEvent("orc_inspector_change", {
      detail: eventPayload,
    });
    this.eventTarget.dispatchEvent(changeEvent); // Uses the injected event bus!
  }

  destroy() {
    this.container.remove();
  }
}

// ============================================================================
// GLOBAL UI CONTROLLER
// ============================================================================
export const UI = {
  toolButtons: document.querySelectorAll(".tool-btn"),
  undoBtn: document.getElementById("btn-undo"),
  redoBtn: document.getElementById("btn-redo"),
  rotateBtn: document.getElementById("btn-rotate"),
  deleteBtn: document.getElementById("btn-delete"),
  settingsBtn: document.getElementById("btn-settings"),
  settingsModal: document.getElementById("settings-modal"),
  closeSettingsBtn: document.getElementById("close-settings"),
  bindingsContainer: document.getElementById("bindings-container"),
  resetBindingsBtn: document.getElementById("btn-reset-bindings"),
  propertiesPanel: document.getElementById("dynamic-properties-panel"),
  propertiesContent: document.getElementById("panel-content"),
  toggleTrianglesBtn: document.getElementById("btn-toggle-triangles"),
  activeListeningRow: null,

  // Inspector Instance Hooks
  roomInspector: null,
  wallInspector: null,

  init() {
    // 1. Bootstrap the Retained-Mode Inspectors
    this.roomInspector = new ORC_Inspector(
      this.propertiesContent,
      { id: "room_inspector", title: "Room Properties" }, // Config object!
      [
        { label: "Floor Height", key: "floorHeight", type: "number", value: 0 },
        { label: "Ceil Height", key: "ceilHeight", type: "number", value: 64 },
        {
          label: "Floor Color",
          key: "floorColor",
          type: "color",
          value: "#555555",
        },
        {
          label: "Ceil Color",
          key: "ceilColor",
          type: "color",
          value: "#888888",
        },
      ],
    );

    this.wallInspector = new ORC_Inspector(
      this.propertiesContent,
      { id: "wall_inspector", title: "Wall Properties" },
      [
        {
          label: "Wall Type",
          key: "type",
          type: "select",
          options: ["solid", "portal", "door"],
          value: "solid",
        },
        { label: "Texture ID", key: "textureId", type: "number", value: 0 },
      ],
    );

    // 2. Wire up the rest of the UI interactions
    this.toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTool = btn.getAttribute("data-tool");
        if (targetTool) {
          State.currentTool = TOOLS[targetTool.toUpperCase()];
          this.updateToolUI();
          this.updatePropertiesPanel();
          saveEditorStateToStorage();
        }
      });
    });

    this.undoBtn.addEventListener("click", () => {
      State.History.undo();
      this.updatePropertiesPanel();
    });
    this.redoBtn.addEventListener("click", () => {
      State.History.redo();
      this.updatePropertiesPanel();
    });

    this.deleteBtn.addEventListener("click", () => {
      const cvs = document.querySelector("canvas");
      if (cvs)
        cvs.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Delete", bubbles: true }),
        );
    });

    this.rotateBtn.addEventListener("click", () => {
      const cvs = document.querySelector("canvas");
      if (cvs)
        cvs.dispatchEvent(
          new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }),
        );
    });

    this.toggleTrianglesBtn.addEventListener("click", () => {
      State.showTriangulationWireframes = !State.showTriangulationWireframes;
      if (State.showTriangulationWireframes) {
        this.toggleTrianglesBtn.textContent = "📐 Triangles: On";
        this.toggleTrianglesBtn.style.color = "#ffaa00";
      } else {
        this.toggleTrianglesBtn.textContent = "📐 Triangles: Off";
        this.toggleTrianglesBtn.style.color = "";
      }
    });

    this.settingsBtn.addEventListener("click", () => this.openModal());
    this.closeSettingsBtn.addEventListener("click", () => this.closeModal());
    this.settingsModal.addEventListener("click", (e) => {
      if (e.target === this.settingsModal) this.closeModal();
    });

    this.resetBindingsBtn.addEventListener("click", () => {
      State.keyBindings = { ...DEFAULT_KEY_BINDINGS };
      this.populateBindingsUI();
    });

    document
      .getElementById("btn-export")
      .addEventListener("click", () => exportMapData());
    const fileImport = document.getElementById("file-import");
    document
      .getElementById("btn-import")
      .addEventListener("click", () => fileImport.click());
    fileImport.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        importMapData(evt.target.result);
        this.updateToolUI();
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    window.addEventListener(
      "keydown",
      (e) => {
        if (this.activeListeningRow) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.handleRemapCapture(e);
          return;
        }
        this.updateToolUI();
        this.updatePropertiesPanel();
      },
      true,
    );

    this.updateToolUI();
  },

  openModal() {
    this.settingsModal.classList.remove("hidden");
    this.populateBindingsUI();
  },

  closeModal() {
    this.settingsModal.classList.add("hidden");
    this.activeListeningRow = null;
  },

  updatePropertiesPanel() {
    // Hide everything implicitly
    this.propertiesPanel.classList.add("hidden");
    this.roomInspector.hide();
    this.wallInspector.hide();

    // Selectively reveal and sync based on tool/selection context
    if (State.currentTool === TOOLS.ROOM && State.selectedFaceId) {
      const selectedFace = State.faces.find(
        (f) => f.id === State.selectedFaceId,
      );
      if (selectedFace) {
        this.propertiesPanel.classList.remove("hidden");

        // Beautiful, bulk programmatic sync
        this.roomInspector.setValues({
          floorHeight: selectedFace.floorHeight,
          ceilHeight: selectedFace.ceilHeight,
          floorColor: selectedFace.floorColor,
          ceilColor: selectedFace.ceilColor,
        });

        this.roomInspector.show();
      }
    } else if (State.currentTool === TOOLS.WALL && State.selectedEdgeId) {
      const selectedEdge = State.edges.find(
        (e) => e.id === State.selectedEdgeId,
      );
      if (selectedEdge) {
        this.propertiesPanel.classList.remove("hidden");

        this.wallInspector.setValue("type", selectedEdge.type);
        this.wallInspector.setValue("textureId", selectedEdge.textureId);

        this.wallInspector.show();
      }
    }
  },

  populateBindingsUI() {
    this.bindingsContainer.innerHTML = "";
    this.activeListeningRow = null;
    Object.values(ACTIONS).forEach((action) => {
      const row = document.createElement("div");
      row.className = "binding-row";
      const label = document.createElement("div");
      label.className = "binding-label";
      label.textContent = action.replace(/_/g, " ");

      const keyCap = document.createElement("div");
      keyCap.className = "key-cap";
      const assignedKeys = Object.keys(State.keyBindings).filter(
        (k) => State.keyBindings[k] === action,
      );
      keyCap.textContent =
        assignedKeys.length > 0 ? assignedKeys.join(" / ") : "[ None ]";

      keyCap.addEventListener("click", () => {
        if (this.activeListeningRow)
          this.activeListeningRow.classList.remove("listening");
        this.activeListeningRow = keyCap;
        keyCap.className = "key-cap listening";
        keyCap.textContent = "Press Key...";
      });

      keyCap.setAttribute("data-action", action);
      row.appendChild(label);
      row.appendChild(keyCap);
      this.bindingsContainer.appendChild(row);
    });
  },

  handleRemapCapture(e) {
    if (!this.activeListeningRow) return;
    const actionTarget = this.activeListeningRow.getAttribute("data-action");
    if (
      [
        "ControlLeft",
        "ControlRight",
        "ShiftLeft",
        "ShiftRight",
        "AltLeft",
        "AltRight",
        "MetaLeft",
      ].includes(e.code)
    )
      return;

    let prefix = "";
    if (e.ctrlKey || e.metaKey) prefix += "Ctrl+";
    const proposedCombo = prefix + e.code;

    delete State.keyBindings[proposedCombo];
    Object.keys(State.keyBindings).forEach((k) => {
      if (State.keyBindings[k] === actionTarget) delete State.keyBindings[k];
    });
    State.keyBindings[proposedCombo] = actionTarget;
    this.populateBindingsUI();
    saveEditorStateToStorage();
  },

  updateToolUI() {
    this.toolButtons.forEach((btn) => {
      const btnTool = btn.getAttribute("data-tool");
      if (btnTool && btnTool === State.currentTool) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  },
};
