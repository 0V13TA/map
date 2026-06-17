import {
  getV,
  Edge,
  Vertex,
  buildAdjacencyMap,
} from "./relational_data_architecture.js";

// =========================
// DCEL DATA STRUCTURES & EXTRACTOR
// =========================
export class HalfEdge {
  /**
   * @param {Edge} edge
   * @param {UUID} originId
   */
  constructor(edge, originId) {
    /** @type {UUID} */
    this.id = crypto.randomUUID();
    /** @type {Edge} */
    this.edge = edge;
    /** @type {UUID} */
    this.originId = originId;

    /** @type {HalfEdge | null} */
    this.twin = null;
    /** @type {HalfEdge | null} */
    this.next = null;
    /** @type {HalfEdge | null} */
    this.prev = null;
    /** @type {HalfEdge | null} */
    this.face = null;
  }
}

export class Face {
  constructor() {
    /** @type {UUID} */
    this.id = crypto.randomUUID();
    /** @type {HalfEdge | null} */
    this.outerComponent = null;

    // 3D Engine Properties
    /** @type {number} */
    this.floorHeight = 0;
    /** @type {number} */
    this.ceilHeight = 64;
    /** @type {string} */
    this.floorColor = "#555555";
    /** @type {string} */
    this.ceilColor = "#888888";
  }
}

/**
 * @param {[number, number]} p
 * @param {Face} face
 */
export function isPointInFace(p, face) {
  let x = p[0],
    y = p[1];
  let inside = false;

  let curr = face.outerComponent;
  if (!curr) return false;

  do {
    let v1 = getV(vertices, curr.originId);
    let v2 = getV(vertices, curr.next.originId); // The destination of this half-edge

    // Ray-Casting algorithm core logic
    let intersect =
      v1.y > y !== v2.y > y &&
      x < ((v2.x - v1.x) * (y - v1.y)) / (v2.y - v1.y) + v1.x;

    if (intersect) inside = !inside;

    curr = curr.next;
  } while (curr && curr !== face.outerComponent);

  return inside;
}

/**
 * @param {HalfEdge[]} halfEdges
 * @param {Face[]} faces
 * @param {Edge[]} edges
 * @param {Vertex[]} vertices
 */
export function buildDCEL(halfEdges, faces, edges, vertices) {
  /** @type {HalfEdge[]} */
  halfEdges = [];
  /** @type {Face[]} */
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
      const prevIndex = (i + 1) % N;
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
  /** @type {Set<HalfEdge>} */
  const visited = new Set();

  halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id) || !startEdge.next) return;

    let currentEdge = startEdge;
    /** @type {HalfEdge[]} */
    let loopEdges = [];
    /** @type {Vertex[]} */
    let loopVertices = [];

    // Trace the loop
    do {
      visited.add(currentEdge.id);
      loopEdges.push(currentEdge);
      loopVertices.push(getV(vertices, currentEdge.originId));
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
