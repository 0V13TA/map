// =========================
// SERIALIZATION PIPELINE
// =========================
export function exportMapData() {
  const TEXTURE_SCALE = 64.0; // Defines tiling scale alignment parameter (e.g. 64 units = 1.0 UV loop)

  const exportSectors = faces.map((f) => {
    // 1. Trace the closed DCEL loop perimeter to gather the ordered polygon vertices
    let perimeterVertices = [];
    let currEdge = f.outerComponent;
    do {
      let v = getV(vertices, currEdge.originId);
      if (v) perimeterVertices.push(v);
      currEdge = currEdge.next;
    } while (currEdge && currEdge !== f.outerComponent);

    // 2. Generate flat plane triangulation indices
    const indices2D = triangulatePolygonPerimeter(perimeterVertices);

    // 3. Construct 3D Flooding Mesh Arrays for WebGL processing pipelines
    let flatFloorTriangles = [];
    let flatCeilTriangles = [];

    indices2D.forEach(([v1, v2, v3]) => {
      // Floor Triangle Coordinate Generation Object Map
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

      // Ceiling Triangle Coordinate Generation Object Map (Winding order inverted for downward visibility normals)
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
      // Extruded 3D Mesh Arrays ready for WebGL Float32Array compilation buffer loads
      mesh3D: {
        floorTriangles: flatFloorTriangles,
        ceilTriangles: flatCeilTriangles,
      },
    };
  });

  const mapData = {
    version: "1.0",
    vertices: vertices.map((v) => ({ id: v.id, x: v.x, y: v.y })),
    edges: edges.map((e) => ({ id: e.id, v1Id: e.v1Id, v2Id: e.v2Id })),
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

    vertices = mapData.vertices.map((v) => new Vertex(v.x, v.y, v.id));
    edges = mapData.edges.map((e) => new Edge(e.v1Id, e.v2Id, e.id));

    selectedVertices.clear();
    selectedFaceId = null;
    History.undoStack = [];
    History.redoStack = [];

    buildDCEL(halfEdges, faces, edges, vertices);

    if (mapData.sectors) {
      mapData.sectors.forEach((savedSector) => {
        const anchorHE = halfEdges.find(
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
    offsetX = 0;
    offsetY = 0;
    zoom = 1.0;
  } catch (err) {
    console.error("Map Load Error:", err);
    alert("Failed to load map.");
  }
}
