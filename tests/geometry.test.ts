import test from "node:test";
import assert from "node:assert/strict";

import { buildDCEL } from "../DCEL.js";
import { State } from "../state_persistence.js";
import { Edge, Vertex } from "../relational_data_architecture.js";
import { triangulatePolygonPerimeter } from "../triangulation.js";

function resetGeometry() {
  State.vertices = [];
  State.edges = [];
  State.faces = [];
  State.halfEdges = [];
  State.selectedVertices.clear();
  State.selectedFaceId.clear();
  State.selectedEdgeId.clear();
  State.selectedEntityIds.clear();
}

test("triangulatePolygonPerimeter slices a rectangle into two triangles", () => {
  const vertices = [
    new Vertex(0, 0),
    new Vertex(0, 10),
    new Vertex(10, 10),
    new Vertex(10, 0),
  ];

  const triangles = triangulatePolygonPerimeter(vertices);

  assert.equal(triangles.length, 2);
  assert.ok(triangles.every((triangle) => triangle.length === 3));
});

test("buildDCEL extracts one clockwise room face from a square", () => {
  resetGeometry();

  const a = new Vertex(0, 0);
  const b = new Vertex(0, 10);
  const c = new Vertex(10, 10);
  const d = new Vertex(10, 0);

  State.vertices = [a, b, c, d];
  State.edges = [
    new Edge(a.id, b.id),
    new Edge(b.id, c.id),
    new Edge(c.id, d.id),
    new Edge(d.id, a.id),
  ];

  buildDCEL();

  assert.equal(State.faces.length, 1);
  assert.equal(State.faces[0].floorHeight, 0);
  assert.equal(State.faces[0].ceilHeight, 64);
});
