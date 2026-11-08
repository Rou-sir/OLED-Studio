import { snapshot } from "./project";
import type { Project } from "./project";

export class History {
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  project: Project;
  revision = 0;
  constructor(project: Project) { this.project = snapshot(project); }
  commit(before: Project): void {
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }
  change(action: (project: Project) => void): void {
    const before = snapshot(this.project);
    try { action(this.project); this.commit(before); }
    catch (error) { this.project = before; throw error; }
  }
  undo(): boolean {
    const project = this.undoStack.pop();
    if (!project) return false;
    this.redoStack.push(snapshot(this.project)); this.project = project; this.changed(); return true;
  }
  redo(): boolean {
    const project = this.redoStack.pop();
    if (!project) return false;
    this.undoStack.push(snapshot(this.project)); this.project = project; this.changed(); return true;
  }
  private changed(): void {
    this.revision++; this.project.modifiedAt = new Date().toISOString();
    while (this.undoStack.length > 1) {
      const buffers = new Set<ArrayBufferLike>();
      for (const project of [this.project, ...this.undoStack, ...this.redoStack]) for (const resource of project.resources) {
        buffers.add(resource.data.buffer); if (resource.source) buffers.add(resource.source.buffer);
      }
      if ([...buffers].reduce((total, buffer) => total + buffer.byteLength, 0) <= 256 * 1024 * 1024) break;
      this.undoStack.shift();
    }
  }
}
