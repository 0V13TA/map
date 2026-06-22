import { buildAdjacencyMap, generateUUID, getV } from "./model";
import type { Edge, Vertex } from "./model";
import { State } from "../state/state";
import type { UUID, Vec2 } from "./types";

export class HalfEdge {
  id: UUID;
  edge: Edge;
  originId: UUID;
  twin: HalfEdge | null = null;
  next: HalfEdge | null = null;
  prev: HalfEdge | null = null;
  face: Face | null = null;

  constructor(edge: Edge, originId: UUID) {
    this.id = generateUUID();
    this.edge = edge;
    this.originId = originId;
  }
}

export class Face {
  id: UUID;
  outerComponent: HalfEdge | null = null;
  floorHeight = 0;
  ceilHeight = 64;
  floorColor = "#555555";
  ceilColor = "#888888";

  constructor() {
    this.id = generateUUID();
  }
}

export function isPointInFace(p: Vec2, face: Face): boolean {
  const x = p[0];
  const y = p[1];
  let inside = false;
  const start = face.outerComponent;
  if (!start) return false;
  let curr: HalfEdge = start;
  do {
    const v1 = getV(State.vertices, curr.originId);
    const nextHe = curr.next;
    if (!nextHe) break;
    const v2 = getV(State.vertices, nextHe.originId);
    if (v1 && v2) {
      const intersect =
        v1.y > y !== v2.y > y &&
        x < ((v2.x - v1.x) * (y - v1.y)) / (v2.y - v1.y) + v1.x;
      if (intersect) inside = !inside;
    }
    curr = nextHe;
  } while (curr && curr !== start);
  return inside;
}

export function buildDCEL(): void {
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
      const currentEdgeId = connectedEdgeIds[i]!;
      const prevEdgeId = connectedEdgeIds[(i + 1) % N]!;

      const inboundHalfEdge = State.halfEdges.find(
        (he) => he.edge.id === currentEdgeId && he.twin!.originId === centerVertexId,
      );
      const outboundHalfEdge = State.halfEdges.find(
        (he) => he.edge.id === prevEdgeId && he.originId === centerVertexId,
      );

      if (inboundHalfEdge && outboundHalfEdge) {
        inboundHalfEdge.next = outboundHalfEdge;
        outboundHalfEdge.prev = inboundHalfEdge;
      }
    }
  });

  const visited = new Set<UUID>();
  State.halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id) || !startEdge.next) return;

    let currentEdge: HalfEdge | null = startEdge;
    const loopEdges: HalfEdge[] = [];
    const loopVertices: Vertex[] = [];

    do {
      if (!currentEdge) break;
      visited.add(currentEdge.id);
      loopEdges.push(currentEdge);
      const v = getV(State.vertices, currentEdge.originId);
      if (v) loopVertices.push(v);
      currentEdge = currentEdge.next;
    } while (currentEdge && currentEdge !== startEdge && !visited.has(currentEdge.id));

    if (!currentEdge || currentEdge !== startEdge) return;

    let signedArea = 0;
    const n = loopVertices.length;
    for (let i = 0; i < n; i++) {
      const a = loopVertices[i]!;
      const b = loopVertices[(i + 1) % n]!;
      signedArea += a.x * b.y - b.x * a.y;
    }

    if (signedArea < -0.01) {
      const newFace = new Face();
      newFace.outerComponent = startEdge;
      loopEdges.forEach((edge) => (edge.face = newFace));

      const matchIndex = oldFaces.findIndex(
        (oldF) =>
          oldF.outerComponent &&
          loopEdges.some((e) => e.edge.id === oldF.outerComponent!.edge.id),
      );

      if (matchIndex !== -1) {
        const match = oldFaces[matchIndex]!;
        newFace.id = match.id;
        newFace.floorHeight = match.floorHeight;
        newFace.ceilHeight = match.ceilHeight;
        newFace.floorColor = match.floorColor;
        newFace.ceilColor = match.ceilColor;
        oldFaces.splice(matchIndex, 1);
      }

      State.faces.push(newFace);
    }
  });
}
