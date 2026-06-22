import { Edge, Vertex, cloneVertex, getOrCreateVertexInPool, getV } from "./model";
import { State } from "../state/state";
import type { UUID, Vec2 } from "./types";

export const HIT_RADIUS =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? 28 : 8;

export function findPortalArrowAt(wPos: Vec2, r: number = HIT_RADIUS / State.zoom): Edge | null {
  for (const edge of State.edges) {
    if (edge.type !== "portal") continue;
    const v1 = getV(State.vertices, edge.v1Id);
    const v2 = getV(State.vertices, edge.v2Id);
    if (!v1 || !v2) continue;

    const midX = (v1.x + v2.x) / 2;
    const midY = (v1.y + v2.y) / 2;
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      const pDir = edge.portalDirection || "both";
      const arrowLen = 12 / State.zoom;
      if (pDir === "both" || pDir === "forward") {
        const tipX = midX + nx * arrowLen;
        const tipY = midY + ny * arrowLen;
        if (Math.hypot(wPos[0] - tipX, wPos[1] - tipY) < r) return edge;
      }
      if (pDir === "both" || pDir === "backward") {
        const tipX = midX - nx * arrowLen;
        const tipY = midY - ny * arrowLen;
        if (Math.hypot(wPos[0] - tipX, wPos[1] - tipY) < r) return edge;
      }
    }
  }
  return null;
}

export function worldFromMouse(x: number, y: number): Vec2 {
  return [x / State.zoom - State.offsetX, y / State.zoom - State.offsetY];
}

export function snapPoint(p: Vec2, SNAP: number): Vec2 {
  return [Math.round(p[0] / SNAP) * SNAP, Math.round(p[1] / SNAP) * SNAP];
}

export function isPointInSelectionBounds(p: Vec2): boolean {
  if (State.selectedVertices.size <= 1) return false;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  State.selectedVertices.forEach((vid) => {
    const v = getV(State.vertices, vid);
    if (v) {
      xMin = Math.min(xMin, v.x);
      xMax = Math.max(xMax, v.x);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
  });
  return p[0] >= xMin - 6 && p[0] <= xMax + 6 && p[1] >= yMin - 6 && p[1] <= yMax + 6;
}

function getLineIntersection(vPool: Vertex[], edge1: Edge, edge2: Edge): Vec2 | null {
  const v1 = vPool.find((v) => v.id === edge1.v1Id);
  const v2 = vPool.find((v) => v.id === edge1.v2Id);
  const v3 = vPool.find((v) => v.id === edge2.v1Id);
  const v4 = vPool.find((v) => v.id === edge2.v2Id);
  if (!v1 || !v2 || !v3 || !v4) return null;

  const s1_x = v2.x - v1.x, s1_y = v2.y - v1.y;
  const s2_x = v4.x - v3.x, s2_y = v4.y - v3.y;
  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 0.0001) return null;

  const s = (-s1_y * (v1.x - v3.x) + s1_x * (v1.y - v3.y)) / denom;
  const t = (s2_x * (v1.y - v3.y) - s2_y * (v1.x - v3.x)) / denom;

  if (s >= 0.001 && s <= 0.999 && t >= 0.001 && t <= 0.999) {
    return [
      Math.round((v1.x + t * s1_x) / 10) * 10,
      Math.round((v1.y + t * s1_y) / 10) * 10,
    ];
  }
  return null;
}

function processSplitting(vPool: Vertex[], ePool: Edge[], newEdge: Edge): Edge[] {
  const isDuplicate = ePool.some(
    (e) =>
      (e.v1Id === newEdge.v1Id && e.v2Id === newEdge.v2Id) ||
      (e.v1Id === newEdge.v2Id && e.v2Id === newEdge.v1Id),
  );
  if (isDuplicate) return ePool;

  const toRemove: UUID[] = [];
  const toAdd: Edge[] = [];
  let split = false;
  for (const existing of ePool) {
    const intPt = getLineIntersection(vPool, newEdge, existing);
    if (intPt) {
      const matchId = getOrCreateVertexInPool(vPool, intPt[0], intPt[1]);
      toRemove.push(existing.id, newEdge.id);
      const subEdges: Edge[] = [
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
    }
  }
  if (split) {
    let filtered = ePool.filter((e) => !toRemove.includes(e.id));
    for (const sub of toAdd) filtered = processSplitting(vPool, filtered, sub);
    return filtered;
  }
  ePool.push(newEdge);
  return ePool;
}

export function computeStateAfterEdges(
  currentVPool: Vertex[],
  currentEPool: Edge[],
  newEdgesArray: Edge[],
): { newV: Vertex[]; newE: Edge[] } {
  const tempV = currentVPool.map(cloneVertex);
  let tempE = currentEPool.filter((e) => e.v1Id !== e.v2Id);

  newEdgesArray.forEach((ne) => {
    tempE = processSplitting(tempV, tempE, ne);
  });

  const clearV = tempV.filter((v) => tempE.some((e) => e.v1Id === v.id || e.v2Id === v.id));
  return { newV: clearV, newE: tempE };
}

function distanceToEdge(vertices: Vertex[], p: Vec2, edge: Edge): number {
  const v1 = getV(vertices, edge.v1Id);
  const v2 = getV(vertices, edge.v2Id);
  if (!v1 || !v2) return Infinity;
  const l2 = Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2);
  if (l2 === 0) return Math.hypot(p[0] - v1.x, p[1] - v1.y);
  const t = Math.max(0, Math.min(1, ((p[0] - v1.x) * (v2.x - v1.x) + (p[1] - v1.y) * (v2.y - v1.y)) / l2));
  return Math.hypot(p[0] - (v1.x + t * (v2.x - v1.x)), p[1] - (v1.y + t * (v2.y - v1.y)));
}

export function findVertexAt(wPos: Vec2, r: number = HIT_RADIUS / State.zoom): Vertex | null {
  return State.vertices.find((v) => Math.hypot(v.x - wPos[0], v.y - wPos[1]) < r) ?? null;
}

export function findEdgeAt(wPos: Vec2, r: number = HIT_RADIUS / State.zoom): Edge | null {
  return State.edges.find((e) => distanceToEdge(State.vertices, wPos, e) < r) ?? null;
}

export function getMagneticSnapPosition(p: Vec2, ignoreVertexIds: Set<UUID>, snapGridSize: number): Vec2 {
  const snapRadius = HIT_RADIUS / State.zoom;

  for (const v of State.vertices) {
    if (ignoreVertexIds.has(v.id)) continue;
    if (Math.hypot(v.x - p[0], v.y - p[1]) < snapRadius) {
      return [v.x, v.y];
    }
  }

  let minDistance = snapRadius;
  let closestPoint: Vec2 | null = null;
  for (const edge of State.edges) {
    if (ignoreVertexIds.has(edge.v1Id) || ignoreVertexIds.has(edge.v2Id)) continue;
    const v1 = getV(State.vertices, edge.v1Id);
    const v2 = getV(State.vertices, edge.v2Id);
    if (!v1 || !v2) continue;
    const l2 = Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2);
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - v1.x) * (v2.x - v1.x) + (p[1] - v1.y) * (v2.y - v1.y)) / l2));
    const projX = v1.x + t * (v2.x - v1.x);
    const projY = v1.y + t * (v2.y - v1.y);
    const dist = Math.hypot(p[0] - projX, p[1] - projY);
    if (dist < minDistance) {
      minDistance = dist;
      closestPoint = [projX, projY];
    }
  }
  if (closestPoint) return closestPoint;
  return [Math.round(p[0] / snapGridSize) * snapGridSize, Math.round(p[1] / snapGridSize) * snapGridSize];
}
