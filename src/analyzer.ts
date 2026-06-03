import { sanitizeImportedHtml } from "./sanitize";
import { generatedOverlayId, generatedScreenId, slugify, createId, nowIso } from "./utils";
import type { ForgeConnection, ForgeOverlay, ForgePage, HtmlForgeProject, ImportInteractionCandidate, ImportReport } from "./types";
import { PROJECT_SCHEMA_VERSION } from "./types";

const SCREEN_HINT = /(view|screen|page|panel|route|workspace|dashboard|agenda|capture|focus|settings|library|report|export|home)/i;
const OVERLAY_HINT = /(overlay|modal|dialog|drawer|popover|capture-overlay|wheel-overlay)/i;
const SWITCH_VIEW_PATTERN = /switchView\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;

export interface ImportAnalysisResult {
  report: ImportReport;
  project: HtmlForgeProject;
}

interface ScreenCandidate {
  name: string;
  selector: string;
  element: Element;
  score: number;
}

function readableName(value: string): string {
  return value
    .replace(/^#|\./g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function selectorFor(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const dataView = element.getAttribute("data-view") || element.getAttribute("data-page") || element.getAttribute("data-page-id");
  if (dataView) return `[data-view="${CSS.escape(dataView)}"]`;
  const className = Array.from(element.classList).find((item) => SCREEN_HINT.test(item) || OVERLAY_HINT.test(item));
  if (className) return `.${CSS.escape(className)}`;
  return element.tagName.toLowerCase();
}

function countMeaningfulNodes(element: Element): number {
  return Array.from(element.querySelectorAll("*")).filter((node) => {
    const tag = node.tagName.toLowerCase();
    return !["style", "meta", "link"].includes(tag);
  }).length;
}

function collectScreenCandidates(doc: Document, switchTargets: Set<string>): ScreenCandidate[] {
  const candidates = new Map<Element, ScreenCandidate>();
  const selectors = [
    "[data-view]",
    "[data-page]",
    "[data-page-id]",
    "[role='main']",
    "main",
    "section",
    "article",
    "div[id]",
    "div[class]"
  ];

  doc.querySelectorAll(selectors.join(",")).forEach((element) => {
    const id = element.id || "";
    const dataName = element.getAttribute("data-view") || element.getAttribute("data-page") || element.getAttribute("data-page-id") || "";
    const classHint = Array.from(element.classList).find((item) => SCREEN_HINT.test(item)) ?? "";
    const label = dataName || id || classHint || element.getAttribute("aria-label") || element.querySelector("h1,h2,h3")?.textContent || element.tagName;
    const textSize = (element.textContent ?? "").trim().length;
    const childCount = countMeaningfulNodes(element);
    const hasHint = SCREEN_HINT.test(`${id} ${dataName} ${classHint}`);
    const matchesSwitchTarget = [...switchTargets].some((target) => {
      const normalized = target.toLowerCase();
      return [id, dataName, ...Array.from(element.classList)].some((value) => value.toLowerCase().includes(normalized));
    });
    let score = 0;
    if (hasHint) score += 5;
    if (matchesSwitchTarget) score += 6;
    if (element.matches("main,section,article,[role='main']")) score += 2;
    if (childCount > 4) score += 2;
    if (textSize > 40) score += 1;
    if (OVERLAY_HINT.test(`${id} ${dataName} ${classHint}`)) score -= 5;
    if (score < 3) return;
    candidates.set(element, { name: readableName(label), selector: selectorFor(element), element, score });
  });

  const ranked = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, list) => {
      return !list.slice(0, index).some((prior) => prior.element.contains(candidate.element) && prior.score >= candidate.score + 2);
    });

  if (!ranked.length && doc.body) {
    ranked.push({ name: "Home", selector: "body", element: doc.body, score: 1 });
  }

  return ranked.slice(0, 48);
}

function collectOverlayCandidates(doc: Document): ScreenCandidate[] {
  const overlays: ScreenCandidate[] = [];
  doc.querySelectorAll("[role='dialog'],dialog,[aria-modal='true'],[id],[class]").forEach((element) => {
    const label = `${element.id} ${Array.from(element.classList).join(" ")} ${element.getAttribute("aria-label") ?? ""}`;
    if (!OVERLAY_HINT.test(label)) return;
    overlays.push({
      name: readableName(element.id || element.getAttribute("aria-label") || Array.from(element.classList)[0] || "Overlay"),
      selector: selectorFor(element),
      element,
      score: 10
    });
  });
  return overlays.slice(0, 24);
}

function collectSwitchTargets(rawHtml: string): Set<string> {
  const targets = new Set<string>();
  for (const match of rawHtml.matchAll(SWITCH_VIEW_PATTERN)) targets.add(match[1]);
  return targets;
}

function snippetAround(source: string, index: number): string {
  return source.slice(Math.max(0, index - 80), index + 180).replace(/\s+/g, " ").trim();
}

function collectInteractions(rawHtml: string, doc: Document, availableNames: Set<string>): ImportInteractionCandidate[] {
  const interactions: ImportInteractionCandidate[] = [];
  for (const match of rawHtml.matchAll(SWITCH_VIEW_PATTERN)) {
    const targetName = match[1];
    interactions.push({
      id: createId("interaction"),
      type: "switchView",
      sourceName: "Imported script",
      targetName,
      status: availableNames.has(targetName.toLowerCase()) ? "mapped" : "missing-target",
      snippet: snippetAround(rawHtml, match.index ?? 0)
    });
  }

  doc.querySelectorAll("[data-target],[data-action],[href^='#']").forEach((element) => {
    const targetName = element.getAttribute("data-target") || element.getAttribute("href")?.replace(/^#/, "") || undefined;
    const sourceName = element.textContent?.trim().slice(0, 80) || element.getAttribute("aria-label") || element.tagName.toLowerCase();
    interactions.push({
      id: createId("interaction"),
      type: element.hasAttribute("data-target") ? "data-target" : "anchor",
      sourceName,
      targetName,
      selector: selectorFor(element),
      status: targetName && availableNames.has(targetName.toLowerCase()) ? "mapped" : "missing-target",
      snippet: element.outerHTML.slice(0, 240)
    });
  });

  doc.querySelectorAll("form").forEach((form) => {
    interactions.push({
      id: createId("interaction"),
      type: "form",
      sourceName: form.getAttribute("aria-label") || "Form submission",
      status: "unsupported",
      snippet: form.outerHTML.slice(0, 240)
    });
  });

  return interactions;
}

function accessibilityFindings(doc: Document): string[] {
  const findings: string[] = [];
  doc.querySelectorAll("button").forEach((button, index) => {
    if (!button.textContent?.trim() && !button.getAttribute("aria-label")) findings.push(`Button ${index + 1} has no visible label or aria-label.`);
  });
  doc.querySelectorAll("img").forEach((image, index) => {
    if (!image.getAttribute("alt")) findings.push(`Image ${index + 1} is missing alt text.`);
  });
  doc.querySelectorAll("[role='dialog'],dialog,[aria-modal='true']").forEach((dialog, index) => {
    if (!dialog.querySelector("button,[aria-label*='close' i]")) findings.push(`Dialog ${index + 1} may not expose a close control.`);
  });
  return findings.slice(0, 80);
}

function pageCssFor(selector: string, sanitizedCss: string): string {
  if (!sanitizedCss.trim()) return "";
  return `/* Imported safe CSS retained for ${selector}. */\n${sanitizedCss}`;
}

export function analyzeHtmlImport(rawHtml: string, fileName = "import.html", retainRawSource = true): ImportAnalysisResult {
  const started = performance.now();
  const sanitized = sanitizeImportedHtml(rawHtml);
  const parser = new DOMParser();
  const rawDoc = parser.parseFromString(rawHtml, "text/html");
  const safeDoc = parser.parseFromString(sanitized.previewHtml, "text/html");
  const switchTargets = collectSwitchTargets(rawHtml);
  const screens = collectScreenCandidates(safeDoc, switchTargets);
  const overlays = collectOverlayCandidates(safeDoc);
  const availableNames = new Set<string>();
  screens.forEach((screen) => {
    availableNames.add(screen.name.toLowerCase());
    const slug = slugify(screen.name);
    availableNames.add(slug.toLowerCase());
    availableNames.add(slug.replace(/-(view|screen|page|panel)$/i, "").toLowerCase());
    if (screen.element.id) availableNames.add(screen.element.id.toLowerCase());
    if (screen.element.id) availableNames.add(screen.element.id.replace(/-(view|screen|page|panel)$/i, "").toLowerCase());
    const dataView = screen.element.getAttribute("data-view") || screen.element.getAttribute("data-page") || screen.element.getAttribute("data-page-id");
    if (dataView) availableNames.add(dataView.toLowerCase());
    if (dataView) availableNames.add(dataView.replace(/-(view|screen|page|panel)$/i, "").toLowerCase());
  });

  const interactions = collectInteractions(rawHtml, rawDoc, availableNames);
  const missingTargets = Array.from(
    new Set(interactions.filter((interaction) => interaction.status === "missing-target" && interaction.targetName).map((interaction) => interaction.targetName as string))
  );
  const accessibility = accessibilityFindings(safeDoc);
  const now = nowIso();
  const projectId = createId("project");

  const pages: ForgePage[] = screens.map((screen, index) => ({
    id: createId("page"),
    generatedId: generatedScreenId(index),
    name: screen.name,
    slug: slugify(screen.name),
    html: screen.element.innerHTML || sanitized.html,
    css: pageCssFor(screen.selector, sanitized.css),
    notes: "",
    componentCount: countMeaningfulNodes(screen.element),
    createdAt: now,
    modifiedAt: now
  }));

  const pageByName = new Map<string, ForgePage>();
  pages.forEach((page, index) => {
    pageByName.set(page.name.toLowerCase(), page);
    pageByName.set(page.slug.toLowerCase(), page);
    pageByName.set(page.slug.replace(/-(view|screen|page|panel)$/i, "").toLowerCase(), page);
    const sourceId = screens[index]?.element.id;
    if (sourceId) {
      pageByName.set(sourceId.toLowerCase(), page);
      pageByName.set(sourceId.replace(/-(view|screen|page|panel)$/i, "").toLowerCase(), page);
    }
    const sourceData = screens[index]?.element.getAttribute("data-view") || screens[index]?.element.getAttribute("data-page") || screens[index]?.element.getAttribute("data-page-id");
    if (sourceData) {
      pageByName.set(sourceData.toLowerCase(), page);
      pageByName.set(sourceData.replace(/-(view|screen|page|panel)$/i, "").toLowerCase(), page);
    }
  });

  const forgeOverlays: ForgeOverlay[] = overlays.map((overlay, index) => ({
    id: createId("overlay"),
    generatedId: generatedOverlayId(index),
    name: overlay.name,
    html: overlay.element.innerHTML,
    css: pageCssFor(overlay.selector, sanitized.css)
  }));

  const connections: ForgeConnection[] = interactions.map((interaction) => {
    const target = interaction.targetName ? pageByName.get(interaction.targetName.toLowerCase()) : undefined;
    return {
      id: createId("connection"),
      sourcePageId: pages[0]?.id ?? "",
      triggerLabel: interaction.sourceName || interaction.type,
      action: interaction.status === "unsupported" ? "unresolved" : "navigate",
      targetId: target?.id,
      targetName: interaction.targetName,
      selector: interaction.selector,
      status: interaction.status === "mapped" ? "mapped" : interaction.status === "missing-target" ? "missing-target" : "unsupported",
      sourceSnippet: interaction.snippet,
      createdAt: now,
      modifiedAt: now
    };
  });

  const reportId = createId("report");
  const elapsed = Math.round(performance.now() - started);
  const report: ImportReport = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: reportId,
    projectId,
    importedAt: now,
    fileName,
    sourceBytes: new Blob([rawHtml]).size,
    rawSourceRetained: retainRawSource,
    sanitizedPreviewHtml: sanitized.previewHtml,
    sanitizedHtml: sanitized.html,
    sanitizedCss: sanitized.css,
    stats: {
      elementCount: rawDoc.querySelectorAll("*").length,
      componentCount: pages.reduce((sum, page) => sum + page.componentCount, 0),
      screenCount: pages.length,
      overlayCount: forgeOverlays.length,
      interactionCount: interactions.length,
      warningCount:
        missingTargets.length +
        sanitized.report.quarantinedScripts.length +
        sanitized.report.blockedUrls.length +
        sanitized.cssReport.blockedResources.length +
        accessibility.length,
      importMs: elapsed
    },
    screens: screens.map((screen, index) => ({
      id: pages[index]?.id ?? createId("screen"),
      name: screen.name,
      selector: screen.selector,
      html: screen.element.innerHTML,
      css: pageCssFor(screen.selector, sanitized.css),
      componentCount: countMeaningfulNodes(screen.element)
    })),
    overlays: overlays.map((overlay, index) => ({
      id: forgeOverlays[index]?.id ?? createId("overlay"),
      name: overlay.name,
      selector: overlay.selector,
      html: overlay.element.innerHTML,
      css: pageCssFor(overlay.selector, sanitized.css)
    })),
    css: sanitized.cssReport,
    sanitization: sanitized.report,
    interactions,
    missingTargets,
    resources: sanitized.resources,
    accessibility,
    unsupported: interactions.filter((interaction) => interaction.status === "unsupported" || interaction.status === "suspected").map((interaction) => interaction.snippet),
    decisions: []
  };

  const project: HtmlForgeProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    slug: slugify(fileName.replace(/\.[^.]+$/, "")),
    name: readableName(fileName.replace(/\.[^.]+$/, "")) || "Imported HTML Project",
    createdAt: now,
    modifiedAt: now,
    revision: 1,
    lastWriterInstanceId: "import",
    storagePersistence: "unknown",
    pages: pages.length
      ? pages
      : [
          {
            id: createId("page"),
            generatedId: generatedScreenId(0),
            name: "Home",
            slug: "home",
            html: sanitized.html,
            css: sanitized.css,
            notes: "",
            componentCount: rawDoc.querySelectorAll("*").length,
            createdAt: now,
            modifiedAt: now
          }
        ],
    overlays: forgeOverlays,
    connections,
    sharedMasters: [],
    sharedInstances: [],
    libraryRefs: [],
    assets: [],
    source: {
      fileName,
      rawText: retainRawSource ? rawHtml : undefined,
      retained: retainRawSource
    },
    importReportId: reportId,
    importSummary: `${report.stats.screenCount} screens, ${report.stats.overlayCount} overlays, ${report.stats.interactionCount} interaction candidates, ${report.stats.warningCount} warnings.`,
    grapesProjectData: undefined,
    notes: {}
  };

  return { report, project };
}
