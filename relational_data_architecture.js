// =========================
// CORE RELATIONAL DATA ARCHITECTURE
// =========================
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
    this.id = id || crypto.randomUUID();
    /** @type {number} */
    this.x = x;
    /** @type {number} */
    this.y = y;
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
    this.id = id || crypto.randomUUID();
    /** @type {UUID} */
    this.v1Id = v1Id;
    /** @type {UUID} */
    this.v2Id = v2Id;
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
