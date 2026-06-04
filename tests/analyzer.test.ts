import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeHtmlImport } from "../src/analyzer";

const focusLike = readFileSync(join(process.cwd(), "fixtures", "synthetic-focus-like.html"), "utf8");
const productSample = readFileSync(join(process.cwd(), "fixtures", "forge-import-sample.html"), "utf8");
const largeProject = readFileSync(join(process.cwd(), "fixtures", "large-project.html"), "utf8");

describe("analyzeHtmlImport", () => {
  it("recovers a simple Forge export without executing scripts", () => {
    const result = analyzeHtmlImport(productSample, "forge-import-sample.html", true);
    expect(result.project.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.project.pages[0].name).toBe("Home");
    expect(result.report.sanitization.quarantinedScripts.length).toBeGreaterThan(0);
    expect(result.project.connections.some((connection) => connection.targetName === "details")).toBe(true);
  });

  it("imports app-shell views without promoting layout containers to pages", () => {
    const shellApp = `<!doctype html>
      <html><head><style>
        #shell{display:flex}.view{display:none}.view.listening,.view.active{display:block}
      </style></head><body>
        <div id="topbar"><button onclick="switchView('landing')">Home</button></div>
        <div id="shell">
          <div id="sidebar"><button onclick="switchView('settings')">Settings</button></div>
          <div id="main">
            <div class="view listening" id="view-landing"><h1>Landing</h1></div>
            <div class="view" id="view-settings"><h1>Settings</h1></div>
          </div>
        </div>
        <script>function switchView(name){document.getElementById('view-'+name).classList.add('active')}</script>
      </body></html>`;
    const result = analyzeHtmlImport(shellApp, "shell.html", true);
    expect(result.project.pages.map((page) => page.name)).toEqual(["Landing", "Settings"]);
    expect(result.project.pages[0].html).toContain('id="topbar"');
    expect(result.project.pages[0].html).toContain('id="view-landing"');
    expect(result.project.pages.map((page) => page.name)).not.toContain("Shell");
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
