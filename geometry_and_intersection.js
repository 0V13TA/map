// =========================
// GEOMETRY & INTERSECTION PIPELINE
// =========================

import { Vertex, Edge } from "./relational_data_architecture.js";

/**
 * @param {number} offsetY
 * @param {number} offsetX
 * @param {number} zoom
 * @param {number} x
 * @param {number} y
 */
export function worldFromMouse(offsetX, offsetY, zoom, x, y) {
  return [x / zoom - offsetX, y / zoom - offsetY];
}
/**
 * @param {number} p
 * @param {number} SNAP
 */
export function snapPoint(p, SNAP) {
  return [Math.round(p[0] / SNAP) * SNAP, Math.round(p[1] / SNAP) * SNAP];
}

/**
 * @param {[number, number]} p
 */
export function isPointInSelectionBounds(p) {
  if (selectedVertices.size <= 1) return false;

  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;

  selectedVertices.forEach((vid) => {
    let v = getV(vertices, vid);
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

/**
 * @param {Vertex[]} vPool
 * @param {Edge} edge1
 * @param {Edge} edge2
 */
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

/**
 * @param {Vertex[]} vPool
 * @param {Edge[]} ePool
 * @param {Edge} newEdge
 */
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

/**
 * @param {Vertex[]} vertices
 * @param {[number, number]} p
 * @param {Edge} edge
 */
function distanceToEdge(vertices, p, edge) {
  let v1 = getV(vertices, edge.v1Id),
    v2 = getV(vertices, edge.v2Id);
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

/**
 * @param {Vertex[]} vertices
 * @param {[number, number]} wPos
 * @param {number} zoom
 * @param {number} r
 */
export function findVertexAt(vertices, wPos, zoom, r = 8 / zoom) {
  return (
    vertices.find((v) => Math.hypot(v.x - wPos[0], v.y - wPos[1]) < r) || null
  );
}

/**
 * @param {Vertex[]} vertices
 * @param {Edge[]} edges
 * @param {[number, number]} wPos
 * @param {number} zoom
 * @param {number} r
 */
export function findEdgeAt(vertices, edges, wPos, zoom, r = 8 / zoom) {
  return edges.find((e) => distanceToEdge(vertices, wPos, e) < r) || null;
}
