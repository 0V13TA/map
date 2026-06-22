import JSZip from "jszip";
import {
  State,
  Campaign,
  getRawStateSnapshot,
  applyRawStateSnapshot,
  saveEditorStateToStorage,
} from "../state/state";
import { Edge, Vertex, getV } from "../core/model";
import { triangulatePolygonPerimeter } from "../core/triangulation";
import { buildDCEL } from "../core/dcel";
import type { UUID } from "../core/types";

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
interface PortalNeighbor {
  neighborSectorId: UUID;
  edgeId?: UUID;
  portalEdgeId?: UUID;
  edgeType: string;
  connectionType: "euclidean" | "teleport";
}
interface FlatTri {
  positions: number[];
  uvs: number[];
  textureId?: number;
}

export async function exportMapData(): Promise<void> {
  const errors: string[] = [];
  State.edges.forEach((e) => {
    const v1 = getV(State.vertices, e.v1Id);
    const v2 = getV(State.vertices, e.v2Id);
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

  const zip = new JSZip();
  const manifest: {
    campaign_name: string;
    starting_level: string;
    levels: Record<string, { next_level: string | null }>;
  } = {
    campaign_name: Campaign.name,
    starting_level: `levels/${Campaign.levels[0]!.id}.json`,
    levels: {},
  };

  Campaign.levels[Campaign.activeLevelIndex]!.rawData = getRawStateSnapshot();
  const originalIndex = Campaign.activeLevelIndex;

  for (let i = 0; i < Campaign.levels.length; i++) {
    const level = Campaign.levels[i]!;
    applyRawStateSnapshot(level.rawData);
    const compiledLevel = compileCurrentStateToJSON(level.id);
    const filename = `${level.id}.json`;
    zip
      .folder("levels")!
      .file(filename, JSON.stringify(compiledLevel, null, 2));
    const nextLevelId =
      i + 1 < Campaign.levels.length
        ? `${Campaign.levels[i + 1]!.id}.json`
        : null;
    manifest.levels[`levels/${filename}`] = {
      next_level: nextLevelId ? `levels/${nextLevelId}` : null,
    };
  }

  applyRawStateSnapshot(Campaign.levels[originalIndex]!.rawData);
  zip.file("campaign.json", JSON.stringify(manifest, null, 2));

  zip.file("workspace_backup.json", JSON.stringify(Campaign, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orc_campaign.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function compileCurrentStateToJSON(levelId: string) {
  const TEXTURE_SCALE = 64.0;
  const exportSectors = State.faces.map((f) => {
    const perimeterVertices: Vertex[] = [];
    const boundaryVertexIds: UUID[] = [];
    const portalNeighbors: PortalNeighbor[] = [];
    const bounds: Bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    };
    const flatWallTriangles: FlatTri[] = [];

    let currEdge: import("../core/dcel").HalfEdge | null = f.outerComponent;
    if (currEdge) {
      const startHe = currEdge;
      do {
        const he: import("../core/dcel").HalfEdge = currEdge;
        const nextHe: import("../core/dcel").HalfEdge | null = he.next;
        if (!nextHe) break;
        const v1 = getV(State.vertices, he.originId);
        const v2 = getV(State.vertices, nextHe.originId);
        const edgeData = he.edge;

        if (v1) {
          perimeterVertices.push(v1);
          boundaryVertexIds.push(v1.id);
          bounds.minX = Math.min(bounds.minX, v1.x);
          bounds.maxX = Math.max(bounds.maxX, v1.x);
          bounds.minY = Math.min(bounds.minY, v1.y);
          bounds.maxY = Math.max(bounds.maxY, v1.y);
        }

        if (he.twin && he.twin.face) {
          portalNeighbors.push({
            neighborSectorId: he.twin.face.id,
            edgeId: edgeData.id,
            edgeType: edgeData.type,
            connectionType: "euclidean",
          });
        }

        if (edgeData.type === "portal" && edgeData.targetEdgeId) {
          const targetHE = State.halfEdges.find(
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
          const hFloor = f.floorHeight;
          const hCeil = f.ceilHeight;
          const zF1 = hFloor + (v1.zFloorOffset || 0);
          const zC1 = hCeil + (v1.zCeilOffset || 0);
          const zF2 = hFloor + (v2.zFloorOffset || 0);
          const zC2 = hCeil + (v2.zCeilOffset || 0);
          const wallLen = Math.hypot(v2.x - v1.x, v2.y - v1.y);
          const texU = wallLen / TEXTURE_SCALE;
          const texV = (hCeil - hFloor) / TEXTURE_SCALE;

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
        currEdge = nextHe;
      } while (currEdge && currEdge !== startHe);
    }

    const indices2D = triangulatePolygonPerimeter(perimeterVertices);
    const flatFloorTriangles: FlatTri[] = [];
    const flatCeilTriangles: FlatTri[] = [];

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
      bounds,
      boundaryVertexIds,
      portalNeighbors,
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
    levelId,
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

export function importMapData(jsonString: string): void {
  try {
    const mapData = JSON.parse(jsonString);
    if (!mapData.vertices || !mapData.edges)
      throw new Error("Invalid map format");

    State.vertices = (mapData.vertices as Array<RawVertexLite>).map((v) => {
      const nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });

    State.edges = (mapData.edges as Array<RawEdgeLite>).map((e) => {
      const edge = new Edge(e.v1Id, e.v2Id, e.id);
      if (e.type) edge.type = e.type;
      if (e.targetEdgeId) edge.targetEdgeId = e.targetEdgeId;
      if (e.portalDirection) edge.portalDirection = e.portalDirection;
      return edge;
    });
    State.selectedVertices.clear();
    State.selectedFaceId.clear();
    State.selectedEdgeId.clear();
    if (State.History) {
      State.History.undoStack = [];
      State.History.redoStack = [];
    }

    buildDCEL();

    if (mapData.sectors) {
      (mapData.sectors as Array<RawSectorLite>).forEach((savedSector) => {
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

export async function importWorkspace(file: File) {
  try {
    const zip = new JSZip();
    const unzipped = await zip.loadAsync(file);

    // 1. Look for the raw backup file inside the zip
    const backupFile = unzipped.file("workspace_backup.json");
    if (!backupFile) {
      alert("Invalid file. No workspace_backup.json found inside the ZIP.");
      return;
    }

    // 2. Read the JSON and hydrate the Campaign object
    const backupText = await backupFile.async("text");
    const data = JSON.parse(backupText);

    Campaign.name = data.name;
    Campaign.activeLevelIndex = data.activeLevelIndex;
    Campaign.levels = data.levels;

    // 3. Apply the state to the canvas and save to local storage
    applyRawStateSnapshot(Campaign.levels[Campaign.activeLevelIndex]!.rawData);
    saveEditorStateToStorage();

    // 4. Force the UI to wake up and redraw the new tabs
    window.dispatchEvent(new Event("orc_level_switched"));
  } catch (err) {
    console.error("Failed to parse workspace:", err);
    alert(
      "Failed to load workspace. Ensure you are uploading a valid ORC .zip file.",
    );
  }
}

interface RawVertexLite {
  id: UUID;
  x: number;
  y: number;
  zFloorOffset?: number;
  zCeilOffset?: number;
}
interface RawEdgeLite {
  id: UUID;
  v1Id: UUID;
  v2Id: UUID;
  type?: Edge["type"];
  targetEdgeId?: UUID | null;
  portalDirection?: Edge["portalDirection"];
}
interface RawSectorLite {
  id: UUID;
  anchorEdgeId: UUID;
  anchorOriginId: UUID;
  floorHeight: number;
  ceilHeight: number;
  floorColor: string;
  ceilColor: string;
}
