import { buildDCEL, Face, HalfEdge } from "./DCEL.js";
import { Vertex, Edge } from "./relational_data_architecture.js";
import { saveEditorStateToStorage } from "./state_persistence.js";

// =========================
// COMMAND PATTERN ENGINE
// =========================
export class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * @param {Face[]} faces
   * @param {HalfEdge[]} halfEdges
   * @param {Edge[]} edges
   * @param {Vertex[]} vertices
   * @param {Set<Vertex>} selectedVertices
   * @param {GeometryChangeCommand} command
   */
  execute(halfEdges, faces, edges, vertices, selectedVertices, command) {
    command.execute(edges, vertices, selectedVertices);
    this.undoStack.push(command);
    this.redoStack = [];
    buildDCEL(halfEdges, faces, edges, vertices);
    saveEditorStateToStorage();
  }

  /**
   * @param {Face[]} faces
   * @param {HalfEdge[]} halfEdges
   * @param {Edge[]} edges
   * @param {Vertex[]} vertices
   */
  undo(halfEdges, faces, edges, vertices) {
    if (this.undoStack.length === 0) return;
    const cmd = this.undoStack.pop();
    cmd.undo();
    this.redoStack.push(cmd);
    buildDCEL(halfEdges, faces, edges, vertices);
    saveEditorStateToStorage();
  }

  /**
   * @param {Face[]} faces
   * @param {HalfEdge[]} halfEdges
   * @param {Edge[]} edges
   * @param {Vertex[]} vertices
   */
  redo(halfEdges, faces, edges, vertices) {
    if (this.redoStack.length === 0) return;
    const cmd = this.redoStack.pop();
    cmd.execute();
    this.undoStack.push(cmd);
    buildDCEL(halfEdges, faces, edges, vertices);
    saveEditorStateToStorage();
  }
}

export class GeometryChangeCommand {
  /**
   *  @param {Vertex[]} newV
   *  @param {Edge[]} oldE
   *  @param {Edge[]} newE
   *  @param {Vertex[]} oldV
   *  @param {Set<Vertex>} oldSel
   *  @param {Set<Vertex>} newSel
   */
  constructor(oldV, oldE, newV, newE, oldSel, newSel) {
    this.oldV = oldV.map((v) => new Vertex(v.x, v.y, v.id));
    this.oldE = oldE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    this.newV = newV.map((v) => new Vertex(v.x, v.y, v.id));
    this.newE = newE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
  }

  /**
   * @param {Edge[]} edges
   * @param {Vertex[]} vertices
   * @param {Set<Vertex>} selectedVertices
   */
  execute(edges, vertices, selectedVertices) {
    vertices = this.newV.map((v) => new Vertex(v.x, v.y, v.id));
    edges = this.newE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    selectedVertices = new Set(this.newSel);
  }

  /**
   * @param {Edge[]} edges
   * @param {Vertex[]} vertices
   * @param {Set<Vertex>} selectedVertices
   */
  undo(edges, vertices, selectedVertices) {
    vertices = this.oldV.map((v) => new Vertex(v.x, v.y, v.id));
    edges = this.oldE.map((e) => new Edge(e.v1Id, e.v2Id, e.id));
    selectedVertices = new Set(this.oldSel);
  }
}
