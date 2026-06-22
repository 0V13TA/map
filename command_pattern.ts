import { buildDCEL } from "./DCEL.js";
import { Vertex, Edge } from "./relational_data_architecture.js";
import { saveEditorStateToStorage, State } from "./state_persistence.js";
import type { UUID } from "./relational_data_architecture.js";

// =========================
// COMMAND PATTERN ENGINE
// =========================
export class CommandHistory {
  undoStack: GeometryChangeCommand[];
  redoStack: GeometryChangeCommand[];

  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * @param {GeometryChangeCommand} command
   */
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
  /**
   * @param {Vertex[]} oldV
   * @param {Edge[]} oldE
   * @param {Vertex[]} newV
   * @param {Edge[]} newE
   * @param {Set<UUID> | UUID[]} oldSel
   * @param {Set<UUID> | UUID[]} newSel
   */
  oldV: Vertex[];
  oldE: Edge[];
  newV: Vertex[];
  newE: Edge[];
  oldSel: UUID[];
  newSel: UUID[];

  constructor(oldV: Vertex[], oldE: Edge[], newV: Vertex[], newE: Edge[], oldSel: Set<UUID> | UUID[], newSel: Set<UUID> | UUID[]) {
    this.oldV = oldV.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    this.oldE = oldE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      ne.targetEdgeId = e.targetEdgeId;
      ne.portalDirection = e.portalDirection;
      return ne;
    });
    this.newV = newV.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    this.newE = newE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      ne.targetEdgeId = e.targetEdgeId;
      ne.portalDirection = e.portalDirection;
      return ne;
    });
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
  }

  execute() {
    State.vertices = this.newV.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    State.edges = this.newE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      ne.targetEdgeId = e.targetEdgeId;
      ne.portalDirection = e.portalDirection;
      return ne;
    });
    State.selectedVertices = new Set(this.newSel);
  }

  undo() {
    State.vertices = this.oldV.map((v) => {
      let nv = new Vertex(v.x, v.y, v.id);
      nv.zFloorOffset = v.zFloorOffset || 0;
      nv.zCeilOffset = v.zCeilOffset || 0;
      return nv;
    });
    State.edges = this.oldE.map((e) => {
      let ne = new Edge(e.v1Id, e.v2Id, e.id);
      ne.type = e.type;
      ne.textureId = e.textureId;
      ne.portalDirection = e.portalDirection;
      ne.targetEdgeId = e.targetEdgeId;
      return ne;
    });
    State.selectedVertices = new Set(this.oldSel);
  }
}
