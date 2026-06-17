import { TOOLS, ACTIONS, DEFAULT_KEY_BINDINGS } from "./enums_actions.js";
import { State, saveEditorStateToStorage } from "./state_persistence.js";
import { exportMapData, importMapData } from "./serialization.js";

export class UIBuilder {
  static createForm(container, targetObj, schema, onChange) {
    container.innerHTML = "";
    if (!targetObj) return;

    schema.forEach((field) => {
      const row = document.createElement("div");
      row.className = "prop-row";

      const label = document.createElement("label");
      label.textContent = field.label;
      row.appendChild(label);

      let input;
      switch (field.type) {
        case "number":
          input = document.createElement("input");
          input.type = "number";
          input.className = "tool-input";
          input.value = targetObj[field.key];
          input.addEventListener("input", (e) => {
            targetObj[field.key] = parseFloat(e.target.value) || 0;
            if (onChange) onChange(field.key, targetObj[field.key]);
            saveEditorStateToStorage();
          });
          break;

        case "color":
          input = document.createElement("input");
          input.type = "color";
          input.style.cssText =
            "background: transparent; border: none; cursor: pointer;";
          input.value = targetObj[field.key];
          input.addEventListener("input", (e) => {
            targetObj[field.key] = e.target.value;
            if (onChange) onChange(field.key, targetObj[field.key]);
            saveEditorStateToStorage();
          });
          break;
      }
      if (input) row.appendChild(input);
      container.appendChild(row);
    });
  }
}

const roomSchema = [
  { label: "Floor Height", key: "floorHeight", type: "number" },
  { label: "Ceil Height", key: "ceilHeight", type: "number" },
  { label: "Floor Color", key: "floorColor", type: "color" },
  { label: "Ceil Color", key: "ceilColor", type: "color" },
];

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

  init() {
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

    // Change these from window.dispatchEvent to target the canvas directly
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
    if (State.currentTool === TOOLS.ROOM && State.selectedFaceId) {
      const selectedFace = State.faces.find(
        (f) => f.id === State.selectedFaceId,
      );
      if (selectedFace) {
        this.propertiesPanel.classList.remove("hidden");
        UIBuilder.createForm(this.propertiesContent, selectedFace, roomSchema);
        return;
      }
    }
    this.propertiesPanel.classList.add("hidden");
    this.propertiesContent.innerHTML = "";
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
