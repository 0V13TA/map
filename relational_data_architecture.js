// =========================
// CORE RELATIONAL DATA ARCHITECTURE
// =========================

export function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * @typedef {`${string}-${string}-${string}-${string}-${string}`} UUID
 */
export class Vertex {
  /**
   * @param {number} x
   * @param {number} y
   * @param {UUID | null} [id = null]
   */
  constructor(x, y, id = null) {
    /** @type {UUID} */
    this.id = id || generateUUID();
    /** @type {number} */
    this.x = x;
    /** @type {number} */
    this.y = y;
    /** @type {number} */
    this.zFloorOffset = 0;
    /** @type {number} */
    this.zCeilOffset = 0;
  }
}

export class Edge {
  /**
   * @param {UUID} v1Id
   * @param {UUID} v2Id
   * @param {UUID | null} [id = null]
   */
  constructor(v1Id, v2Id, id = null) {
    /** @type {UUID} */
    this.id = id || generateUUID();
    /** @type {UUID} */
    this.v1Id = v1Id;
    /** @type {UUID} */
    this.v2Id = v2Id;

    /** @type {"solid" | "portal" | "door"} */
    this.type = "solid";
    /** @type {"forward" | "backward" | "both"} */
    this.portalDirection = "forward";
    /** @type {UUID | null} */
    this.targetEdgeId = null;
    /** @type {number} */
    this.textureId = 0;
  }
}

export class Entity {
  /**
   * @param {number} y
   * @param {number} x
   * @param {"PlayerSpawn" | "Enemy" | "Light" | "Prop"} [type = "PlayerSpawn"] - The type of entity (e.g., "PlayerSpawn", "Enemy", "Light", "Prop")
   * @param {UUID | null} [id = null] - Optional unique identifier for the entity. If not provided, a new UUID will be generated.
   */
  constructor(x, y, type = "PlayerSpawn", id = null) {
    this.id = id || generateUUID();
    this.x = x;
    this.y = y;
    this.type = type; // e.g., "PlayerSpawn", "Enemy", "Light", "Prop"
    this.angle = 0; // The direction the entity is facing (degrees)
  }
}

/**
 * @param {UUID} id
 * @param {Vertex[]} vertices
 */
export const getV = (vertices, id) => vertices.find((v) => v.id === id);

/**
 * @param {Vertex[]} vPool
 * @param {number} x
 * @param {number} y
 */
export function getOrCreateVertexInPool(vPool, x, y) {
  const existing = vPool.find((v) => Math.hypot(v.x - x, v.y - y) < 0.001);
  if (existing) return existing.id;
  const newV = new Vertex(x, y);
  vPool.push(newV);
  return newV.id;
}

/**
 * @param {Vertex[]} vertexPool
 * @param {Edge[]} edgePool
 */
export function buildAdjacencyMap(vertexPool, edgePool) {
  /** @type {Map<UUID, UUID>} */
  const adjacency = new Map();
  vertexPool.forEach((v) => adjacency.set(v.id, []));

  edgePool.forEach((edge) => {
    if (adjacency.has(edge.v1Id)) adjacency.get(edge.v1Id).push(edge.id);
    if (adjacency.has(edge.v2Id)) adjacency.get(edge.v2Id).push(edge.id);
  });

  adjacency.forEach((connectedEdgeIds, centerVId) => {
    const centerV = vertexPool.find((v) => v.id === centerVId);
    connectedEdgeIds.sort((idA, idB) => {
      const edgeA = edgePool.find((e) => e.id === idA);
      const edgeB = edgePool.find((e) => e.id === idB);

      const targetAId = edgeA.v1Id === centerVId ? edgeA.v2Id : edgeA.v1Id;
      const targetA = vertexPool.find((v) => v.id === targetAId);
      const angleA = Math.atan2(targetA.y - centerV.y, targetA.x - centerV.x);

      const targetBId = edgeB.v1Id === centerVId ? edgeB.v2Id : edgeB.v1Id;
      const targetB = vertexPool.find((v) => v.id === targetBId);
      const angleB = Math.atan2(targetB.y - centerV.y, targetB.x - centerV.x);

      return angleA - angleB;
    });
  });
  return adjacency;
}
