import { strToU8, zipSync } from "fflate";
import type { ForgeConnection, ForgePage, HtmlForgeProject, ImportReport, PackageExport } from "./types";
import { escapeAttribute, escapeHtml, formatFileStamp, safeJson, slugify } from "./utils";

export interface HtmlExportOptions {
  interactive: boolean;
  includeNotes?: boolean;
  includeReport?: boolean;
}

function styleForPage(page: ForgePage): string {
  return page.css || "";
}

function visibleScreenClass(index: number): string {
  return index === 0 ? "is-active" : "";
}

function connectionRuntimeData(project: HtmlForgeProject): Array<{ source: string; target: string; action: string; selector?: string; label: string }> {
  return project.connections
    .filter((connection) => connection.status === "mapped" && connection.targetId)
    .map((connection) => {
      const sourcePage = project.pages.find((page) => page.id === connection.sourcePageId) ?? project.pages[0];
      const targetPage = project.pages.find((page) => page.id === connection.targetId);
      const targetOverlay = project.overlays.find((overlay) => overlay.id === connection.targetId);
      return {
        source: sourcePage?.generatedId ?? "hf-screen-0001",
        target: targetPage?.generatedId ?? targetOverlay?.generatedId ?? "",
        action: connection.action,
        selector: connection.selector,
        label: connection.triggerLabel
      };
    })
    .filter((item) => /^hf-(screen|overlay)-\d{4}$/.test(item.target));
}

function runtimeScript(data: ReturnType<typeof connectionRuntimeData>): string {
  return `
(() => {
  const connections = ${safeJson(data)};
  const showScreen = (id) => {
    document.querySelectorAll("[data-hf-screen]").forEach((screen) => screen.classList.toggle("is-active", screen.id === id));
    document.querySelectorAll("[data-hf-overlay]").forEach((overlay) => overlay.hidden = true);
  };
  const openOverlay = (id) => {
    const overlay = document.getElementById(id);
    if (overlay) overlay.hidden = false;
  };
  const closeOverlay = (id) => {
    const overlay = document.getElementById(id);
    if (overlay) overlay.hidden = true;
  };
  for (const connection of connections) {
    const root = document.getElementById(connection.source);
    const trigger = connection.selector && root ? root.querySelector(connection.selector) : null;
    const fallback = root ? Array.from(root.querySelectorAll("button,a,[role='button']")).find((el) => (el.textContent || el.getAttribute("aria-label") || "").trim() === connection.label) : null;
    const element = trigger || fallback;
    if (!element) continue;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      if (connection.action === "open-overlay") openOverlay(connection.target);
      else if (connection.action === "close-overlay") closeOverlay(connection.target);
      else showScreen(connection.target);
    });
  }
  document.querySelectorAll("[data-hf-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const overlay = button.closest("[data-hf-overlay]");
      if (overlay) overlay.hidden = true;
    });
  });
})();`;
}

export function createPrototypeHtml(project: HtmlForgeProject, options: HtmlExportOptions = { interactive: true }): string {
  const connections = connectionRuntimeData(project);
  const css = project.pages.map(styleForPage).join("\n") + "\n" + project.overlays.map((overlay) => overlay.css).join("\n");
  const screens = project.pages
    .map(
      (page, index) => `<section id="${escapeAttribute(page.generatedId)}" class="hf-screen ${visibleScreenClass(index)}" data-hf-screen="${escapeAttribute(
        page.name
      )}" aria-label="${escapeAttribute(page.name)}">${page.html}</section>`
    )
    .join("\n");
  const overlays = project.overlays
    .map(
      (overlay) =>
        `<aside id="${escapeAttribute(overlay.generatedId)}" class="hf-overlay" data-hf-overlay="${escapeAttribute(
          overlay.name
        )}" hidden><button class="hf-overlay-close" type="button" data-hf-close aria-label="Close overlay">Close</button>${overlay.html}</aside>`
    )
    .join("\n");
  const notes = options.includeNotes
    ? `<script type="application/json" id="html-forge-notes">${safeJson(project.notes)}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)}</title>
<style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#18202f}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f8fafc}
.hf-screen{display:none;min-height:100vh;padding:24px}
.hf-screen.is-active{display:block}
.hf-overlay{position:fixed;inset:0;z-index:20;background:rgba(12,18,28,.62);padding:32px;overflow:auto}
.hf-overlay[hidden]{display:none}
.hf-overlay-close{position:fixed;right:20px;top:20px;border:0;border-radius:6px;padding:10px 14px;background:#101827;color:white}
${css}
</style>
</head>
<body>
${screens}
${overlays}
${notes}
${options.interactive ? `<script>${runtimeScript(connections)}</script>` : ""}
</body>
</html>`;
}

export function createStaticVisualHtml(project: HtmlForgeProject): string {
  return createPrototypeHtml(project, { interactive: false });
}

export function createProjectJson(project: HtmlForgeProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function createImportReportMarkdown(report: ImportReport): string {
  const lines = [
    `# Import Report: ${report.fileName}`,
    "",
    `Imported: ${report.importedAt}`,
    `Screens: ${report.stats.screenCount}`,
    `Overlays: ${report.stats.overlayCount}`,
    `Interactions: ${report.stats.interactionCount}`,
    `Warnings: ${report.stats.warningCount}`,
    "",
    "## Missing Targets",
    report.missingTargets.length ? report.missingTargets.map((target) => `- ${target}`).join("\n") : "None",
    "",
    "## Blocked Resources",
    report.resources.length ? report.resources.map((resource) => `- ${resource.type}: ${resource.url} (${resource.context})`).join("\n") : "None",
    "",
    "## Quarantined Scripts",
    report.sanitization.quarantinedScripts.length
      ? report.sanitization.quarantinedScripts.map((script) => `- ${script.location}: ${script.sample}`).join("\n")
      : "None",
    "",
    "## Accessibility Findings",
    report.accessibility.length ? report.accessibility.map((finding) => `- ${finding}`).join("\n") : "None"
  ];
  return `${lines.join("\n")}\n`;
}

export function exportProjectPackage(project: HtmlForgeProject, report?: ImportReport): PackageExport {
  const stamp = formatFileStamp();
  const fileBase = `${slugify(project.name)}_${stamp}`;
  const entries: Record<string, Uint8Array> = {
    "project.htmlforge.json": strToU8(createProjectJson(project)),
    "prototype.html": strToU8(createPrototypeHtml(project, { interactive: true })),
    "static-visual.html": strToU8(createStaticVisualHtml(project)),
    "THIRD_PARTY_NOTICES.md": strToU8("See the hosted HTML Forge repository for full dependency notices. Runtime export contains no imported scripts.\n")
  };
  if (report) {
    entries["import-report.md"] = strToU8(createImportReportMarkdown(report));
    entries["import-report.json"] = strToU8(JSON.stringify(report, null, 2));
    if (project.source?.retained && project.source.rawText) entries[`source/${project.source.fileName}`] = strToU8(project.source.rawText);
  }
  for (const asset of project.assets) {
    if (asset.dataUrl) entries[`assets/${asset.name}`] = strToU8(asset.dataUrl);
  }
  const zipped = zipSync(entries, { level: 6 });
  return {
    fileName: `${fileBase}.htmlforge.zip`,
    blob: new Blob([zipped], { type: "application/zip" })
  };
}

export function exportAiHandoff(project: HtmlForgeProject, report?: ImportReport): PackageExport {
  const stamp = formatFileStamp();
  const fileBase = `${slugify(project.name)}_${stamp}_ai-handoff`;
  const connections = project.connections
    .map((connection: ForgeConnection) => `- ${connection.triggerLabel}: ${connection.action} -> ${connection.targetName ?? "unresolved"} (${connection.status})`)
    .join("\n");
  const markdown = `# HTML Forge AI Handoff

Project: ${project.name}
Generated: ${new Date().toISOString()}

## Screens
${project.pages.map((page) => `- ${page.name} (${page.generatedId})`).join("\n")}

## Connections
${connections || "No mapped connections."}

## Import Summary
${project.importSummary ?? "No import report attached."}
`;
  const entries: Record<string, Uint8Array> = {
    "handoff.md": strToU8(markdown),
    "project.json": strToU8(createProjectJson(project)),
    "prototype.html": strToU8(createPrototypeHtml(project, { interactive: true })),
    "static-visual.html": strToU8(createStaticVisualHtml(project))
  };
  if (report) entries["import-report.json"] = strToU8(JSON.stringify(report, null, 2));
  return {
    fileName: `${fileBase}.zip`,
    blob: new Blob([zipSync(entries, { level: 6 })], { type: "application/zip" })
  };
}
