import {
  getV,
  buildAdjacencyMap,
  generateUUID,
} from "./relational_data_architecture.js";
import { State } from "./state_persistence.js";

// =========================
// DCEL DATA STRUCTURES & EXTRACTOR
// =========================
export class HalfEdge {
  constructor(edge, originId) {
    this.id = generateUUID();
    this.edge = edge;
    this.originId = originId;
    this.twin = null;
    this.next = null;
    this.prev = null;
    this.face = null;
  }
}

export class Face {
  constructor() {
    this.id = generateUUID();
    this.outerComponent = null;
    this.floorHeight = 0;
    this.ceilHeight = 64;
    this.floorColor = "#555555";
    this.ceilColor = "#888888";
  }
}

export function isPointInFace(p, face) {
  let x = p[0],
    y = p[1],
    inside = false;
  let curr = face.outerComponent;
  if (!curr) return false;

  do {
    let v1 = getV(State.vertices, curr.originId);
    let v2 = getV(State.vertices, curr.next.originId);
    let intersect =
      v1.y > y !== v2.y > y &&
      x < ((v2.x - v1.x) * (y - v1.y)) / (v2.y - v1.y) + v1.x;
    if (intersect) inside = !inside;
    curr = curr.next;
  } while (curr && curr !== face.outerComponent);

  return inside;
}

export function buildDCEL() {
  // 1. Create the consumable pool FIRST
  const oldFaces = [...State.faces];

  State.halfEdges.length = 0;
  State.faces.length = 0;

  State.edges.forEach((edge) => {
    const fHalf = new HalfEdge(edge, edge.v1Id);
    const bHalf = new HalfEdge(edge, edge.v2Id);
    fHalf.twin = bHalf;
    bHalf.twin = fHalf;
    State.halfEdges.push(fHalf, bHalf);
  });

  const adjacencyMap = buildAdjacencyMap(State.vertices, State.edges);
  adjacencyMap.forEach((connectedEdgeIds, centerVertexId) => {
    const N = connectedEdgeIds.length;
    if (N === 0) return;

    for (let i = 0; i < N; i++) {
      const currentEdgeId = connectedEdgeIds[i];
      const prevEdgeId = connectedEdgeIds[(i + 1) % N];

      let inboundHalfEdge = State.halfEdges.find(
        (he) =>
          he.edge.id === currentEdgeId && he.twin.originId === centerVertexId,
      );
      let outboundHalfEdge = State.halfEdges.find(
        (he) => he.edge.id === prevEdgeId && he.originId === centerVertexId,
      );

      if (inboundHalfEdge && outboundHalfEdge) {
        inboundHalfEdge.next = outboundHalfEdge;
        outboundHalfEdge.prev = inboundHalfEdge;
      }
    }
  });

  const visited = new Set();
  State.halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id) || !startEdge.next) return;

    let currentEdge = startEdge;
    let loopEdges = [];
    let loopVertices = [];

    do {
      visited.add(currentEdge.id);
      loopEdges.push(currentEdge);
      loopVertices.push(getV(State.vertices, currentEdge.originId));
      currentEdge = currentEdge.next;
    } while (
      currentEdge &&
      currentEdge !== startEdge &&
      !visited.has(currentEdge.id)
    );

    if (!currentEdge || currentEdge !== startEdge) return;

    let signedArea = 0;
    const n = loopVertices.length;
    for (let i = 0; i < n; i++) {
      signedArea +=
        loopVertices[i].x * loopVertices[(i + 1) % n].y -
        loopVertices[(i + 1) % n].x * loopVertices[i].y;
    }

    if (signedArea < -0.01) {
      const newFace = new Face();
      newFace.outerComponent = startEdge;
      loopEdges.forEach((edge) => (edge.face = newFace));

      // 2. PRESERVE PROPERTIES: Apply the consumable pool logic here, before pushing!
      const matchIndex = oldFaces.findIndex(
        (oldF) =>
          oldF.outerComponent &&
          loopEdges.some((e) => e.edge.id === oldF.outerComponent.edge.id),
      );

      if (matchIndex !== -1) {
        const match = oldFaces[matchIndex];
        newFace.id = match.id; // Keep the same identity
        newFace.floorHeight = match.floorHeight;
        newFace.ceilHeight = match.ceilHeight;
        newFace.floorColor = match.floorColor;
        newFace.ceilColor = match.ceilColor;

        // Remove it so adjacent rooms don't steal the exact same identity!
        oldFaces.splice(matchIndex, 1);
      }

      State.faces.push(newFace);
    }
  });
}
