// =========================
// SERIALIZATION PIPELINE
// =========================
import { State } from "./state_persistence.js";
import { getV, Vertex, Edge } from "./relational_data_architecture.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import { buildDCEL } from "./DCEL.js";

export function exportMapData() {
  const TEXTURE_SCALE = 64.0;

  const exportSectors = State.faces.map((f) => {
    let perimeterVertices = [];
    let currEdge = f.outerComponent;
    do {
      let v = getV(State.vertices, currEdge.originId);
      if (v) perimeterVertices.push(v);
      currEdge = currEdge.next;
    } while (currEdge && currEdge !== f.outerComponent);

    const indices2D = triangulatePolygonPerimeter(perimeterVertices);

    let flatFloorTriangles = [];
    let flatCeilTriangles = [];

    indices2D.forEach(([v1, v2, v3]) => {
      flatFloorTriangles.push({
        positions: [
          v1.x,
          f.floorHeight,
          v1.y,
          v2.x,
          f.floorHeight,
          v2.y,
          v3.x,
          f.floorHeight,
          v3.y,
        ],
        uvs: [
          v1.x / TEXTURE_SCALE,
          v1.y / TEXTURE_SCALE,
          v2.x / TEXTURE_SCALE,
          v2.y / TEXTURE_SCALE,
          v3.x / TEXTURE_SCALE,
          v3.y / TEXTURE_SCALE,
        ],
      });
      flatCeilTriangles.push({
        positions: [
          v1.x,
          f.ceilHeight,
          v1.y,
          v3.x,
          f.ceilHeight,
          v3.y,
          v2.x,
          f.ceilHeight,
          v2.y,
        ],
        uvs: [
          v1.x / TEXTURE_SCALE,
          v1.y / TEXTURE_SCALE,
          v3.x / TEXTURE_SCALE,
          v3.y / TEXTURE_SCALE,
          v2.x / TEXTURE_SCALE,
          v2.y / TEXTURE_SCALE,
        ],
      });
    });

    return {
      id: f.id,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      anchorEdgeId: f.outerComponent?.edge?.id,
      anchorOriginId: f.outerComponent?.originId,
      mesh3D: {
        floorTriangles: flatFloorTriangles,
        ceilTriangles: flatCeilTriangles,
      },
    };
  });

  const mapData = {
    version: "1.0",
    vertices: State.vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
    edges: State.edges.map((e) => ({
      id: e.id,
      v1Id: e.v1Id,
      v2Id: e.v2Id,
      type: e.type,
      portalDirection: e.portalDirection,
    })),
    sectors: exportSectors,
  };

  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(mapData, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "orc_map_3d_ready.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

export function importMapData(jsonString) {
  try {
    const mapData = JSON.parse(jsonString);
    if (!mapData.vertices || !mapData.edges)
      throw new Error("Invalid map format");

    State.vertices = mapData.vertices.map((v) => new Vertex(v.x, v.y, v.id));
    State.edges = mapData.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));

    State.selectedVertices.clear();
    State.selectedFaceId = null;
    State.History.undoStack = [];
    State.History.redoStack = [];

    buildDCEL();

    if (mapData.sectors) {
      mapData.sectors.forEach((savedSector) => {
        const anchorHE = State.halfEdges.find(
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
    State.offsetX = 0;
    State.offsetY = 0;
    State.zoom = 1.0;
  } catch (err) {
    console.error("Map Load Error:", err);
    alert("Failed to load map.");
  }
}
