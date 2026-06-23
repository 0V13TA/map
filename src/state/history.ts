import { buildDCEL } from "../core/dcel";
import {
  Edge,
  Entity,
  Vertex,
  cloneEdge,
  cloneEntity,
  cloneVertex,
} from "../core/model";
import { State, saveEditorStateToStorage } from "./state";
import type { UUID } from "../core/types";

export interface CommandSnapshot {
  oldV: Vertex[];
  oldE: Edge[];
  newV: Vertex[];
  newE: Edge[];
  oldSel: UUID[];
  newSel: UUID[];
}

export class CommandHistory {
  undoStack: GeometryChangeCommand[] = [];
  redoStack: GeometryChangeCommand[] = [];

  execute(command: GeometryChangeCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    buildDCEL();
    saveEditorStateToStorage();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    buildDCEL();
    saveEditorStateToStorage();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    buildDCEL();
    saveEditorStateToStorage();
  }
}

export class GeometryChangeCommand {
  oldV: Vertex[];
  oldE: Edge[];
  newV: Vertex[];
  newE: Edge[];
  oldSel: UUID[];
  newSel: UUID[];
  oldEnt?: Entity[];
  newEnt?: Entity[];

  constructor(
    oldV: Vertex[],
    oldE: Edge[],
    newV: Vertex[],
    newE: Edge[],
    oldSel: Iterable<UUID>,
    newSel: Iterable<UUID>,
    oldEnt?: Entity[],
    newEnt?: Entity[],
  ) {
    this.oldV = oldV.map(cloneVertex);
    this.oldE = oldE.map(cloneEdge);
    this.newV = newV.map(cloneVertex);
    this.newE = newE.map(cloneEdge);
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
    this.oldEnt = oldEnt ? oldEnt.map(cloneEntity) : undefined;
    this.newEnt = newEnt ? newEnt.map(cloneEntity) : undefined;
  }

  execute() {
    State.vertices = this.newV.map(cloneVertex);
    State.edges = this.newE.map(cloneEdge);
    if (this.newEnt) State.entities = this.newEnt.map(cloneEntity);

    State.selectedVertices = new Set(this.newSel);
    State.selectedEdgeId.clear();
    State.selectedFaceId.clear();
  }

  undo() {
    State.vertices = this.oldV.map(cloneVertex);
    State.edges = this.oldE.map(cloneEdge);
    if (this.oldEnt) State.entities = this.oldEnt.map(cloneEntity);

    State.selectedVertices = new Set(this.oldSel);
    State.selectedEdgeId.clear();
    State.selectedFaceId.clear();
  }

  snapshot(): CommandSnapshot {
    return {
      oldV: this.oldV.map(cloneVertex),
      oldE: this.oldE.map(cloneEdge),
      newV: this.newV.map(cloneVertex),
      newE: this.newE.map(cloneEdge),
      oldSel: [...this.oldSel],
      newSel: [...this.newSel],
    };
  }
}
