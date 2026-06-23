import type { UUID, EdgeType, PortalDirection, EntityType } from "./types";

export function cloneEntity(e: Entity): Entity {
  const ne = new Entity(e.x, e.y, e.type, e.id);
  ne.angle = e.angle;
  return ne;
}

export function generateUUID(): UUID {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID() as UUID;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  }) as UUID;
}

export class Vertex {
  id: UUID;
  x: number;
  y: number;
  zFloorOffset = 0;
  zCeilOffset = 0;

  constructor(x: number, y: number, id: UUID | null = null) {
    this.id = id ?? generateUUID();
    this.x = x;
    this.y = y;
  }
}

export class Edge {
  id: UUID;
  v1Id: UUID;
  v2Id: UUID;
  type: EdgeType = "solid";
  portalDirection: PortalDirection = "forward";
  targetEdgeId: UUID | null = null;
  textureId = 0;

  constructor(v1Id: UUID, v2Id: UUID, id: UUID | null = null) {
    this.id = id ?? generateUUID();
    this.v1Id = v1Id;
    this.v2Id = v2Id;
  }
}

export class Entity {
  id: UUID;
  x: number;
  y: number;
  type: EntityType;
  angle = 0;

  constructor(
    x: number,
    y: number,
    type: EntityType = "PlayerSpawn",
    id: UUID | null = null,
  ) {
    this.id = id ?? generateUUID();
    this.x = x;
    this.y = y;
    this.type = type;
  }
}

export const getV = (vertices: Vertex[], id: UUID): Vertex | undefined =>
  vertices.find((v) => v.id === id);

export function getOrCreateVertexInPool(
  vPool: Vertex[],
  x: number,
  y: number,
): UUID {
  const existing = vPool.find((v) => Math.hypot(v.x - x, v.y - y) < 0.001);
  if (existing) return existing.id;
  const nv = new Vertex(x, y);
  vPool.push(nv);
  return nv.id;
}

export function buildAdjacencyMap(
  vertexPool: Vertex[],
  edgePool: Edge[],
): Map<UUID, UUID[]> {
  const adjacency = new Map<UUID, UUID[]>();
  vertexPool.forEach((v) => adjacency.set(v.id, []));

  edgePool.forEach((edge) => {
    adjacency.get(edge.v1Id)?.push(edge.id);
    adjacency.get(edge.v2Id)?.push(edge.id);
  });

  adjacency.forEach((connectedEdgeIds, centerVId) => {
    const centerV = vertexPool.find((v) => v.id === centerVId);
    if (!centerV) return;
    connectedEdgeIds.sort((idA, idB) => {
      const edgeA = edgePool.find((e) => e.id === idA);
      const edgeB = edgePool.find((e) => e.id === idB);
      if (!edgeA || !edgeB) return 0;
      const targetAId = edgeA.v1Id === centerVId ? edgeA.v2Id : edgeA.v1Id;
      const targetA = vertexPool.find((v) => v.id === targetAId);
      const targetBId = edgeB.v1Id === centerVId ? edgeB.v2Id : edgeB.v1Id;
      const targetB = vertexPool.find((v) => v.id === targetBId);
      if (!targetA || !targetB) return 0;
      const angleA = Math.atan2(targetA.y - centerV.y, targetA.x - centerV.x);
      const angleB = Math.atan2(targetB.y - centerV.y, targetB.x - centerV.x);
      return angleA - angleB;
    });
  });
  return adjacency;
}

export function cloneVertex(v: Vertex): Vertex {
  const nv = new Vertex(v.x, v.y, v.id);
  nv.zFloorOffset = v.zFloorOffset || 0;
  nv.zCeilOffset = v.zCeilOffset || 0;
  return nv;
}

export function cloneEdge(e: Edge): Edge {
  const ne = new Edge(e.v1Id, e.v2Id, e.id);
  ne.type = e.type;
  ne.portalDirection = e.portalDirection;
  ne.textureId = e.textureId;
  ne.targetEdgeId = e.targetEdgeId;
  return ne;
}
