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

// =========================
// MAIN UI SYSTEM CONTROL
// =========================
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

  activeListeningRow: null,

  propertiesPanel: document.getElementById("dynamic-properties-panel"),
  propertiesContent: document.getElementById("panel-content"),
  toggleTrianglesBtn: document.getElementById("btn-toggle-triangles"), // Add reference

  init() {
    this.toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTool = btn.getAttribute("data-tool");
        if (targetTool) {
          currentTool = TOOLS[targetTool.toUpperCase()];
          this.updateToolUI();
          this.updatePropertiesPanel();
          saveEditorStateToStorage();
        }
      });
    });

    this.undoBtn.addEventListener("click", () => {
      History.undo(halfEdges, faces, edges, vertices);
      this.updatePropertiesPanel();
    });
    this.redoBtn.addEventListener("click", () => {
      History.redo(halfEdges, faces, edges, vertices);
      this.updatePropertiesPanel();
    });
    this.deleteBtn.addEventListener("click", () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete" })),
    );
    this.rotateBtn.addEventListener("click", () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" })),
    );
    this.toggleTrianglesBtn.addEventListener("click", () => {
      showTriangulationWireframes = !showTriangulationWireframes;
      if (showTriangulationWireframes) {
        this.toggleTrianglesBtn.textContent = "📐 Triangles: On";
        this.toggleTrianglesBtn.style.color = "#ffaa00"; // Orange highlight when active
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
      keyBindings = { ...DEFAULT_KEY_BINDINGS };
      this.populateBindingsUI();
    });

    // Serialization Hooks
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
    if (currentTool === TOOLS.ROOM && selectedFaceId) {
      const selectedFace = faces.find((f) => f.id === selectedFaceId);
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
      const assignedKeys = Object.keys(keyBindings).filter(
        (k) => keyBindings[k] === action,
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

    delete keyBindings[proposedCombo];
    Object.keys(keyBindings).forEach((k) => {
      if (keyBindings[k] === actionTarget) delete keyBindings[k];
    });
    keyBindings[proposedCombo] = actionTarget;
    this.populateBindingsUI();
    saveEditorStateToStorage();
  },

  updateToolUI() {
    this.toolButtons.forEach((btn) => {
      const btnTool = btn.getAttribute("data-tool");
      // Clean, bulletproof string verification matching currentTool
      if (btnTool && btnTool === currentTool) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  },
};
