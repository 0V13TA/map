// ts-check
"use strict";
import { TOOLS, ACTIONS } from "./enums_actions.js";
import { buildDCEL, isPointInFace } from "./DCEL.js";
import { CommandHistory, GeometryChangeCommand } from "./command_pattern.js";
import { UI } from "./ui.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import {
  State,
  loadEditorStateFromStorage,
  saveEditorStateToStorage,
} from "./state_persistence.js";
import {
  snapPoint,
  findEdgeAt,
  findVertexAt,
  worldFromMouse,
  findPortalArrowAt,
  computeStateAfterEdges,
  isPointInSelectionBounds,
  getMagneticSnapPosition,
} from "./geometry_and_intersection.js";
import {
  getV,
  Edge,
  Vertex,
  getOrCreateVertexInPool,
} from "./relational_data_architecture.js";

// Initialize Central Logic
State.History = new CommandHistory();

// Canvas & Variables
let SCREEN_WIDTH = Math.floor(window.innerWidth * 0.99);
let SCREEN_HEIGHT = Math.floor(window.innerHeight * 0.99);
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
canvas.width = SCREEN_WIDTH;
canvas.height = SCREEN_HEIGHT;

canvas.tabIndex = 0;
canvas.style.outline = "none";

document.body.appendChild(canvas);
canvas.focus();

const SNAP = 10;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20.0;

/** @type {import("./relational_data_architecture.js").UUID} */
let draggingPortalId = null;

let isMouseDown = false;
let currentAnchorId = null;
let currentRawMouse = [0, 0];
let boxStartWorld = null;
let isBoxSelecting = false;
let dragLastWorld = [0, 0];
let initialDragStateSnapshot = null;
let isPanning = false;
let panLastScreen = [0, 0];
let hoveredVertexId = null;
let hoveredEdgeId = null;
let actionStartSnapshot = null;

window.addEventListener("resize", () => {
  SCREEN_WIDTH = Math.floor(window.innerWidth * 0.99);
  SCREEN_HEIGHT = Math.floor(window.innerHeight * 0.99);
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
});

// Input Router
canvas.addEventListener("keydown", (e) => {
  let modifierPrefix = "";
  if (e.ctrlKey || e.metaKey) modifierPrefix += "Ctrl+";
  const action = State.keyBindings[modifierPrefix + e.code];
  if (!action) return;
  e.preventDefault();

  switch (action) {
    case ACTIONS.UNDO:
      State.History.undo();
      break;
    case ACTIONS.REDO:
      State.History.redo();
      break;
    case ACTIONS.SELECT_ALL:
      State.selectedVertices.clear();
      State.vertices.forEach((v) => State.selectedVertices.add(v.id));
      break;
    case ACTIONS.SET_TOOL_LINE:
    case ACTIONS.SET_TOOL_NGON:
    case ACTIONS.SET_TOOL_ZOOM:
    case ACTIONS.SET_TOOL_DRAG: {
      const toolMap = {
        [ACTIONS.SET_TOOL_LINE]: TOOLS.LINE,
        [ACTIONS.SET_TOOL_NGON]: TOOLS.NGON,
        [ACTIONS.SET_TOOL_ZOOM]: TOOLS.ZOOM,
        [ACTIONS.SET_TOOL_DRAG]: TOOLS.DRAG,
      };

      const newTool = toolMap[action];
      if (State.currentTool !== newTool) {
        State.selectedVertices.clear();
        State.selectedFaceId.clear();
        State.selectedEdgeId.clear();
        State.currentTool = newTool;
      }
      break;
    }

    case ACTIONS.PAN_UP:
      State.offsetY += 40 / State.zoom;
      break;
    case ACTIONS.PAN_DOWN:
      State.offsetY -= 40 / State.zoom;
      break;
    case ACTIONS.PAN_LEFT:
      State.offsetX += 40 / State.zoom;
      break;
    case ACTIONS.PAN_RIGHT:
      State.offsetX -= 40 / State.zoom;
      break;
    case ACTIONS.DELETE_SELECTION:
      if (State.selectedFaceId.size > 0) {
        let edgesToRemove = new Set();
        let faceHalfEdges = State.halfEdges.filter(
          (he) => he.face && State.selectedFaceId.has(he.face.id),
        );

        faceHalfEdges.forEach((he) => {
          // If the twin wall points outside, OR it points to another face that is ALSO being deleted, wipe it!
          if (!he.twin.face || State.selectedFaceId.has(he.twin.face.id)) {
            edgesToRemove.add(he.edge.id);
          }
        });

        const newE = State.edges.filter((e) => !edgesToRemove.has(e.id));
        const newV = State.vertices.filter((v) =>
          newE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
        );

        State.History.execute(
          new GeometryChangeCommand(
            State.vertices,
            State.edges,
            newV,
            newE,
            State.selectedVertices,
            [],
          ),
        );
        State.selectedFaceId.clear();
        State.selectedVertices.clear();
        UI.updatePropertiesPanel();
      } else if (State.selectedEdgeId.size > 0) {
        const newE = State.edges.filter((e) => !State.selectedEdgeId.has(e.id));
        const newV = State.vertices.filter((v) =>
          newE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
        );

        State.History.execute(
          new GeometryChangeCommand(
            State.vertices,
            State.edges,
            newV,
            newE,
            State.selectedVertices,
            [],
          ),
        );
        State.selectedEdgeId.clear();
        State.selectedVertices.clear();
        UI.updatePropertiesPanel();
      } else if (State.selectedVertices.size > 0) {
        const newE = State.edges.filter(
          (e) =>
            !State.selectedVertices.has(e.v1Id) &&
            !State.selectedVertices.has(e.v2Id),
        );
        const newV = State.vertices.filter(
          (v) => !State.selectedVertices.has(v.id),
        );
        State.History.execute(
          new GeometryChangeCommand(
            State.vertices,
            State.edges,
            newV,
            newE,
            State.selectedVertices,
            [],
          ),
        );
        State.selectedEdgeId.clear();
        State.selectedFaceId.clear();
      }
      break;
    case ACTIONS.ROTATE_SELECTION:
      if (State.selectedVertices.size > 0) {
        let cx = 0,
          cy = 0;
        State.selectedVertices.forEach((vid) => {
          let v = getV(State.vertices, vid);
          cx += v.x;
          cy += v.y;
        });
        cx /= State.selectedVertices.size;
        cy /= State.selectedVertices.size;
        let angle = 15 * (Math.PI / 180);
        let origV = State.vertices.map((v) => {
          let nv = new Vertex(v.x, v.y, v.id);
          nv.zFloorOffset = v.zFloorOffset || 0;
          nv.zCeilOffset = v.zCeilOffset || 0;
          return nv;
        });
        let origE = State.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));

        State.selectedVertices.forEach((vid) => {
          let v = getV(State.vertices, vid);
          let dx = v.x - cx,
            dy = v.y - cy;
          v.x = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
          v.y = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
        });

        let staticEdges = [],
          movedEdges = [];
        State.edges.forEach((e) => {
          if (
            State.selectedVertices.has(e.v1Id) ||
            State.selectedVertices.has(e.v2Id)
          ) {
            let ne = new Edge(e.v1Id, e.v2Id, e.id);
            ne.type = e.type;
            ne.portalDirection = e.portalDirection;
            ne.textureId = e.textureId;
            ne.targetEdgeId = e.targetEdgeId;
            movedEdges.push(ne);
          } else staticEdges.push(e);
        });
        let state = computeStateAfterEdges(
          State.vertices,
          staticEdges,
          movedEdges,
        );
        State.History.execute(
          new GeometryChangeCommand(
            origV,
            origE,
            state.newV,
            state.newE,
            State.selectedVertices,
            State.selectedVertices,
          ),
        );
      }
      break;
  }
});

function getMouseCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height),
  ];
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && e.altKey) {
    isPanning = true;
    panLastScreen = [e.clientX, e.clientY];
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  isMouseDown = true;
  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);

  actionStartSnapshot = {
    v: State.vertices.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    }),
    e: State.edges.map((e) => {
      let edge = new Edge(e.v1Id, e.v2Id, e.id);
      edge.type = e.type;
      edge.portalDirection = e.portalDirection;
      edge.textureId = e.textureId;
      edge.targetEdgeId = e.targetEdgeId; // NEW
      return edge;
    }),
    sel: new Set(State.selectedVertices),
  };
  currentRawMouse = [...world];
  dragLastWorld = [...world];
  isBoxSelecting = false;
  boxStartWorld = null;

  switch (State.currentTool) {
    case TOOLS.LINE:
      if (e.altKey) return;
      let hitV = findVertexAt(world);
      if (!hitV) {
        let snapped = getMagneticSnapPosition(world, new Set(), SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          State.vertices,
          snapped[0],
          snapped[1],
        );
      } else currentAnchorId = hitV.id;
      break;

    case TOOLS.NGON:
      if (e.altKey) return;
      if (!currentAnchorId) {
        let snapped = getMagneticSnapPosition(world, new Set(), SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          State.vertices,
          snapped[0],
          snapped[1],
        );
      }
      break;

    case TOOLS.DRAG:
      if (e.altKey) return;

      let grabArrow = findPortalArrowAt(world);
      if (grabArrow) {
        draggingPortalId = grabArrow.id;
        State.selectedFaceId.clear();
        State.selectedEdgeId.clear();
        State.selectedEdgeId.add(grabArrow.id);
        UI.updatePropertiesPanel();
        return;
      }

      let grabV = findVertexAt(world);
      let grabE = findEdgeAt(world);

      let grabF = null;
      for (let face of State.faces) {
        if (isPointInFace(world, face)) {
          grabF = face;
          break;
        }
      }

      initialDragStateSnapshot = {
        v: State.vertices.map((v) => {
          let nv = new Vertex(v.x, v.y, v.id);
          nv.zFloorOffset = v.zFloorOffset || 0;
          nv.zCeilOffset = v.zCeilOffset || 0;
          return nv;
        }),
        e: State.edges.map((e) => {
          let ne = new Edge(e.v1Id, e.v2Id, e.id);
          ne.type = e.type;
          ne.portalDirection = e.portalDirection;
          ne.textureId = e.textureId;
          ne.targetEdgeId = e.targetEdgeId;
          return ne;
        }),
      };

      if (grabV) {
        State.selectedEdgeId.clear();
        State.selectedFaceId.clear();
        if (e.shiftKey) {
          if (State.selectedVertices.has(grabV.id))
            State.selectedVertices.delete(grabV.id);
          else State.selectedVertices.add(grabV.id);
        } else if (!State.selectedVertices.has(grabV.id)) {
          State.selectedVertices.clear();
          State.selectedVertices.add(grabV.id);
        }
        UI.updatePropertiesPanel();
      } else if (isPointInSelectionBounds(world)) {
        // Do nothing, just drag
      } else if (grabE) {
        State.selectedFaceId.clear();
        if (e.shiftKey) {
          if (State.selectedEdgeId.has(grabE.id)) {
            State.selectedEdgeId.delete(grabE.id);
            State.selectedVertices.clear();
            State.edges.forEach((edge) => {
              if (State.selectedEdgeId.has(edge.id)) {
                State.selectedVertices.add(edge.v1Id);
                State.selectedVertices.add(edge.v2Id);
              }
            });
          } else {
            State.selectedEdgeId.add(grabE.id);
            State.selectedVertices.add(grabE.v1Id);
            State.selectedVertices.add(grabE.v2Id);
          }
        } else if (!State.selectedEdgeId.has(grabE.id)) {
          State.selectedEdgeId.clear();
          State.selectedVertices.clear();
          State.selectedEdgeId.add(grabE.id);
          State.selectedVertices.add(grabE.v1Id);
          State.selectedVertices.add(grabE.v2Id);
        }
        UI.updatePropertiesPanel();
      } else if (grabF) {
        State.selectedEdgeId.clear();
        if (e.shiftKey) {
          if (State.selectedFaceId.has(grabF.id)) {
            State.selectedFaceId.delete(grabF.id);
            State.selectedVertices.clear();
            State.faces.forEach((face) => {
              if (State.selectedFaceId.has(face.id)) {
                let loopE = face.outerComponent;
                if (loopE)
                  do {
                    State.selectedVertices.add(loopE.originId);
                    loopE = loopE.next;
                  } while (loopE && loopE !== face.outerComponent);
              }
            });
          } else {
            State.selectedFaceId.add(grabF.id);
            let loopE = grabF.outerComponent;
            if (loopE)
              do {
                State.selectedVertices.add(loopE.originId);
                loopE = loopE.next;
              } while (loopE && loopE !== grabF.outerComponent);
          }
        } else if (!State.selectedFaceId.has(grabF.id)) {
          State.selectedFaceId.clear();
          State.selectedVertices.clear();
          State.selectedFaceId.add(grabF.id);
          let loopE = grabF.outerComponent;
          if (loopE)
            do {
              State.selectedVertices.add(loopE.originId);
              loopE = loopE.next;
            } while (loopE && loopE !== grabF.outerComponent);
        }
        UI.updatePropertiesPanel();
      } else {
        State.selectedEdgeId.clear();
        State.selectedFaceId.clear();
        if (!e.shiftKey) State.selectedVertices.clear();
        isBoxSelecting = true;
        boxStartWorld = [...world];
        UI.updatePropertiesPanel();
      }
      break;
  }
});

canvas.addEventListener("mousemove", (e) => {
  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);
  currentRawMouse = world;

  if (isPanning) {
    State.offsetX += (e.clientX - panLastScreen[0]) / State.zoom;
    State.offsetY += (e.clientY - panLastScreen[1]) / State.zoom;
    panLastScreen = [e.clientX, e.clientY];
    return;
  }

  if (!isMouseDown) {
    let hitV = findVertexAt(world);
    hoveredVertexId = hitV ? hitV.id : null;
    if (!hoveredVertexId) {
      let hitE = findEdgeAt(world);
      hoveredEdgeId = hitE ? hitE.id : null;
    } else hoveredEdgeId = null;
  }

  if (!isMouseDown) return;

  switch (State.currentTool) {
    case TOOLS.DRAG:
      if (isBoxSelecting) return;
      let dx = world[0] - dragLastWorld[0],
        dy = world[1] - dragLastWorld[1];
      State.selectedVertices.forEach((vid) => {
        let v = getV(State.vertices, vid);
        v.x += dx;
        v.y += dy;
      });
      break;
    case TOOLS.ZOOM:
      let zoomCenter = worldFromMouse(canvas.width / 2, canvas.height / 2);
      State.zoom =
        e.movementY < 0
          ? Math.min(MAX_ZOOM, State.zoom * 1.03)
          : Math.max(MIN_ZOOM, State.zoom / 1.03);
      State.offsetX = canvas.width / 2 / State.zoom - zoomCenter[0];
      State.offsetY = canvas.height / 2 / State.zoom - zoomCenter[1];
      break;
  }
  dragLastWorld = [...world];
});

window.addEventListener("mouseup", (e) => {
  if (isPanning) {
    isPanning = false;
    return;
  }

  if (e.button === 0 && e.altKey) {
    isPanning = false;
    return;
  }
  if (!isMouseDown) return;
  isMouseDown = false;
  const snapped = getMagneticSnapPosition(currentRawMouse, new Set(), SNAP);

  switch (State.currentTool) {
    case TOOLS.LINE:
      if (currentAnchorId) {
        let hitV = findVertexAt(snapped);
        let endVId = hitV
          ? hitV.id
          : getOrCreateVertexInPool(State.vertices, snapped[0], snapped[1]);
        if (currentAnchorId !== endVId) {
          let nextState = computeStateAfterEdges(State.vertices, State.edges, [
            new Edge(currentAnchorId, endVId),
          ]);
          State.History.execute(
            new GeometryChangeCommand(
              actionStartSnapshot.v, // Use pristine snapshot
              actionStartSnapshot.e,
              nextState.newV,
              nextState.newE,
              actionStartSnapshot.sel,
              State.selectedVertices,
            ),
          );
        } else {
          // Safety: Revert the eagerly added vertex if they just clicked without drawing!
          State.vertices = actionStartSnapshot.v;
        }
      }
      currentAnchorId = null;
      break;

    case TOOLS.NGON:
      if (currentAnchorId) {
        let anchorV = getV(State.vertices, currentAnchorId);
        let radius = Math.hypot(snapped[0] - anchorV.x, snapped[1] - anchorV.y);
        if (radius > 10) {
          let sides = Math.max(
            3,
            Math.min(
              12,
              parseInt(document.getElementById("ngon-sides").value) || 8,
            ),
          );
          let ngonEdges = [],
            firstVId = null,
            prevVId = null;
          for (let i = 0; i < sides; i++) {
            let ang = (i / sides) * Math.PI * 2;
            let currVId = getOrCreateVertexInPool(
              State.vertices,
              Math.round((anchorV.x + Math.cos(ang) * radius) / SNAP) * SNAP,
              Math.round((anchorV.y + Math.sin(ang) * radius) / SNAP) * SNAP,
            );
            if (i === 0) firstVId = currVId;
            if (prevVId) ngonEdges.push(new Edge(prevVId, currVId));
            prevVId = currVId;
          }
          ngonEdges.push(new Edge(prevVId, firstVId));
          let nextState = computeStateAfterEdges(
            State.vertices,
            State.edges,
            ngonEdges,
          );
          State.History.execute(
            new GeometryChangeCommand(
              actionStartSnapshot.v, // Use pristine snapshot
              actionStartSnapshot.e,
              nextState.newV,
              nextState.newE,
              actionStartSnapshot.sel,
              State.selectedVertices,
            ),
          );
        } else {
          // Safety: Revert if they didn't drag far enough to make a shape
          State.vertices = actionStartSnapshot.v;
        }
      }
      currentAnchorId = null;
      break;

    case TOOLS.DRAG:
      if (draggingPortalId) {
        let dropArrow = findPortalArrowAt(currentRawMouse);

        let nextE = State.edges.map((e) => {
          let ne = new Edge(e.v1Id, e.v2Id, e.id);
          ne.type = e.type;
          ne.textureId = e.textureId;
          ne.targetEdgeId = e.targetEdgeId;
          ne.portalDirection = e.portalDirection;
          return ne;
        });

        let sEdge = nextE.find((e) => e.id === draggingPortalId);

        if (dropArrow && dropArrow.id !== draggingPortalId) {
          let tEdge = nextE.find((e) => e.id === dropArrow.id);

          // 1. Scrub the board: Break ANY existing connections pointing to EITHER portal
          nextE.forEach((e) => {
            if (e.targetEdgeId === sEdge.id || e.targetEdgeId === tEdge.id) {
              e.targetEdgeId = null;
            }
          });

          // 2. Establish the strict 1-to-1 connection
          sEdge.targetEdgeId = tEdge.id;
          tEdge.targetEdgeId = sEdge.id;
        } else if (!dropArrow) {
          // Dropped in empty space: Break the connection
          nextE.forEach((e) => {
            if (e.targetEdgeId === sEdge.id) {
              e.targetEdgeId = null;
            }
          });
          sEdge.targetEdgeId = null;
        }

        State.History.execute(
          new GeometryChangeCommand(
            actionStartSnapshot.v,
            actionStartSnapshot.e,
            actionStartSnapshot.v,
            nextE,
            actionStartSnapshot.sel,
            State.selectedVertices,
          ),
        );

        draggingPortalId = null;
        return;
      } else if (isBoxSelecting) {
        let xMin = Math.min(boxStartWorld[0], currentRawMouse[0]),
          xMax = Math.max(boxStartWorld[0], currentRawMouse[0]);
        let yMin = Math.min(boxStartWorld[1], currentRawMouse[1]),
          yMax = Math.max(boxStartWorld[1], currentRawMouse[1]);
        State.vertices.forEach((v) => {
          if (v.x >= xMin && v.x <= xMax && v.y >= yMin && v.y <= yMax)
            State.selectedVertices.add(v.id);
        });
        isBoxSelecting = false;
        boxStartWorld = null;
      } else if (initialDragStateSnapshot) {
        State.selectedVertices.forEach((vid) => {
          let v = getV(State.vertices, vid);
          if (State.selectedVertices.size === 1) {
            let snapped = getMagneticSnapPosition(
              [v.x, v.y],
              State.selectedVertices,
              SNAP,
            );
            v.x = snapped[0];
            v.y = snapped[1];
          } else {
            v.x = Math.round(v.x / SNAP) * SNAP;
            v.y = Math.round(v.y / SNAP) * SNAP;
          }
        });

        let staticEdges = [],
          movedEdges = [];
        State.edges.forEach((e) => {
          if (
            State.selectedVertices.has(e.v1Id) ||
            State.selectedVertices.has(e.v2Id)
          ) {
            let ne = new Edge(e.v1Id, e.v2Id, e.id);
            ne.type = e.type;
            ne.portalDirection = e.portalDirection;
            ne.textureId = e.textureId;
            ne.targetEdgeId = e.targetEdgeId;
            movedEdges.push(ne);
          } else staticEdges.push(e);
        });

        let nextState = computeStateAfterEdges(
          State.vertices,
          staticEdges,
          movedEdges,
        );
        State.History.execute(
          new GeometryChangeCommand(
            initialDragStateSnapshot.v,
            initialDragStateSnapshot.e,
            nextState.newV,
            nextState.newE,
            State.selectedVertices,
            State.selectedVertices,
          ),
        );
        initialDragStateSnapshot = null;
      }
      break;
  }
});

canvas.addEventListener("dblclick", (e) => {
  if (e.button !== 0) return;

  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);

  // Only allow quick-split if we are using the primary Drag/Select tool
  if (State.currentTool === TOOLS.DRAG) {
    let hitEdge = findEdgeAt(world);

    if (hitEdge) {
      let snapW = getMagneticSnapPosition(world, new Set(), SNAP);
      let newVId = getOrCreateVertexInPool(State.vertices, snapW[0], snapW[1]);

      // 1. Inherit all properties to the two new sub-edges
      let e1 = new Edge(hitEdge.v1Id, newVId);
      e1.type = hitEdge.type;
      e1.portalDirection = hitEdge.portalDirection;
      e1.textureId = hitEdge.textureId;
      e1.targetEdgeId = hitEdge.targetEdgeId;

      let e2 = new Edge(newVId, hitEdge.v2Id);
      e2.type = hitEdge.type;
      e2.portalDirection = hitEdge.portalDirection;
      e2.textureId = hitEdge.textureId;
      e2.targetEdgeId = hitEdge.targetEdgeId;

      let nextE = State.edges.filter((e) => e.id !== hitEdge.id);
      nextE.push(e1, e2);

      let state = computeStateAfterEdges(State.vertices, nextE, []);

      // 2. Safely clone the old state for the Undo buffer
      let oldV = State.vertices.map((v) => {
        let nv = new Vertex(v.x, v.y, v.id);
        nv.zFloorOffset = v.zFloorOffset || 0;
        nv.zCeilOffset = v.zCeilOffset || 0;
        return nv;
      });
      let oldE = State.edges.map((e) => {
        let ne = new Edge(e.v1Id, e.v2Id, e.id);
        ne.type = e.type;
        ne.portalDirection = e.portalDirection;
        ne.textureId = e.textureId;
        ne.targetEdgeId = e.targetEdgeId;
        return ne;
      });

      State.History.execute(
        new GeometryChangeCommand(
          oldV,
          oldE,
          state.newV,
          state.newE,
          State.selectedVertices,
          State.selectedVertices,
        ),
      );

      // 3. Auto-select the newly created vertex so the user can immediately move it!
      State.selectedFaceId.clear();
      State.selectedEdgeId.clear();
      State.selectedVertices.clear();
      State.selectedVertices.add(newVId);
      UI.updatePropertiesPanel();
    }
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const screen = getMouseCoords(e);
  const wM = worldFromMouse(screen[0], screen[1]);
  State.zoom =
    e.deltaY < 0
      ? Math.min(MAX_ZOOM, State.zoom * 1.12)
      : Math.max(MIN_ZOOM, State.zoom / 1.12);
  State.offsetX = screen[0] / State.zoom - wM[0];
  State.offsetY = screen[1] / State.zoom - wM[1];
});

window.addEventListener("orc_inspector_change", (e) => {
  const { id, values } = e.detail;

  if (id === "room_inspector" && State.selectedFaceId.size > 0) {
    State.faces.forEach((f) => {
      if (State.selectedFaceId.has(f.id)) {
        f.floorHeight = values.floorHeight;
        f.ceilHeight = values.ceilHeight;
        f.floorColor = values.floorColor;
        f.ceilColor = values.ceilColor;
      }
    });
    saveEditorStateToStorage();
  } else if (id === "wall_inspector" && State.selectedEdgeId.size > 0) {
    State.edges.forEach((edge) => {
      if (State.selectedEdgeId.has(edge.id)) {
        edge.type = values.type;
        edge.portalDirection = values.portalDirection;
        edge.textureId = values.textureId;
      }
    });
    saveEditorStateToStorage();
  } else if (id === "vertex_inspector" && State.selectedVertices.size > 0) {
    State.vertices.forEach((v) => {
      if (State.selectedVertices.has(v.id)) {
        v.zFloorOffset = values.zFloorOffset;
        v.zCeilOffset = values.zCeilOffset;
      }
    });
    saveEditorStateToStorage();
  }
});

window.addEventListener("orc_inspector_action", (e) => {
  const { id, action } = e.detail;
  if (
    id === "wall_inspector" &&
    action === "action_disconnect" &&
    State.selectedEdgeId.size > 0
  ) {
    let nextE = State.edges.map((edge) => {
      let ne = new Edge(edge.v1Id, edge.v2Id, edge.id);
      ne.type = edge.type;
      ne.portalDirection = edge.portalDirection;
      ne.textureId = edge.textureId;
      ne.targetEdgeId = edge.targetEdgeId;
      return ne;
    });

    State.selectedEdgeId.forEach((selectedId) => {
      let sEdge = nextE.find((edge) => edge.id === selectedId);
      if (sEdge && sEdge.targetEdgeId) {
        nextE.forEach((edge) => {
          if (edge.targetEdgeId === sEdge.id || edge.id === sEdge.targetEdgeId)
            edge.targetEdgeId = null;
        });
        sEdge.targetEdgeId = null;
      }
    });

    State.History.execute(
      new GeometryChangeCommand(
        State.vertices,
        State.edges,
        State.vertices,
        nextE,
        State.selectedVertices,
        State.selectedVertices,
      ),
    );
    UI.updatePropertiesPanel();
  }
});

// ==========================================
// MOBILE TOUCH ADAPTER
// ==========================================
let initialPinchDistance = null;
let initialZoomState = null;

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault(); // Prevents mobile scrolling while drawing

    if (e.touches.length === 1) {
      // 1 Finger: Simulate Mouse Down
      const touch = e.touches[0];
      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          bubbles: true,
        }),
      );
    } else if (e.touches.length === 2) {
      // 2 Fingers: Cancel drawing/dragging, start Pan & Zoom
      if (isMouseDown) {
        window.dispatchEvent(
          new MouseEvent("mouseup", { button: 0, bubbles: true }),
        );
      }

      isPanning = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];

      // Calculate distance and midpoint between the two fingers
      initialPinchDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      initialZoomState = State.zoom;
      panLastScreen = [
        (t1.clientX + t2.clientX) / 2,
        (t1.clientY + t2.clientY) / 2,
      ];
    }
  },
  { passive: false },
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();

    if (e.touches.length === 1 && !isPanning) {
      // 1 Finger: Simulate Mouse Move
      const touch = e.touches[0];
      canvas.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          bubbles: true,
        }),
      );
    } else if (e.touches.length === 2) {
      // 2 Fingers: Calculate Pan & Zoom natively
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentCenter = [
        (t1.clientX + t2.clientX) / 2,
        (t1.clientY + t2.clientY) / 2,
      ];
      const currentDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );

      // Execute Pan (Dragging two fingers across screen)
      State.offsetX += (currentCenter[0] - panLastScreen[0]) / State.zoom;
      State.offsetY += (currentCenter[1] - panLastScreen[1]) / State.zoom;
      panLastScreen = currentCenter;

      // Execute Pinch-to-Zoom
      if (initialPinchDistance > 0) {
        const rect = canvas.getBoundingClientRect();
        const zoomCenterScreen = [
          (currentCenter[0] - rect.left) * (canvas.width / rect.width),
          (currentCenter[1] - rect.top) * (canvas.height / rect.height),
        ];

        const wCenterBefore = worldFromMouse(
          zoomCenterScreen[0],
          zoomCenterScreen[1],
        );
        const zoomFactor = currentDistance / initialPinchDistance;

        State.zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, initialZoomState * zoomFactor),
        );

        // Compensate offset to keep the zoom perfectly centered exactly between your two fingers
        State.offsetX = zoomCenterScreen[0] / State.zoom - wCenterBefore[0];
        State.offsetY = zoomCenterScreen[1] / State.zoom - wCenterBefore[1];
      }
    }
  },
  { passive: false },
);

window.addEventListener("touchend", (e) => {
  if (e.touches.length < 2) {
    isPanning = false;
    initialPinchDistance = null;
  }

  if (e.touches.length === 0) {
    // 0 Fingers: Simulate Mouse Up to finalize drawing
    const touch = e.changedTouches[0];
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        bubbles: true,
      }),
    );
  }
});

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(
    State.zoom,
    0,
    0,
    State.zoom,
    State.offsetX * State.zoom,
    State.offsetY * State.zoom,
  );

  // Draw Grid
  const left = -State.offsetX,
    right = left + canvas.width / State.zoom;
  const top = -State.offsetY,
    bottom = top + canvas.height / State.zoom;
  ctx.lineWidth = 1 / State.zoom;
  for (let x = Math.floor(left / 40) * 40; x < right; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle =
      x % 200 === 0 ? "rgba(160,180,220,0.22)" : "rgba(120,140,180,0.05)";
    ctx.stroke();
  }
  for (let y = Math.floor(top / 40) * 40; y < bottom; y += 40) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.strokeStyle =
      y % 200 === 0 ? "rgba(160,180,220,0.22)" : "rgba(120,140,180,0.05)";
    ctx.stroke();
  }

  // Draw Faces
  State.faces.forEach((face) => {
    ctx.beginPath();
    let currEdge = face.outerComponent,
      first = true;
    do {
      let v = getV(State.vertices, currEdge.originId);
      if (first) {
        ctx.moveTo(v.x, v.y);
        first = false;
      } else {
        ctx.lineTo(v.x, v.y);
      }
      currEdge = currEdge.next;
    } while (currEdge && currEdge !== face.outerComponent);

    // Render the base physical color transparently FIRST
    ctx.fillStyle = face.floorColor + "99";
    ctx.fill();

    // Layer the bright blue outline ONLY if selected
    if (State.selectedFaceId.has(face.id)) {
      ctx.fillStyle = "rgba(0, 150, 255, 0.2)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 2 / State.zoom;
      ctx.stroke();
    }
    ctx.fill();

    if (State.showTriangulationWireframes) {
      let perimeterVertices = [];
      let loopEdge = face.outerComponent;
      do {
        let v = getV(State.vertices, loopEdge.originId);
        if (v) perimeterVertices.push(v);
        loopEdge = loopEdge.next;
      } while (loopEdge && loopEdge !== face.outerComponent);

      ctx.save();
      ctx.strokeStyle = "rgba(255, 165, 0, 0.35)";
      ctx.lineWidth = 1 / State.zoom;
      ctx.setLineDash([2 / State.zoom, 4 / State.zoom]);
      triangulatePolygonPerimeter(perimeterVertices).forEach(([v1, v2, v3]) => {
        ctx.beginPath();
        ctx.moveTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.lineTo(v3.x, v3.y);
        ctx.closePath();
        ctx.stroke();
      });
      ctx.restore();
    }
  });

  // --- DRAW PORTAL CONNECTIONS ---
  ctx.lineWidth = 2 / State.zoom;
  State.edges.forEach((edge) => {
    // 1. Established Connections (Curved transparent cyan line)
    if (edge.type === "portal" && edge.targetEdgeId) {
      let target = State.edges.find((e) => e.id === edge.targetEdgeId);
      // Prevent drawing the same line twice (A->B and B->A)
      if (target && edge.id < target.id) {
        let v1 = getV(State.vertices, edge.v1Id),
          v2 = getV(State.vertices, edge.v2Id);
        let tv1 = getV(State.vertices, target.v1Id),
          tv2 = getV(State.vertices, target.v2Id);
        if (v1 && v2 && tv1 && tv2) {
          let m1X = (v1.x + v2.x) / 2,
            m1Y = (v1.y + v2.y) / 2;
          let m2X = (tv1.x + tv2.x) / 2,
            m2Y = (tv1.y + tv2.y) / 2;

          ctx.beginPath();
          ctx.strokeStyle = "rgba(68, 255, 255, 0.25)";
          ctx.setLineDash([4 / State.zoom, 8 / State.zoom]);
          ctx.moveTo(m1X, m1Y);
          // Curve slightly to differentiate from straight geometric walls
          let cpX = (m1X + m2X) / 2 + (m2Y - m1Y) * 0.2;
          let cpY = (m1Y + m2Y) / 2 - (m2X - m1X) * 0.2;
          ctx.quadraticCurveTo(cpX, cpY, m2X, m2Y);
          ctx.stroke();
        }
      }
    }
  });

  // 2. Active Dragging Wire (Solid glowing cyan tracking mouse)
  if (isMouseDown && draggingPortalId) {
    let sEdge = State.edges.find((e) => e.id === draggingPortalId);
    if (sEdge) {
      let v1 = getV(State.vertices, sEdge.v1Id),
        v2 = getV(State.vertices, sEdge.v2Id);
      let m1X = (v1.x + v2.x) / 2,
        m1Y = (v1.y + v2.y) / 2;

      ctx.beginPath();
      ctx.strokeStyle = "#44ffff";
      ctx.setLineDash([6 / State.zoom, 6 / State.zoom]);
      ctx.moveTo(m1X, m1Y);
      ctx.lineTo(currentRawMouse[0], currentRawMouse[1]);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // Draw Edges
  State.edges.forEach((edge) => {
    let v1 = getV(State.vertices, edge.v1Id),
      v2 = getV(State.vertices, edge.v2Id);
    if (!v1 || !v2) return;

    // DIAGNOSTIC: Check if this edge is swallowed by a Face in the DCEL
    let isLoose = true;
    let hEdges = State.halfEdges.filter((he) => he.edge.id === edge.id);
    if (hEdges.some((he) => he.face !== null)) isLoose = false;

    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);

    let standsSelected =
      State.selectedVertices.has(edge.v1Id) &&
      State.selectedVertices.has(edge.v2Id);
    ctx.lineWidth = standsSelected ? 3.5 / State.zoom : 2 / State.zoom;

    // 1. BASE COLORING BY TYPE
    if (edge.type === "portal") {
      ctx.strokeStyle = standsSelected ? "#ff4444" : "#44ffff"; // Portals are Cyan
      ctx.setLineDash([4 / State.zoom, 4 / State.zoom]);
    } else if (edge.type === "door") {
      ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffaa00"; // Doors are Orange
      ctx.setLineDash([]);
    } else {
      // Solid Walls
      if (isLoose) {
        // Only show the magenta warning for SOLID loose walls, so it doesn't hide portals!
        ctx.strokeStyle = standsSelected ? "#ff4444" : "#ff00ff";
        ctx.setLineDash([8 / State.zoom, 8 / State.zoom]);
      } else {
        ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffffff";
        ctx.setLineDash([]);
      }
    }

    // Hover or Active Wall Selection Highlights
    if (edge.id === hoveredEdgeId || State.selectedEdgeId.has(edge.id)) {
      ctx.strokeStyle = "#ffd966";
      ctx.lineWidth = 4 / State.zoom;
    }

    ctx.stroke();
    ctx.setLineDash([]); // Reset dash for subsequent drawing operations

    // 2. DRAW THE DIRECTIONAL ARROWS (Removed the !isLoose constraint)
    if (edge.type === "portal") {
      let midX = (v1.x + v2.x) / 2;
      let midY = (v1.y + v2.y) / 2;
      let dx = v2.x - v1.x;
      let dy = v2.y - v1.y;
      let len = Math.hypot(dx, dy);

      if (len > 0) {
        let nx = -dy / len;
        let ny = dx / len;
        let arrowLen = 12 / State.zoom;
        let headLen = 6 / State.zoom;

        const drawArrow = (dirX, dirY) => {
          let angle = Math.atan2(dirY, dirX);
          ctx.beginPath();
          ctx.strokeStyle = standsSelected ? "#ff4444" : "#44ffff";
          ctx.lineWidth = 2 / State.zoom;
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + dirX * arrowLen, midY + dirY * arrowLen);
          ctx.lineTo(
            midX + dirX * arrowLen - headLen * Math.cos(angle - Math.PI / 6),
            midY + dirY * arrowLen - headLen * Math.sin(angle - Math.PI / 6),
          );
          ctx.moveTo(midX + dirX * arrowLen, midY + dirY * arrowLen);
          ctx.lineTo(
            midX + dirX * arrowLen - headLen * Math.cos(angle + Math.PI / 6),
            midY + dirY * arrowLen - headLen * Math.sin(angle + Math.PI / 6),
          );
          ctx.stroke();
        };

        let pDir = edge.portalDirection || "both";
        // Draw normal (forward)
        if (pDir === "both" || pDir === "forward") drawArrow(nx, ny);
        // Draw inverse normal (backward)
        if (pDir === "both" || pDir === "backward") drawArrow(-nx, -ny);
      }
    }
  });
  // Selection Bounds
  if (State.selectedVertices.size > 1) {
    ctx.fillStyle = "rgba(255, 68, 68, 0.04)";
    ctx.strokeStyle = "rgba(255, 68, 68, 0.2)";
    ctx.lineWidth = 1 / State.zoom;
    ctx.beginPath();
    let bounds = {
      xMin: Infinity,
      xMax: -Infinity,
      yMin: Infinity,
      yMax: -Infinity,
    };
    State.selectedVertices.forEach((vid) => {
      let v = getV(State.vertices, vid);
      bounds.xMin = Math.min(bounds.xMin, v.x);
      bounds.xMax = Math.max(bounds.xMax, v.x);
      bounds.yMin = Math.min(bounds.yMin, v.y);
      bounds.yMax = Math.max(bounds.yMax, v.y);
    });
    ctx.fillRect(
      bounds.xMin - 6,
      bounds.yMin - 6,
      bounds.xMax - bounds.xMin + 12,
      bounds.yMax - bounds.yMin + 12,
    );
    ctx.strokeRect(
      bounds.xMin - 6,
      bounds.yMin - 6,
      bounds.xMax - bounds.xMin + 12,
      bounds.yMax - bounds.yMin + 12,
    );
  }

  // Draw Vertices
  // Draw Vertices
  State.vertices.forEach((v) => {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 4 / State.zoom, 0, 2 * Math.PI);

    if (State.selectedVertices.has(v.id)) {
      ctx.fillStyle = "#ff4444";
    } else if (v.zFloorOffset !== 0 || v.zCeilOffset !== 0) {
      ctx.fillStyle = "#ffaa00"; // Orange visual indicator for slanted vertices!
    } else {
      ctx.fillStyle = "#44ff88";
    }

    ctx.fill();
    ctx.lineWidth = 1 / State.zoom;
    ctx.strokeStyle = "#ffffff";
    if (v.id === hoveredVertexId) {
      ctx.fillStyle = "#ffffff";
      ctx.arc(v.x, v.y, 6 / State.zoom, 0, 2 * Math.PI);
    }
    ctx.stroke();
  });

  // Tools visual feedback
  let snapped = getMagneticSnapPosition(currentRawMouse, new Set(), SNAP);
  if (isMouseDown && State.currentTool === TOOLS.LINE && currentAnchorId) {
    let vAnchor = getV(State.vertices, currentAnchorId);
    if (vAnchor) {
      ctx.beginPath();
      ctx.strokeStyle = "#ffd966";
      ctx.setLineDash([5 / State.zoom, 5 / State.zoom]);
      ctx.lineWidth = 2 / State.zoom;
      ctx.moveTo(vAnchor.x, vAnchor.y);
      ctx.lineTo(snapped[0], snapped[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (isMouseDown && isBoxSelecting && boxStartWorld) {
    ctx.fillStyle = "rgba(0, 160, 255, 0.08)";
    ctx.strokeStyle = "rgba(0, 160, 255, 0.5)";
    ctx.lineWidth = 1 / State.zoom;
    ctx.fillRect(
      boxStartWorld[0],
      boxStartWorld[1],
      currentRawMouse[0] - boxStartWorld[0],
      currentRawMouse[1] - boxStartWorld[1],
    );
    ctx.strokeRect(
      boxStartWorld[0],
      boxStartWorld[1],
      currentRawMouse[0] - boxStartWorld[0],
      currentRawMouse[1] - boxStartWorld[1],
    );
  }
  ctx.restore();

  // Tools visual feedback

  // if (isMouseDown && State.currentTool === TOOLS.LINE && currentAnchorId) {
  //   let vAnchor = getV(State.vertices, currentAnchorId);
  //   if (vAnchor) {
  //     ctx.beginPath();
  //     ctx.strokeStyle = "#ffd966";
  //     ctx.setLineDash([5 / State.zoom, 5 / State.zoom]);
  //     ctx.lineWidth = 2 / State.zoom;
  //     ctx.moveTo(vAnchor.x, vAnchor.y);
  //     ctx.lineTo(snapped[0], snapped[1]);
  //     ctx.stroke();
  //     ctx.setLineDash([]);
  //   }
  // }

  // NEW: N-Gon Live Wireframe Visualizer
  if (isMouseDown && State.currentTool === TOOLS.NGON && currentAnchorId) {
    let vAnchor = getV(State.vertices, currentAnchorId);
    if (vAnchor) {
      let radius = Math.hypot(snapped[0] - vAnchor.x, snapped[1] - vAnchor.y);
      if (radius > 10) {
        let sides = Math.max(
          3,
          Math.min(
            12,
            parseInt(document.getElementById("ngon-sides").value) || 8,
          ),
        );
        ctx.beginPath();
        ctx.strokeStyle = "#ffd966";
        ctx.setLineDash([5 / State.zoom, 5 / State.zoom]);
        ctx.lineWidth = 2 / State.zoom;

        for (let i = 0; i <= sides; i++) {
          let ang = (i / sides) * Math.PI * 2;
          // Pre-calculate exact grid-snapping so the preview perfectly matches the final generated geometry
          let px =
            Math.round((vAnchor.x + Math.cos(ang) * radius) / SNAP) * SNAP;
          let py =
            Math.round((vAnchor.y + Math.sin(ang) * radius) / SNAP) * SNAP;

          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function update() {
  render();
  requestAnimationFrame(update);
}
requestAnimationFrame(update);

UI.init();
const hydrated = loadEditorStateFromStorage();
if (hydrated) {
  UI.updateToolUI();
  UI.updatePropertiesPanel();
} else {
  buildDCEL();
}
