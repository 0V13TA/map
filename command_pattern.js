import { buildDCEL } from "./DCEL.js";
import { Vertex, Edge } from "./relational_data_architecture.js";
import { saveEditorStateToStorage, State } from "./state_persistence.js";

// =========================
// COMMAND PATTERN ENGINE
// =========================
export class CommandHistory {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    buildDCEL();
    saveEditorStateToStorage();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const cmd = this.undoStack.pop();
    cmd.undo();
    this.redoStack.push(cmd);
    buildDCEL();
    saveEditorStateToStorage();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const cmd = this.redoStack.pop();
    cmd.execute();
    this.undoStack.push(cmd);
    buildDCEL();
    saveEditorStateToStorage();
  }
}

export class GeometryChangeCommand {
  constructor(oldV, oldE, newV, newE, oldSel, newSel) {
    this.oldV = oldV.map((v) => new Vertex(v.x, v.y, v.id));
    this.oldE = oldE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      return ne;
    });
    this.newV = newV.map((v) => new Vertex(v.x, v.y, v.id));
    this.newE = newE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      return ne;
    });
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
  }

  execute() {
    State.vertices = this.newV.map((v) => new Vertex(v.x, v.y, v.id));
    State.edges = this.newE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      return ne;
    });
    State.selectedVertices = new Set(this.newSel);
  }

  undo() {
    State.vertices = this.oldV.map((v) => new Vertex(v.x, v.y, v.id));
    State.edges = this.oldE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      return ne;
    });
    State.selectedVertices = new Set(this.oldSel);
  }
}
