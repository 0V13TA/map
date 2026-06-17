import { TOOLS, ACTIONS, DEFAULT_KEY_BINDINGS } from "./enums_actions.js";
import { HalfEdge, Face, isPointInFace, buildDCEL } from "./DCEL.js";
import { GeometryChangeCommand, CommandHistory } from "./command_pattern.js";
import { UI } from "./ui.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import { loadEditorStateFromStorage } from "./state_persistence.js";

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

let currentTool = TOOLS.LINE;
let keyBindings = { ...DEFAULT_KEY_BINDINGS };
// =========================
// CANVAS SETUP & WORLD
// =========================
let SCREEN_WIDTH = Math.floor(window.innerWidth * 0.99);
let SCREEN_HEIGHT = Math.floor(window.innerHeight * 0.99);

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
canvas.width = SCREEN_WIDTH;
canvas.height = SCREEN_HEIGHT;
document.body.appendChild(canvas);

let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;
const SNAP = 10;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20.0;

window.addEventListener("resize", () => {
  SCREEN_WIDTH = Math.floor(window.innerWidth * 0.99);
  SCREEN_HEIGHT = Math.floor(window.innerHeight * 0.99);
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
});

/** @type {Vertex[]} */
let vertices = [];
/** @type {Edge[]} */
let edges = [];
/** @type {Set<Vertex>} */
let selectedVertices = new Set();

// Add a global tracking variable near your other state variables
let selectedFaceId = null;

/** @type {HalfEdge[]} */
let halfEdges = [];
/** @type {Face[]} */
let faces = [];

// =========================
// COMMAND PATTERN ENGINE
// =========================

const History = new CommandHistory();

// =========================
// INPUT & KEYBOARD ROUTER
// =========================
canvas.addEventListener("keydown", (e) => {
  let modifierPrefix = "";
  if (e.ctrlKey || e.metaKey) modifierPrefix += "Ctrl+";

  const action = keyBindings[modifierPrefix + e.code];
  if (!action) return;
  e.preventDefault();

  switch (action) {
    case ACTIONS.UNDO:
      History.undo(halfEdges, faces, edges, vertices);
      break;
    case ACTIONS.REDO:
      History.redo(halfEdges, faces, edges, vertices);
      break;
    case ACTIONS.SELECT_ALL:
      selectedVertices.clear();
      vertices.forEach((v) => selectedVertices.add(v.id));
      break;
    case ACTIONS.SET_TOOL_LINE:
      currentTool = TOOLS.LINE;
      break;
    case ACTIONS.SET_TOOL_SPLIT:
      currentTool = TOOLS.SPLIT;
      break;
    case ACTIONS.SET_TOOL_NGON:
      currentTool = TOOLS.NGON;
      break;
    case ACTIONS.SET_TOOL_ZOOM:
      currentTool = TOOLS.ZOOM;
      break;
    case ACTIONS.SET_TOOL_DRAG:
      currentTool = TOOLS.DRAG;
      break;
    case ACTIONS.PAN_UP:
      offsetY += 40 / zoom;
      break;
    case ACTIONS.PAN_DOWN:
      offsetY -= 40 / zoom;
      break;
    case ACTIONS.PAN_LEFT:
      offsetX += 40 / zoom;
      break;
    case ACTIONS.PAN_RIGHT:
      offsetX -= 40 / zoom;
      break;

    case ACTIONS.DELETE_SELECTION:
      if (selectedVertices.size > 0) {
        let nextE = edges.filter(
          (e) => !selectedVertices.has(e.v1Id) && !selectedVertices.has(e.v2Id),
        );
        let nextV = vertices.filter(
          (v) =>
            !selectedVertices.has(v.id) &&
            nextE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
        );
        History.execute(
          halfEdges,
          faces,
          edges,
          vertices,
          selectedVertices,
          new GeometryChangeCommand(
            vertices,
            edges,
            nextV,
            nextE,
            selectedVertices,
            [],
          ),
        );
      }
      break;

    case ACTIONS.ROTATE_SELECTION:
      if (selectedVertices.size > 0) {
        let cx = 0,
          cy = 0;
        selectedVertices.forEach((vid) => {
          let v = getV(vertices, vid);
          cx += v.x;
          cy += v.y;
        });
        cx /= selectedVertices.size;
        cy /= selectedVertices.size;

        let angle = 15 * (Math.PI / 180);

        // Take snapshots for the Undo History
        let origV = vertices.map((v) => new Vertex(v.x, v.y, v.id));
        let origE = edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));

        // Apply mathematical rotation to the live vertices
        selectedVertices.forEach((vid) => {
          let v = getV(vertices, vid);
          let dx = v.x - cx,
            dy = v.y - cy;
          v.x = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
          v.y = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
        });

        // FIX 3: Separate edges to trigger clean intersections during rotation!
        let staticEdges = [];
        let movedEdges = [];
        edges.forEach((e) => {
          if (selectedVertices.has(e.v1Id) || selectedVertices.has(e.v2Id)) {
            movedEdges.push(new Edge(e.v1Id, e.v2Id, e.id));
          } else {
            staticEdges.push(e);
          }
        });

        let state = computeStateAfterEdges(vertices, staticEdges, movedEdges);
        History.execute(
          halfEdges,
          faces,
          edges,
          vertices,
          selectedVertices,
          new GeometryChangeCommand(
            origV,
            origE,
            state.newV,
            state.newE,
            selectedVertices,
            selectedVertices,
          ),
        );
      }
      break;
  }
});

// =========================
// MOUSE TOOL STATE DRIVER
// =========================
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
let showTriangulationWireframes = false;

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
  const world = worldFromMouse(offsetX, offsetY, zoom, screen[0], screen[1]);

  currentRawMouse = [...world];
  dragLastWorld = [...world];

  // Safety reset for boxing flags right as a new click begins
  isBoxSelecting = false;
  boxStartWorld = null;

  switch (currentTool) {
    case TOOLS.LINE:
      if (e.altKey) return;
      let hitV = findVertexAt(vertices, world, zoom);
      if (!hitV) {
        let snapped = snapPoint(world, SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          vertices,
          snapped[0],
          snapped[1],
        );
      } else {
        currentAnchorId = hitV.id;
      }
      break;

    case TOOLS.NGON:
      if (e.altKey) return;
      if (!currentAnchorId) {
        let snapped = snapPoint(world, SNAP);
        currentAnchorId = getOrCreateVertexInPool(
          vertices,
          snapped[0],
          snapped[1],
        );
      }
      break;

    case TOOLS.SPLIT:
      if (e.altKey) return;
      let hitEdge = findEdgeAt(vertices, edges, world, zoom);
      if (hitEdge) {
        let snapW = snapPoint(world, SNAP);
        let newVId = getOrCreateVertexInPool(vertices, snapW[0], snapW[1]);
        let nextE = edges.filter((e) => e.id !== hitEdge.id);
        nextE.push(
          new Edge(hitEdge.v1Id, newVId),
          new Edge(newVId, hitEdge.v2Id),
        );
        let state = computeStateAfterEdges(vertices, nextE, []);
        History.execute(
          halfEdges,
          faces,
          edges,
          vertices,
          selectedVertices,
          new GeometryChangeCommand(
            vertices,
            edges,
            state.newV,
            state.newE,
            selectedVertices,
            selectedVertices,
          ),
        );
      }
      break;

    case TOOLS.DRAG:
      if (e.altKey) return;
      let grabV = findVertexAt(vertices, world, zoom);
      let grabE = findEdgeAt(vertices, edges, world, zoom);

      initialDragStateSnapshot = {
        v: vertices.map((v) => new Vertex(v.x, v.y, v.id)),
        e: edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id)),
      };

      if (grabV) {
        if (e.shiftKey) {
          if (selectedVertices.has(grabV.id)) selectedVertices.delete(grabV.id);
          else selectedVertices.add(grabV.id);
        } else {
          if (!selectedVertices.has(grabV.id)) {
            selectedVertices.clear();
            selectedVertices.add(grabV.id);
          }
        }
      } else if (isPointInSelectionBounds(world)) {
        // NEW QUALITY OF LIFE:
        // Clicked inside the active bounding box group!
        // Do nothing to the selection set, just fall through to allow mousemove dragging.
        if (e.shiftKey) {
          // If shift clicking inside the box, let's keep the group but not select anything else
        }
      } else if (grabE) {
        if (!e.shiftKey) selectedVertices.clear();
        selectedVertices.add(grabE.v1Id);
        selectedVertices.add(grabE.v2Id);
      } else {
        if (!e.shiftKey) selectedVertices.clear();
        isBoxSelecting = true;
        boxStartWorld = [...world];
      }
      break;

    case TOOLS.ROOM:
      if (e.altKey) return;
      selectedFaceId = null; // Clear previous selection

      // Check every extracted face in the map
      for (let face of faces) {
        if (isPointInFace(world, face)) {
          selectedFaceId = face.id;
          break;
        }
      }

      // Tell the UI to update the properties panel based on the selection
      UI.updatePropertiesPanel();
      break;
  }
});

canvas.addEventListener("mousemove", (e) => {
  const screen = getMouseCoords(e);
  const world = worldFromMouse(offsetX, offsetY, zoom, screen[0], screen[1]);
  currentRawMouse = world;

  if (isPanning) {
    let dx = e.clientX - panLastScreen[0];
    let dy = e.clientY - panLastScreen[1];
    offsetX += dx / zoom; // Divide by zoom so panning is 1:1 with world space
    offsetY += dy / zoom;
    panLastScreen = [e.clientX, e.clientY];
    return;
  }

  // Calculate hover state when just moving the mouse around freely
  if (!isMouseDown) {
    let hitV = findVertexAt(vertices, world, zoom);
    hoveredVertexId = hitV ? hitV.id : null;

    // Prioritize vertex hovering over edge hovering
    if (!hoveredVertexId) {
      let hitE = findEdgeAt(vertices, edges, world, zoom);
      hoveredEdgeId = hitE ? hitE.id : null;
    } else {
      hoveredEdgeId = null;
    }
  }

  if (!isMouseDown) return;

  switch (currentTool) {
    case TOOLS.DRAG:
      if (isBoxSelecting) return;
      let dx = world[0] - dragLastWorld[0],
        dy = world[1] - dragLastWorld[1];
      selectedVertices.forEach((vid) => {
        let v = getV(vertices, vid);
        v.x += dx;
        v.y += dy;
      });
      break;

    case TOOLS.ZOOM:
      let zoomCenter = worldFromMouse(
        offsetX,
        offsetY,
        zoom,
        canvas.width / 2,
        canvas.height / 2,
      );
      zoom =
        e.movementY < 0
          ? Math.min(MAX_ZOOM, zoom * 1.03)
          : Math.max(MIN_ZOOM, zoom / 1.03);
      offsetX = canvas.width / 2 / zoom - zoomCenter[0];
      offsetY = canvas.height / 2 / zoom - zoomCenter[1];
      break;
  }
  dragLastWorld = [...world];
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0 && e.altKey) {
    isPanning = false;
    return;
  }

  if (!isMouseDown) return;
  isMouseDown = false;
  const snapped = snapPoint(currentRawMouse, SNAP);

  switch (currentTool) {
    case TOOLS.LINE:
      if (currentAnchorId) {
        let endVId;
        let hitV = findVertexAt(vertices, snapped, zoom);
        if (hitV) endVId = hitV.id;
        else endVId = getOrCreateVertexInPool(vertices, snapped[0], snapped[1]);

        if (currentAnchorId !== endVId) {
          let nextState = computeStateAfterEdges(vertices, edges, [
            new Edge(currentAnchorId, endVId),
          ]);
          History.execute(
            halfEdges,
            faces,
            edges,
            vertices,
            selectedVertices,
            new GeometryChangeCommand(
              vertices,
              edges,
              nextState.newV,
              nextState.newE,
              selectedVertices,
              selectedVertices,
            ),
          );
        }
      }
      currentAnchorId = null; // Reset line anchor ONLY here after drawing commits
      break;

    case TOOLS.NGON:
      if (currentAnchorId) {
        let anchorV = getV(vertices, currentAnchorId);
        let radius = Math.hypot(snapped[0] - anchorV.x, snapped[1] - anchorV.y);
        if (radius > 10) {
          let sidesInput = document.getElementById("ngon-sides").value;
          let sides = Math.max(3, Math.min(12, parseInt(sidesInput) || 8));
          let ngonEdges = [],
            firstVId = null,
            prevVId = null;

          for (let i = 0; i < sides; i++) {
            let ang = (i / sides) * Math.PI * 2;
            let vx =
              Math.round((anchorV.x + Math.cos(ang) * radius) / SNAP) * SNAP;
            let vy =
              Math.round((anchorV.y + Math.sin(ang) * radius) / SNAP) * SNAP;
            let currVId = getOrCreateVertexInPool(vertices, vx, vy);
            if (i === 0) firstVId = currVId;
            if (prevVId) ngonEdges.push(new Edge(prevVId, currVId));
            prevVId = currVId;
          }
          ngonEdges.push(new Edge(prevVId, firstVId));
          let nextState = computeStateAfterEdges(vertices, edges, ngonEdges);
          History.execute(
            halfEdges,
            faces,
            edges,
            vertices,
            selectedVertices,
            new GeometryChangeCommand(
              vertices,
              edges,
              nextState.newV,
              nextState.newE,
              selectedVertices,
              selectedVertices,
            ),
          );
        }
      }
      currentAnchorId = null; // Reset ngon anchor ONLY here after geometry commits
      break;

    case TOOLS.DRAG:
      if (isBoxSelecting) {
        let xMin = Math.min(boxStartWorld[0], currentRawMouse[0]),
          xMax = Math.max(boxStartWorld[0], currentRawMouse[0]);
        let yMin = Math.min(boxStartWorld[1], currentRawMouse[1]),
          yMax = Math.max(boxStartWorld[1], currentRawMouse[1]);
        vertices.forEach((v) => {
          if (v.x >= xMin && v.x <= xMax && v.y >= yMin && v.y <= yMax)
            selectedVertices.add(v.id);
        });
        isBoxSelecting = false;
        boxStartWorld = null;
      } else if (initialDragStateSnapshot) {
        selectedVertices.forEach((vid) => {
          let v = getV(vertices, vid);
          v.x = Math.round(v.x / SNAP) * SNAP;
          v.y = Math.round(v.y / SNAP) * SNAP;
        });

        let staticEdges = [];
        let movedEdges = [];
        edges.forEach((e) => {
          if (selectedVertices.has(e.v1Id) || selectedVertices.has(e.v2Id)) {
            movedEdges.push(new Edge(e.v1Id, e.v2Id, e.id));
          } else {
            staticEdges.push(e);
          }
        });

        let nextState = computeStateAfterEdges(
          vertices,
          staticEdges,
          movedEdges,
        );
        History.execute(
          halfEdges,
          faces,
          edges,
          vertices,
          selectedVertices,
          new GeometryChangeCommand(
            initialDragStateSnapshot.v,
            initialDragStateSnapshot.e,
            nextState.newV,
            nextState.newE,
            selectedVertices,
            selectedVertices,
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
  const wM = worldFromMouse(offsetX, offsetY, zoom, screen[0], screen[1]);
  zoom =
    e.deltaY < 0
      ? Math.min(MAX_ZOOM, zoom * 1.12)
      : Math.max(MIN_ZOOM, zoom / 1.12);
  offsetX = screen[0] / zoom - wM[0];
  offsetY = screen[1] / zoom - wM[1];
});

// =========================
// GRAPHICS RENDER LOOP
// =========================
function drawGrid() {
  const left = -offsetX,
    right = -offsetX + canvas.width / zoom,
    top = -offsetY,
    bottom = -offsetY + canvas.height / zoom;
  ctx.lineWidth = 1 / zoom;
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
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(zoom, 0, 0, zoom, offsetX * zoom, offsetY * zoom);
  drawGrid();

  // Draw Faces visually via DCEL structure
  // Draw Faces visually via DCEL structure
  faces.forEach((face) => {
    ctx.beginPath();
    let currEdge = face.outerComponent;
    let first = true;
    do {
      let v = getV(vertices, currEdge.originId);
      if (first) {
        ctx.moveTo(v.x, v.y);
        first = false;
      } else {
        ctx.lineTo(v.x, v.y);
      }
      currEdge = currEdge.next;
    } while (currEdge && currEdge !== face.outerComponent);

    // Check if this specific face is selected
    if (selectedFaceId === face.id) {
      ctx.fillStyle = "rgba(0, 150, 255, 0.4)"; // Bright Blue Highlight
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 2 / zoom;
      ctx.stroke();
    } else {
      ctx.fillStyle = face.floorColor + "40";
    }
    ctx.fill();

    // ==========================================
    // LIVE TRIANGULATION WIREFRAME VISUALIZER
    // ==========================================
    if (showTriangulationWireframes) {
      // Gather the perimeter point sequence for this specific face
      let perimeterVertices = [];
      let loopEdge = face.outerComponent;
      do {
        let v = getV(vertices, loopEdge.originId);
        if (v) perimeterVertices.push(v);
        loopEdge = loopEdge.next;
      } while (loopEdge && loopEdge !== face.outerComponent);

      // Run your Ear-Clipping math kernels on the fly
      const triangles = triangulatePolygonPerimeter(perimeterVertices);

      // Draw the interior diagnostic lines
      ctx.save();
      ctx.strokeStyle = "rgba(255, 165, 0, 0.35)"; // Thin orange diagnostic lines
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([2 / zoom, 4 / zoom]); // Dashed blueprint aesthetic

      triangles.forEach(([v1, v2, v3]) => {
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

  edges.forEach((edge) => {
    let v1 = getV(vertices, edge.v1Id),
      v2 = getV(vertices, edge.v2Id);
    if (!v1 || !v2) return;
    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    let standsSelected =
      selectedVertices.has(edge.v1Id) && selectedVertices.has(edge.v2Id);
    ctx.strokeStyle = standsSelected ? "#ff4444" : "#ffffff";
    ctx.lineWidth = standsSelected ? 3.5 / zoom : 2 / zoom;

    if (edge.id === hoveredEdgeId) {
      ctx.strokeStyle = "#ffd966"; // Bright yellow glow
      ctx.lineWidth = 4 / zoom;
    }

    ctx.stroke();
  });

  if (selectedVertices.size > 1) {
    ctx.fillStyle = "rgba(255, 68, 68, 0.04)";
    ctx.strokeStyle = "rgba(255, 68, 68, 0.2)";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    let bounds = {
      xMin: Infinity,
      xMax: -Infinity,
      yMin: Infinity,
      yMax: -Infinity,
    };
    selectedVertices.forEach((vid) => {
      let v = getV(vertices, vid);
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

  vertices.forEach((v) => {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 4 / zoom, 0, 2 * Math.PI);
    ctx.fillStyle = selectedVertices.has(v.id) ? "#ff4444" : "#44ff88";
    ctx.fill();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = "#ffffff";

    if (v.id === hoveredVertexId) {
      ctx.fillStyle = "#ffffff";
      ctx.arc(v.x, v.y, 6 / zoom, 0, 2 * Math.PI); // Draw it slightly larger
    }

    ctx.stroke();
  });

  let snapped = snapPoint(currentRawMouse, SNAP);
  if (isMouseDown && currentTool === TOOLS.LINE && currentAnchorId) {
    let vAnchor = getV(vertices, currentAnchorId);
    if (vAnchor) {
      ctx.beginPath();
      ctx.strokeStyle = "#ffd966";
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.lineWidth = 2 / zoom;
      ctx.moveTo(vAnchor.x, vAnchor.y);
      ctx.lineTo(snapped[0], snapped[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (isMouseDown && currentTool === TOOLS.NGON && currentAnchorId) {
    let vAnchor = getV(vertices, currentAnchorId);
    if (vAnchor) {
      let r = Math.hypot(snapped[0] - vAnchor.x, snapped[1] - vAnchor.y);
      let sidesInput = document.getElementById("ngon-sides").value;
      let sides = Math.max(3, Math.min(12, parseInt(sidesInput) || 8));

      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        let ang = (i / sides) * Math.PI * 2;
        let vx = Math.round((vAnchor.x + Math.cos(ang) * r) / SNAP) * SNAP;
        let vy = Math.round((vAnchor.y + Math.sin(ang) * r) / SNAP) * SNAP;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.strokeStyle = "#99f3ff";
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (isMouseDown && isBoxSelecting && boxStartWorld) {
    ctx.fillStyle = "rgba(0, 160, 255, 0.08)";
    ctx.strokeStyle = "rgba(0, 160, 255, 0.5)";
    ctx.lineWidth = 1 / zoom;
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
}

function update() {
  render();
  requestAnimationFrame(update);
}
requestAnimationFrame(update);

// =========================
// DYNAMIC UI COMPONENT ENGINE
// =========================

UI.init();

// Initialize or Hydrate existing Session
const hydrated = loadEditorStateFromStorage();
if (hydrated) {
  console.log("ORC Mesh Engine session rehydrated successfully.");
  UI.updateToolUI();
  UI.updatePropertiesPanel();
} else {
  buildDCEL(halfEdges, faces, edges, vertices);
}
