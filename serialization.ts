// =========================
// SERIALIZATION PIPELINE
// =========================

import {
  State,
  Campaign,
  getRawStateSnapshot,
  applyRawStateSnapshot,
} from "./state_persistence.js";
import { getV, Vertex, Edge } from "./relational_data_architecture.js";
import { triangulatePolygonPerimeter } from "./triangulation.js";
import { buildDCEL } from "./DCEL.js";

export async function exportMapData() {
  // ==========================================
  // GEOMETRY VALIDATION (Active Level Only)
  // ==========================================
  let errors = [];
  State.edges.forEach((e) => {
    let v1 = getV(State.vertices, e.v1Id),
      v2 = getV(State.vertices, e.v2Id);
    if (v1 && v2 && Math.hypot(v2.x - v1.x, v2.y - v1.y) < 0.1)
      errors.push(`Wall ${e.id.substring(0, 4)} has zero length.`);
    if (e.type === "portal" && !e.targetEdgeId)
      errors.push(`Portal ${e.id.substring(0, 4)} is missing a target.`);
  });
  if (State.faces.length === 0)
    errors.push("Map has no closed rooms (sectors).");
  if (errors.length > 0) {
    alert(
      "🚨 Map Validation Failed on Active Level 🚨\n\n" + errors.join("\n"),
    );
    return;
  }

  // ==========================================
  // JSZIP CAMPAIGN COMPILER
  // ==========================================
  const zip = new window.JSZip();
  const manifest = {
    campaign_name: Campaign.name,
    starting_level: `levels/${Campaign.levels[0].id}.json`,
    levels: {},
  };

  // 1. Sleep the active state so we don't lose unsaved changes
  Campaign.levels[Campaign.activeLevelIndex].rawData = getRawStateSnapshot();
  const originalIndex = Campaign.activeLevelIndex;

  // 2. Compile Loop
  for (let i = 0; i < Campaign.levels.length; i++) {
    let level = Campaign.levels[i];

    // Swap State context
    applyRawStateSnapshot(level.rawData);

    // Compile geometry
    let compiledLevel = compileCurrentStateToJSON(level.id);
    let filename = `${level.id}.json`;

    // Write file to ZIP
    zip.folder("levels").file(filename, JSON.stringify(compiledLevel, null, 2));

    // Update Master Manifest Graph
    let nextLevelId =
      i + 1 < Campaign.levels.length
        ? `${Campaign.levels[i + 1].id}.json`
        : null;
    manifest.levels[`levels/${filename}`] = {
      next_level: nextLevelId ? `levels/${nextLevelId}` : null,
    };
  }

  // 3. Restore the user's active level safely
  applyRawStateSnapshot(Campaign.levels[originalIndex].rawData);

  // 4. Finalize Manifest and Download ZIP
  zip.file("campaign.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.href = url;
  downloadAnchor.download = "orc_campaign.zip";
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(url);
}

function compileCurrentStateToJSON(levelId) {
  const TEXTURE_SCALE = 64.0;
  const exportSectors = State.faces.map((f) => {
    let perimeterVertices = [];
    let boundaryVertexIds = [];
    let portalNeighbors = [];
    let bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    };
    let flatWallTriangles = [];

    let currEdge = f.outerComponent;
    if (currEdge) {
      do {
        let v1 = getV(State.vertices, currEdge.originId);
        let v2 = getV(State.vertices, currEdge.next.originId);
        let edgeData = currEdge.edge;

        if (v1) {
          perimeterVertices.push(v1);
          boundaryVertexIds.push(v1.id);
          bounds.minX = Math.min(bounds.minX, v1.x);
          bounds.maxX = Math.max(bounds.maxX, v1.x);
          bounds.minY = Math.min(bounds.minY, v1.y);
          bounds.maxY = Math.max(bounds.maxY, v1.y);
        }

        if (currEdge.twin && currEdge.twin.face) {
          portalNeighbors.push({
            neighborSectorId: currEdge.twin.face.id,
            edgeId: edgeData.id,
            edgeType: edgeData.type,
            connectionType: "euclidean",
          });
        }

        if (edgeData.type === "portal" && edgeData.targetEdgeId) {
          let targetHE = State.halfEdges.find(
            (he) => he.edge.id === edgeData.targetEdgeId,
          );
          if (targetHE && targetHE.face) {
            portalNeighbors.push({
              neighborSectorId: targetHE.face.id,
              portalEdgeId: edgeData.id,
              edgeType: "portal",
              connectionType: "teleport",
            });
          }
        }

        if (v1 && v2 && edgeData.type === "solid") {
          let hFloor = f.floorHeight,
            hCeil = f.ceilHeight;
          let zF1 = hFloor + (v1.zFloorOffset || 0),
            zC1 = hCeil + (v1.zCeilOffset || 0);
          let zF2 = hFloor + (v2.zFloorOffset || 0),
            zC2 = hCeil + (v2.zCeilOffset || 0);
          let wallLen = Math.hypot(v2.x - v1.x, v2.y - v1.y);
          let texU = wallLen / TEXTURE_SCALE,
            texV = (hCeil - hFloor) / TEXTURE_SCALE;

          flatWallTriangles.push({
            positions: [
              v2.x,
              zF2,
              v2.y,
              v1.x,
              zF1,
              v1.y,
              v1.x,
              zC1,
              v1.y,
              v2.x,
              zF2,
              v2.y,
              v1.x,
              zC1,
              v1.y,
              v2.x,
              zC2,
              v2.y,
            ],
            uvs: [texU, 0, 0, 0, 0, texV, texU, 0, 0, texV, texU, texV],
            textureId: edgeData.textureId,
          });
        }
        currEdge = currEdge.next;
      } while (currEdge && currEdge !== f.outerComponent);
    }

    const indices2D = triangulatePolygonPerimeter(perimeterVertices);
    let flatFloorTriangles = [],
      flatCeilTriangles = [];

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
      bounds: bounds,
      boundaryVertexIds: boundaryVertexIds,
      portalNeighbors: portalNeighbors,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      mesh3D: {
        floorTriangles: flatFloorTriangles,
        ceilTriangles: flatCeilTriangles,
        wallTriangles: flatWallTriangles,
      },
    };
  });

  return {
    version: "1.0",
    levelId: levelId,
    vertices: State.vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
    edges: State.edges.map((e) => ({
      id: e.id,
      v1Id: e.v1Id,
      v2Id: e.v2Id,
      type: e.type,
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
