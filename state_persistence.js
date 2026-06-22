import { TOOLS, DEFAULT_KEY_BINDINGS } from "./enums_actions.js";
import { Vertex, Edge } from "./relational_data_architecture.js";
import { buildDCEL, Face, HalfEdge } from "./DCEL.js";
import { CommandHistory, GeometryChangeCommand } from "./command_pattern.js";

// ==========================================
// CENTRAL STATE MANAGER
// ==========================================
export const State = {
  /** @type {Vertex[]} */
  vertices: [],
  /** @type {Edge[]} */
  edges: [],
  /** @type {Face[]} */
  faces: [],
  /** @type {HalfEdge[]} */
  halfEdges: [],

  /** @type {Set<Vertex>} */
  selectedVertices: new Set(),
  /** @type {Set<import("./relational_data_architecture.js").UUID>} */
  selectedFaceId: new Set(),
  /** @type {Set<import("./relational_data_architecture.js").UUID>} */
  selectedEdgeId: new Set(),

  /** @type {import("./relational_data_architecture.js").Entity[]} */
  entities: [],
  /** @type {Set<import("./relational_data_architecture.js").UUID>} */
  selectedEntityIds: new Set(),

  /** @type {TOOLS} */
  currentTool: TOOLS.LINE,
  /** @type {DEFAULT_KEY_BINDINGS} */
  keyBindings: { ...DEFAULT_KEY_BINDINGS },

  /** @type {number} */
  zoom: 1.0,
  /** @type {number} */
  offsetX: 0,
  /** @type {number} */
  offsetY: 0,
  /** @type {boolean} */
  showTriangulationWireframes: false,

  /** @type {CommandHistory} */
  History: null, // Injected at boot by index.js
};

// ==========================================
// STATE PERSISTENCE ENGINE
// ==========================================
export function saveEditorStateToStorage() {
  const payload = {
    currentTool: State.currentTool,
    geometry: {
      vertices: State.vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
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
  localStorage.setItem("orc_engine_editor_state", JSON.stringify(payload));
}

export function loadEditorStateFromStorage() {
  const raw = localStorage.getItem("orc_engine_editor_state");
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);

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

    if (data.history) {
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
    return true;
  } catch (err) {
    console.warn("Auto-load failed, clearing corrupted fallback space:", err);
    localStorage.removeItem("orc_engine_editor_state");
    return false;
  }
}
