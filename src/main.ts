import { TOOLS, ACTIONS, type Action } from "./core/enums";
import { buildDCEL, isPointInFace } from "./core/dcel";
import { CommandHistory, GeometryChangeCommand } from "./state/history";
import { UI } from "./ui/panels";
import { triangulatePolygonPerimeter } from "./core/triangulation";
import {
  State,
  loadEditorStateFromStorage,
  saveEditorStateToStorage,
} from "./state/state";
import {
  findEdgeAt,
  findVertexAt,
  worldFromMouse,
  findPortalArrowAt,
  computeStateAfterEdges,
  isPointInSelectionBounds,
  getMagneticSnapPosition,
} from "./core/geometry";
import {
  Edge,
  Entity,
  Vertex,
  cloneEdge,
  cloneEntity,
  cloneVertex,
  getOrCreateVertexInPool,
  getV,
} from "./core/model";
import type { UUID, Vec2 } from "./core/types";
import type {
  InspectorChangeDetail,
  InspectorActionDetail,
} from "./ui/inspector";

State.History = new CommandHistory();

// =========================
// CANVAS BOOTSTRAP
// =========================
const host = document.getElementById("canvas-host") as HTMLElement;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
host.appendChild(canvas);
canvas.tabIndex = 0;
canvas.style.outline = "none";
canvas.addEventListener("dragstart", (e) => e.preventDefault());
function resizeCanvas(): void {
  const rect = host.getBoundingClientRect();
  canvas.width = Math.floor(rect.width);
  canvas.height = Math.floor(rect.height);
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
canvas.focus();

const SNAP = 10;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20.0;

let draggingPortalId: UUID | null = null;
let isMouseDown = false;
let currentAnchorId: UUID | null = null;
let currentRawMouse: Vec2 = [0, 0];
let boxStartWorld: Vec2 | null = null;
let isBoxSelecting = false;
let dragLastWorld: Vec2 = [0, 0];
let initialDragStateSnapshot: { v: Vertex[]; e: Edge[]; ent: Entity[] } | null =
  null;
let isPanning = false;
let panLastScreen: Vec2 = [0, 0];
let hoveredVertexId: UUID | null = null;
let hoveredEdgeId: UUID | null = null;
let actionStartSnapshot: {
  v: Vertex[];
  e: Edge[];
  sel: Set<UUID>;
  ent: Entity[];
} | null = null;

// =========================
// INPUT ROUTER
// =========================
canvas.addEventListener("keydown", (e) => {
  let modifierPrefix = "";
  if (e.ctrlKey || e.metaKey) modifierPrefix += "Ctrl+";
  const action = State.keyBindings[modifierPrefix + e.code] as
    | Action
    | undefined;
  if (!action) return;
  e.preventDefault();

  switch (action) {
    case ACTIONS.UNDO:
      State.History?.undo();
      break;
    case ACTIONS.REDO:
      State.History?.redo();
      break;
    case ACTIONS.SELECT_ALL:
      State.selectedVertices.clear();
      State.vertices.forEach((v) => State.selectedVertices.add(v.id));
      State.selectedEntityIds.clear();
      State.entities.forEach((ent) => State.selectedEntityIds.add(ent.id));
      UI.updatePropertiesPanel();
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
      } as const;
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
        const edgesToRemove = new Set<UUID>();
        const faceHalfEdges = State.halfEdges.filter(
          (he) => he.face && State.selectedFaceId.has(he.face.id),
        );
        faceHalfEdges.forEach((he) => {
          if (!he.twin?.face || State.selectedFaceId.has(he.twin.face.id)) {
            edgesToRemove.add(he.edge.id);
          }
        });
        const newE = State.edges.filter((e) => !edgesToRemove.has(e.id));
        const newV = State.vertices.filter((v) =>
          newE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
        );
        State.History!.execute(
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
        State.History!.execute(
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
        State.History!.execute(
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
      } else if (State.selectedEntityIds.size > 0) {
        // NEW: Record deletion in History
        const oldEnt = State.entities.map(cloneEntity);
        const newEnt = State.entities.filter(
          (e) => !State.selectedEntityIds.has(e.id),
        );

        State.History!.execute(
          new GeometryChangeCommand(
            State.vertices,
            State.edges,
            State.vertices,
            State.edges,
            State.selectedVertices,
            State.selectedVertices,
            oldEnt,
            newEnt,
          ),
        );
        State.selectedEntityIds.clear();
      }
      break;
    case ACTIONS.ROTATE_SELECTION:
      if (State.selectedVertices.size > 0) {
        let cx = 0,
          cy = 0;
        State.selectedVertices.forEach((vid) => {
          const v = getV(State.vertices, vid);
          if (v) {
            cx += v.x;
            cy += v.y;
          }
        });
        cx /= State.selectedVertices.size;
        cy /= State.selectedVertices.size;
        const angle = 15 * (Math.PI / 180);
        const origV = State.vertices.map(cloneVertex);
        const origE = State.edges.map(cloneEdge);

        State.selectedVertices.forEach((vid) => {
          const v = getV(State.vertices, vid);
          if (!v) return;
          const dx = v.x - cx,
            dy = v.y - cy;
          v.x = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
          v.y = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
        });

        const staticEdges: Edge[] = [];
        const movedEdges: Edge[] = [];
        State.edges.forEach((e) => {
          if (
            State.selectedVertices.has(e.v1Id) ||
            State.selectedVertices.has(e.v2Id)
          ) {
            movedEdges.push(cloneEdge(e));
          } else staticEdges.push(e);
        });
        const next = computeStateAfterEdges(
          State.vertices,
          staticEdges,
          movedEdges,
        );
        State.History!.execute(
          new GeometryChangeCommand(
            origV,
            origE,
            next.newV,
            next.newE,
            State.selectedVertices,
            State.selectedVertices,
          ),
        );
      }
      break;
  }
});

function getMouseCoords(e: MouseEvent): Vec2 {
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
    v: State.vertices.map(cloneVertex),
    e: State.edges.map(cloneEdge),
    sel: new Set(State.selectedVertices),
    ent: State.entities.map(cloneEntity),
  };
  currentRawMouse = [...world] as Vec2;
  dragLastWorld = [...world] as Vec2;
  isBoxSelecting = false;
  boxStartWorld = null;

  switch (State.currentTool) {
    case TOOLS.LINE: {
      if (e.altKey) return;
      const hitV = findVertexAt(world);
      if (!hitV) {
        const snapped = getMagneticSnapPosition(world, new Set(), SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          State.vertices,
          snapped[0],
          snapped[1],
        );
      } else currentAnchorId = hitV.id;
      break;
    }
    case TOOLS.NGON: {
      if (e.altKey) return;
      if (!currentAnchorId) {
        const snapped = getMagneticSnapPosition(world, new Set(), SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          State.vertices,
          snapped[0],
          snapped[1],
        );
      }
      break;
    }
    case TOOLS.DRAG: {
      if (e.altKey) return;

      const grabArrow = findPortalArrowAt(world);
      if (grabArrow) {
        draggingPortalId = grabArrow.id;
        State.selectedFaceId.clear();
        State.selectedEdgeId.clear();
        State.selectedEdgeId.add(grabArrow.id);
        UI.updatePropertiesPanel();
        return;
      }

      const hitEnt = State.entities.find(
        (ent) =>
          Math.hypot(ent.x - world[0], ent.y - world[1]) < 12 / State.zoom,
      );
      if (hitEnt) {
        State.selectedFaceId.clear();
        State.selectedEdgeId.clear();
        State.selectedVertices.clear();
        if (e.shiftKey) {
          if (State.selectedEntityIds.has(hitEnt.id))
            State.selectedEntityIds.delete(hitEnt.id);
          else State.selectedEntityIds.add(hitEnt.id);
        } else if (!State.selectedEntityIds.has(hitEnt.id)) {
          State.selectedEntityIds.clear();
          State.selectedEntityIds.add(hitEnt.id);
        }
        UI.updatePropertiesPanel();
        return;
      }

      const grabV = findVertexAt(world);
      const grabE = findEdgeAt(world);
      let grabF: ReturnType<(typeof State.faces)["find"]> = undefined;
      for (const face of State.faces) {
        if (isPointInFace(world, face)) {
          grabF = face;
          break;
        }
      }

      initialDragStateSnapshot = {
        v: State.vertices.map(cloneVertex),
        e: State.edges.map(cloneEdge),
        ent: State.entities.map(cloneEntity),
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
      } else if (
        grabE &&
        (e.shiftKey ||
          e.ctrlKey ||
          e.metaKey ||
          !State.selectedEdgeId.has(grabE.id))
      ) {
        State.selectedFaceId.clear();
        if (e.ctrlKey || e.metaKey) {
          const v1 = getV(State.vertices, grabE.v1Id)!;
          const v2 = getV(State.vertices, grabE.v2Id)!;
          const dx = v2.x - v1.x,
            dy = v2.y - v1.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -(dy / len) * 0.5,
            ny = (dx / len) * 0.5;

          const nv1 = new Vertex(v1.x + nx, v1.y + ny);
          const nv2 = new Vertex(v2.x + nx, v2.y + ny);
          State.vertices.push(nv1, nv2);

          const eNew = new Edge(nv1.id, nv2.id);
          eNew.type = grabE.type;
          eNew.textureId = grabE.textureId;
          const eSide1 = new Edge(grabE.v1Id, nv1.id);
          const eSide2 = new Edge(grabE.v2Id, nv2.id);
          State.edges.push(eNew, eSide1, eSide2);

          State.selectedEdgeId.clear();
          State.selectedEdgeId.add(eNew.id);
          State.selectedVertices.clear();
          State.selectedVertices.add(nv1.id);
          State.selectedVertices.add(nv2.id);

          initialDragStateSnapshot = {
            v: State.vertices.map(cloneVertex),
            e: State.edges.map(cloneEdge),
            ent: State.entities.map(cloneEntity),
          };
          UI.updatePropertiesPanel();
        } else if (e.shiftKey) {
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
        } else {
          State.selectedEdgeId.clear();
          State.selectedVertices.clear();
          State.selectedEdgeId.add(grabE.id);
          State.selectedVertices.add(grabE.v1Id);
          State.selectedVertices.add(grabE.v2Id);
        }
        UI.updatePropertiesPanel();
      } else if (isPointInSelectionBounds(world)) {
        // fall through to drag
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
        const selectFaceVerts = (face: typeof grabF) => {
          let loopE = face!.outerComponent;
          if (!loopE) return;
          const start = loopE;
          do {
            if (!loopE) break;
            State.selectedVertices.add(loopE.originId);
            loopE = loopE.next;
          } while (loopE && loopE !== start);
        };
        if (e.shiftKey) {
          if (State.selectedFaceId.has(grabF.id)) {
            State.selectedFaceId.delete(grabF.id);
            State.selectedVertices.clear();
            State.faces.forEach((face) => {
              if (State.selectedFaceId.has(face.id)) selectFaceVerts(face);
            });
          } else {
            State.selectedFaceId.add(grabF.id);
            selectFaceVerts(grabF);
          }
        } else if (!State.selectedFaceId.has(grabF.id)) {
          State.selectedFaceId.clear();
          State.selectedVertices.clear();
          State.selectedFaceId.add(grabF.id);
          selectFaceVerts(grabF);
        }
        UI.updatePropertiesPanel();
      } else {
        State.selectedEdgeId.clear();
        State.selectedFaceId.clear();
        if (!e.shiftKey) {
          State.selectedVertices.clear();
          State.selectedEntityIds.clear();
        }
        isBoxSelecting = true;
        boxStartWorld = [...world] as Vec2;
        UI.updatePropertiesPanel();
      }
      break;
    }
    case TOOLS.ENTITY: {
      if (e.altKey) return;
      const snappedEnt = getMagneticSnapPosition(world, new Set(), SNAP);

      // Wrap creation in Undo History
      const oldEnt = State.entities.map(cloneEntity);
      State.entities.push(
        new Entity(snappedEnt[0], snappedEnt[1], "PlayerSpawn"),
      );
      const newEnt = State.entities.map(cloneEntity);

      State.History!.execute(
        new GeometryChangeCommand(
          State.vertices,
          State.edges,
          State.vertices,
          State.edges,
          State.selectedVertices,
          State.selectedVertices,
          oldEnt,
          newEnt,
        ),
      );
      saveEditorStateToStorage();
      break;
    }
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
    const hitV = findVertexAt(world);
    hoveredVertexId = hitV ? hitV.id : null;
    if (!hoveredVertexId) {
      const hitE = findEdgeAt(world);
      hoveredEdgeId = hitE ? hitE.id : null;
    } else hoveredEdgeId = null;
  }

  if (!isMouseDown) return;

  switch (State.currentTool) {
    case TOOLS.DRAG: {
      if (isBoxSelecting) return;
      const dx = world[0] - dragLastWorld[0];
      const dy = world[1] - dragLastWorld[1];

      if (State.selectedEntityIds.size > 0) {
        State.selectedEntityIds.forEach((eid) => {
          const ent = State.entities.find((x) => x.id === eid);
          if (ent) {
            ent.x += dx;
            ent.y += dy;
          }
        });
      }
      if (State.selectedVertices.size > 0) {
        State.selectedVertices.forEach((vid) => {
          const v = getV(State.vertices, vid);
          if (v) {
            v.x += dx;
            v.y += dy;
          }
        });
      }
      break;
    }
    case TOOLS.ZOOM: {
      const zoomCenter = worldFromMouse(canvas.width / 2, canvas.height / 2);
      State.zoom =
        e.movementY < 0
          ? Math.min(MAX_ZOOM, State.zoom * 1.03)
          : Math.max(MIN_ZOOM, State.zoom / 1.03);
      State.offsetX = canvas.width / 2 / State.zoom - zoomCenter[0];
      State.offsetY = canvas.height / 2 / State.zoom - zoomCenter[1];
      break;
    }
  }
  dragLastWorld = [...world] as Vec2;
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
    case TOOLS.LINE: {
      if (currentAnchorId && actionStartSnapshot) {
        const hitV = findVertexAt(snapped);
        const endVId = hitV
          ? hitV.id
          : getOrCreateVertexInPool(State.vertices, snapped[0], snapped[1]);
        if (currentAnchorId !== endVId) {
          const nextState = computeStateAfterEdges(
            State.vertices,
            State.edges,
            [new Edge(currentAnchorId, endVId)],
          );
          State.History!.execute(
            new GeometryChangeCommand(
              actionStartSnapshot.v,
              actionStartSnapshot.e,
              nextState.newV,
              nextState.newE,
              actionStartSnapshot.sel,
              State.selectedVertices,
            ),
          );
        } else {
          State.vertices = actionStartSnapshot.v;
        }
      }
      currentAnchorId = null;
      break;
    }
    case TOOLS.NGON: {
      if (currentAnchorId && actionStartSnapshot) {
        const anchorV = getV(State.vertices, currentAnchorId);
        if (anchorV) {
          const radius = Math.hypot(
            snapped[0] - anchorV.x,
            snapped[1] - anchorV.y,
          );
          if (radius > 10) {
            const sidesInput = document.getElementById(
              "ngon-sides",
            ) as HTMLInputElement | null;
            const sides = Math.max(
              3,
              Math.min(12, parseInt(sidesInput?.value ?? "8") || 8),
            );
            const ngonEdges: Edge[] = [];
            let firstVId: UUID | null = null;
            let prevVId: UUID | null = null;
            for (let i = 0; i < sides; i++) {
              const ang = (i / sides) * Math.PI * 2;
              const currVId = getOrCreateVertexInPool(
                State.vertices,
                Math.round((anchorV.x + Math.cos(ang) * radius) / SNAP) * SNAP,
                Math.round((anchorV.y + Math.sin(ang) * radius) / SNAP) * SNAP,
              );
              if (i === 0) firstVId = currVId;
              if (prevVId) ngonEdges.push(new Edge(prevVId, currVId));
              prevVId = currVId;
            }
            if (prevVId && firstVId)
              ngonEdges.push(new Edge(prevVId, firstVId));
            const nextState = computeStateAfterEdges(
              State.vertices,
              State.edges,
              ngonEdges,
            );
            State.History!.execute(
              new GeometryChangeCommand(
                actionStartSnapshot.v,
                actionStartSnapshot.e,
                nextState.newV,
                nextState.newE,
                actionStartSnapshot.sel,
                State.selectedVertices,
              ),
            );
          } else {
            State.vertices = actionStartSnapshot.v;
          }
        }
      }
      currentAnchorId = null;
      break;
    }
    case TOOLS.DRAG: {
      if (draggingPortalId && actionStartSnapshot) {
        const dropArrow = findPortalArrowAt(currentRawMouse);
        const nextE = State.edges.map(cloneEdge);
        const sEdge = nextE.find((x) => x.id === draggingPortalId);
        if (sEdge) {
          if (dropArrow && dropArrow.id !== draggingPortalId) {
            const tEdge = nextE.find((x) => x.id === dropArrow.id);
            if (tEdge) {
              nextE.forEach((x) => {
                if (x.targetEdgeId === sEdge.id || x.targetEdgeId === tEdge.id)
                  x.targetEdgeId = null;
              });
              sEdge.targetEdgeId = tEdge.id;
              tEdge.targetEdgeId = sEdge.id;
            }
          } else if (!dropArrow) {
            nextE.forEach((x) => {
              if (x.targetEdgeId === sEdge.id) x.targetEdgeId = null;
            });
            sEdge.targetEdgeId = null;
          }
        }
        State.History!.execute(
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
      } else if (isBoxSelecting && boxStartWorld) {
        const xMin = Math.min(boxStartWorld[0], currentRawMouse[0]);
        const xMax = Math.max(boxStartWorld[0], currentRawMouse[0]);
        const yMin = Math.min(boxStartWorld[1], currentRawMouse[1]);
        const yMax = Math.max(boxStartWorld[1], currentRawMouse[1]);
        State.vertices.forEach((v) => {
          if (v.x >= xMin && v.x <= xMax && v.y >= yMin && v.y <= yMax)
            State.selectedVertices.add(v.id);
        });
        isBoxSelecting = false;
        boxStartWorld = null;
        UI.updatePropertiesPanel();
      } else if (initialDragStateSnapshot) {
        State.selectedVertices.forEach((vid) => {
          const v = getV(State.vertices, vid);
          if (!v) return;
          if (State.selectedVertices.size === 1) {
            const snappedV = getMagneticSnapPosition(
              [v.x, v.y],
              State.selectedVertices,
              SNAP,
            );
            v.x = snappedV[0];
            v.y = snappedV[1];
          } else {
            v.x = Math.round(v.x / SNAP) * SNAP;
            v.y = Math.round(v.y / SNAP) * SNAP;
          }
        });

        const vertexMap = new Map<UUID, UUID>();
        const weldedV: Vertex[] = [];
        State.vertices.forEach((v) => {
          const existing = weldedV.find(
            (ev) => Math.hypot(ev.x - v.x, ev.y - v.y) < 0.1,
          );
          if (existing) {
            vertexMap.set(v.id, existing.id);
          } else {
            const safeV = cloneVertex(v);
            weldedV.push(safeV);
            vertexMap.set(v.id, v.id);
          }
        });

        const staticEdges: Edge[] = [];
        const movedEdges: Edge[] = [];
        State.edges.forEach((e) => {
          const v1Mapped = vertexMap.get(e.v1Id)!;
          const v2Mapped = vertexMap.get(e.v2Id)!;
          if (v1Mapped === v2Mapped) return;
          const ne = new Edge(v1Mapped, v2Mapped, e.id);
          ne.type = e.type;
          ne.portalDirection = e.portalDirection;
          ne.textureId = e.textureId;
          ne.targetEdgeId = e.targetEdgeId;
          if (
            State.selectedVertices.has(e.v1Id) ||
            State.selectedVertices.has(e.v2Id)
          )
            movedEdges.push(ne);
          else staticEdges.push(ne);
        });

        const newSelection = new Set<UUID>();
        State.selectedVertices.forEach((vid) => {
          const mapped = vertexMap.get(vid);
          if (mapped) newSelection.add(mapped);
        });

        const nextState = computeStateAfterEdges(
          weldedV,
          staticEdges,
          movedEdges,
        );
        State.History!.execute(
          new GeometryChangeCommand(
            initialDragStateSnapshot.v,
            initialDragStateSnapshot.e,
            nextState.newV,
            nextState.newE,
            State.selectedVertices,
            newSelection,
            initialDragStateSnapshot.ent,
            State.entities.map(cloneEntity),
          ),
        );
        initialDragStateSnapshot = null;
      }
      break;
    }
  }
});

canvas.addEventListener("dblclick", (e) => {
  if (e.button !== 0) return;
  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);

  if (State.currentTool === TOOLS.DRAG) {
    const hitEdge = findEdgeAt(world);
    if (hitEdge) {
      const snapW = getMagneticSnapPosition(world, new Set(), SNAP);
      const newVId = getOrCreateVertexInPool(
        State.vertices,
        snapW[0],
        snapW[1],
      );
      const e1 = new Edge(hitEdge.v1Id, newVId);
      e1.type = hitEdge.type;
      e1.portalDirection = hitEdge.portalDirection;
      e1.textureId = hitEdge.textureId;
      e1.targetEdgeId = hitEdge.targetEdgeId;
      const e2 = new Edge(newVId, hitEdge.v2Id);
      e2.type = hitEdge.type;
      e2.portalDirection = hitEdge.portalDirection;
      e2.textureId = hitEdge.textureId;
      e2.targetEdgeId = hitEdge.targetEdgeId;
      const nextE = State.edges.filter((x) => x.id !== hitEdge.id);
      nextE.push(e1, e2);
      const state = computeStateAfterEdges(State.vertices, nextE, []);
      const oldV = State.vertices.map(cloneVertex);
      const oldE = State.edges.map(cloneEdge);
      State.History!.execute(
        new GeometryChangeCommand(
          oldV,
          oldE,
          state.newV,
          state.newE,
          State.selectedVertices,
          State.selectedVertices,
        ),
      );
      State.selectedFaceId.clear();
      State.selectedEdgeId.clear();
      State.selectedVertices.clear();
      State.selectedVertices.add(newVId);
      UI.updatePropertiesPanel();
    }
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const screen = getMouseCoords(e);
    const wM = worldFromMouse(screen[0], screen[1]);
    State.zoom =
      e.deltaY < 0
        ? Math.min(MAX_ZOOM, State.zoom * 1.12)
        : Math.max(MIN_ZOOM, State.zoom / 1.12);
    State.offsetX = screen[0] / State.zoom - wM[0];
    State.offsetY = screen[1] / State.zoom - wM[1];
  },
  { passive: false },
);

// =========================
// INSPECTOR -> STATE
// =========================
window.addEventListener("orc_inspector_change", (ev) => {
  const e = ev as CustomEvent<InspectorChangeDetail>;
  const { id, values } = e.detail;
  if (id === "room_inspector" && State.selectedFaceId.size > 0) {
    State.faces.forEach((f) => {
      if (State.selectedFaceId.has(f.id)) {
        f.floorHeight = Number(values.floorHeight);
        f.ceilHeight = Number(values.ceilHeight);
        f.floorColor = String(values.floorColor);
        f.ceilColor = String(values.ceilColor);
      }
    });
    saveEditorStateToStorage();
  } else if (id === "wall_inspector" && State.selectedEdgeId.size > 0) {
    State.edges.forEach((edge) => {
      if (State.selectedEdgeId.has(edge.id)) {
        edge.type = values.type as Edge["type"];
        edge.portalDirection =
          values.portalDirection as Edge["portalDirection"];
        edge.textureId = Number(values.textureId);
      }
    });
    saveEditorStateToStorage();
  } else if (id === "vertex_inspector" && State.selectedVertices.size > 0) {
    State.vertices.forEach((v) => {
      if (State.selectedVertices.has(v.id)) {
        v.zFloorOffset = Number(values.zFloorOffset);
        v.zCeilOffset = Number(values.zCeilOffset);
      }
    });
    saveEditorStateToStorage();
  } else if (id === "entity_inspector" && State.selectedEntityIds.size > 0) {
    State.entities.forEach((ent) => {
      if (State.selectedEntityIds.has(ent.id)) {
        ent.type = values.type as Entity["type"];
        ent.angle = Number(values.angle);
      }
    });
    saveEditorStateToStorage();
  }
});

window.addEventListener("orc_inspector_action", (ev) => {
  const e = ev as CustomEvent<InspectorActionDetail>;
  const { id, action } = e.detail;
  if (
    id === "wall_inspector" &&
    action === "action_disconnect" &&
    State.selectedEdgeId.size > 0
  ) {
    const nextE = State.edges.map(cloneEdge);
    State.selectedEdgeId.forEach((selectedId) => {
      const sEdge = nextE.find((edge) => edge.id === selectedId);
      if (sEdge && sEdge.targetEdgeId) {
        nextE.forEach((edge) => {
          if (edge.targetEdgeId === sEdge.id || edge.id === sEdge.targetEdgeId)
            edge.targetEdgeId = null;
        });
        sEdge.targetEdgeId = null;
      }
    });
    State.History!.execute(
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

// =========================
// MOBILE TOUCH
// =========================
let initialPinchDistance: number | null = null;
let initialZoomState: number | null = null;

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          bubbles: true,
        }),
      );
    } else if (e.touches.length === 2) {
      if (isMouseDown)
        window.dispatchEvent(
          new MouseEvent("mouseup", { button: 0, bubbles: true }),
        );
      isPanning = true;
      const t1 = e.touches[0]!,
        t2 = e.touches[1]!;
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
      const t = e.touches[0]!;
      canvas.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          bubbles: true,
        }),
      );
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0]!,
        t2 = e.touches[1]!;
      const currentCenter: Vec2 = [
        (t1.clientX + t2.clientX) / 2,
        (t1.clientY + t2.clientY) / 2,
      ];
      const currentDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      State.offsetX += (currentCenter[0] - panLastScreen[0]) / State.zoom;
      State.offsetY += (currentCenter[1] - panLastScreen[1]) / State.zoom;
      panLastScreen = currentCenter;
      if (
        initialPinchDistance &&
        initialPinchDistance > 0 &&
        initialZoomState !== null
      ) {
        const rect = canvas.getBoundingClientRect();
        const zoomCenterScreen: Vec2 = [
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
    const t = e.changedTouches[0]!;
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: t.clientX,
        clientY: t.clientY,
        button: 0,
        bubbles: true,
      }),
    );
  }
});

// =========================
// RENDER LOOP
// =========================
function render(): void {
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

  // Faces
  State.faces.forEach((face) => {
    if (!face.outerComponent) return;
    ctx.beginPath();
    let currEdge = face.outerComponent;
    let first = true;
    do {
      const v = getV(State.vertices, currEdge.originId);
      if (v) {
        if (first) {
          ctx.moveTo(v.x, v.y);
          first = false;
        } else ctx.lineTo(v.x, v.y);
      }
      if (!currEdge.next) break;
      currEdge = currEdge.next;
    } while (currEdge && currEdge !== face.outerComponent);

    ctx.fillStyle = face.floorColor + "99";
    ctx.fill();
    if (State.selectedFaceId.has(face.id)) {
      ctx.fillStyle = "rgba(0, 150, 255, 0.2)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 2 / State.zoom;
      ctx.stroke();
    }
    ctx.fill();

    if (State.showTriangulationWireframes && face.outerComponent) {
      const perimeterVertices: Vertex[] = [];
      let loopEdge = face.outerComponent;
      const start = loopEdge;
      do {
        const v = getV(State.vertices, loopEdge.originId);
        if (v) perimeterVertices.push(v);
        if (!loopEdge.next) break;
        loopEdge = loopEdge.next;
      } while (loopEdge && loopEdge !== start);
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

  // Portal connections (curved)
  ctx.lineWidth = 2 / State.zoom;
  State.edges.forEach((edge) => {
    if (edge.type === "portal" && edge.targetEdgeId) {
      const target = State.edges.find((e) => e.id === edge.targetEdgeId);
      if (target && edge.id < target.id) {
        const v1 = getV(State.vertices, edge.v1Id),
          v2 = getV(State.vertices, edge.v2Id);
        const tv1 = getV(State.vertices, target.v1Id),
          tv2 = getV(State.vertices, target.v2Id);
        if (v1 && v2 && tv1 && tv2) {
          const m1X = (v1.x + v2.x) / 2,
            m1Y = (v1.y + v2.y) / 2;
          const m2X = (tv1.x + tv2.x) / 2,
            m2Y = (tv1.y + tv2.y) / 2;
          ctx.beginPath();
          ctx.strokeStyle = "rgba(68, 255, 255, 0.25)";
          ctx.setLineDash([4 / State.zoom, 8 / State.zoom]);
          ctx.moveTo(m1X, m1Y);
          const cpX = (m1X + m2X) / 2 + (m2Y - m1Y) * 0.2;
          const cpY = (m1Y + m2Y) / 2 - (m2X - m1X) * 0.2;
          ctx.quadraticCurveTo(cpX, cpY, m2X, m2Y);
          ctx.stroke();
        }
      }
    }
  });

  if (isMouseDown && draggingPortalId) {
    const sEdge = State.edges.find((e) => e.id === draggingPortalId);
    if (sEdge) {
      const v1 = getV(State.vertices, sEdge.v1Id),
        v2 = getV(State.vertices, sEdge.v2Id);
      if (v1 && v2) {
        const m1X = (v1.x + v2.x) / 2,
          m1Y = (v1.y + v2.y) / 2;
        ctx.beginPath();
        ctx.strokeStyle = "#44ffff";
        ctx.setLineDash([6 / State.zoom, 6 / State.zoom]);
        ctx.moveTo(m1X, m1Y);
        ctx.lineTo(currentRawMouse[0], currentRawMouse[1]);
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);

  // Entities
  State.entities.forEach((ent) => {
    ctx.beginPath();
    ctx.arc(ent.x, ent.y, 8 / State.zoom, 0, 2 * Math.PI);
    if (ent.type === "PlayerSpawn") ctx.fillStyle = "#00ff00";
    else if (ent.type === "Enemy") ctx.fillStyle = "#ff0000";
    else if (ent.type === "Light") ctx.fillStyle = "#ffff00";
    else ctx.fillStyle = "#aa00aa";
    if (State.selectedEntityIds.has(ent.id)) {
      ctx.lineWidth = 3 / State.zoom;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ent.x, ent.y);
    const aRad = ent.angle * (Math.PI / 180);
    ctx.lineTo(
      ent.x + (Math.cos(aRad) * 16) / State.zoom,
      ent.y + (Math.sin(aRad) * 16) / State.zoom,
    );
    ctx.lineWidth = 2 / State.zoom;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  });

  // Edges
  State.edges.forEach((edge) => {
    const v1 = getV(State.vertices, edge.v1Id),
      v2 = getV(State.vertices, edge.v2Id);
    if (!v1 || !v2) return;

    let isLoose = true;
    const hEdges = State.halfEdges.filter((he) => he.edge.id === edge.id);
    if (hEdges.some((he) => he.face !== null)) isLoose = false;

    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);

    const standsSelected =
      State.selectedVertices.has(edge.v1Id) &&
      State.selectedVertices.has(edge.v2Id);
    ctx.lineWidth = standsSelected ? 3.5 / State.zoom : 2 / State.zoom;

    if (edge.type === "portal") {
      ctx.strokeStyle = standsSelected ? "#ff4444" : "#44ffff";
      ctx.setLineDash([4 / State.zoom, 4 / State.zoom]);
    } else if (edge.type === "door") {
      ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffaa00";
      ctx.setLineDash([]);
    } else {
      if (isLoose) {
        ctx.strokeStyle = standsSelected ? "#ff4444" : "#ff00ff";
        ctx.setLineDash([8 / State.zoom, 8 / State.zoom]);
      } else {
        ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffffff";
        ctx.setLineDash([]);
      }
    }

    if (edge.id === hoveredEdgeId || State.selectedEdgeId.has(edge.id)) {
      ctx.strokeStyle = "#ffd966";
      ctx.lineWidth = 4 / State.zoom;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (edge.type === "portal") {
      const midX = (v1.x + v2.x) / 2,
        midY = (v1.y + v2.y) / 2;
      const dx = v2.x - v1.x,
        dy = v2.y - v1.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = -dy / len,
          ny = dx / len;
        const arrowLen = 12 / State.zoom,
          headLen = 6 / State.zoom;
        const drawArrow = (dirX: number, dirY: number) => {
          const angle = Math.atan2(dirY, dirX);
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
        const pDir = edge.portalDirection || "both";
        if (pDir === "both" || pDir === "forward") drawArrow(nx, ny);
        if (pDir === "both" || pDir === "backward") drawArrow(-nx, -ny);
      }
    }
  });

  // Selection bounds
  if (State.selectedVertices.size > 1) {
    ctx.fillStyle = "rgba(255, 68, 68, 0.04)";
    ctx.strokeStyle = "rgba(255, 68, 68, 0.2)";
    ctx.lineWidth = 1 / State.zoom;
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    State.selectedVertices.forEach((vid) => {
      const v = getV(State.vertices, vid);
      if (v) {
        xMin = Math.min(xMin, v.x);
        xMax = Math.max(xMax, v.x);
        yMin = Math.min(yMin, v.y);
        yMax = Math.max(yMax, v.y);
      }
    });
    ctx.fillRect(xMin - 6, yMin - 6, xMax - xMin + 12, yMax - yMin + 12);
    ctx.strokeRect(xMin - 6, yMin - 6, xMax - xMin + 12, yMax - yMin + 12);
  }

  // Vertices
  State.vertices.forEach((v) => {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 4 / State.zoom, 0, 2 * Math.PI);
    if (State.selectedVertices.has(v.id)) ctx.fillStyle = "#ff4444";
    else if (v.zFloorOffset !== 0 || v.zCeilOffset !== 0)
      ctx.fillStyle = "#ffaa00";
    else ctx.fillStyle = "#44ff88";
    ctx.fill();
    ctx.lineWidth = 1 / State.zoom;
    ctx.strokeStyle = "#ffffff";
    if (v.id === hoveredVertexId) {
      ctx.fillStyle = "#ffffff";
      ctx.arc(v.x, v.y, 6 / State.zoom, 0, 2 * Math.PI);
    }
    ctx.stroke();
  });

  // Tool feedback
  const snapped = getMagneticSnapPosition(currentRawMouse, new Set(), SNAP);
  if (isMouseDown && State.currentTool === TOOLS.LINE && currentAnchorId) {
    const vAnchor = getV(State.vertices, currentAnchorId);
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

  if (isMouseDown && State.currentTool === TOOLS.NGON && currentAnchorId) {
    const vAnchor = getV(State.vertices, currentAnchorId);
    if (vAnchor) {
      const radius = Math.hypot(snapped[0] - vAnchor.x, snapped[1] - vAnchor.y);
      if (radius > 10) {
        const sidesInput = document.getElementById(
          "ngon-sides",
        ) as HTMLInputElement | null;
        const sides = Math.max(
          3,
          Math.min(12, parseInt(sidesInput?.value ?? "8") || 8),
        );
        ctx.save();
        ctx.setTransform(
          State.zoom,
          0,
          0,
          State.zoom,
          State.offsetX * State.zoom,
          State.offsetY * State.zoom,
        );
        ctx.beginPath();
        ctx.strokeStyle = "#ffd966";
        ctx.setLineDash([5 / State.zoom, 5 / State.zoom]);
        ctx.lineWidth = 2 / State.zoom;
        for (let i = 0; i <= sides; i++) {
          const ang = (i / sides) * Math.PI * 2;
          const px =
            Math.round((vAnchor.x + Math.cos(ang) * radius) / SNAP) * SNAP;
          const py =
            Math.round((vAnchor.y + Math.sin(ang) * radius) / SNAP) * SNAP;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }
}

function update(): void {
  render();
  requestAnimationFrame(update);
}

UI.init();
const hydrated = loadEditorStateFromStorage();
if (hydrated) {
  UI.updateToolUI();
  UI.updatePropertiesPanel();
} else {
  buildDCEL();
}
requestAnimationFrame(update);
