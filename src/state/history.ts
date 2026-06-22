import { buildDCEL } from "../core/dcel";
import { Edge, Vertex, cloneEdge, cloneVertex } from "../core/model";
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

  constructor(
    oldV: Vertex[],
    oldE: Edge[],
    newV: Vertex[],
    newE: Edge[],
    oldSel: Iterable<UUID>,
    newSel: Iterable<UUID>,
  ) {
    this.oldV = oldV.map(cloneVertex);
    this.oldE = oldE.map(cloneEdge);
    this.newV = newV.map(cloneVertex);
    this.newE = newE.map(cloneEdge);
    this.oldSel = [...oldSel];
    this.newSel = [...newSel];
  }

  execute(): void {
    State.vertices = this.newV.map(cloneVertex);
    State.edges = this.newE.map(cloneEdge);
    State.selectedVertices = new Set(this.newSel);
  }

  undo(): void {
    State.vertices = this.oldV.map(cloneVertex);
    State.edges = this.oldE.map(cloneEdge);
    State.selectedVertices = new Set(this.oldSel);
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
