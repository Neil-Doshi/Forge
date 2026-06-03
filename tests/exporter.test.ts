import { describe, expect, it } from "vitest";
import { createPrototypeHtml, exportProjectPackage } from "../src/exporter";
import { createBlankProject } from "../src/projectFactory";

describe("exporter", () => {
  it("escapes script-breaking project data and uses generated runtime ids", () => {
    const project = createBlankProject("</script><img src=x onerror=alert(1)>");
    project.pages[0].name = "Home <script>";
    project.notes.malicious = "</script><img src=x onerror=alert(1)>";
    const html = createPrototypeHtml(project, { interactive: true, includeNotes: true });
    expect(html).toContain("hf-screen-0001");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script");
  });

  it("creates a portable zip package", async () => {
    const project = createBlankProject("Portable");
    const pkg = exportProjectPackage(project);
    expect(pkg.fileName).toMatch(/portable_.*\.htmlforge\.zip/);
    expect(pkg.blob.type).toBe("application/zip");
    expect(pkg.blob.size).toBeGreaterThan(100);
  });
});
