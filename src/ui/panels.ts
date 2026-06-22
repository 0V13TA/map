import { TOOLS, ACTIONS, DEFAULT_KEY_BINDINGS, type Tool, type Action } from "../core/enums";
import {
  State, Campaign, switchLevel, deleteLevel, createNewLevel, saveEditorStateToStorage,
} from "../state/state";
import { exportMapData, importMapData } from "../io/serialization";
import { ORC_Inspector, type InspectorChangeDetail, type InspectorActionDetail } from "./inspector";

export const UI = {
  toolButtons: null as unknown as NodeListOf<HTMLButtonElement>,
  undoBtn: null as unknown as HTMLButtonElement,
  redoBtn: null as unknown as HTMLButtonElement,
  rotateBtn: null as unknown as HTMLButtonElement,
  deleteBtn: null as unknown as HTMLButtonElement,
  settingsBtn: null as unknown as HTMLButtonElement,
  settingsModal: null as unknown as HTMLElement,
  closeSettingsBtn: null as unknown as HTMLButtonElement,
  bindingsContainer: null as unknown as HTMLElement,
  resetBindingsBtn: null as unknown as HTMLButtonElement,
  propertiesPanel: null as unknown as HTMLElement,
  propertiesContent: null as unknown as HTMLElement,
  toggleTrianglesBtn: null as unknown as HTMLButtonElement,
  activeListeningRow: null as HTMLElement | null,

  roomInspector: null as unknown as ORC_Inspector,
  wallInspector: null as unknown as ORC_Inspector,
  vertexInspector: null as unknown as ORC_Inspector,
  entityInspector: null as unknown as ORC_Inspector,

  init(): void {
    this.toolButtons = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
    this.undoBtn = document.getElementById("btn-undo") as HTMLButtonElement;
    this.redoBtn = document.getElementById("btn-redo") as HTMLButtonElement;
    this.rotateBtn = document.getElementById("btn-rotate") as HTMLButtonElement;
    this.deleteBtn = document.getElementById("btn-delete") as HTMLButtonElement;
    this.settingsBtn = document.getElementById("btn-settings") as HTMLButtonElement;
    this.settingsModal = document.getElementById("settings-modal") as HTMLElement;
    this.closeSettingsBtn = document.getElementById("close-settings") as HTMLButtonElement;
    this.bindingsContainer = document.getElementById("bindings-container") as HTMLElement;
    this.resetBindingsBtn = document.getElementById("btn-reset-bindings") as HTMLButtonElement;
    this.propertiesPanel = document.getElementById("dynamic-properties-panel") as HTMLElement;
    this.propertiesContent = document.getElementById("panel-content") as HTMLElement;
    this.toggleTrianglesBtn = document.getElementById("btn-toggle-triangles") as HTMLButtonElement;

    this.roomInspector = new ORC_Inspector(this.propertiesContent, { id: "room_inspector", title: "Room Properties" }, [
      { label: "Floor Height", key: "floorHeight", type: "number", value: 0 },
      { label: "Ceil Height", key: "ceilHeight", type: "number", value: 64 },
      { label: "Floor Color", key: "floorColor", type: "color", value: "#555555" },
      { label: "Ceil Color", key: "ceilColor", type: "color", value: "#888888" },
    ]);

    this.wallInspector = new ORC_Inspector(this.propertiesContent, { id: "wall_inspector", title: "Wall Properties" }, [
      { label: "Wall Type", key: "type", type: "select", options: ["solid", "portal", "door"], value: "solid" },
      { label: "Portal Dir", key: "portalDirection", type: "select", options: ["both", "forward", "backward"], value: "both" },
      { label: "Texture ID", key: "textureId", type: "number", value: 0 },
      { label: "Disconnect Portal", key: "action_disconnect", type: "button" },
    ]);

    this.vertexInspector = new ORC_Inspector(this.propertiesContent, { id: "vertex_inspector", title: "Vertex Slopes (Offset)" }, [
      { label: "Floor Z Offset", key: "zFloorOffset", type: "number", value: 0 },
      { label: "Ceil Z Offset", key: "zCeilOffset", type: "number", value: 0 },
    ]);

    this.entityInspector = new ORC_Inspector(this.propertiesContent, { id: "entity_inspector", title: "Entity Properties" }, [
      { label: "Type", key: "type", type: "select", options: ["PlayerSpawn", "Enemy", "Light", "Prop"], value: "PlayerSpawn" },
      { label: "Spawn Angle", key: "angle", type: "number", value: 0, step: 15, wrap: true, min: 0, max: 360 },
    ]);

    this.toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tool");
        if (!target) return;
        const key = target.toUpperCase() as keyof typeof TOOLS;
        const newTool: Tool | undefined = TOOLS[key];
        if (!newTool) return;
        if (State.currentTool !== newTool) {
          State.selectedFaceId.clear();
          State.selectedEdgeId.clear();
          State.selectedVertices.clear();
          State.selectedEntityIds.clear();
          State.currentTool = newTool;
          this.updateToolUI();
          this.updatePropertiesPanel();
          saveEditorStateToStorage();
        }
      });
    });

    this.undoBtn.addEventListener("click", () => { State.History?.undo(); this.updatePropertiesPanel(); });
    this.redoBtn.addEventListener("click", () => { State.History?.redo(); this.updatePropertiesPanel(); });

    this.deleteBtn.addEventListener("click", () => {
      const cvs = document.querySelector("canvas");
      cvs?.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", bubbles: true }));
    });
    this.rotateBtn.addEventListener("click", () => {
      const cvs = document.querySelector("canvas");
      cvs?.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }));
    });

    this.toggleTrianglesBtn.addEventListener("click", () => {
      State.showTriangulationWireframes = !State.showTriangulationWireframes;
      this.toggleTrianglesBtn.textContent = State.showTriangulationWireframes
        ? "📐 Triangles: On"
        : "📐 Triangles: Off";
      this.toggleTrianglesBtn.style.color = State.showTriangulationWireframes ? "#ffaa00" : "";
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

    document.getElementById("btn-export")!.addEventListener("click", () => void exportMapData());
    const fileImport = document.getElementById("file-import") as HTMLInputElement;
    document.getElementById("btn-import")!.addEventListener("click", () => fileImport.click());
    fileImport.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        importMapData(String(evt.target?.result ?? ""));
        this.updateToolUI();
      };
      reader.readAsText(file);
      (e.target as HTMLInputElement).value = "";
    });

    window.addEventListener("keydown", (e) => {
      if (this.activeListeningRow) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.handleRemapCapture(e);
        return;
      }
      this.updateToolUI();
      this.updatePropertiesPanel();
    }, true);

    document.getElementById("btn-new-level")!.addEventListener("click", () => createNewLevel());

    window.addEventListener("orc_level_switched", () => {
      this.renderCampaignSidebar();
      this.updatePropertiesPanel();
      this.updateToolUI();
    });

    window.addEventListener("orc_inspector_change", (e) => this.handleInspectorChange(e as CustomEvent<InspectorChangeDetail>));
    window.addEventListener("orc_inspector_action", (e) => this.handleInspectorAction(e as CustomEvent<InspectorActionDetail>));

    this.renderCampaignSidebar();
    this.updateToolUI();
  },

  handleInspectorChange(_e: CustomEvent<InspectorChangeDetail>): void {
    // Side-effects on State are handled in main.ts to keep all geometry-mutation logic centralized.
  },
  handleInspectorAction(_e: CustomEvent<InspectorActionDetail>): void {},

  openModal(): void {
    this.settingsModal.classList.remove("hidden");
    this.populateBindingsUI();
  },
  closeModal(): void {
    this.settingsModal.classList.add("hidden");
    this.activeListeningRow = null;
  },

  renderCampaignSidebar(): void {
    const list = document.getElementById("level-list");
    if (!list) return;
    list.innerHTML = "";
    Campaign.levels.forEach((level, index) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "4px";
      row.style.width = "100%";

      const btn = document.createElement("button");
      btn.className = "action-btn level-btn" + (index === Campaign.activeLevelIndex ? " active" : "");
      btn.textContent = level.name;
      btn.style.flexGrow = "1";
      btn.addEventListener("click", () => switchLevel(index));

      const delBtn = document.createElement("button");
      delBtn.className = "action-btn";
      delBtn.innerHTML = "🗑️";
      delBtn.title = "Delete Level";
      delBtn.style.padding = "4px 8px";
      delBtn.style.background = "rgba(255, 68, 68, 0.1)";
      delBtn.style.color = "#ff4444";
      delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteLevel(index); });

      row.appendChild(btn);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  },

  updatePropertiesPanel(): void {
    this.propertiesPanel.classList.add("hidden");
    this.roomInspector.hide();
    this.wallInspector.hide();
    this.entityInspector.hide();
    this.vertexInspector.hide();

    if (State.selectedFaceId.size > 0) {
      const firstId = [...State.selectedFaceId][0]!;
      const selectedFace = State.faces.find((f) => f.id === firstId);
      if (selectedFace) {
        this.propertiesPanel.classList.remove("hidden");
        const title = this.roomInspector.container.querySelector(".panel-title");
        if (title) title.textContent =
          State.selectedFaceId.size > 1 ? `Rooms (${State.selectedFaceId.size})` : "Room Properties";
        this.roomInspector.setValues({
          floorHeight: selectedFace.floorHeight,
          ceilHeight: selectedFace.ceilHeight,
          floorColor: selectedFace.floorColor,
          ceilColor: selectedFace.ceilColor,
        });
        this.roomInspector.show();
      }
    } else if (State.selectedEdgeId.size > 0) {
      const firstId = [...State.selectedEdgeId][0]!;
      const selectedEdge = State.edges.find((e) => e.id === firstId);
      if (selectedEdge) {
        this.propertiesPanel.classList.remove("hidden");
        const title = this.wallInspector.container.querySelector(".panel-title");
        if (title) title.textContent =
          State.selectedEdgeId.size > 1 ? `Walls (${State.selectedEdgeId.size})` : "Wall Properties";
        this.wallInspector.setValues({
          type: selectedEdge.type,
          portalDirection: selectedEdge.portalDirection || "both",
          textureId: selectedEdge.textureId,
        });
        const anyLinked = [...State.selectedEdgeId].some((id) => {
          const e = State.edges.find((edge) => edge.id === id);
          return e && e.type === "portal" && e.targetEdgeId;
        });
        this.wallInspector.toggleVisibility("action_disconnect", anyLinked);
        this.wallInspector.show();
      }
    } else if (State.selectedVertices.size > 0) {
      const firstId = [...State.selectedVertices][0]!;
      const selectedV = State.vertices.find((v) => v.id === firstId);
      if (selectedV) {
        this.propertiesPanel.classList.remove("hidden");
        const title = this.vertexInspector.container.querySelector(".panel-title");
        if (title) title.textContent =
          State.selectedVertices.size > 1 ? `Vertices (${State.selectedVertices.size})` : "Vertex Slopes";
        this.vertexInspector.setValues({
          zFloorOffset: selectedV.zFloorOffset || 0,
          zCeilOffset: selectedV.zCeilOffset || 0,
        });
        this.vertexInspector.show();
      }
    } else if (State.selectedEntityIds.size > 0) {
      const firstId = [...State.selectedEntityIds][0]!;
      const selectedEnt = State.entities.find((e) => e.id === firstId);
      if (selectedEnt) {
        this.propertiesPanel.classList.remove("hidden");
        const title = this.entityInspector.container.querySelector(".panel-title");
        if (title) title.textContent =
          State.selectedEntityIds.size > 1 ? `Entities (${State.selectedEntityIds.size})` : "Entity Properties";
        this.entityInspector.setValues({
          type: selectedEnt.type,
          angle: selectedEnt.angle || 0,
        });
        this.entityInspector.show();
      }
    }
  },

  populateBindingsUI(): void {
    this.bindingsContainer.innerHTML = "";
    this.activeListeningRow = null;
    (Object.values(ACTIONS) as Action[]).forEach((action) => {
      const row = document.createElement("div");
      row.className = "binding-row";
      const label = document.createElement("div");
      label.className = "binding-label";
      label.textContent = action.replace(/_/g, " ");

      const keyCap = document.createElement("div");
      keyCap.className = "key-cap";
      const assignedKeys = Object.keys(State.keyBindings).filter((k) => State.keyBindings[k] === action);
      keyCap.textContent = assignedKeys.length > 0 ? assignedKeys.join(" / ") : "[ None ]";
      keyCap.addEventListener("click", () => {
        this.activeListeningRow?.classList.remove("listening");
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

  handleRemapCapture(e: KeyboardEvent): void {
    if (!this.activeListeningRow) return;
    const actionTarget = this.activeListeningRow.getAttribute("data-action") as Action | null;
    if (!actionTarget) return;
    if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft"].includes(e.code)) return;

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

  updateToolUI(): void {
    this.toolButtons?.forEach((btn) => {
      const btnTool = btn.getAttribute("data-tool");
      if (btnTool && TOOLS[btnTool.toUpperCase() as keyof typeof TOOLS] === State.currentTool) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  },
};
