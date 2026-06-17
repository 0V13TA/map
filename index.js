import { TOOLS, ACTIONS } from "./enums_actions.js";
import { buildDCEL, isPointInFace } from "./DCEL.js";
import { CommandHistory, GeometryChangeCommand } from "./command_pattern.js";
import { UI } from "./ui.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import { State, loadEditorStateFromStorage } from "./state_persistence.js";
import {
  snapPoint,
  findEdgeAt,
  findVertexAt,
  worldFromMouse,
  computeStateAfterEdges,
  isPointInSelectionBounds,
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
      State.currentTool = TOOLS.LINE;
      break;
    case ACTIONS.SET_TOOL_SPLIT:
      State.currentTool = TOOLS.SPLIT;
      break;
    case ACTIONS.SET_TOOL_NGON:
      State.currentTool = TOOLS.NGON;
      break;
    case ACTIONS.SET_TOOL_ZOOM:
      State.currentTool = TOOLS.ZOOM;
      break;
    case ACTIONS.SET_TOOL_DRAG:
      State.currentTool = TOOLS.DRAG;
      break;
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
      if (State.selectedVertices.size > 0) {
        let nextE = State.edges.filter(
          (e) =>
            !State.selectedVertices.has(e.v1Id) &&
            !State.selectedVertices.has(e.v2Id),
        );
        let nextV = State.vertices.filter(
          (v) =>
            !State.selectedVertices.has(v.id) &&
            nextE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
        );
        State.History.execute(
          new GeometryChangeCommand(
            State.vertices,
            State.edges,
            nextV,
            nextE,
            State.selectedVertices,
            [],
          ),
        );
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
        let origV = State.vertices.map((v) => new Vertex(v.x, v.y, v.id));
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
          )
            movedEdges.push(new Edge(e.v1Id, e.v2Id, e.id));
          else staticEdges.push(e);
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
    v: State.vertices.map((v) => new Vertex(v.x, v.y, v.id)),
    e: State.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id)),
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
        let snapped = snapPoint(world, SNAP);
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
        let snapped = snapPoint(world, SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          State.vertices,
          snapped[0],
          snapped[1],
        );
      }
      break;

    case TOOLS.SPLIT:
      if (e.altKey) return;
      let hitEdge = findEdgeAt(world);
      if (hitEdge) {
        let snapW = snapPoint(world, SNAP);
        let newVId = getOrCreateVertexInPool(
          State.vertices,
          snapW[0],
          snapW[1],
        );
        let nextE = State.edges.filter((e) => e.id !== hitEdge.id);
        nextE.push(
          new Edge(hitEdge.v1Id, newVId),
          new Edge(newVId, hitEdge.v2Id),
        );
        let state = computeStateAfterEdges(State.vertices, nextE, []);

        State.History.execute(
          new GeometryChangeCommand(
            actionStartSnapshot.v, // Use pristine snapshot
            actionStartSnapshot.e,
            state.newV,
            state.newE,
            actionStartSnapshot.sel,
            State.selectedVertices,
          ),
        );
      }
      break;

    case TOOLS.DRAG:
      if (e.altKey) return;
      let grabV = findVertexAt(world);
      let grabE = findEdgeAt(world);
      initialDragStateSnapshot = {
        v: State.vertices.map((v) => new Vertex(v.x, v.y, v.id)),
        e: State.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id)),
      };

      if (grabV) {
        if (e.shiftKey) {
          if (State.selectedVertices.has(grabV.id))
            State.selectedVertices.delete(grabV.id);
          else State.selectedVertices.add(grabV.id);
        } else if (!State.selectedVertices.has(grabV.id)) {
          State.selectedVertices.clear();
          State.selectedVertices.add(grabV.id);
        }
      } else if (isPointInSelectionBounds(world)) {
        // Do nothing, let mousemove handle grouping drag
      } else if (grabE) {
        if (!e.shiftKey) State.selectedVertices.clear();
        State.selectedVertices.add(grabE.v1Id);
        State.selectedVertices.add(grabE.v2Id);
      } else {
        if (!e.shiftKey) State.selectedVertices.clear();
        isBoxSelecting = true;
        boxStartWorld = [...world];
      }
      break;

    case TOOLS.ROOM:
      if (e.altKey) return;
      State.selectedFaceId = null;
      for (let face of State.faces) {
        if (isPointInFace(world, face)) {
          State.selectedFaceId = face.id;
          break;
        }
      }
      UI.updatePropertiesPanel();
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
  const snapped = snapPoint(currentRawMouse, SNAP);

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
      if (isBoxSelecting) {
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
          v.x = Math.round(v.x / SNAP) * SNAP;
          v.y = Math.round(v.y / SNAP) * SNAP;
        });
        let staticEdges = [],
          movedEdges = [];
        State.edges.forEach((e) => {
          if (
            State.selectedVertices.has(e.v1Id) ||
            State.selectedVertices.has(e.v2Id)
          )
            movedEdges.push(new Edge(e.v1Id, e.v2Id, e.id));
          else staticEdges.push(e);
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

    // FIX 1: ALWAYS draw the base material color first so you can preview edits live!
    ctx.fillStyle = face.floorColor + "99"; // Add hex transparency (approx 60% alpha)
    ctx.fill();

    // Then layer the selection highlights on top
    if (State.selectedFaceId === face.id) {
      ctx.fillStyle = "rgba(0, 150, 255, 0.2)"; // Soft blue selection tint
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 2 / State.zoom;
      ctx.stroke();
    } else ctx.fillStyle = face.floorColor + "40";
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

  // Draw Edges
  State.edges.forEach((edge) => {
    let v1 = getV(State.vertices, edge.v1Id),
      v2 = getV(State.vertices, edge.v2Id);
    if (!v1 || !v2) return;
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    let standsSelected =
      State.selectedVertices.has(edge.v1Id) &&
      State.selectedVertices.has(edge.v2Id);
    ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffffff";
    ctx.lineWidth = standsSelected ? 3.5 / State.zoom : 2 / State.zoom;
    if (edge.id === hoveredEdgeId) {
      ctx.strokeStyle = "#ffd966";
      ctx.lineWidth = 4 / State.zoom;
    }
    ctx.stroke();
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
  State.vertices.forEach((v) => {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 4 / State.zoom, 0, 2 * Math.PI);
    ctx.fillStyle = State.selectedVertices.has(v.id) ? "#ff4444" : "#44ff88";
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
  let snapped = snapPoint(currentRawMouse, SNAP);
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
