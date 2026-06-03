import { describe, expect, it } from "vitest";
import { createBlankProject } from "../src/projectFactory";
import { listProjects, saveProject } from "../src/storage";

describe("storage", () => {
  it("saves projects with revision and conflict protection", async () => {
    const project = createBlankProject("Storage Test");
    const saved = await saveProject(project, "test", 1);
    expect(saved.revision).toBe(1);
    const listed = await listProjects();
    expect(listed.some((item) => item.name === "Storage Test")).toBe(true);
    await expect(saveProject(saved, "stale", 0)).rejects.toThrow(/Save conflict/);
  });
});
