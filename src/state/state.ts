import { TOOLS, DEFAULT_KEY_BINDINGS, type Tool, type Action } from "../core/enums";
import { Edge, Entity, Vertex } from "../core/model";
import { buildDCEL, type Face, type HalfEdge } from "../core/dcel";
import { GeometryChangeCommand, type CommandHistory, type CommandSnapshot } from "./history";
import type { UUID } from "../core/types";

export interface RawEdgeSnapshot {
  id: UUID;
  v1Id: UUID;
  v2Id: UUID;
  type: Edge["type"];
  textureId: number;
  targetEdgeId: UUID | null;
  portalDirection: Edge["portalDirection"];
}
export interface RawVertexSnapshot {
  id: UUID;
  x: number;
  y: number;
  zFloorOffset: number;
  zCeilOffset: number;
}
export interface RawSectorSnapshot {
  id: UUID;
  floorHeight: number;
  ceilHeight: number;
  floorColor: string;
  ceilColor: string;
  anchorEdgeId: UUID | undefined;
  anchorOriginId: UUID | undefined;
}
export interface RawEntitySnapshot {
  id: UUID;
  x: number;
  y: number;
  type: Entity["type"];
  angle: number;
}

export interface RawStateSnapshot {
  currentTool: Tool;
  geometry: { vertices: RawVertexSnapshot[]; edges: RawEdgeSnapshot[] };
  sectors: RawSectorSnapshot[];
  entities: RawEntitySnapshot[];
  history: { undo: CommandSnapshot[]; redo: CommandSnapshot[] };
  keyBindings: Record<string, Action>;
}

interface StateShape {
  vertices: Vertex[];
  edges: Edge[];
  faces: Face[];
  halfEdges: HalfEdge[];
  selectedVertices: Set<UUID>;
  selectedFaceId: Set<UUID>;
  selectedEdgeId: Set<UUID>;
  entities: Entity[];
  selectedEntityIds: Set<UUID>;
  currentTool: Tool;
  keyBindings: Record<string, Action>;
  zoom: number;
  offsetX: number;
  offsetY: number;
  showTriangulationWireframes: boolean;
  History: CommandHistory | null;
}

export const State: StateShape = {
  vertices: [],
  edges: [],
  faces: [],
  halfEdges: [],
  selectedVertices: new Set(),
  selectedFaceId: new Set(),
  selectedEdgeId: new Set(),
  entities: [],
  selectedEntityIds: new Set(),
  currentTool: TOOLS.LINE,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  showTriangulationWireframes: false,
  History: null,
};

export interface CampaignLevel {
  id: string;
  name: string;
  rawData: RawStateSnapshot | null;
}

export const Campaign: { name: string; activeLevelIndex: number; levels: CampaignLevel[] } = {
  name: "ORC_Campaign",
  activeLevelIndex: 0,
  levels: [{ id: "level_01", name: "Level 1", rawData: null }],
};

export function getRawStateSnapshot(): RawStateSnapshot {
  return {
    currentTool: State.currentTool,
    geometry: {
      vertices: State.vertices.map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        zFloorOffset: v.zFloorOffset,
        zCeilOffset: v.zCeilOffset,
      })),
      edges: State.edges.map((e) => ({
        id: e.id,
        v1Id: e.v1Id,
        v2Id: e.v2Id,
        type: e.type,
        textureId: e.textureId,
        targetEdgeId: e.targetEdgeId,
        portalDirection: e.portalDirection,
      })),
    },
    sectors: State.faces.map((f) => ({
      id: f.id,
      floorHeight: f.floorHeight,
      ceilHeight: f.ceilHeight,
      floorColor: f.floorColor,
      ceilColor: f.ceilColor,
      anchorEdgeId: f.outerComponent?.edge?.id,
      anchorOriginId: f.outerComponent?.originId,
    })),
    entities: State.entities.map((ent) => ({
      id: ent.id,
      x: ent.x,
      y: ent.y,
      type: ent.type,
      angle: ent.angle,
    })),
    history: {
      undo: (State.History?.undoStack ?? []).map((cmd) => cmd.snapshot()),
      redo: (State.History?.redoStack ?? []).map((cmd) => cmd.snapshot()),
    },
    keyBindings: State.keyBindings,
  };
}

export function applyRawStateSnapshot(data: RawStateSnapshot | null): void {
  State.vertices = [];
  State.edges = [];
  State.faces = [];
  State.halfEdges = [];
  State.entities = [];
  State.selectedVertices.clear();
  State.selectedFaceId.clear();
  State.selectedEdgeId.clear();
  State.selectedEntityIds.clear();
  if (State.History) {
    State.History.undoStack = [];
    State.History.redoStack = [];
  }

  if (!data) {
    buildDCEL();
    return;
  }

  if (data.keyBindings) State.keyBindings = data.keyBindings;
  if (data.currentTool) State.currentTool = data.currentTool;

  if (data.geometry) {
    State.vertices = data.geometry.vertices.map((v) => {
      const nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    State.edges = data.geometry.edges.map((e) => {
      const edge = new Edge(e.v1Id, e.v2Id, e.id);
      if (e.type) edge.type = e.type;
      if (e.targetEdgeId) edge.targetEdgeId = e.targetEdgeId;
      if (e.textureId !== undefined) edge.textureId = e.textureId;
      if (e.portalDirection) edge.portalDirection = e.portalDirection;
      return edge;
    });
  }

  buildDCEL();

  if (data.sectors) {
    data.sectors.forEach((savedSector) => {
      const anchorHE = State.halfEdges.find(
        (he) => he.edge.id === savedSector.anchorEdgeId && he.originId === savedSector.anchorOriginId,
      );
      if (anchorHE && anchorHE.face) {
        const face = anchorHE.face;
        face.id = savedSector.id;
        face.floorHeight = savedSector.floorHeight;
        face.ceilHeight = savedSector.ceilHeight;
        face.floorColor = savedSector.floorColor;
        face.ceilColor = savedSector.ceilColor;
      }
    });
  }

  if (data.history && State.History) {
    State.History.undoStack = data.history.undo.map(
      (h) => new GeometryChangeCommand(h.oldV, h.oldE, h.newV, h.newE, new Set(h.oldSel), new Set(h.newSel)),
    );
    State.History.redoStack = data.history.redo.map(
      (h) => new GeometryChangeCommand(h.oldV, h.oldE, h.newV, h.newE, new Set(h.oldSel), new Set(h.newSel)),
    );
  }

  if (data.entities) {
    State.entities = data.entities.map((ent) => {
      const e = new Entity(ent.x, ent.y, ent.type, ent.id);
      e.angle = ent.angle || 0;
      return e;
    });
  }
}

export function switchLevel(index: number): void {
  if (index === Campaign.activeLevelIndex) return;
  Campaign.levels[Campaign.activeLevelIndex]!.rawData = getRawStateSnapshot();
  Campaign.activeLevelIndex = index;
  applyRawStateSnapshot(Campaign.levels[index]!.rawData);
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}

export function createNewLevel(): void {
  Campaign.levels[Campaign.activeLevelIndex]!.rawData = getRawStateSnapshot();
  const newIndex = Campaign.levels.length;
  const newId = "level_" + String(newIndex + 1).padStart(2, "0");
  Campaign.levels.push({ id: newId, name: "Level " + (newIndex + 1), rawData: null });
  Campaign.activeLevelIndex = newIndex;

  applyRawStateSnapshot(null);
  State.offsetX = 0;
  State.offsetY = 0;
  State.zoom = 1;
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}

export function saveEditorStateToStorage(): void {
  Campaign.levels[Campaign.activeLevelIndex]!.rawData = getRawStateSnapshot();
  localStorage.setItem("orc_engine_campaign_state", JSON.stringify(Campaign));
}

export function loadEditorStateFromStorage(): boolean {
  const raw = localStorage.getItem("orc_engine_campaign_state");
  if (!raw) return false;
  try {
    const data = JSON.parse(raw) as typeof Campaign;
    Campaign.name = data.name;
    Campaign.activeLevelIndex = data.activeLevelIndex;
    Campaign.levels = data.levels;
    applyRawStateSnapshot(Campaign.levels[Campaign.activeLevelIndex]!.rawData);
    window.dispatchEvent(new Event("orc_level_switched"));
    return true;
  } catch (err) {
    console.warn("Auto-load failed, clearing cache", err);
    localStorage.removeItem("orc_engine_campaign_state");
    return false;
  }
}

export function deleteLevel(index: number): void {
  if (Campaign.levels.length <= 1) {
    alert("You must have at least one level in your campaign!");
    return;
  }
  if (!confirm(`Are you sure you want to delete "${Campaign.levels[index]!.name}"? This cannot be undone.`)) {
    return;
  }
  if (index === Campaign.activeLevelIndex) {
    Campaign.levels.splice(index, 1);
    Campaign.activeLevelIndex = Math.min(index, Campaign.levels.length - 1);
    applyRawStateSnapshot(Campaign.levels[Campaign.activeLevelIndex]!.rawData);
  } else {
    Campaign.levels.splice(index, 1);
    if (Campaign.activeLevelIndex > index) Campaign.activeLevelIndex--;
  }
  saveEditorStateToStorage();
  window.dispatchEvent(new Event("orc_level_switched"));
}
