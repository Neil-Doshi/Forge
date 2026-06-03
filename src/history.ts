import type { HtmlForgeProject } from "./types";
import { cloneProject } from "./utils";

export interface HistoryEntry {
  id: string;
  label: string;
  before: HtmlForgeProject;
  after: HtmlForgeProject;
  createdAt: string;
}

export class UnifiedHistoryService {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  record(label: string, before: HtmlForgeProject, after: HtmlForgeProject): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.undoStack.push({
      id: crypto.randomUUID(),
      label,
      before: cloneProject(before),
      after: cloneProject(after),
      createdAt: new Date().toISOString()
    });
    this.redoStack = [];
  }

  undo(current: HtmlForgeProject): HtmlForgeProject {
    const entry = this.undoStack.pop();
    if (!entry) return current;
    this.redoStack.push(entry);
    return cloneProject(entry.before);
  }

  redo(current: HtmlForgeProject): HtmlForgeProject {
    const entry = this.redoStack.pop();
    if (!entry) return current;
    this.undoStack.push(entry);
    return cloneProject(entry.after);
  }

  list(): HistoryEntry[] {
    return [...this.undoStack].reverse();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
