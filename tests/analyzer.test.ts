import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeHtmlImport } from "../src/analyzer";

const focusLike = readFileSync(join(process.cwd(), "fixtures", "synthetic-focus-like.html"), "utf8");
const prototype = readFileSync(join(process.cwd(), "fixtures", "forge-prototype.html"), "utf8");
const largeProject = readFileSync(join(process.cwd(), "fixtures", "large-project.html"), "utf8");

describe("analyzeHtmlImport", () => {
  it("recovers a simple Forge export without executing scripts", () => {
    const result = analyzeHtmlImport(prototype, "forge-prototype.html", true);
    expect(result.project.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.report.sanitization.quarantinedScripts.length).toBeGreaterThan(0);
    expect(result.project.connections.some((connection) => connection.targetName === "details")).toBe(true);
  });

  it("detects the synthetic FOCUS acceptance shape", () => {
    const result = analyzeHtmlImport(focusLike, "synthetic-focus.html", true);
    expect(result.report.stats.screenCount).toBeGreaterThanOrEqual(11);
    expect(result.report.overlays.map((overlay) => overlay.name.toLowerCase())).toEqual(expect.arrayContaining(["wheel overlay", "capture overlay"]));
    expect(result.report.css.tokens).toEqual(expect.arrayContaining(["--gemstone", "--focus-accent"]));
    expect(result.report.css.keyframes).toEqual(expect.arrayContaining(["wheelPulse", "captureRise"]));
    expect(result.report.missingTargets).toContain("settings");
    expect(result.project.connections.some((connection) => connection.status === "missing-target")).toBe(true);
  });

  it("handles the committed large-project stress fixture", () => {
    const result = analyzeHtmlImport(largeProject, "large-project.html", false);
    expect(result.report.stats.elementCount).toBeGreaterThanOrEqual(3000);
    expect(result.report.stats.importMs).toBeGreaterThanOrEqual(0);
    expect(result.report.css.tokens).toContain("--stress-accent");
  });
});
