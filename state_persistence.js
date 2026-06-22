import { TOOLS, DEFAULT_KEY_BINDINGS } from "./enums_actions.js";
import { Vertex, Edge, Entity } from "./relational_data_architecture.js";
import { buildDCEL } from "./DCEL.js";
import { GeometryChangeCommand } from "./command_pattern.js";

// ==========================================
// CENTRAL STATE MANAGER
// ==========================================
export const State = {
  vertices: [],
  edges: [],
  faces: [],
  halfEdges: [],
  selectedVertices: new Set(),
  selectedFaceId: new Set(),
  selectedEdgeId: new Set(),
  entities: [],
  selectedEntityIds: new Set(),
  currentTool: TOOLS.LINE,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  showTriangulationWireframes: false,
  History: null,
};

// ==========================================
// CAMPAIGN MANAGER (State Swapper)
// ==========================================
export const Campaign = {
  name: "ORC_Campaign",
  activeLevelIndex: 0,
  levels: [{ id: "level_01", name: "Level 1", rawData: null }],
};

export function getRawStateSnapshot() {
  return {
    currentTool: State.currentTool,
    geometry: {
      vertices: State.vertices.map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        zFloorOffset: v.zFloorOffset,
        zCeilOffset: v.zCeilOffset,
      })),
      edges: State.edges.map((e) => ({
        id: e.id,
        v1Id: e.v1Id,
        v2Id: e.v2Id,
        type: e.type,
        textureId: e.textureId,
        targetEdgeId: e.targetEdgeId,
        portalDirection: e.portalDirection,
      })),
    },
    sectors: State.faces.map((f) => ({
      id: f.id,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      anchorEdgeId: f.outerComponent?.edge?.id,
      anchorOriginId: f.outerComponent?.originId,
    })),
    entities: State.entities.map((ent) => ({
      id: ent.id,
      x: ent.x,
      y: ent.y,
      type: ent.type,
      angle: ent.angle,
    })),
    history: {
      undo: State.History.undoStack.map((cmd) => ({
        oldV: cmd.oldV,
        oldE: cmd.oldE,
        newV: cmd.newV,
        newE: cmd.newE,
        oldSel: cmd.oldSel,
        newSel: cmd.newSel,
      })),
      redo: State.History.redoStack.map((cmd) => ({
        oldV: cmd.oldV,
        oldE: cmd.oldE,
        newV: cmd.newV,
        newE: cmd.newE,
        oldSel: cmd.oldSel,
        newSel: cmd.newSel,
      })),
    },
    keyBindings: State.keyBindings,
  };
}

export function applyRawStateSnapshot(data) {
  // 1. Wipe the current canvas
  State.vertices = [];
  State.edges = [];
  State.faces = [];
  State.halfEdges = [];
  State.entities = [];
  State.selectedVertices.clear();
  State.selectedFaceId.clear();
  State.selectedEdgeId.clear();
  State.selectedEntityIds.clear();
  if (State.History) {
    State.History.undoStack = [];
    State.History.redoStack = [];
  }

  // 2. Hydrate new data
  if (!data) {
    buildDCEL();
    return;
  }

  if (data.keyBindings) State.keyBindings = data.keyBindings;
  if (data.currentTool) State.currentTool = data.currentTool;

  if (data.geometry) {
    State.vertices = data.geometry.vertices.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    State.edges = data.geometry.edges.map((e) => {
      let edge = new Edge(e.v1Id, e.v2Id, e.id);
      if (e.type) edge.type = e.type;
      if (e.targetEdgeId) edge.targetEdgeId = e.targetEdgeId;
      if (e.textureId !== undefined) edge.textureId = e.textureId;
      if (e.portalDirection) edge.portalDirection = e.portalDirection;
      return edge;
    });
  }

  buildDCEL();

  if (data.sectors) {
    data.sectors.forEach((savedSector) => {
      const anchorHE = State.halfEdges.find(
        (he) =>
          he.edge.id === savedSector.anchorEdgeId &&
          he.originId === savedSector.anchorOriginId,
      );
      if (anchorHE && anchorHE.face) {
        const face = anchorHE.face;
        face.id = savedSector.id;
        face.floorHeight = savedSector.floorHeight;
        face.ceilHeight = savedSector.ceilHeight;
        face.floorColor = savedSector.floorColor;
        face.ceilColor = savedSector.ceilColor;
      }
    });
  }

  if (data.history && State.History) {
    State.History.undoStack = data.history.undo.map(
      (h) =>
        new GeometryChangeCommand(
          h.oldV,
          h.oldE,
          h.newV,
          h.newE,
          h.oldSel,
          h.newSel,
        ),
    );
    State.History.redoStack = data.history.redo.map(
      (h) =>
        new GeometryChangeCommand(
          h.oldV,
          h.oldE,
          h.newV,
          h.newE,
          h.oldSel,
          h.newSel,
        ),
    );
  }

  if (data.entities) {
    State.entities = data.entities.map((ent) => {
      let e = new Entity(ent.x, ent.y, ent.type, ent.id);
      e.angle = ent.angle || 0;
      return e;
    });
  }
}

export function switchLevel(index) {
  if (index === Campaign.activeLevelIndex) return;
  Campaign.levels[Campaign.activeLevelIndex].rawData = getRawStateSnapshot(); // Sleep old
  Campaign.activeLevelIndex = index;
  applyRawStateSnapshot(Campaign.levels[index].rawData); // Wake new
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}

export function createNewLevel() {
  Campaign.levels[Campaign.activeLevelIndex].rawData = getRawStateSnapshot(); // Sleep old
  let newIndex = Campaign.levels.length;
  let newId = "level_" + String(newIndex + 1).padStart(2, "0");
  Campaign.levels.push({
    id: newId,
    name: "Level " + (newIndex + 1),
    rawData: null,
  });
  Campaign.activeLevelIndex = newIndex;

  applyRawStateSnapshot(null); // Blank canvas!
  State.offsetX = 0;
  State.offsetY = 0;
  State.zoom = 1;
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}

export function saveEditorStateToStorage() {
  Campaign.levels[Campaign.activeLevelIndex].rawData = getRawStateSnapshot();
  localStorage.setItem("orc_engine_campaign_state", JSON.stringify(Campaign));
}

export function loadEditorStateFromStorage() {
  const raw = localStorage.getItem("orc_engine_campaign_state");
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    Campaign.name = data.name;
    Campaign.activeLevelIndex = data.activeLevelIndex;
    Campaign.levels = data.levels;
    applyRawStateSnapshot(Campaign.levels[Campaign.activeLevelIndex].rawData);

    // NEW: This is the missing line! It tells the UI to wake up and draw the buttons
    window.dispatchEvent(new Event("orc_level_switched"));

    return true;
  } catch (err) {
    console.warn("Auto-load failed, clearing cache", err);
    localStorage.removeItem("orc_engine_campaign_state");
    return false;
  }
}

export function deleteLevel(index) {
  // 1. Prevent deleting the very last level
  if (Campaign.levels.length <= 1) {
    alert("You must have at least one level in your campaign!");
    return;
  }

  // 2. Ask for confirmation so you don't lose hours of work by misclicking!
  if (
    !confirm(
      `Are you sure you want to delete "${Campaign.levels[index].name}"? This cannot be undone.`,
    )
  ) {
    return;
  }

  // 3. Handle the deletion safely
  if (index === Campaign.activeLevelIndex) {
    // We are deleting the level we are currently looking at!
    Campaign.levels.splice(index, 1);

    // Shift the active index if we deleted the bottom-most level
    Campaign.activeLevelIndex = Math.min(index, Campaign.levels.length - 1);

    // Wake up the neighboring level to replace the deleted one on the canvas
    applyRawStateSnapshot(Campaign.levels[Campaign.activeLevelIndex].rawData);
  } else {
    // We are deleting a background level
    Campaign.levels.splice(index, 1);

    // If the deleted level was ABOVE our active level in the list, we need to shift our active index down by 1
    if (Campaign.activeLevelIndex > index) {
      Campaign.activeLevelIndex--;
    }
  }

  // 4. Save and force the UI to redraw the sidebar
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}
