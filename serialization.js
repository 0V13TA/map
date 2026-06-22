// =========================
// SERIALIZATION PIPELINE
// =========================
import { State } from "./state_persistence.js";
import { getV, Vertex, Edge } from "./relational_data_architecture.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import { buildDCEL } from "./DCEL.js";

export function exportMapData() {
  // ==========================================
  // GEOMETRY VALIDATION (PRE-FLIGHT CHECKS)
  // ==========================================
  let errors = [];

  // Clear selections so we can highlight ONLY the broken geometry
  State.selectedVertices.clear();
  State.selectedEdgeId.clear();
  State.selectedFaceId.clear();

  // 1. Check for Zero-Length Walls & Unlinked Portals
  State.edges.forEach((e) => {
    let v1 = getV(State.vertices, e.v1Id);
    let v2 = getV(State.vertices, e.v2Id);
    if (v1 && v2) {
      if (Math.hypot(v2.x - v1.x, v2.y - v1.y) < 0.1) {
        errors.push(`Wall ${e.id.substring(0, 4)} has zero length.`);
        // Highlight the broken vertex for the user
        State.selectedVertices.add(v1.id);
      }
    }
    if (e.type === "portal" && !e.targetEdgeId) {
      errors.push(
        `Portal ${e.id.substring(0, 4)} is missing a target connection.`,
      );
      // Highlight the broken portal for the user
      State.selectedEdgeId.add(e.id);
    }
  });

  // 2. Check for empty maps
  if (State.faces.length === 0) {
    errors.push("Map has no closed rooms (sectors).");
  }

  // 3. Abort export if validation failed
  if (errors.length > 0) {
    // Force the UI to refresh and show the red highlights on the broken parts
    window.dispatchEvent(new Event("resize"));

    alert(
      "🚨 Map Validation Failed 🚨\n\n" +
        errors.join("\n") +
        "\n\n(The problematic walls/vertices have been highlighted in red on your canvas!)",
    );
    return;
  }
  // ==========================================

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
          f.floorHeight + (v1.zFloorOffset || 0),
          v1.y,
          v2.x,
          f.floorHeight + (v2.zFloorOffset || 0),
          v2.y,
          v3.x,
          f.floorHeight + (v3.zFloorOffset || 0),
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
          f.ceilHeight + (v1.zCeilOffset || 0),
          v1.y,
          v3.x,
          f.ceilHeight + (v3.zCeilOffset || 0),
          v3.y,
          v2.x,
          f.ceilHeight + (v2.zCeilOffset || 0),
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
      targetID: e.targetID,
      targetEdgeId: e.targetEdgeId,
      portalDirection: e.portalDirection,
    })),
    entities: State.entities.map((ent) => ({
      id: ent.id,
      x: ent.x,
      y: ent.y,
      type: ent.type,
      angle: ent.angle,
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

    State.vertices = mapData.vertices.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });

    // NEW: Properly hydrate all edge properties on JSON load
    State.edges = mapData.edges.map((e) => {
      let edge = new Edge(e.v1Id, e.v2Id, e.id);
      if (e.type) edge.type = e.type;
      if (e.targetEdgeId) edge.targetEdgeId = e.targetEdgeId;
      if (e.portalDirection) edge.portalDirection = e.portalDirection;
      return edge;
    });
    State.selectedVertices.clear();
    State.selectedFaceId.clear();
    State.selectedEdgeId.clear();
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
