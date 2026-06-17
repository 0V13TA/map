// =========================
// STATE PERSISTENCE ENGINE
// =========================

import { Face, HalfEdge } from "./DCEL.js";
import { CommandHistory } from "./command_pattern.js";
import { Edge, Vertex } from "./relational_data_architecture.js";

/**
 * @param {Edge[]} edges
 * @param {Vertex[]} vertices
 * @param {Face[]} faces
 * @param {*} currentTool
 * @param {*} keyBindings
 * @param {CommandHistory} History
 */
export function saveEditorStateToStorage(
  currentTool,
  vertices,
  edges,
  faces,
  keyBindings,
  History,
) {
  const payload = {
    currentTool: currentTool, // NEW PERSISTENCE PARAMETER
    geometry: {
      vertices: vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
      edges: edges.map((e) => ({ id: e.id, v1Id: e.v1Id, v2Id: e.v2Id })),
    },
    sectors: faces.map((f) => ({
      id: f.id,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      anchorEdgeId: f.outerComponent?.edge?.id,
      anchorOriginId: f.outerComponent?.originId,
    })),
    history: {
      undo: History.undoStack.map((cmd) => ({
        oldV: cmd.oldV,
        oldE: cmd.oldE,
        newV: cmd.newV,
        newE: cmd.newE,
        oldSel: cmd.oldSel,
        newSel: cmd.newSel,
      })),
      redo: History.redoStack.map((cmd) => ({
        oldV: cmd.oldV,
        oldE: cmd.oldE,
        newV: cmd.newV,
        newE: cmd.newE,
        oldSel: cmd.oldSel,
        newSel: cmd.newSel,
      })),
    },
    keyBindings: keyBindings,
  };
  localStorage.setItem("orc_engine_editor_state", JSON.stringify(payload));
}

/**
 * @param {Face[]} faces
 * @param {Edge[]} edges
 * @param {HalfEdge[]} halfEdges
 * @param {Vertex[]} vertices
 * @param {CommandHistory} History
 */
export function loadEditorStateFromStorage(
  halfEdges,
  faces,
  edges,
  vertices,
  History,
) {
  const raw = localStorage.getItem("orc_engine_editor_state");
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);

    // 1. Rehydrate Hotkeys
    if (data.keyBindings) keyBindings = data.keyBindings;

    // 2. Rehydrate Active Tool Selection State
    if (data.currentTool) currentTool = data.currentTool;

    // 3. Rehydrate Topology
    if (data.geometry) {
      vertices = data.geometry.vertices.map((v) => new Vertex(v.x, v.y, v.id));
      edges = data.geometry.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    }

    // 4. Rebuild DCEL Mesh
    buildDCEL(halfEdges, faces, edges, vertices);

    // 5. Re-inject Sector 3D parameters
    if (data.sectors) {
      data.sectors.forEach((savedSector) => {
        const anchorHE = halfEdges.find(
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

    // 6. Reconstruct Command History Objects
    if (data.history) {
      History.undoStack = data.history.undo.map(
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
      History.redoStack = data.history.redo.map(
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

    return true;
  } catch (err) {
    console.warn("Auto-load failed, clearing corrupted fallback space:", err);
    localStorage.removeItem("orc_engine_editor_state");
    return false;
  }
}
