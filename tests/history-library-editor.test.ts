import { describe, expect, it } from "vitest";
import { GRAPESJS_INIT_BASE } from "../src/editor";
import { UnifiedHistoryService } from "../src/history";
import { suggestLibraryItems } from "../src/library";
import { createBlankProject } from "../src/projectFactory";
import { cloneProject } from "../src/utils";

describe("editor configuration", () => {
  it("disables GrapesJS telemetry and built-in storage", () => {
    expect(GRAPESJS_INIT_BASE.telemetry).toBe(false);
    expect(GRAPESJS_INIT_BASE.storageManager).toBe(false);
    expect(GRAPESJS_INIT_BASE.cssIcons).toBe("");
    expect(GRAPESJS_INIT_BASE.canvas.scripts).toEqual([]);
  });
});

describe("history and library", () => {
  it("records cross-model undo and redo snapshots", () => {
    const history = new UnifiedHistoryService();
    const before = createBlankProject("Before");
    const after = cloneProject(before);
    after.connections.push({
      id: "connection-test",
      sourcePageId: before.pages[0].id,
      triggerLabel: "Settings",
      action: "unresolved",
      status: "missing-target",
      targetName: "settings",
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    });
    history.record("repair", before, after);
    expect(history.canUndo()).toBe(true);
    expect(history.undo(after).connections).toHaveLength(0);
    expect(history.redo(before).connections).toHaveLength(1);
  });

  it("suggests repeated local components without auto-promoting them", () => {
    const project = createBlankProject("Library");
    project.pages[0].html = '<header class="topbar"><nav>One</nav></header><header class="topbar"><nav>Two</nav></header>';
    const suggestions = suggestLibraryItems(project);
    expect(suggestions.some((item) => item.scope === "review")).toBe(true);
  });
});
