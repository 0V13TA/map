import type { Vertex } from "./model";

interface P { x: number; y: number }

function isPointInTriangle(p: P, a: P, b: P, c: P): boolean {
  const cross = (v1: P, v2: P, v3: P) =>
    (v2.x - v1.x) * (v3.y - v1.y) - (v2.y - v1.y) * (v3.x - v1.x);

  const hasNeg = cross(a, b, p) < 0 || cross(b, c, p) < 0 || cross(c, a, p) < 0;
  const hasPos = cross(a, b, p) > 0 || cross(b, c, p) > 0 || cross(c, a, p) > 0;
  return !(hasNeg && hasPos);
}

export function triangulatePolygonPerimeter(polygonVertices: Vertex[]): [Vertex, Vertex, Vertex][] {
  const cleaned: Vertex[] = [];
  for (let i = 0; i < polygonVertices.length; i++) {
    const currV = polygonVertices[i]!;
    const nextV = polygonVertices[(i + 1) % polygonVertices.length]!;
    if (Math.hypot(nextV.x - currV.x, nextV.y - currV.y) > 0.001) {
      cleaned.push(currV);
    }
  }

  const remaining = [...cleaned];
  const triangles: [Vertex, Vertex, Vertex][] = [];

  if (remaining.length < 3) return triangles;
  if (remaining.length === 3) {
    triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
    return triangles;
  }

  let safetyCounter = 0;
  const maxIterations = remaining.length * remaining.length;

  while (remaining.length > 3) {
    let earFound = false;
    const n = remaining.length;
    for (let i = 0; i < n; i++) {
      const prev = remaining[(i - 1 + n) % n]!;
      const curr = remaining[i]!;
      const next = remaining[(i + 1) % n]!;

      const crossProduct =
        (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
      if (crossProduct >= -0.001) continue;

      let isEar = true;
      for (let j = 0; j < n; j++) {
        if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue;
        if (isPointInTriangle(remaining[j]!, prev, curr, next)) {
          isEar = false;
          break;
        }
      }
      if (isEar) {
        triangles.push([prev, curr, next]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }

    safetyCounter++;
    if (safetyCounter > maxIterations) break;
    if (!earFound) break;
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  }
  return triangles;
}
