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

let offsetX = 0;
let offsetY = 0;
let zoom = 1.0;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20.0;
const SNAP = 10;

// =========================
// ENUMS & ACTIONS
// =========================
const TOOLS = {
  LINE: "line",
  SPLIT: "split",
  NGON: "ngon",
  ZOOM: "zoom",
  DRAG: "drag",
};
let currentTool = TOOLS.LINE;

const ACTIONS = {
  UNDO: "undo",
  REDO: "redo",
  DELETE_SELECTION: "delete_selection",
  ROTATE_SELECTION: "rotate_selection",
  SELECT_ALL: "select_all",
  SET_TOOL_LINE: "set_tool_line",
  SET_TOOL_SPLIT: "set_tool_split",
  SET_TOOL_NGON: "set_tool_ngon",
  SET_TOOL_ZOOM: "set_tool_zoom",
  SET_TOOL_DRAG: "set_tool_drag",
};

const DEFAULT_KEY_BINDINGS = {
  "Ctrl+KeyZ": ACTIONS.UNDO,
  "Ctrl+KeyY": ACTIONS.REDO,
  "Ctrl+KeyA": ACTIONS.SELECT_ALL,
  Delete: ACTIONS.DELETE_SELECTION,
  Backspace: ACTIONS.DELETE_SELECTION,
  KeyR: ACTIONS.ROTATE_SELECTION,
  Digit1: ACTIONS.SET_TOOL_LINE,
  Digit2: ACTIONS.SET_TOOL_SPLIT,
  Digit3: ACTIONS.SET_TOOL_NGON,
  Digit4: ACTIONS.SET_TOOL_ZOOM,
  Digit5: ACTIONS.SET_TOOL_DRAG,
};
let keyBindings = { ...DEFAULT_KEY_BINDINGS };

// =========================
// CORE RELATIONAL DATA ARCHITECTURE
// =========================
class Vertex {
  constructor(x, y, id = null) {
    this.id = id || crypto.randomUUID();
    this.x = x;
    this.y = y;
  }
}

class Edge {
  constructor(v1Id, v2Id, id = null) {
    this.id = id || crypto.randomUUID();
    this.v1Id = v1Id;
    this.v2Id = v2Id;
  }
}

let vertices = [];
let edges = [];
let selectedVertices = new Set();

const getV = (id) => vertices.find((v) => v.id === id);

function getOrCreateVertexInPool(vPool, x, y) {
  const existing = vPool.find((v) => Math.hypot(v.x - x, v.y - y) < 0.001);
  if (existing) return existing.id;
  const newV = new Vertex(x, y);
  vPool.push(newV);
  return newV.id;
}

function buildAdjacencyMap(vertexPool, edgePool) {
  const adjacency = new Map();
  vertexPool.forEach((v) => adjacency.set(v.id, []));

  edgePool.forEach((edge) => {
    if (adjacency.has(edge.v1Id)) adjacency.get(edge.v1Id).push(edge.id);
    if (adjacency.has(edge.v2Id)) adjacency.get(edge.v2Id).push(edge.id);
  });

  adjacency.forEach((connectedEdgeIds, centerVId) => {
    const centerV = vertexPool.find((v) => v.id === centerVId);
    connectedEdgeIds.sort((idA, idB) => {
      const edgeA = edgePool.find((e) => e.id === idA);
      const edgeB = edgePool.find((e) => e.id === idB);

      const targetAId = edgeA.v1Id === centerVId ? edgeA.v2Id : edgeA.v1Id;
      const targetA = vertexPool.find((v) => v.id === targetAId);
      const angleA = Math.atan2(targetA.y - centerV.y, targetA.x - centerV.x);

      const targetBId = edgeB.v1Id === centerVId ? edgeB.v2Id : edgeB.v1Id;
      const targetB = vertexPool.find((v) => v.id === targetBId);
      const angleB = Math.atan2(targetB.y - centerV.y, targetB.x - centerV.x);

      return angleA - angleB;
    });
  });
  return adjacency;
}

// =========================
// DCEL DATA STRUCTURES & EXTRACTOR
// =========================
class HalfEdge {
  constructor(edge, originId) {
    this.id = crypto.randomUUID();
    this.edge = edge;
    this.originId = originId;

    this.twin = null;
    this.next = null;
    this.prev = null;
    this.face = null;
  }
}

class Face {
  constructor() {
    this.id = crypto.randomUUID();
    this.outerComponent = null;

    // 3D Engine Properties
    this.floorHeight = 0;
    this.ceilHeight = 64;
    this.floorColor = "#555555";
    this.ceilColor = "#888888";
  }
}

// Add a global tracking variable near your other state variables
let selectedFaceId = null;

/** @type {HalfEdge[]} */
let halfEdges = [];
/** @type {Face[]} */
let faces = [];

/**
 * @param {[number, number]} p
 * @param {Face} face
 */
function isPointInFace(p, face) {
  let x = p[0],
    y = p[1];
  let inside = false;

  let curr = face.outerComponent;
  if (!curr) return false;

  do {
    let v1 = getV(curr.originId);
    let v2 = getV(curr.next.originId); // The destination of this half-edge

    // Ray-Casting algorithm core logic
    let intersect =
      v1.y > y !== v2.y > y &&
      x < ((v2.x - v1.x) * (y - v1.y)) / (v2.y - v1.y) + v1.x;

    if (intersect) inside = !inside;

    curr = curr.next;
  } while (curr && curr !== face.outerComponent);

  return inside;
}

function buildDCEL() {
  halfEdges = [];
  faces = [];

  // 1. Generate Twins
  edges.forEach((edge) => {
    const fHalf = new HalfEdge(edge, edge.v1Id);
    const bHalf = new HalfEdge(edge, edge.v2Id);
    fHalf.twin = bHalf;
    bHalf.twin = fHalf;
    halfEdges.push(fHalf, bHalf);
  });

  // 2. Wire Next/Prev via Adjacency Map
  const adjacencyMap = buildAdjacencyMap(vertices, edges);
  adjacencyMap.forEach((connectedEdgeIds, centerVertexId) => {
    const N = connectedEdgeIds.length;
    if (N === 0) return;

    for (let i = 0; i < N; i++) {
      const currentEdgeId = connectedEdgeIds[i];
      const prevIndex = (i - 1 + N) % N;
      const prevEdgeId = connectedEdgeIds[prevIndex];

      // INBOUND LANE: Belongs to currentEdgeId, and its destination is centerVertexId
      // (Destination is proven because its twin starts at centerVertexId)
      let inboundHalfEdge = halfEdges.find(
        (he) =>
          he.edge.id === currentEdgeId && he.twin.originId === centerVertexId,
      );

      // OUTBOUND LANE: Belongs to prevEdgeId, and its origin is centerVertexId
      let outboundHalfEdge = halfEdges.find(
        (he) => he.edge.id === prevEdgeId && he.originId === centerVertexId,
      );

      if (inboundHalfEdge && outboundHalfEdge) {
        inboundHalfEdge.next = outboundHalfEdge;
        outboundHalfEdge.prev = inboundHalfEdge;
      }
    }
  });

  // 3. Extract Faces
  const visited = new Set();

  halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id) || !startEdge.next) return;

    let currentEdge = startEdge;
    let loopEdges = [];
    let loopVertices = [];

    // Trace the loop
    do {
      visited.add(currentEdge.id);
      loopEdges.push(currentEdge);
      loopVertices.push(getV(currentEdge.originId));
      currentEdge = currentEdge.next;
    } while (
      currentEdge &&
      currentEdge !== startEdge &&
      !visited.has(currentEdge.id)
    );

    if (!currentEdge || currentEdge !== startEdge) return; // Broken loop (hanging wall)

    // Shoelace Formula to find Area (In Canvas, CCW is negative area)
    let signedArea = 0;
    const n = loopVertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = loopVertices[i];
      const v2 = loopVertices[(i + 1) % n];
      signedArea += v1.x * v2.y - v2.x * v1.y;
    }

    // Isolate actual rooms from the infinite void
    if (signedArea < -0.01) {
      const newFace = new Face();
      newFace.outerComponent = startEdge;
      loopEdges.forEach((edge) => (edge.face = newFace));
      faces.push(newFace);
    }
  });
}

// =========================
// COMMAND PATTERN ENGINE
// =========================
class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }
  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    buildDCEL();
  }
  undo() {
    if (this.undoStack.length === 0) return;
    const cmd = this.undoStack.pop();
    cmd.undo();
    this.redoStack.push(cmd);
    buildDCEL();
  }
  redo() {
    if (this.redoStack.length === 0) return;
    const cmd = this.redoStack.pop();
    cmd.execute();
    this.undoStack.push(cmd);
    buildDCEL();
  }
}
const History = new CommandHistory();

class GeometryChangeCommand {
  constructor(oldV, oldE, newV, newE, oldSel, newSel) {
    this.oldV = oldV.map((v) => new Vertex(v.x, v.y, v.id));
    this.oldE = oldE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    this.newV = newV.map((v) => new Vertex(v.x, v.y, v.id));
    this.newE = newE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
  }
  execute() {
    vertices = this.newV.map((v) => new Vertex(v.x, v.y, v.id));
    edges = this.newE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    selectedVertices = new Set(this.newSel);
  }
  undo() {
    vertices = this.oldV.map((v) => new Vertex(v.x, v.y, v.id));
    edges = this.oldE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    selectedVertices = new Set(this.oldSel);
  }
}

// =========================
// GEOMETRY & INTERSECTION PIPELINE
// =========================
function worldFromMouse(x, y) {
  return [x / zoom - offsetX, y / zoom - offsetY];
}
function snapPoint(p) {
  return [Math.round(p[0] / SNAP) * SNAP, Math.round(p[1] / SNAP) * SNAP];
}

function isPointInSelectionBounds(p) {
  if (selectedVertices.size <= 1) return false;

  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;

  selectedVertices.forEach((vid) => {
    let v = getV(vid);
    if (v) {
      xMin = Math.min(xMin, v.x);
      xMax = Math.max(xMax, v.x);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
  });

  // Expand the interaction bounds slightly (e.g., by 6 units) to match the visual padding in render()
  return (
    p[0] >= xMin - 6 && p[0] <= xMax + 6 && p[1] >= yMin - 6 && p[1] <= yMax + 6
  );
}

function getLineIntersection(vPool, edge1, edge2) {
  const v1 = vPool.find((v) => v.id === edge1.v1Id),
    v2 = vPool.find((v) => v.id === edge1.v2Id);
  const v3 = vPool.find((v) => v.id === edge2.v1Id),
    v4 = vPool.find((v) => v.id === edge2.v2Id);
  if (!v1 || !v2 || !v3 || !v4) return null;

  const p0_x = v1.x,
    p0_y = v1.y,
    p1_x = v2.x,
    p1_y = v2.y;
  const p2_x = v3.x,
    p2_y = v3.y,
    p3_x = v4.x,
    p3_y = v4.y;

  const s1_x = p1_x - p0_x,
    s1_y = p1_y - p0_y,
    s2_x = p3_x - p2_x,
    s2_y = p3_y - p2_y;
  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 0.0001) return null;

  const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / denom;
  const t = (s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / denom;

  if (s >= 0.001 && s <= 0.999 && t >= 0.001 && t <= 0.999) {
    return [
      Math.round((p0_x + t * s1_x) / SNAP) * SNAP,
      Math.round((p0_y + t * s1_y) / SNAP) * SNAP,
    ];
  }
  return null;
}

function processSplitting(vPool, ePool, newEdge) {
  const isDuplicate = ePool.some(
    (e) =>
      (e.v1Id === newEdge.v1Id && e.v2Id === newEdge.v2Id) ||
      (e.v1Id === newEdge.v2Id && e.v2Id === newEdge.v1Id),
  );
  if (isDuplicate) return ePool;

  let toRemove = [],
    toAdd = [],
    split = false;

  for (let existing of ePool) {
    let intPt = getLineIntersection(vPool, newEdge, existing);
    if (intPt) {
      let matchId = getOrCreateVertexInPool(vPool, intPt[0], intPt[1]);
      toRemove.push(existing.id, newEdge.id);

      // Generate the 4 new sliced pieces
      const subEdges = [
        new Edge(existing.v1Id, matchId),
        new Edge(matchId, existing.v2Id),
        new Edge(newEdge.v1Id, matchId),
        new Edge(matchId, newEdge.v2Id),
      ];

      subEdges.forEach((e) => {
        if (e.v1Id !== e.v2Id) toAdd.push(e);
      });

      split = true;
      break;
      break;
    }
  }
  if (split) {
    let filtered = ePool.filter((e) => !toRemove.includes(e.id));
    for (let sub of toAdd) filtered = processSplitting(vPool, filtered, sub);
    return filtered;
  } else {
    ePool.push(newEdge);
    return ePool;
  }
}

/**
 * @param {Vertex[]} currentVPool
 * @param {Edge[]} currentEPool
 * @param {Edge[]} newEdgesArray
 */
function computeStateAfterEdges(currentVPool, currentEPool, newEdgesArray) {
  let tempV = currentVPool.map((v) => new Vertex(v.x, v.y, v.id));
  let tempE = currentEPool.filter((e) => e.v1Id !== e.v2Id);

  newEdgesArray.forEach((ne) => {
    tempE = processSplitting(tempV, tempE, ne);
  });

  let clearV = tempV.filter((v) =>
    tempE.some((e) => e.v1Id === v.id || e.v2Id === v.id),
  );
  return { newV: clearV, newE: tempE };
}

function distanceToEdge(p, edge) {
  let v1 = getV(edge.v1Id),
    v2 = getV(edge.v2Id);
  if (!v1 || !v2) return Infinity;

  let x = p[0],
    y = p[1],
    x1 = v1.x,
    y1 = v1.y,
    x2 = v2.x,
    y2 = v2.y;
  let l2 = Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2);
  if (l2 === 0) return Math.hypot(x - x1, y - y1);
  let t = Math.max(
    0,
    Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2),
  );
  return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
}

function findVertexAt(wPos, r = 8 / zoom) {
  return (
    vertices.find((v) => Math.hypot(v.x - wPos[0], v.y - wPos[1]) < r) || null
  );
}
function findEdgeAt(wPos, r = 8 / zoom) {
  return edges.find((e) => distanceToEdge(wPos, e) < r) || null;
}

// =========================
// INPUT & KEYBOARD ROUTER
// =========================
window.addEventListener("keydown", (e) => {
  let modifierPrefix = "";
  if (e.ctrlKey || e.metaKey) modifierPrefix += "Ctrl+";

  const action = keyBindings[modifierPrefix + e.code];
  if (!action) return;
  e.preventDefault();

  switch (action) {
    case ACTIONS.UNDO:
      History.undo();
      break;
    case ACTIONS.REDO:
      History.redo();
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
          let v = getV(vid);
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
          let v = getV(vid);
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

function getMouseCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height),
  ];
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1) {
    isPanning = true;
    panLastScreen = [e.clientX, e.clientY];
    return;
  }
  if (e.button !== 0) return;

  isMouseDown = true;
  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);

  currentRawMouse = [...world];
  dragLastWorld = [...world];

  // Safety reset for boxing flags right as a new click begins
  isBoxSelecting = false;
  boxStartWorld = null;

  switch (currentTool) {
    case TOOLS.LINE:
      let hitV = findVertexAt(world);
      if (!hitV) {
        let snapped = snapPoint(world);
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
      if (!currentAnchorId) {
        let snapped = snapPoint(world);
        currentAnchorId = getOrCreateVertexInPool(
          vertices,
          snapped[0],
          snapped[1],
        );
      }
      break;

    case TOOLS.SPLIT:
      let hitEdge = findEdgeAt(world);
      if (hitEdge) {
        let snapW = snapPoint(world);
        let newVId = getOrCreateVertexInPool(vertices, snapW[0], snapW[1]);
        let nextE = edges.filter((e) => e.id !== hitEdge.id);
        nextE.push(
          new Edge(hitEdge.v1Id, newVId),
          new Edge(newVId, hitEdge.v2Id),
        );
        let state = computeStateAfterEdges(vertices, nextE, []);
        History.execute(
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
      let grabV = findVertexAt(world);
      let grabE = findEdgeAt(world);

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
    let hitV = findVertexAt(world);
    hoveredVertexId = hitV ? hitV.id : null;

    // Prioritize vertex hovering over edge hovering
    if (!hoveredVertexId) {
      let hitE = findEdgeAt(world);
      hoveredEdgeId = hitE ? hitE.id : null;
    } else {
      hoveredEdgeId = null;
    }
  }

  const screen = getMouseCoords(e);
  const world = worldFromMouse(screen[0], screen[1]);
  currentRawMouse = world;

  if (!isMouseDown) return;

  switch (currentTool) {
    case TOOLS.DRAG:
      if (isBoxSelecting) return;
      let dx = world[0] - dragLastWorld[0],
        dy = world[1] - dragLastWorld[1];
      selectedVertices.forEach((vid) => {
        let v = getV(vid);
        v.x += dx;
        v.y += dy;
      });
      break;

    case TOOLS.ZOOM:
      let zoomCenter = worldFromMouse(canvas.width / 2, canvas.height / 2);
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
  if (e.button === 1) {
    isPanning = false;
    return;
  }

  if (!isMouseDown) return;
  isMouseDown = false;
  const snapped = snapPoint(currentRawMouse);

  switch (currentTool) {
    case TOOLS.LINE:
      if (currentAnchorId) {
        let endVId;
        let hitV = findVertexAt(snapped);
        if (hitV) endVId = hitV.id;
        else endVId = getOrCreateVertexInPool(vertices, snapped[0], snapped[1]);

        if (currentAnchorId !== endVId) {
          let nextState = computeStateAfterEdges(vertices, edges, [
            new Edge(currentAnchorId, endVId),
          ]);
          History.execute(
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
        let anchorV = getV(currentAnchorId);
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
          let v = getV(vid);
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

  // REMOVED ALL GLOBAL RESETS FROM HERE
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const screen = getMouseCoords(e);
  const wM = worldFromMouse(screen[0], screen[1]);
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
  faces.forEach((face) => {
    ctx.beginPath();
    let currEdge = face.outerComponent;
    let first = true;
    do {
      let v = getV(currEdge.originId);
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
      // Use the face's assigned floor color, but add transparency (hex + "40")
      ctx.fillStyle = face.floorColor + "40";
    }
    ctx.fill();
  });

  edges.forEach((edge) => {
    let v1 = getV(edge.v1Id),
      v2 = getV(edge.v2Id);
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
      let v = getV(vid);
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

  let snapped = snapPoint(currentRawMouse);
  if (isMouseDown && currentTool === TOOLS.LINE && currentAnchorId) {
    let vAnchor = getV(currentAnchorId);
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
    let vAnchor = getV(currentAnchorId);
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
// SERIALIZATION PIPELINE
// =========================
function exportMapData() {
  const mapData = {
    version: "1.0",
    vertices: vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
    edges: edges.map((e) => ({ id: e.id, v1Id: e.v1Id, v2Id: e.v2Id })),
    sectors: faces.map((f) => ({
      id: f.id,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      anchorEdgeId: f.outerComponent.edge.id,
      anchorOriginId: f.outerComponent.originId,
    })),
  };

  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(mapData, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "orc_map_01.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importMapData(jsonString) {
  try {
    const mapData = JSON.parse(jsonString);
    if (!mapData.vertices || !mapData.edges)
      throw new Error("Invalid map format");

    vertices = mapData.vertices.map((v) => new Vertex(v.x, v.y, v.id));
    edges = mapData.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));

    selectedVertices.clear();
    selectedFaceId = null;
    History.undoStack = [];
    History.redoStack = [];

    buildDCEL();

    if (mapData.sectors) {
      mapData.sectors.forEach((savedSector) => {
        const anchorHE = halfEdges.find(
          (he) =>
            he.edge.id === savedSector.anchorEdgeId &&
            he.originId === savedSector.anchorOriginId,
        );
        if (anchorHE && anchorHE.face) {
          const liveFace = anchorHE.face;
          liveFace.id = savedSector.id;
          liveFace.floorHeight = savedSector.floorHeight;
          liveFace.ceilHeight = savedSector.ceilHeight;
          liveFace.floorColor = savedSector.floorColor;
          liveFace.ceilColor = savedSector.ceilColor;
        }
      });
    }
    offsetX = 0;
    offsetY = 0;
    zoom = 1.0;
  } catch (err) {
    console.error("Map Load Error:", err);
    alert("Failed to load map.");
  }
}

// =========================
// DYNAMIC UI COMPONENT ENGINE
// =========================
class UIBuilder {
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
const UI = {
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

  init() {
    this.toolButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTool = btn.getAttribute("data-tool");
        if (targetTool) {
          currentTool = TOOLS[targetTool.toUpperCase()];
          this.updateToolUI();
          this.updatePropertiesPanel();
        }
      });
    });

    this.undoBtn.addEventListener("click", () => {
      History.undo();
      this.updatePropertiesPanel();
    });
    this.redoBtn.addEventListener("click", () => {
      History.redo();
      this.updatePropertiesPanel();
    });
    this.deleteBtn.addEventListener("click", () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete" })),
    );
    this.rotateBtn.addEventListener("click", () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" })),
    );
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
  },

  updateToolUI() {
    this.toolButtons.forEach((btn) => {
      const btnTool = btn.getAttribute("data-tool");
      if (btnTool && TOOLS[btnTool.toUpperCase()] === currentTool)
        btn.classList.add("active");
      else btn.classList.remove("active");
    });
  },
};

UI.init();
