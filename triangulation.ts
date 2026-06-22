// ==========================================
// EAR CLIPPING TRIANGULATION GEOMETRY ENGINE
// ==========================================

/**
 * Uses 2D cross-products to determine if a point sits inside a triangle triangle boundary.
 */
function isPointInTriangle(p, a, b, c) {
  const cross = (v1, v2, v3) =>
    (v2.x - v1.x) * (v3.y - v1.y) - (v2.y - v1.y) * (v3.x - v1.x);

  const hasNeg = cross(a, b, p) < 0 || cross(b, c, p) < 0 || cross(c, a, p) < 0;
  const hasPos = cross(a, b, p) > 0 || cross(b, c, p) > 0 || cross(c, a, p) > 0;

  return !(hasNeg && hasPos);
}

/**
 * Slices an ordered counter-clockwise array of perimeter points into an array of triangles.
 * Returns an array of vertex triplets: [[v1, v2, v3], [v1, v2, v3], ...]
 */
export function triangulatePolygonPerimeter(polygonVertices) {
  // Clean step: Filter out any consecutive duplicate vertices that break vector lines
  let cleaned = [];
  for (let i = 0; i < polygonVertices.length; i++) {
    let currV = polygonVertices[i];
    let nextV = polygonVertices[(i + 1) % polygonVertices.length];
    // If next vertex is at the exact same location, skip adding the duplicate segment
    if (Math.hypot(nextV.x - currV.x, nextV.y - currV.y) > 0.001) {
      cleaned.push(currV);
    }
  }

  let remaining = [...cleaned];
  let triangles = [];

  // Guard condition for degenerate structures
  if (remaining.length < 3) return triangles;

  // If it's already a perfect triangle, return it immediately
  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
    return triangles;
  }

  let safetyCounter = 0;
  const maxIterations = remaining.length * remaining.length;

  while (remaining.length > 3) {
    let earFound = false;
    const n = remaining.length;

    for (let i = 0; i < n; i++) {
      const prev = remaining[(i - 1 + n) % n];
      const curr = remaining[i];
      const next = remaining[(i + 1) % n];

      // Rule 1: Winding Check. In a Y-Down canvas, CCW convex turns are NEGATIVE.
      // We skip if the cross product is positive (reflex) or close to 0 (flat colinear lines).
      const crossProduct =
        (curr.x - prev.x) * (next.y - curr.y) -
        (curr.y - prev.y) * (next.x - curr.x);
      if (crossProduct >= -0.001) continue;

      // Rule 2: Point-In-Triangle Check. Ensure no remaining vertices puncture the ear candidate.
      let isEar = true;
      for (let j = 0; j < n; j++) {
        if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue;

        if (isPointInTriangle(remaining[j], prev, curr, next)) {
          isEar = false;
          break;
        }
      }

      // Snip the ear tip out of the polygon calculation
      if (isEar) {
        triangles.push([prev, curr, next]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }

    // Infinite loop escape hatch safety valve
    safetyCounter++;
    if (safetyCounter > maxIterations) {
      break;
    }

    if (!earFound) {
      break;
    }
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }

  return triangles;
}
