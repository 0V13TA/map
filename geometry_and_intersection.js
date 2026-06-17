// =========================
// GEOMETRY & INTERSECTION PIPELINE
// =========================
import {
  Vertex,
  Edge,
  getV,
  getOrCreateVertexInPool,
} from "./relational_data_architecture.js";
import { State } from "./state_persistence.js";

export function worldFromMouse(x, y) {
  return [x / State.zoom - State.offsetX, y / State.zoom - State.offsetY];
}

export function snapPoint(p, SNAP) {
  return [Math.round(p[0] / SNAP) * SNAP, Math.round(p[1] / SNAP) * SNAP];
}

export function isPointInSelectionBounds(p) {
  if (State.selectedVertices.size <= 1) return false;

  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  State.selectedVertices.forEach((vid) => {
    let v = getV(State.vertices, vid);
    if (v) {
      xMin = Math.min(xMin, v.x);
      xMax = Math.max(xMax, v.x);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
  });

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

  const s1_x = v2.x - v1.x,
    s1_y = v2.y - v1.y,
    s2_x = v4.x - v3.x,
    s2_y = v4.y - v3.y;
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

export function computeStateAfterEdges(
  currentVPool,
  currentEPool,
  newEdgesArray,
) {
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

function distanceToEdge(vertices, p, edge) {
  let v1 = getV(vertices, edge.v1Id),
    v2 = getV(vertices, edge.v2Id);
  if (!v1 || !v2) return Infinity;

  let l2 = Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2);
  if (l2 === 0) return Math.hypot(p[0] - v1.x, p[1] - v1.y);
  let t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - v1.x) * (v2.x - v1.x) + (p[1] - v1.y) * (v2.y - v1.y)) / l2,
    ),
  );
  return Math.hypot(
    p[0] - (v1.x + t * (v2.x - v1.x)),
    p[1] - (v1.y + t * (v2.y - v1.y)),
  );
}

export function findVertexAt(wPos, r = 8 / State.zoom) {
  return (
    State.vertices.find((v) => Math.hypot(v.x - wPos[0], v.y - wPos[1]) < r) ||
    null
  );
}

export function findEdgeAt(wPos, r = 8 / State.zoom) {
  return (
    State.edges.find((e) => distanceToEdge(State.vertices, wPos, e) < r) || null
  );
}
