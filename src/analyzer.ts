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
    .replace(/^(view|screen|page|route)[-_]+/i, "")
    .replace(/[-_]+(view|screen|page|panel)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function normalizedName(value = ""): string {
  return value
    .toLowerCase()
    .replace(/^#|\./g, "")
    .replace(/^(view|screen|page|route)[-_]+/i, "")
    .replace(/[-_]+(view|screen|page|panel)$/i, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

function nameAliases(...values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => [value, slugify(value ?? ""), normalizedName(value)])
        .map((value) => normalizedName(value))
        .filter(Boolean)
    )
  );
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

function isExplicitViewElement(element: Element): boolean {
  const id = element.id.toLowerCase();
  const classList = Array.from(element.classList).map((item) => item.toLowerCase());
  return (
    element.hasAttribute("data-view") ||
    element.hasAttribute("data-page") ||
    element.hasAttribute("data-page-id") ||
    classList.includes("view") ||
    /^view[-_]/.test(id)
  );
}

function screenNameFor(element: Element): string {
  const dataName = element.getAttribute("data-view") || element.getAttribute("data-page") || element.getAttribute("data-page-id") || "";
  return readableName(dataName || element.id || element.getAttribute("aria-label") || element.querySelector("h1,h2,h3")?.textContent || element.tagName);
}

function documentOrder(a: Element, b: Element): number {
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  return 0;
}

function collectExplicitViewCandidates(doc: Document, switchTargets: Set<string>): ScreenCandidate[] {
  const nodes = Array.from(doc.querySelectorAll("[data-view],[data-page],[data-page-id],.view[id],[id^='view-']"));
  const candidates = nodes
    .filter((element) => {
      if (!isExplicitViewElement(element)) return false;
      const label = `${element.id} ${Array.from(element.classList).join(" ")} ${element.getAttribute("aria-label") ?? ""}`;
      if (OVERLAY_HINT.test(label)) return false;
      const aliases = nameAliases(element.id, element.getAttribute("data-view") ?? undefined, element.getAttribute("data-page") ?? undefined, element.getAttribute("data-page-id") ?? undefined);
      return (
        element.hasAttribute("data-view") ||
        element.hasAttribute("data-page") ||
        element.hasAttribute("data-page-id") ||
        switchTargets.size === 0 ||
        aliases.some((alias) => switchTargets.has(alias)) ||
        element.classList.contains("view")
      );
    })
    .map((element) => {
      const aliases = nameAliases(element.id, element.getAttribute("data-view") ?? undefined, element.getAttribute("data-page") ?? undefined, element.getAttribute("data-page-id") ?? undefined);
      const matchesSwitchTarget = aliases.some((alias) => switchTargets.has(alias));
      return {
        name: screenNameFor(element),
        selector: selectorFor(element),
        element,
        score: 20 + (matchesSwitchTarget ? 8 : 0) + Math.min(countMeaningfulNodes(element), 12)
      };
    })
    .sort((a, b) => documentOrder(a.element, b.element));

  return candidates.filter((candidate, index, list) => !list.slice(0, index).some((prior) => prior.element.contains(candidate.element)));
}

function collectScreenCandidates(doc: Document, switchTargets: Set<string>): ScreenCandidate[] {
  const normalizedSwitchTargets = new Set([...switchTargets].map((target) => normalizedName(target)).filter(Boolean));
  const explicitViews = collectExplicitViewCandidates(doc, normalizedSwitchTargets);
  if (explicitViews.length > 1) return explicitViews.slice(0, 48);

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
    const matchesSwitchTarget = [...normalizedSwitchTargets].some((target) => {
      return nameAliases(id, dataName, ...Array.from(element.classList)).some((value) => value.includes(target) || target.includes(value));
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

  const rankedByConfidence = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, list) => {
      return !list.slice(0, index).some((prior) => prior.element.contains(candidate.element) && prior.score >= candidate.score + 2);
    });
  const ranked = rankedByConfidence.sort((a, b) => documentOrder(a.element, b.element));

  if (!ranked.length && doc.body) {
    ranked.push({ name: "Home", selector: "body", element: doc.body, score: 1 });
  }

  return ranked.slice(0, 48);
}

function sameScreenElement(a: Element, b: Element): boolean {
  if (a === b) return true;
  if (a.id && b.id) return a.id === b.id;
  const aAliases = nameAliases(a.id, a.getAttribute("data-view") ?? undefined, a.getAttribute("data-page") ?? undefined, a.getAttribute("data-page-id") ?? undefined);
  const bAliases = new Set(nameAliases(b.id, b.getAttribute("data-view") ?? undefined, b.getAttribute("data-page") ?? undefined, b.getAttribute("data-page-id") ?? undefined));
  return aAliases.some((alias) => bAliases.has(alias));
}

function shouldSnapshotAppShell(doc: Document, screens: ScreenCandidate[]): boolean {
  return screens.length > 1 && screens.every((screen) => isExplicitViewElement(screen.element)) && Boolean(doc.querySelector("#shell,#main,.view[id],[id^='view-']"));
}

function screenAliasSet(screen: ScreenCandidate): Set<string> {
  const element = screen.element;
  return new Set(
    nameAliases(
      screen.name,
      element.id,
      element.getAttribute("data-view") ?? undefined,
      element.getAttribute("data-page") ?? undefined,
      element.getAttribute("data-page-id") ?? undefined
    )
  );
}

function switchTargetFor(element: Element): string | undefined {
  const directTarget =
    element.getAttribute("data-view") ||
    element.getAttribute("data-page") ||
    element.getAttribute("data-page-id") ||
    element.getAttribute("data-target") ||
    element.getAttribute("href")?.replace(/^#/, "");
  if (directTarget) return directTarget;

  const onclick = element.getAttribute("onclick") ?? "";
  const match = /switchView\s*\(\s*['"]([^'"]+)['"]\s*\)/i.exec(onclick);
  return match?.[1];
}

function navigationAliasesFor(element: Element): string[] {
  const text = element.textContent?.trim() ?? "";
  return nameAliases(
    switchTargetFor(element),
    element.id,
    element.getAttribute("aria-label") ?? undefined,
    text.length <= 80 ? text : undefined
  );
}

function matchesScreenAlias(element: Element, aliases: Set<string>): boolean {
  const navAliases = navigationAliasesFor(element);
  if (aliases.has("landing") && navAliases.includes("home")) return true;
  return navAliases.some((alias) => aliases.has(alias) || [...aliases].some((target) => alias.length > 3 && (target.includes(alias) || alias.includes(target))));
}

function screenHtmlFor(screen: ScreenCandidate, doc: Document, snapshotShell: boolean): string {
  if (!snapshotShell) return screen.element.outerHTML || screen.element.innerHTML;
  const body = doc.body.cloneNode(true) as HTMLElement;
  const aliases = screenAliasSet(screen);
  body.querySelectorAll(".view[id],[id^='view-'],[data-view],[data-page],[data-page-id]").forEach((candidate) => {
    const active = sameScreenElement(candidate, screen.element);
    candidate.classList.toggle("active", active);
    candidate.classList.toggle("listening", active);
    if (active) candidate.classList.remove("hidden");
    else candidate.classList.remove("active", "listening");
  });
  body.querySelectorAll(".tnav-btn,.sb-item,.nav-item,.nav-link,.tab,[role='tab'],[data-nav],nav [onclick*='switchView'],header [onclick*='switchView'],aside [onclick*='switchView']").forEach((candidate) => {
    const active = matchesScreenAlias(candidate, aliases);
    candidate.classList.toggle("active", active);
    candidate.classList.toggle("listening", active);
  });
  return body.innerHTML;
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
      status: availableNames.has(normalizedName(targetName)) ? "mapped" : "missing-target",
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
      status: targetName && availableNames.has(normalizedName(targetName)) ? "mapped" : "missing-target",
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
  const snapshotShell = shouldSnapshotAppShell(safeDoc, screens);
  const overlays = collectOverlayCandidates(safeDoc);
  const availableNames = new Set<string>();
  screens.forEach((screen) => {
    const dataView = screen.element.getAttribute("data-view") || screen.element.getAttribute("data-page") || screen.element.getAttribute("data-page-id") || undefined;
    nameAliases(screen.name, screen.element.id, dataView).forEach((alias) => availableNames.add(alias));
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
    html: screenHtmlFor(screen, safeDoc, snapshotShell) || sanitized.html,
    css: pageCssFor(screen.selector, sanitized.css),
    notes: "",
    componentCount: countMeaningfulNodes(screen.element),
    createdAt: now,
    modifiedAt: now
  }));

  const pageByName = new Map<string, ForgePage>();
  pages.forEach((page, index) => {
    nameAliases(page.name, page.slug).forEach((alias) => pageByName.set(alias, page));
    const sourceId = screens[index]?.element.id;
    if (sourceId) nameAliases(sourceId).forEach((alias) => pageByName.set(alias, page));
    const sourceData = screens[index]?.element.getAttribute("data-view") || screens[index]?.element.getAttribute("data-page") || screens[index]?.element.getAttribute("data-page-id");
    if (sourceData) nameAliases(sourceData).forEach((alias) => pageByName.set(alias, page));
  });

  const forgeOverlays: ForgeOverlay[] = overlays.map((overlay, index) => ({
    id: createId("overlay"),
    generatedId: generatedOverlayId(index),
    name: overlay.name,
    html: overlay.element.innerHTML,
    css: pageCssFor(overlay.selector, sanitized.css)
  }));

  const connections: ForgeConnection[] = interactions.map((interaction) => {
    const target = interaction.targetName ? pageByName.get(normalizedName(interaction.targetName)) : undefined;
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
      html: screenHtmlFor(screen, safeDoc, snapshotShell),
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
