import "./styles.css";
import { strFromU8, unzipSync } from "fflate";
import { analyzeHtmlImport, type ImportAnalysisResult } from "./analyzer";
import { createProductHtml, createProjectJson, exportProjectPackage } from "./exporter";
import { createBlankProject } from "./projectFactory";
import { migrateProject } from "./migrations";
import {
  getImportReport,
  getProject,
  getStorageStatus,
  listLibraryItems,
  listProjects,
  putProject,
  requestPersistentStorage,
  saveImportReport,
  saveLibraryItem,
  saveProject
} from "./storage";
import { PROJECT_SCHEMA_VERSION, type ForgeAsset, type ForgeConnection, type ForgePage, type HtmlForgeProject, type LibraryItem } from "./types";
import { createId, downloadBlob, escapeAttribute, escapeHtml, formatFileStamp, generatedScreenId, humanBytes, nowIso, slugify } from "./utils";

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("HTML Forge root element is missing.");
const root: HTMLDivElement = rootElement;

type PanelId = "pages" | "reuse" | "assets" | "themes" | "import";
type InspectorTab = "design" | "layout" | "actions" | "canvas";
type UtilityTab = "toolbox" | "objects" | "properties";
type PropertyTab = "properties" | "connections";
type ToolId = "select" | "hand" | "text" | "frame";
type ElementType = "frame" | "text" | "button" | "input" | "card" | "image" | "shape" | "html";
type ThemeId = "forge" | "slate" | "light" | "terminal";

interface ForgeElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  text: string;
  html: string;
  fill: string;
  color: string;
  border: string;
  borderWidth: number;
  radius: number;
  font: number;
  fontFamily: string;
  weight: number;
  opacity: number;
  shadow: string;
  locked: boolean;
  hidden: boolean;
  action: "" | "page" | "toggle";
  target: string;
  assetId?: string;
  assetData?: string;
  parentId?: string;
  sourceTag?: string;
  sourcePath?: string;
  z: number;
}

interface ForgeDesignPage {
  id: string;
  generatedId: string;
  name: string;
  slug: string;
  width: number;
  height: number;
  background: string;
  elements: ForgeElement[];
}

interface ForgeTemplate {
  id: string;
  name: string;
  category: "component" | "imported" | "blueprint";
  elements: ForgeElement[];
}

interface ForgeDesignModel {
  version: 2;
  theme: ThemeId;
  currentPageId: string;
  pages: ForgeDesignPage[];
  templates: ForgeTemplate[];
  zoom: number;
  panX: number;
  panY: number;
  grid: boolean;
  snap: boolean;
  nextNumber: number;
}

interface DragState {
  kind: "drag" | "resize" | "pan" | "create";
  id?: string;
  handle?: string;
  startClientX: number;
  startClientY: number;
  startCanvasX: number;
  startCanvasY: number;
  startPanX?: number;
  startPanY?: number;
  originals: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  ratio?: number;
}

interface PanelResizeState {
  side: "left" | "right";
  startClientX: number;
  startWidth: number;
}

const MODEL_NOTE_KEY = "forgeEditorModel";
const instanceId = createId("instance");
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 800;
const DESKTOP_APP_IMPORT_WIDTH = 1920;
const DESKTOP_APP_IMPORT_HEIGHT = 960;
const MIN_IMPORT_WIDTH = 320;
const MIN_IMPORT_HEIGHT = 240;
const MAX_IMPORT_WIDTH = 4096;
const MAX_IMPORT_HEIGHT = 2160;
const MAX_MEASURED_IMPORT_ELEMENTS = 180;

const defaultFont = "Inter, Segoe UI, system-ui, sans-serif";
const themes: Record<ThemeId, { label: string; bg: string; panel: string; canvas: string; text: string; accent: string; accent2: string; muted: string; line: string }> = {
  forge: { label: "Forge", bg: "#07111f", panel: "#101b2b", canvas: "#ffffff", text: "#f8fafc", accent: "#f59e0b", accent2: "#22d3ee", muted: "#9fb0c5", line: "#26384f" },
  slate: { label: "Slate", bg: "#111827", panel: "#1f2937", canvas: "#f8fafc", text: "#f9fafb", accent: "#38bdf8", accent2: "#a7f3d0", muted: "#cbd5e1", line: "#374151" },
  light: { label: "Light", bg: "#edf2f7", panel: "#ffffff", canvas: "#ffffff", text: "#172033", accent: "#0f766e", accent2: "#2563eb", muted: "#637083", line: "#d7dee9" },
  terminal: { label: "Terminal", bg: "#050807", panel: "#0c1511", canvas: "#07110c", text: "#d6ffe3", accent: "#22c55e", accent2: "#84cc16", muted: "#8fc9a4", line: "#1d3a2a" }
};

const elementDefaults: Record<ElementType, Omit<ForgeElement, "id" | "name" | "x" | "y" | "z">> = {
  frame: {
    type: "frame",
    w: 360,
    h: 240,
    rotation: 0,
    text: "",
    html: "",
    fill: "#f8fafc",
    color: "#172033",
    border: "#cbd5e1",
    borderWidth: 1,
    radius: 8,
    font: 16,
    fontFamily: defaultFont,
    weight: 600,
    opacity: 100,
    shadow: "0 12px 34px rgba(15,23,42,.12)",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  text: {
    type: "text",
    w: 280,
    h: 72,
    rotation: 0,
    text: "New text",
    html: "",
    fill: "transparent",
    color: "#172033",
    border: "transparent",
    borderWidth: 0,
    radius: 0,
    font: 28,
    fontFamily: defaultFont,
    weight: 800,
    opacity: 100,
    shadow: "",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  button: {
    type: "button",
    w: 148,
    h: 48,
    rotation: 0,
    text: "Button",
    html: "",
    fill: "#0f766e",
    color: "#ffffff",
    border: "#0f766e",
    borderWidth: 1,
    radius: 8,
    font: 15,
    fontFamily: defaultFont,
    weight: 800,
    opacity: 100,
    shadow: "",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  input: {
    type: "input",
    w: 280,
    h: 46,
    rotation: 0,
    text: "Input label",
    html: "",
    fill: "#ffffff",
    color: "#344258",
    border: "#cbd5e1",
    borderWidth: 1,
    radius: 8,
    font: 14,
    fontFamily: defaultFont,
    weight: 600,
    opacity: 100,
    shadow: "",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  card: {
    type: "card",
    w: 320,
    h: 190,
    rotation: 0,
    text: "Card title\nCard content",
    html: "",
    fill: "#ffffff",
    color: "#172033",
    border: "#d9e1eb",
    borderWidth: 1,
    radius: 10,
    font: 16,
    fontFamily: defaultFont,
    weight: 700,
    opacity: 100,
    shadow: "0 12px 34px rgba(15,23,42,.12)",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  image: {
    type: "image",
    w: 280,
    h: 180,
    rotation: 0,
    text: "Image",
    html: "",
    fill: "#e5e7eb",
    color: "#475569",
    border: "#cbd5e1",
    borderWidth: 1,
    radius: 8,
    font: 14,
    fontFamily: defaultFont,
    weight: 700,
    opacity: 100,
    shadow: "",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  shape: {
    type: "shape",
    w: 120,
    h: 120,
    rotation: 0,
    text: "",
    html: "",
    fill: "#f59e0b",
    color: "#111827",
    border: "#f59e0b",
    borderWidth: 1,
    radius: 999,
    font: 14,
    fontFamily: defaultFont,
    weight: 700,
    opacity: 100,
    shadow: "",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  },
  html: {
    type: "html",
    w: 420,
    h: 220,
    rotation: 0,
    text: "",
    html: "<p>Imported HTML</p>",
    fill: "#ffffff",
    color: "#172033",
    border: "#d9e1eb",
    borderWidth: 1,
    radius: 8,
    font: 15,
    fontFamily: defaultFont,
    weight: 500,
    opacity: 100,
    shadow: "0 12px 34px rgba(15,23,42,.10)",
    locked: false,
    hidden: false,
    action: "",
    target: ""
  }
};

const iconPaths = {
  add: '<path d="M12 5v14M5 12h14"/>',
  pointer: '<path d="m5 3 10 14 1-7 6-1Z"/><path d="m13 13 4 5"/>',
  hand: '<path d="M8 11V5a2 2 0 0 1 4 0v5"/><path d="M12 10V4a2 2 0 0 1 4 0v7"/><path d="M16 11V7a2 2 0 0 1 4 0v7c0 5-3 8-8 8h-1c-3 0-5-2-6-5l-1-4a2 2 0 1 1 4-1l1 3"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  frame: '<path d="M4 4h16v16H4z"/><path d="M8 8h8v8H8z"/>',
  undo: '<path d="M9 7H4v5"/><path d="M4 12c2-4 8-6 12-3 3 2 4 6 2 9"/>',
  redo: '<path d="M15 7h5v5"/><path d="M20 12c-2-4-8-6-12-3-3 2-4 6-2 9"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M10.5 7.5v6M7.5 10.5h6M15.5 15.5 21 21"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.5 15.5 21 21"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
  preview: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  pages: '<path d="M7 3h10l4 4v14H7z"/><path d="M17 3v5h5"/><path d="M3 7v14h4"/>',
  components: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  reuse: '<path d="M7 7h11v11H7z"/><path d="M4 14V4h10"/>',
  image: '<path d="M4 5h16v14H4z"/><path d="m7 16 4-4 3 3 2-2 3 3"/><circle cx="9" cy="9" r="1.5"/>',
  theme: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="15" cy="8" r="1"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  collapse: '<path d="m15 6-6 6 6 6"/>',
  expand: '<path d="m9 6 6 6-6 6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  folder: '<path d="M3 6h7l2 2h9v13H3z"/>',
  file: '<path d="M7 3h9l5 5v13H7z"/><path d="M16 3v6h6"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 10.6a3 3 0 0 0 3.8 3.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17.8 17.8 0 0 1-2.2 3.2"/><path d="M6.4 6.8C3.8 8.6 2.5 12 2.5 12s3.5 7 9.5 7c1.4 0 2.7-.3 3.8-.8"/>',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><path d="M5 11h14v10H5z"/>',
  unlock: '<path d="M7 11V8a5 5 0 0 1 9.5-2.2"/><path d="M5 11h14v10H5z"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  rectangle: '<path d="M4 6h16v12H4z"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="5"/>',
  line: '<path d="M5 19 19 5"/>',
  polygon: '<path d="m12 3 9 7-4 11H7L3 10z"/>',
  buttonIcon: '<rect x="5" y="7" width="14" height="10" rx="2"/><path d="M8 12h8"/>',
  nav: '<path d="M4 5h16M4 12h12M4 19h8"/><path d="m17 15 4 4-4 4"/>',
  gauge: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="m12 14 4-4"/><path d="M6 18h12"/>',
  indicator: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'
} as const;

function icon(name: keyof typeof iconPaths): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]}</svg>`;
}

const app = {
  projects: [] as HtmlForgeProject[],
  library: [] as LibraryItem[],
  project: undefined as HtmlForgeProject | undefined,
  model: undefined as ForgeDesignModel | undefined,
  activePanel: "pages" as PanelId,
  inspectorTab: "design" as InspectorTab,
  utilityTab: "objects" as UtilityTab,
  propertyTab: "properties" as PropertyTab,
  activeTool: "select" as ToolId,
  selectedIds: [] as string[],
  collapsedObjectIds: new Set<string>(),
  highlightObjects: true,
  leftCollapsed: false,
  rightCollapsed: false,
  topCollapsed: false,
  leftWidth: 322,
  rightWidth: 330,
  previewOpen: false,
  previewHtml: "",
  importOpen: false,
  importSourceText: "",
  importFileName: "import.html",
  importRetainSource: true,
  importDraft: undefined as ImportAnalysisResult | undefined,
  storageUsage: "",
  storageMessage: "Checking storage...",
  dirty: false,
  saving: false,
  saveError: "",
  toast: "",
  drag: undefined as DragState | undefined,
  panelResize: undefined as PanelResizeState | undefined,
  history: [] as ForgeDesignModel[],
  redo: [] as ForgeDesignModel[]
};

let repairedStoredImport = false;

function activePage(): ForgeDesignPage | undefined {
  return app.model?.pages.find((page) => page.id === app.model?.currentPageId) ?? app.model?.pages[0];
}

function selectedElements(): ForgeElement[] {
  const page = activePage();
  if (!page) return [];
  return app.selectedIds.map((id) => page.elements.find((element) => element.id === id)).filter(Boolean) as ForgeElement[];
}

function selectedElement(): ForgeElement | undefined {
  return selectedElements()[0];
}

function cloneModel(model: ForgeDesignModel): ForgeDesignModel {
  return structuredClone(model);
}

function normalizeDesignModel(model: ForgeDesignModel): ForgeDesignModel {
  model.zoom = Number.isFinite(model.zoom) ? model.zoom : 100;
  model.panX = Number.isFinite(model.panX) ? model.panX : 0;
  model.panY = Number.isFinite(model.panY) ? model.panY : 0;
  model.grid = model.grid ?? true;
  model.snap = model.snap ?? true;
  model.nextNumber = Number.isFinite(model.nextNumber) ? model.nextNumber : 20;
  model.pages.forEach((page) => {
    page.width = Number.isFinite(page.width) ? page.width : DEFAULT_CANVAS_WIDTH;
    page.height = Number.isFinite(page.height) ? page.height : DEFAULT_CANVAS_HEIGHT;
    page.background ||= "#ffffff";
    page.elements.forEach((element, index) => {
      element.z = Number.isFinite(element.z) ? element.z : index + 1;
      element.parentId = element.parentId || undefined;
      element.sourceTag = element.sourceTag || undefined;
      element.sourcePath = element.sourcePath || undefined;
    });
  });
  return model;
}

function snap(value: number): number {
  if (!app.model?.snap) return Math.round(value);
  return Math.round(value / 10) * 10;
}

function nextZ(page: ForgeDesignPage): number {
  return page.elements.reduce((max, element) => Math.max(max, element.z), 0) + 1;
}

function makeElement(type: ElementType, x = 80, y = 80, overrides: Partial<ForgeElement> = {}): ForgeElement {
  const number = app.model?.nextNumber ?? 1;
  if (app.model) app.model.nextNumber = number + 1;
  const base = elementDefaults[type];
  return {
    ...structuredClone(base),
    id: createId("el"),
    name: `${type} ${number}`,
    x,
    y,
    z: 1,
    ...overrides
  };
}

function textFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function elementsFromHtml(html: string, css = ""): ForgeElement[] {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const candidates = Array.from(doc.body.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,button,a,input,textarea,label,img,article,section,div"));
  const elements: ForgeElement[] = [];
  let y = 64;
  let z = 1;
  candidates.slice(0, 42).forEach((node) => {
    const tag = node.tagName.toLowerCase();
    const text = (node.textContent ?? node.getAttribute("placeholder") ?? node.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
    if (!text && !["img", "input", "textarea", "section", "article", "div"].includes(tag)) return;
    const style = node.getAttribute("style") ?? "";
    const color = style.match(/color\s*:\s*([^;]+)/i)?.[1]?.trim();
    const fill = style.match(/background(?:-color)?\s*:\s*([^;]+)/i)?.[1]?.trim();
    const radius = Number(style.match(/border-radius\s*:\s*(\d+)/i)?.[1] ?? 8);
    if (tag === "button" || tag === "a") {
      elements.push(makeElement("button", 80, y, { text: text || "Button", z: z++, fill: fill ?? "#0f766e", color: color ?? "#ffffff", radius }));
      y += 66;
      return;
    }
    if (tag === "input" || tag === "textarea" || tag === "label") {
      elements.push(makeElement("input", 80, y, { text: text || node.getAttribute("placeholder") || "Input", z: z++ }));
      y += 66;
      return;
    }
    if (tag === "img") {
      elements.push(makeElement("image", 80, y, { text: node.getAttribute("alt") || "Image", z: z++ }));
      y += 210;
      return;
    }
    if (["article", "section", "div"].includes(tag) && text.length > 120) {
      elements.push(makeElement("card", 80, y, { text: text.slice(0, 180), z: z++, fill: fill ?? "#ffffff", color: color ?? "#172033", radius }));
      y += 220;
      return;
    }
    const isHeading = /^h[1-4]$/.test(tag);
    elements.push(
      makeElement("text", 80, y, {
        text: text || "Text",
        z: z++,
        w: isHeading ? 680 : 560,
        h: isHeading ? 72 : 92,
        font: isHeading ? 34 : 17,
        weight: isHeading ? 900 : 500,
        color: color ?? "#172033"
      })
    );
    y += isHeading ? 86 : 106;
  });
  if (!elements.length) {
    elements.push(makeElement("html", 70, 70, { html: css ? `<style>${css}</style>${html}` : html, text: textFromHtml(html).slice(0, 80), w: 760, h: 460, z: 1 }));
  }
  return elements.map((element, index) => ({ ...element, z: index + 1 }));
}

type ImportedScreen = ImportAnalysisResult["report"]["screens"][number];

interface ImportViewport {
  width: number;
  height: number;
}

interface MeasuredImport {
  width: number;
  height: number;
  background: string;
  elements: ForgeElement[];
}

function shouldMeasureImportedScreen(screen: ImportedScreen, result: ImportAnalysisResult): boolean {
  return (
    result.report.screens.length > 6 ||
    result.report.stats.componentCount > 160 ||
    screen.componentCount > 24 ||
    screen.html.length > 6000 ||
    /id=["'](?:topbar|shell|sidebar|main)["']|class=["'][^"']*\bview\b/i.test(screen.html) ||
    /#(?:topbar|shell|sidebar|main)\b|\.(?:view|tnav-btn|sb-item)\b/i.test(screen.css)
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function largestCssDimension(source: string, properties: string[], min: number, max: number): number | undefined {
  const pattern = new RegExp(`(?:^|[;{\\s])(?:${properties.join("|")})\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "gi");
  const values = Array.from(source.matchAll(pattern))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= min && value <= max);
  return values.length ? Math.round(Math.max(...values)) : undefined;
}

function inferImportedViewport(screen: ImportedScreen): ImportViewport {
  const inlineShell = screen.html.match(/<(?:main|div|section)[^>]+(?:id=["'](?:app|shell|main|root)["']|class=["'][^"']*(?:app|shell|screen|display)[^"']*["'])[^>]+style=["']([^"']+)["']/i)?.[1] ?? "";
  const explicitWidth = largestCssDimension(inlineShell, ["width"], MIN_IMPORT_WIDTH, MAX_IMPORT_WIDTH);
  const explicitHeight = largestCssDimension(inlineShell, ["height"], MIN_IMPORT_HEIGHT, MAX_IMPORT_HEIGHT);
  const fullScreenApp = /id=["'](?:app|shell|topbar|sidebar|main)["']|class=["'][^"']*\b(?:view|view-body|view-header|tnav-btn|sb-item)\b/i.test(`${screen.html}\n${screen.css}`);
  const fallbackWidth = fullScreenApp ? DESKTOP_APP_IMPORT_WIDTH : Math.round(window.innerWidth || DEFAULT_CANVAS_WIDTH);
  const fallbackHeight = fullScreenApp ? DESKTOP_APP_IMPORT_HEIGHT : Math.round(window.innerHeight || DEFAULT_CANVAS_HEIGHT);
  const viewportWidth = clampNumber(fallbackWidth, MIN_IMPORT_WIDTH, MAX_IMPORT_WIDTH);
  const viewportHeight = clampNumber(fallbackHeight, MIN_IMPORT_HEIGHT, MAX_IMPORT_HEIGHT);
  return {
    width: explicitWidth ?? viewportWidth,
    height: explicitHeight ?? viewportHeight
  };
}

function importedScreenSrcdoc(screen: ImportedScreen): string {
  const css = [
    screen.css,
    "html,body{width:100%;height:100%;margin:0;overflow:hidden}",
    "body{min-height:100%;}"
  ]
    .filter(Boolean)
    .join("\n");
  return `<style>${css}</style>${screen.html}`;
}

function waitForFrameReady(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.setTimeout(resolve, 40);
    };
    frame.addEventListener("load", done, { once: true });
    window.setTimeout(done, 650);
  });
}

function cssPixel(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function visibleText(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function ownVisibleText(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll("script,style,svg").forEach((child) => child.remove());
  return visibleText(clone);
}

function directVisibleText(node: Element): string {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cssBackground(style: CSSStyleDeclaration): string {
  const image = style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage : "";
  const color = style.backgroundColor && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) ? style.backgroundColor : "";
  if (image && color) return `${image}, ${color}`;
  if (image) return image;
  return color || "transparent";
}

function pageBackground(style: CSSStyleDeclaration, fallback: string): string {
  const background = cssBackground(style);
  return background === "transparent" ? fallback : background;
}

function hasVisiblePaint(style: CSSStyleDeclaration): boolean {
  return (
    Boolean(style.backgroundImage && style.backgroundImage !== "none") ||
    !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor) ||
    cssPixel(style.borderTopWidth) > 0 ||
    Boolean(style.boxShadow && style.boxShadow !== "none")
  );
}

function importedNodeType(node: HTMLElement, style: CSSStyleDeclaration, text: string): ElementType | undefined {
  const tag = node.tagName.toLowerCase();
  const className = node.className.toString().toLowerCase();
  const role = node.getAttribute("role")?.toLowerCase();
  const containerLike = /\b(card|row|item-row|project-pill|knowledge-row|file-item|agenda-item|trash-item|setting-row|stat-card|view-header|resume-hero|card-mode-block|cnode|cboard-toolbar)\b/.test(className);
  const clickable = style.cursor === "pointer" || role === "button" || /\b(btn|button|item|pill|badge|tag|link|action)\b/.test(className);
  if (tag === "input" || tag === "textarea" || tag === "select") return "input";
  if (containerLike && node.children.length > 0) return hasVisiblePaint(style) ? "frame" : undefined;
  if (tag === "button" || tag === "a" || clickable) return text ? "button" : "shape";
  if (/^h[1-6]$/.test(tag) || /\b(title|subtitle|label|meta|value|name|text)\b/.test(className)) return text ? "text" : undefined;
  if (text && node.children.length === 0) return "text";
  if (hasVisiblePaint(style)) return "frame";
  return text && text.length <= 90 && node.children.length === 0 ? "text" : undefined;
}

function importedElementText(node: HTMLElement, type: ElementType, text: string): string {
  const tag = node.tagName.toLowerCase();
  const className = node.className.toString().toLowerCase();
  if (type === "input") return node.getAttribute("placeholder") || text || measuredElementName(node, type, text);
  if (type === "text") return text || measuredElementName(node, type, text);
  if (node.id === "logo") return text || measuredElementName(node, type, text);
  if (type === "button" && (tag === "button" || tag === "a" || node.children.length === 0 || /\b(tnav-btn|sb-item|cb-btn)\b/.test(className))) {
    return directVisibleText(node) || text || measuredElementName(node, type, text);
  }
  return "";
}

function measuredElementName(node: HTMLElement, type: ElementType, text: string): string {
  const identity = node.id || node.getAttribute("aria-label") || node.className.toString().split(/\s+/).find(Boolean) || text || type;
  return identity.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 42) || type;
}

function shouldSkipMeasuredNode(node: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration, viewport: ImportViewport): boolean {
  if (["script", "style", "meta", "link", "svg", "path"].includes(node.tagName.toLowerCase())) return true;
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
  if (rect.width < 8 || rect.height < 8) return true;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height) return true;
  const area = rect.width * rect.height;
  const viewportArea = viewport.width * viewport.height;
  if (area > viewportArea * 0.98 && !["topbar", "sidebar"].includes(node.id)) return true;
  return false;
}

function importElementImportance(type: ElementType | undefined, node: HTMLElement): number {
  const className = node.className.toString().toLowerCase();
  if (type === "button" || type === "input") return 6;
  if (type === "text") return 5;
  if (node.id === "topbar" || node.id === "sidebar") return 4;
  if (node.id === "caseboard-canvas") return 4;
  if (/\b(card|hero|row|pill|item|header|cnode|cmb|cb-btn|cboard)\b/.test(className)) return 3;
  if (type === "frame") return 2;
  return 1;
}

function nodeSourcePath(node: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = node;
  while (current && current.tagName.toLowerCase() !== "body") {
    const tag = current.tagName.toLowerCase();
    const identity = current.id ? `#${current.id}` : Array.from(current.classList).slice(0, 2).map((name) => `.${name}`).join("");
    parts.unshift(`${tag}${identity}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

async function measuredElementsFromImportedScreen(screen: ImportedScreen): Promise<MeasuredImport> {
  let viewport = inferImportedViewport(screen);
  const frame = document.createElement("iframe");
  // The source has already been sanitized; this temporary frame must remain
  // same-origin so Forge can read layout boxes and convert them into elements.
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${viewport.width}px;height:${viewport.height}px;border:0;pointer-events:none;opacity:0;`;
  frame.srcdoc = importedScreenSrcdoc(screen);
  document.body.appendChild(frame);
  await waitForFrameReady(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return { width: viewport.width, height: viewport.height, background: "#ffffff", elements: [] };
  }
  await doc.fonts?.ready.catch(() => undefined);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const selector = [
    "#topbar",
    "#sidebar",
    "#logo",
    "#search-wrap",
    "#statusbar-right",
    ".view-header",
    ".resume-hero",
    ".card",
    ".card-mode-block",
    ".stat-card",
    ".project-pill",
    ".item-row",
    ".file-item",
    ".agenda-item",
    ".knowledge-row",
    ".trash-item",
    ".setting-row",
    "#caseboard-canvas",
    ".cboard-toolbar",
    ".cnode",
    ".cnode-type",
    ".cnode-title",
    ".cnode-body",
    ".cnode-footer",
    ".cb-btn",
    ".cmb-label",
    ".cmb-content",
    ".btn",
    ".tnav-btn",
    ".sb-item",
    ".tag",
    ".type-badge",
    ".sb-badge",
    ".view-title",
    ".view-subtitle",
    ".card-title",
    ".title",
    ".meta",
    ".label",
    ".pname",
    ".pmeta",
    ".stat-value",
    ".stat-label",
    ".resume-project",
    ".resume-action",
    ".resume-meta",
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "h1",
    "h2",
    "h3",
    "h4",
    "[role]",
    "[aria-label]"
  ].join(",");

  const seen = new Set<Element>();
  const measuredItems = Array.from(doc.body.querySelectorAll<HTMLElement>(selector))
    .filter((node) => {
      if (seen.has(node)) return false;
      seen.add(node);
      return true;
    })
    .map((node) => {
      const style = doc.defaultView!.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const text = ownVisibleText(node);
      const type = importedNodeType(node, style, text);
      return { node, style, rect, text, type, area: rect.width * rect.height, importance: importElementImportance(type, node) };
    })
    .filter((item) => item.type && !shouldSkipMeasuredNode(item.node, item.rect, item.style, viewport))
    .sort((a, b) => b.importance - a.importance || b.area - a.area)
    .slice(0, MAX_MEASURED_IMPORT_ELEMENTS)
    .sort((a, b) => b.area - a.area);

  const nodeToElementId = new Map<HTMLElement, string>();
  const measured = measuredItems
    .map((item, index) => {
      const type = item.type as ElementType;
      const isText = type === "text";
      const isFrame = type === "frame";
      const rect = item.rect;
      const elementText = importedElementText(item.node, type, item.text);
      const element = makeElement(type, Math.max(0, Math.round(rect.left)), Math.max(0, Math.round(rect.top)), {
        name: measuredElementName(item.node, type, item.text),
        text: elementText,
        w: Math.max(12, Math.round(Math.min(rect.width, viewport.width - Math.max(0, rect.left)))),
        h: Math.max(12, Math.round(Math.min(rect.height, viewport.height - Math.max(0, rect.top)))),
        fill: isText ? "transparent" : cssBackground(item.style),
        color: item.style.color || "#172033",
        border: item.style.borderTopColor || "transparent",
        borderWidth: isText ? 0 : Math.round(cssPixel(item.style.borderTopWidth)),
        radius: Math.round(cssPixel(item.style.borderTopLeftRadius)),
        font: Math.max(8, Math.round(cssPixel(item.style.fontSize, 15))),
        fontFamily: item.style.fontFamily || defaultFont,
        weight: Number.parseInt(item.style.fontWeight, 10) || (isText ? 700 : 600),
        opacity: Math.round((Number.parseFloat(item.style.opacity || "1") || 1) * 100),
        shadow: item.style.boxShadow === "none" ? "" : item.style.boxShadow,
        sourceTag: item.node.tagName.toLowerCase(),
        sourcePath: nodeSourcePath(item.node),
        z: index + 1
      });
      nodeToElementId.set(item.node, element.id);
      return { item, element };
    })
    .map(({ item, element }, index) => {
      let parent = item.node.parentElement;
      while (parent && parent !== doc.body) {
        const parentId = nodeToElementId.get(parent);
        if (parentId) {
          element.parentId = parentId;
          break;
        }
        parent = parent.parentElement;
      }
      return { ...element, z: index + 1 };
    });

  const bodyStyle = doc.defaultView!.getComputedStyle(doc.body);
  const htmlStyle = doc.defaultView!.getComputedStyle(doc.documentElement);
  const background = pageBackground(bodyStyle, pageBackground(htmlStyle, "#ffffff"));

  frame.remove();
  return { width: viewport.width, height: viewport.height, background, elements: measured };
}

async function measuredImportFromScreen(screen: ImportedScreen, result: ImportAnalysisResult): Promise<MeasuredImport> {
  if (!shouldMeasureImportedScreen(screen, result)) {
    const viewport = inferImportedViewport(screen);
    return { width: viewport.width, height: viewport.height, background: "#ffffff", elements: elementsFromHtml(screen.html, screen.css) };
  }
  const measured = await measuredElementsFromImportedScreen(screen);
  return measured.elements.length ? measured : { ...measured, elements: elementsFromHtml(screen.html, screen.css) };
}

function shouldRepairStoredImport(project: HtmlForgeProject, model: ForgeDesignModel): boolean {
  if (!project.source?.rawText || !project.source.retained) return false;
  const names = model.pages.slice(0, 10).map((page) => page.name.toLowerCase());
  const layoutPages = names.filter((name) => ["topbar", "topnav", "shell", "sidebar", "main"].includes(name) || name === "div").length;
  const preservedPages = model.pages.filter((page) => page.elements.length === 1 && page.elements[0]?.type === "html").length;
  const inflatedResponsiveImport = model.pages.some((page) => page.width === 1320 || page.height >= 1800);
  const sourceHasSpecialViews = /\b(card-mode-block|caseboard-canvas|cboard-toolbar|cnode)\b/i.test(project.source.rawText);
  const hasSpecialLayers = model.pages.some((page) => page.elements.some((element) => /\b(card-mode-block|caseboard-canvas|cboard-toolbar|cnode)\b/i.test(element.sourcePath ?? "")));
  return inflatedResponsiveImport || layoutPages >= 3 || (model.pages.length > 2 && preservedPages >= Math.min(3, model.pages.length)) || (sourceHasSpecialViews && !hasSpecialLayers);
}

async function modelFromProject(project: HtmlForgeProject): Promise<ForgeDesignModel> {
  repairedStoredImport = false;
  const stored = project.notes?.[MODEL_NOTE_KEY];
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ForgeDesignModel;
      if (parsed.version === 2 && Array.isArray(parsed.pages)) {
        if (shouldRepairStoredImport(project, parsed)) {
          repairedStoredImport = true;
          return await modelFromImport(analyzeHtmlImport(project.source!.rawText!, project.source!.fileName, true));
        }
        return normalizeDesignModel(parsed);
      }
    } catch {
      // Fall through and rebuild from project pages.
    }
  }
  const pages: ForgeDesignPage[] = project.pages.map((page, index) => ({
    id: page.id,
    generatedId: page.generatedId || generatedScreenId(index),
    name: page.name,
    slug: page.slug || slugify(page.name),
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    background: "#ffffff",
    elements: elementsFromHtml(page.html, page.css)
  }));
  return {
    version: 2,
    theme: "forge",
    currentPageId: pages[0]?.id ?? createId("page"),
    pages: pages.length
      ? pages
      : [
          {
            id: createId("page"),
            generatedId: generatedScreenId(0),
            name: "Home",
            slug: "home",
            width: DEFAULT_CANVAS_WIDTH,
            height: DEFAULT_CANVAS_HEIGHT,
            background: "#ffffff",
            elements: [makeElement("text", 80, 80, { text: "New UI", font: 48, w: 560, h: 90, z: 1 })]
          }
        ],
    templates: [],
    zoom: 100,
    panX: 0,
    panY: 0,
    grid: true,
    snap: true,
    nextNumber: 20
  };
}

async function modelFromImport(result: ImportAnalysisResult): Promise<ForgeDesignModel> {
  const report = result.report;
  const screens = report.screens.length
    ? report.screens
    : [
        {
          id: createId("screen"),
          name: "Imported Screen",
          selector: "body",
          html: report.sanitizedHtml,
          css: report.sanitizedCss,
          componentCount: report.stats.componentCount
        }
      ];
  const pages: ForgeDesignPage[] = await Promise.all(
    screens.map(async (screen, index) => {
      const measured = await measuredImportFromScreen(screen, result);
      return {
        id: result.project.pages[index]?.id ?? createId("page"),
        generatedId: generatedScreenId(index),
        name: screen.name || `Screen ${index + 1}`,
        slug: slugify(screen.name || `screen-${index + 1}`),
        width: measured.width,
        height: measured.height,
        background: measured.background,
        elements: measured.elements
      };
    })
  );
  const templates = importedTemplates(report.sanitizedHtml);
  const model: ForgeDesignModel = {
    version: 2,
    theme: "forge",
    currentPageId: pages[0].id,
    pages,
    templates,
    zoom: 100,
    panX: 0,
    panY: 0,
    grid: true,
    snap: true,
    nextNumber: 100
  };
  wireImportedActions(model, result);
  return model;
}

function importedTemplates(html: string): ForgeTemplate[] {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const templates: ForgeTemplate[] = [];
  Array.from(doc.body.querySelectorAll<HTMLElement>("header,nav,article,section,form,button")).slice(0, 12).forEach((node, index) => {
    const text = (node.textContent ?? node.getAttribute("aria-label") ?? node.tagName).replace(/\s+/g, " ").trim();
    const type: ElementType = node.tagName.toLowerCase() === "button" ? "button" : node.tagName.toLowerCase() === "form" ? "card" : "html";
    templates.push({
      id: createId("tpl"),
      name: text.slice(0, 34) || `Imported ${index + 1}`,
      category: "imported",
      elements: [makeElement(type, 80, 80, { html: node.outerHTML, text: text || "Imported component", w: type === "button" ? 148 : 460, h: type === "button" ? 48 : 220, z: 1 })]
    });
  });
  return templates;
}

type ImportedInteraction = ImportAnalysisResult["report"]["interactions"][number];

function normalizeActionName(value = ""): string {
  return value.toLowerCase().replace(/[\s_-]+/g, " ").replace(/\b(view|screen|page|panel)\b/g, "").replace(/\s+/g, " ").trim();
}

function pageLookup(model: ForgeDesignModel): Map<string, string> {
  const lookup = new Map<string, string>();
  model.pages.forEach((page) => {
    [page.name, page.slug, page.generatedId, page.slug.replace(/-(view|screen|page|panel)$/i, "")].forEach((value) => {
      const normalized = normalizeActionName(value);
      if (normalized) lookup.set(normalized, page.id);
    });
  });
  return lookup;
}

function elementActionText(element: ForgeElement): string {
  return normalizeActionName(element.text || textFromHtml(element.html) || element.name);
}

function importedActionScore(page: ForgeDesignPage, element: ForgeElement, interaction: ImportedInteraction, targetName: string, targetId: string): number {
  if (!["button", "text", "html"].includes(element.type) || element.action) return -1;
  const text = elementActionText(element);
  if (!text) return -1;
  const source = normalizeActionName(interaction.sourceName);
  const target = normalizeActionName(targetName);
  let score = element.type === "button" ? 80 : element.type === "html" ? 40 : 20;
  if (source && text === source) score += 90;
  if (source && (text.includes(source) || source.includes(text))) score += 42;
  if (target && text === target) score += 26;
  if (target && text.includes(target)) score += 38;
  if (interaction.type === "switchView" && /\b(open|go|view|show|details|next)\b/.test(text)) score += 18;
  if (page.id === targetId && text === target) score -= 60;
  if (page.id === targetId && interaction.type === "switchView") score -= 35;
  return score;
}

function wireImportedActions(model: ForgeDesignModel, result: ImportAnalysisResult): void {
  const byName = pageLookup(model);
  result.report.interactions
    .filter((interaction) => interaction.status !== "unsupported" && interaction.targetName)
    .forEach((interaction) => {
      const targetName = interaction.targetName as string;
      const targetId = byName.get(normalizeActionName(targetName));
      if (!targetId) return;
      let best: { page: ForgeDesignPage; element: ForgeElement; score: number } | undefined;
      for (const page of model.pages) {
        for (const element of page.elements) {
          const score = importedActionScore(page, element, interaction, targetName, targetId);
          if (score < 55) continue;
          if (!best || score > best.score) best = { page, element, score };
        }
      }
      if (best) {
        best.element.action = "page";
        best.element.target = targetId;
      }
    });
}

function compileElementContent(element: ForgeElement, interactive = false): string {
  if (element.type === "html") return element.html;
  if (element.type === "image") {
    const src = element.assetData || "";
    return src ? `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(element.text || element.name)}">` : `<span>${escapeHtml(element.text || "Image")}</span>`;
  }
  if (element.type === "input") return `<span>${escapeHtml(element.text)}</span>`;
  if (element.type === "card") {
    const [title, ...body] = element.text.split("\n");
    return `<strong>${escapeHtml(title || "Card title")}</strong><span>${escapeHtml(body.join("\n") || "Card content")}</span>`;
  }
  if (interactive && element.type === "button") return `<button type="button">${escapeHtml(element.text)}</button>`;
  return escapeHtml(element.text);
}

function elementStyle(element: ForgeElement): string {
  const image = element.type === "image" && element.assetData ? `background-image:url(${element.assetData});background-size:cover;background-position:center;` : "";
  const display = element.hidden ? "display:none;" : "";
  return [
    `position:absolute`,
    `left:${element.x}px`,
    `top:${element.y}px`,
    `width:${element.w}px`,
    `height:${element.h}px`,
    `z-index:${element.z}`,
    `transform:rotate(${element.rotation}deg)`,
    `transform-origin:center center`,
    `opacity:${element.opacity / 100}`,
    `background:${element.fill}`,
    image,
    `color:${element.color}`,
    `border:${element.borderWidth}px solid ${element.border}`,
    `border-radius:${element.radius}px`,
    `box-shadow:${element.shadow || "none"}`,
    `font:${element.weight} ${element.font}px ${element.fontFamily}`,
    display
  ].join(";");
}

function compilePageHtml(page: ForgeDesignPage): string {
  return `<div class="forge-product-canvas" style="position:relative;width:${page.width}px;height:${page.height}px;min-height:${page.height}px;background:${page.background};overflow:hidden">${page.elements
    .filter((element) => !element.hidden)
    .map((element) => {
      const attrs = [
        `class="forge-product-element forge-product-${element.type}"`,
        `data-forge-id="${escapeAttribute(element.id)}"`,
        `data-forge-name="${escapeAttribute(element.name)}"`,
        element.action ? `data-forge-action="${escapeAttribute(element.action)}"` : "",
        element.target ? `data-forge-target="${escapeAttribute(element.target)}"` : "",
        `style="${escapeAttribute(elementStyle(element))}"`
      ]
        .filter(Boolean)
        .join(" ");
      return `<div ${attrs}>${compileElementContent(element, true)}</div>`;
    })
    .join("")}</div>`;
}

function compilePageCss(page: ForgeDesignPage): string {
  return `
.forge-product-canvas{font-family:${defaultFont};}
.forge-product-element{box-sizing:border-box;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;overflow:hidden;padding:8px;line-height:1.2}
.forge-product-card{align-items:flex-start;flex-direction:column;gap:8px;text-align:left}
.forge-product-image{padding:0}
.forge-product-image img{width:100%;height:100%;object-fit:cover;display:block}
.forge-product-button button{width:100%;height:100%;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.forge-product-input::after{content:"";position:absolute;left:12px;right:12px;bottom:10px;height:1px;background:currentColor;opacity:.28}
@media (max-width: ${page.width}px){.forge-product-canvas{max-width:100%;height:auto;min-height:${page.height}px}}
`;
}

function syncProjectModel(): void {
  if (!app.project || !app.model) return;
  const now = nowIso();
  app.project.name = app.project.name || "HTML Forge Project";
  app.project.slug = slugify(app.project.name);
  app.project.modifiedAt = now;
  app.project.notes[MODEL_NOTE_KEY] = JSON.stringify(app.model);
  app.project.pages = app.model.pages.map(
    (page, index): ForgePage => ({
      id: page.id,
      generatedId: page.generatedId || generatedScreenId(index),
      name: page.name,
      slug: page.slug || slugify(page.name),
      html: compilePageHtml(page),
      css: compilePageCss(page),
      notes: "",
      componentCount: page.elements.length,
      createdAt: now,
      modifiedAt: now
    })
  );
  app.project.connections = [];
  app.model.pages.forEach((page) => {
    page.elements
      .filter((element) => element.action === "page" && element.target)
      .forEach((element) => {
        const target = app.model?.pages.find((candidate) => candidate.id === element.target || candidate.name === element.target);
        if (!target) return;
        app.project?.connections.push({
          id: `connection-${element.id}`,
          sourcePageId: page.id,
          triggerLabel: element.text || element.name,
          action: "navigate",
          targetId: target.id,
          targetName: target.name,
          selector: `[data-forge-id="${element.id}"] button, [data-forge-id="${element.id}"]`,
          status: "mapped",
          createdAt: now,
          modifiedAt: now
        } satisfies ForgeConnection);
      });
  });
}

function pushHistory(label = "edit"): void {
  void label;
  if (!app.model) return;
  app.history.push(cloneModel(app.model));
  if (app.history.length > 80) app.history.shift();
  app.redo = [];
}

function markDirty(renderAfter = false): void {
  syncProjectModel();
  app.dirty = true;
  scheduleSave();
  updateStatusOnly();
  if (renderAfter) render();
}

const scheduleSave = window.setTimeout
  ? ((() => {
      let timer = 0;
      return () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void saveNow(false), 700);
      };
    })() as () => void)
  : () => undefined;

async function saveNow(showToast = true): Promise<void> {
  if (!app.project) return;
  syncProjectModel();
  try {
    app.saving = true;
    updateStatusOnly();
    app.project = await saveProject(app.project, instanceId, app.project.revision);
    app.projects = await listProjects();
    app.dirty = false;
    app.saveError = "";
    if (showToast) toast("Saved locally.");
  } catch (error) {
    app.saveError = error instanceof Error ? error.message : String(error);
    toast("Save failed. Export a backup before closing.");
  } finally {
    app.saving = false;
    updateStatusOnly();
  }
}

function statusText(): string {
  if (app.saveError) return `Save issue: ${app.saveError}`;
  if (app.saving) return "Saving locally...";
  if (app.dirty) return "Unsaved local edits";
  return "Saved locally";
}

function toast(message: string): void {
  app.toast = message;
  renderToast();
  window.setTimeout(() => {
    if (app.toast === message) {
      app.toast = "";
      renderToast();
    }
  }, 2600);
}

function renderToast(): void {
  const node = document.querySelector<HTMLElement>("[data-toast]");
  if (!node) return;
  node.textContent = app.toast;
  node.hidden = !app.toast;
}

function updateStatusOnly(): void {
  document.querySelector("[data-save-state]")?.replaceChildren(document.createTextNode(statusText()));
  document.querySelector("[data-element-count]")?.replaceChildren(document.createTextNode(`${activePage()?.elements.length ?? 0} elements`));
}

function render(): void {
  const theme = themes[app.model?.theme ?? "forge"];
  root.innerHTML = `
    <div class="forge-app ${app.leftCollapsed ? "left-collapsed" : ""} ${app.rightCollapsed ? "right-collapsed" : ""} ${app.topCollapsed ? "top-collapsed" : ""}" style="--app-bg:${theme.bg};--panel:${theme.panel};--canvas:${theme.canvas};--text:${theme.text};--accent:${theme.accent};--accent-2:${theme.accent2};--muted:${theme.muted};--line:${theme.line};--left-width:${app.leftWidth}px;--right-width:${app.rightWidth}px">
      ${topbarMarkup()}
      ${leftPanelMarkup()}
      ${canvasMarkup()}
      ${rightPanelMarkup()}
      ${statusbarMarkup()}
      ${app.importOpen ? importDialogMarkup() : ""}
        ${app.previewOpen ? previewDialogMarkup() : ""}
      <div class="toast" data-toast ${app.toast ? "" : "hidden"}>${escapeHtml(app.toast)}</div>
    </div>
  `;
  bindEvents();
}

function renderThenFit(): void {
  render();
  window.requestAnimationFrame(() => fitCanvas());
}

function topbarMarkup(): string {
  const page = activePage();
  return `
    <header class="forge-topbar">
      <div class="brand">
        <div class="brand-mark">F</div>
        <div class="brand-copy">
          <strong>Forge</strong>
          <span>${escapeHtml(page?.name ?? "No page")}</span>
        </div>
      </div>
      <div class="tool-strip" role="toolbar" aria-label="Editor toolbar">
        <button class="icon-button ${app.activeTool === "select" ? "is-active" : ""}" title="Select tool" aria-label="Select tool" data-tool="select">${icon("pointer")}</button>
        <button class="icon-button ${app.activeTool === "hand" ? "is-active" : ""}" title="Hand pan tool" aria-label="Hand pan tool" data-tool="hand">${icon("hand")}</button>
        <button class="icon-button ${app.activeTool === "text" ? "is-active" : ""}" title="Text tool" aria-label="Text tool" data-tool="text">${icon("text")}</button>
        <button class="icon-button ${app.activeTool === "frame" ? "is-active" : ""}" title="Frame tool" aria-label="Frame tool" data-tool="frame">${icon("frame")}</button>
        <span class="toolbar-separator"></span>
        ${quickAddButton("text", "Text")}
        ${quickAddButton("button", "Button")}
        ${quickAddButton("card", "Card")}
        ${quickAddButton("input", "Input")}
        <button class="secondary-button compact" data-action="add-page">${icon("pages")} Page</button>
        <span class="toolbar-separator"></span>
        <button class="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" data-action="undo">${icon("undo")}</button>
        <button class="icon-button" title="Redo (Ctrl+Y)" aria-label="Redo" data-action="redo">${icon("redo")}</button>
        <button class="icon-button" title="Zoom out (Ctrl+-)" aria-label="Zoom out" data-action="zoom-out">${icon("zoomOut")}</button>
        <span class="zoom-readout">${app.model?.zoom ?? 100}%</span>
        <button class="icon-button" title="Zoom in (Ctrl++)" aria-label="Zoom in" data-action="zoom-in">${icon("zoomIn")}</button>
        <button class="icon-button" title="Fit canvas (Ctrl+0)" aria-label="Fit canvas" data-action="fit">${icon("fit")}</button>
        <button class="secondary-button compact" title="100% native scale (Ctrl+1)" data-action="zoom-100">100%</button>
      </div>
      <div class="top-actions">
        <select data-action="open-project-select" aria-label="Open project">
          <option value="">Open project...</option>
          ${app.projects.map((project) => `<option value="${project.id}" ${project.id === app.project?.id ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
        </select>
        <button class="secondary-button compact" data-action="new-project">New</button>
        <button class="secondary-button compact" data-action="open-import">${icon("import")} Import</button>
        <button class="secondary-button compact" data-action="preview">${icon("preview")} Run</button>
        <button class="primary-button compact" data-action="save">${icon("save")} Save</button>
        <button class="icon-button" title="${app.topCollapsed ? "Show chrome" : "Hide chrome"}" aria-label="${app.topCollapsed ? "Show chrome" : "Hide chrome"}" data-action="toggle-top">${app.topCollapsed ? icon("expand") : icon("collapse")}</button>
      </div>
    </header>
  `;
}

function quickAddButton(type: ElementType, label: string): string {
  return `<button class="secondary-button compact" data-add-element="${type}">${icon("add")} ${label}</button>`;
}

function leftPanelMarkup(): string {
  return `
    <aside class="left-panel" aria-label="Project Explorer">
      <button class="panel-collapse left" title="${app.leftCollapsed ? "Show left panel" : "Hide left panel"}" aria-label="${app.leftCollapsed ? "Show left panel" : "Hide left panel"}" data-action="toggle-left">${app.leftCollapsed ? icon("expand") : icon("collapse")}</button>
      <div class="panel-titlebar"><strong>Project Explorer</strong></div>
      <div class="panel-body">${leftPanelBody()}</div>
      <div class="panel-tabs bottom-tabs">
        ${panelButton("pages", "pages", "Application")}
        ${panelButton("reuse", "reuse", "Reuse")}
        ${panelButton("assets", "image", "Assets")}
        ${panelButton("themes", "theme", "Theme")}
        ${panelButton("import", "import", "Import")}
      </div>
      <div class="panel-resizer panel-resizer-left" data-resize-panel="left" title="Resize Project Explorer"></div>
    </aside>
  `;
}

function panelButton(id: PanelId, iconName: keyof typeof iconPaths, label: string): string {
  return `<button class="${app.activePanel === id ? "is-active" : ""}" data-panel="${id}" title="${label}">${icon(iconName)}<span>${label}</span></button>`;
}

function leftPanelBody(): string {
  if (!app.model || !app.project) return projectStartMarkup();
  if (app.activePanel === "pages") return pagesPanelMarkup();
  if (app.activePanel === "reuse") return reusePanelMarkup();
  if (app.activePanel === "assets") return assetsPanelMarkup();
  if (app.activePanel === "themes") return themesPanelMarkup();
  return importPanelMarkup();
}

function projectStartMarkup(): string {
  return `
    <section class="panel-section">
      <h2>Start editing</h2>
      <button class="primary-button full" data-action="new-project">New project</button>
      <button class="secondary-button full" data-action="open-import">Import HTML</button>
    </section>
  `;
}

function pagesPanelMarkup(): string {
  const page = activePage();
  const pages = app.model!.pages;
  return `
    <section class="panel-section">
      <div class="section-head"><h2>Application</h2><button class="secondary-button compact" data-action="add-page">${icon("add")} Display</button></div>
      <div class="project-tree" role="tree">
        <div class="project-tree-row root-row">${icon("folder")}<strong>${escapeHtml(app.project?.name ?? "Project")}</strong></div>
        <div class="project-tree-row branch-row">${icon("chevronDown")}${icon("folder")}<strong>Displays</strong></div>
        <div class="display-list">
          ${pages
            .map(
              (candidate, index) => `
                <button class="project-tree-row display-row ${candidate.id === page?.id ? "is-active" : ""}" data-page-id="${candidate.id}" role="treeitem">
                  <span class="tree-line"></span>
                  ${icon("file")}
                  <span>${String(index + 1).padStart(3, "0")} ${escapeHtml(candidate.name)}</span>
                </button>`
            )
            .join("")}
        </div>
        <div class="project-tree-row branch-row">${icon("chevronDown")}${icon("nav")}<strong>Navigation</strong></div>
        <div class="navigation-list">
          ${pages
            .map((candidate) => `<button class="project-tree-row nav-row" data-page-nav-target="${candidate.id}"><span class="tree-line"></span>${icon("nav")}<span>Add button to ${escapeHtml(candidate.name)}</span></button>`)
            .join("")}
        </div>
      </div>
    </section>
    <section class="panel-section">
      <h2>Display Setup</h2>
      <label class="field-label">Page name <input type="text" data-page-prop="name" value="${escapeAttribute(page?.name ?? "")}"></label>
      ${canvasFieldsMarkup()}
      <div class="button-row">
        <button class="secondary-button compact" data-action="add-nav-button">${icon("nav")} Add nav button</button>
        <button class="secondary-button compact" data-action="add-nav-menu">${icon("pages")} Build menu</button>
      </div>
      <p class="muted">Navigation buttons are editable objects. Change their targets in the Property Panel.</p>
    </section>
  `;
}

function componentsPanelMarkup(): string {
  const groups: Array<{ title: string; items: Array<[ElementType, string, string]> }> = [
    { title: "Layout", items: [["frame", "Frame", "Containers and sections"], ["card", "Card", "Panels and tiles"], ["shape", "Shape", "Circles or blocks"]] },
    { title: "Content", items: [["text", "Text", "Headings and labels"], ["button", "Button", "Clickable actions"], ["image", "Image", "Local uploaded image"]] },
    { title: "Forms", items: [["input", "Input", "Form fields"], ["html", "HTML", "Reusable imported markup"]] }
  ];
  return groups
    .map(
      (group) => `
      <section class="panel-section">
        <h2>${group.title}</h2>
        <div class="component-grid">
          ${group.items.map(([type, label, hint]) => `<button class="component-tile" data-add-element="${type}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(hint)}</span></button>`).join("")}
        </div>
      </section>`
    )
    .join("");
}

function templatePreviewMarkup(elements: ForgeElement[]): string {
  if (!elements.length) return `<span class="reuse-preview empty-preview">No preview</span>`;
  const visible = elements.filter((element) => !element.hidden);
  const items = visible.length ? visible : elements;
  const minX = Math.min(...items.map((element) => element.x));
  const minY = Math.min(...items.map((element) => element.y));
  const maxX = Math.max(...items.map((element) => element.x + element.w));
  const maxY = Math.max(...items.map((element) => element.y + element.h));
  const width = Math.max(40, maxX - minX);
  const height = Math.max(28, maxY - minY);
  const scale = Math.min(1, 68 / width, 38 / height);
  return `
    <span class="reuse-preview" aria-hidden="true">
      <span class="reuse-preview-stage" style="width:${width}px;height:${height}px;transform:scale(${scale});">
        ${items
          .map((element) => {
            const previewElement = { ...element, x: element.x - minX, y: element.y - minY, shadow: "" };
            return `<span class="preview-element type-${element.type}" style="${escapeAttribute(elementStyle(previewElement))}">${compileElementContent(previewElement)}</span>`;
          })
          .join("")}
      </span>
    </span>
  `;
}

function reusePanelMarkup(): string {
  const templates = app.model?.templates ?? [];
  return `
    <section class="panel-section">
      <div class="section-head"><h2>Reusable UI</h2><button class="secondary-button compact" data-action="save-template">${icon("reuse")} Save</button></div>
      <div class="list-stack">
        ${templates
          .map(
            (template) => `
              <button class="template-row" data-template-id="${template.id}">
                ${templatePreviewMarkup(template.elements)}
                <span><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.category)} - ${template.elements.length} element${template.elements.length === 1 ? "" : "s"}</small></span>
              </button>`
          )
          .join("") || `<p class="muted">Select elements and save them here. Imported buttons/forms also land here.</p>`}
      </div>
    </section>
    <section class="panel-section">
      <h2>Shared Library</h2>
      <div class="list-stack">
        ${app.library
          .slice(-10)
          .map((item) => {
            const template = item.data as ForgeTemplate | undefined;
            return `<button class="template-row" data-library-id="${item.id}">
              ${template?.elements ? templatePreviewMarkup(template.elements) : `<span class="reuse-preview empty-preview">HTML</span>`}
              <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)} - ${escapeHtml(item.scope)}</small></span>
            </button>`;
          })
          .join("") || `<p class="muted">No saved library items yet.</p>`}
      </div>
    </section>
  `;
}

function assetsPanelMarkup(): string {
  return `
    <section class="panel-section">
      <h2>Local Assets</h2>
      <label class="file-button full">
        Upload image
        <input type="file" accept="image/*" data-action="asset-upload">
      </label>
      <div class="list-stack asset-list">
        ${(app.project?.assets ?? [])
          .map(
            (asset) => `
              <button class="asset-row" data-asset-id="${asset.id}">
                <span class="asset-thumb" style="${asset.dataUrl ? `background-image:url(${asset.dataUrl})` : ""}"></span>
                <strong>${escapeHtml(asset.name)}</strong>
                <small>${humanBytes(asset.size)}</small>
              </button>`
          )
          .join("") || `<p class="muted">Uploaded images stay in this browser and can be inserted onto the canvas.</p>`}
      </div>
    </section>
  `;
}

function themesPanelMarkup(): string {
  return `
    <section class="panel-section">
      <h2>Theme</h2>
      <div class="theme-grid">
        ${(Object.keys(themes) as ThemeId[])
          .map((id) => {
            const theme = themes[id];
            return `
              <button class="theme-card ${app.model?.theme === id ? "is-active" : ""}" data-theme-id="${id}">
                <span class="theme-swatches"><i style="background:${theme.bg}"></i><i style="background:${theme.panel}"></i><i style="background:${theme.accent}"></i><i style="background:${theme.accent2}"></i></span>
                <strong>${escapeHtml(theme.label)}</strong>
              </button>`;
          })
          .join("")}
      </div>
    </section>
    <section class="panel-section">
      <h2>Canvas</h2>
      ${canvasFieldsMarkup()}
    </section>
  `;
}

function importPanelMarkup(): string {
  return `
    <section class="panel-section">
      <h2>Import</h2>
      <button class="primary-button full" data-action="open-import">${icon("import")} Import HTML into editor</button>
      <p class="muted">Imports are sanitized first, then converted into editable text, buttons, inputs, cards, and reusable imported components.</p>
    </section>
    <section class="panel-section">
      <h2>Export</h2>
      <button class="secondary-button full" data-action="export-html">Download HTML</button>
      <button class="secondary-button full" data-action="export-json">Download JSON</button>
      <button class="secondary-button full" data-action="export-zip">Download ZIP</button>
    </section>
  `;
}

function canvasMarkup(): string {
  const page = activePage();
  if (!app.model || !page) {
    return `<main class="canvas-workspace empty-workspace"><div class="empty-start">${projectStartMarkup()}</div></main>`;
  }
  const scale = app.model.zoom / 100;
  return `
    <main class="canvas-workspace" id="workspace">
      <div class="stage-viewport" id="stage-viewport">
        <div class="stage-camera" id="stage-camera" style="width:${page.width}px;height:${page.height}px;transform:translate(${app.model.panX}px, ${app.model.panY}px) scale(${scale});">
          <section class="design-canvas ${app.model.grid ? "show-grid" : ""}" id="design-canvas" style="width:${page.width}px;height:${page.height}px;background:${page.background};">
            ${page.elements.map((element) => elementMarkup(element)).join("")}
          </section>
        </div>
      </div>
      <div class="floating-tools" aria-label="Canvas camera controls">
        <button class="tool-square ${app.activeTool === "select" ? "is-active" : ""}" data-tool="select" title="Select">${icon("pointer")}</button>
        <button class="tool-square ${app.activeTool === "hand" ? "is-active" : ""}" data-tool="hand" title="Pan">${icon("hand")}</button>
        <button class="tool-square ${app.activeTool === "text" ? "is-active" : ""}" data-tool="text" title="Text">${icon("text")}</button>
        <button class="tool-square ${app.activeTool === "frame" ? "is-active" : ""}" data-tool="frame" title="Frame">${icon("frame")}</button>
        <span>${page.width} x ${page.height}</span>
        <span>Pan ${Math.round(app.model.panX)}, ${Math.round(app.model.panY)}</span>
      </div>
    </main>
  `;
}

function elementMarkup(element: ForgeElement): string {
  const selected = app.selectedIds.includes(element.id);
  const contentEditable = selected && ["text", "button", "card"].includes(element.type) && !element.locked;
  const content =
    element.type === "html"
      ? `<iframe class="html-preview-frame" title="${escapeAttribute(element.name)} preview" sandbox="" srcdoc="${escapeAttribute(element.html)}"></iframe>`
      : compileElementContent(element);
  const classes = ["canvas-element", `type-${element.type}`, selected ? "is-selected" : "", element.locked ? "is-locked" : "", element.hidden ? "is-hidden" : ""].filter(Boolean).join(" ");
  const style = elementStyle(element);
  return `
    <div class="${classes}" data-element-id="${element.id}" style="${escapeAttribute(style)}">
      <div class="element-content" ${contentEditable ? `contenteditable="true" data-inline-edit="${element.id}" spellcheck="false"` : ""}>${content}</div>
      ${selected && !element.locked ? resizeHandlesMarkup() : ""}
      ${selected ? `<span class="element-chip">${escapeHtml(element.name)}</span>` : ""}
    </div>
  `;
}

function resizeHandlesMarkup(): string {
  return ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => `<span class="resize-handle ${handle}" data-resize-handle="${handle}"></span>`).join("");
}

function rightPanelMarkup(): string {
  return `
    <aside class="right-panel" aria-label="Object tools and properties">
      <button class="panel-collapse right" title="${app.rightCollapsed ? "Show inspector" : "Hide inspector"}" aria-label="${app.rightCollapsed ? "Show inspector" : "Hide inspector"}" data-action="toggle-right">${app.rightCollapsed ? icon("collapse") : icon("expand")}</button>
      <div class="panel-titlebar utility-titlebar"><strong>${utilityTitle()}</strong></div>
      <div class="utility-body">${utilityBodyMarkup()}</div>
      <div class="utility-tabs">
        ${utilityTabButton("toolbox", "Toolbox")}
        ${utilityTabButton("objects", "Object Explorer")}
        ${utilityTabButton("properties", "Property Panel")}
      </div>
      <div class="panel-resizer panel-resizer-right" data-resize-panel="right" title="Resize right panel"></div>
    </aside>
  `;
}

function utilityTitle(): string {
  if (app.utilityTab === "toolbox") return "Toolbox";
  if (app.utilityTab === "objects") return "Object Explorer";
  return "Property Panel";
}

function utilityTabButton(id: UtilityTab, label: string): string {
  return `<button class="${app.utilityTab === id ? "is-active" : ""}" data-utility-tab="${id}">${escapeHtml(label)}</button>`;
}

function utilityBodyMarkup(): string {
  if (app.utilityTab === "toolbox") return toolboxMarkup();
  if (app.utilityTab === "objects") return objectExplorerMarkup();
  return propertyPanelMarkup();
}

const toolboxGroups: Array<{ title: string; items: Array<{ id: string; label: string; icon: keyof typeof iconPaths }> }> = [
  {
    title: "Common Objects",
    items: [
      { id: "text", label: "Text", icon: "text" },
      { id: "image", label: "Image", icon: "image" },
      { id: "panel", label: "Panel", icon: "rectangle" }
    ]
  },
  {
    title: "Drawing",
    items: [
      { id: "rectangle", label: "Rectangle", icon: "rectangle" },
      { id: "rounded-rectangle", label: "Rounded Rectangle", icon: "rectangle" },
      { id: "ellipse", label: "Ellipse", icon: "ellipse" },
      { id: "line", label: "Line", icon: "line" },
      { id: "polygon", label: "Polygon", icon: "polygon" }
    ]
  },
  {
    title: "Push Button",
    items: [
      { id: "momentary-button", label: "Momentary Button", icon: "buttonIcon" as keyof typeof iconPaths },
      { id: "maintained-button", label: "Maintained Button", icon: "buttonIcon" as keyof typeof iconPaths },
      { id: "latched-button", label: "Latched Button", icon: "buttonIcon" as keyof typeof iconPaths },
      { id: "interlocked-button", label: "Interlocked Button", icon: "buttonIcon" as keyof typeof iconPaths }
    ]
  },
  {
    title: "Numeric and String",
    items: [
      { id: "numeric-display", label: "Numeric Display", icon: "indicator" },
      { id: "numeric-input", label: "Numeric Input Enable", icon: "indicator" },
      { id: "string-display", label: "String Display", icon: "text" },
      { id: "string-input", label: "String Input Enable", icon: "text" }
    ]
  },
  {
    title: "Display Navigation",
    items: [
      { id: "goto-display", label: "Goto Display", icon: "nav" },
      { id: "return-display", label: "Return To Display", icon: "nav" },
      { id: "close-display", label: "Close Display", icon: "nav" },
      { id: "display-menu", label: "Display List Selector", icon: "pages" }
    ]
  },
  {
    title: "Indicator",
    items: [
      { id: "multistate-indicator", label: "Multistate Indicator", icon: "indicator" },
      { id: "symbol-indicator", label: "Symbol Indicator", icon: "indicator" },
      { id: "list-indicator", label: "List Indicator", icon: "layers" }
    ]
  },
  {
    title: "Gauge and Graph",
    items: [
      { id: "bar-graph", label: "Bar Graph", icon: "gauge" },
      { id: "gauge", label: "Gauge", icon: "gauge" },
      { id: "scale", label: "Scale", icon: "line" }
    ]
  }
];

function toolboxMarkup(): string {
  return `
    <div class="toolbox-panel">
      <div class="panel-search">${icon("search")}<input type="search" placeholder="Find tool"></div>
      ${toolboxGroups
        .map(
          (group) => `
          <section class="toolbox-group">
            <h2>${icon("chevronDown")}${escapeHtml(group.title)}</h2>
            ${group.items
              .map((item) => `<button class="toolbox-row" data-add-tool="${item.id}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></button>`)
              .join("")}
          </section>`
        )
        .join("")}
    </div>
  `;
}

interface ObjectTreeNode {
  element: ForgeElement;
  children: ObjectTreeNode[];
}

function objectTree(page: ForgeDesignPage): ObjectTreeNode[] {
  const sorted = page.elements.slice().sort((a, b) => a.z - b.z);
  const nodes = new Map<string, ObjectTreeNode>();
  sorted.forEach((element) => nodes.set(element.id, { element, children: [] }));
  const roots: ObjectTreeNode[] = [];
  sorted.forEach((element) => {
    const node = nodes.get(element.id)!;
    const parent = element.parentId ? nodes.get(element.parentId) : undefined;
    if (parent && parent.element.id !== element.id) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

function objectNodeMarkup(node: ObjectTreeNode, level: number): string {
  const element = node.element;
  const selected = app.selectedIds.includes(element.id);
  const collapsed = app.collapsedObjectIds.has(element.id);
  const hasChildren = node.children.length > 0;
  return `
    <div class="object-node">
      <div class="object-row ${selected ? "is-active" : ""}" style="--tree-level:${level}">
        <button class="tree-toggle" data-object-toggle="${element.id}" ${hasChildren ? "" : "disabled"} aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeAttribute(element.name)}">${hasChildren ? icon(collapsed ? "chevronRight" : "chevronDown") : ""}</button>
        <label class="visibility-check" title="${element.hidden ? "Show" : "Hide"} ${escapeAttribute(element.name)}">
          <input type="checkbox" data-object-visible="${element.id}" ${element.hidden ? "" : "checked"}>
        </label>
        <button class="object-select" data-layer-id="${element.id}">
          ${icon(element.type === "frame" || element.type === "card" ? "folder" : "file")}
          <span>${escapeHtml(element.name)}</span>
        </button>
        <button class="tree-state" data-object-lock="${element.id}" title="${element.locked ? "Unlock" : "Lock"}">${icon(element.locked ? "lock" : "unlock")}</button>
      </div>
      ${hasChildren && !collapsed ? `<div class="object-children">${node.children.map((child) => objectNodeMarkup(child, level + 1)).join("")}</div>` : ""}
    </div>
  `;
}

function objectExplorerMarkup(): string {
  const page = activePage();
  if (!page) return `<p class="muted">No display open.</p>`;
  const tree = objectTree(page);
  return `
    <div class="object-explorer">
      <div class="object-root">${icon("chevronDown")}<label class="visibility-check"><input type="checkbox" checked></label>${icon("file")}<strong>Display</strong></div>
      <div class="object-tree">
        ${tree.map((node) => objectNodeMarkup(node, 0)).join("") || `<p class="muted">No objects on this display.</p>`}
      </div>
      <div class="object-footer">
        <label class="check-row"><input type="checkbox" data-action="toggle-highlight" ${app.highlightObjects ? "checked" : ""}> Highlighting on</label>
        <button class="secondary-button compact" data-action="expand-objects">Expand</button>
        <button class="secondary-button compact" data-action="collapse-objects">Collapse</button>
        <button class="secondary-button compact" data-action="group-selection">Group</button>
        <button class="secondary-button compact" data-action="ungroup-selection">Ungroup</button>
      </div>
    </div>
  `;
}

type PropertyField = { key: keyof ForgeElement; label: string; type: "text" | "number" | "color" | "boolean" };

const propertyFields: PropertyField[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "x", label: "Left", type: "number" },
  { key: "y", label: "Top", type: "number" },
  { key: "w", label: "Width", type: "number" },
  { key: "h", label: "Height", type: "number" },
  { key: "rotation", label: "Rotation", type: "number" },
  { key: "hidden", label: "Visible", type: "boolean" },
  { key: "locked", label: "Locked", type: "boolean" },
  { key: "fill", label: "Fill", type: "color" },
  { key: "color", label: "TextColor", type: "color" },
  { key: "border", label: "BorderColor", type: "color" },
  { key: "borderWidth", label: "BorderWidth", type: "number" },
  { key: "radius", label: "Radius", type: "number" },
  { key: "font", label: "FontSize", type: "number" },
  { key: "weight", label: "FontWeight", type: "number" },
  { key: "opacity", label: "Opacity", type: "number" },
  { key: "z", label: "ZIndex", type: "number" }
];

function sharedValue(elements: ForgeElement[], key: keyof ForgeElement): unknown {
  const first = elements[0]?.[key];
  return elements.every((element) => element[key] === first) ? first : "";
}

function propertyInputMarkup(field: PropertyField, elements: ForgeElement[]): string {
  const value = sharedValue(elements, field.key);
  if (field.type === "boolean") {
    const checked = field.key === "hidden" ? !Boolean(value) : Boolean(value);
    return `<input type="checkbox" data-property-flag="${String(field.key)}" ${checked ? "checked" : ""}>`;
  }
  if (field.type === "color") {
    return `<input type="color" data-el-prop="${String(field.key)}" value="${normalizeColor(String(value || ""), field.key === "color" ? "#172033" : "#ffffff")}">`;
  }
  return `<input type="${field.type}" data-el-prop="${String(field.key)}" value="${escapeAttribute(String(value ?? ""))}">`;
}

function propertyPanelMarkup(): string {
  const selected = selectedElements();
  if (!selected.length) return canvasPropertyPanelMarkup();
  const selectedName = selected.length === 1 ? selected[0].name : "Multiple Selection";
  return `
    <div class="property-panel">
      <input class="property-selected-name" type="text" data-el-prop="name" value="${escapeAttribute(selectedName)}" ${selected.length > 1 ? "disabled" : ""}>
      <div class="property-help"><button class="mini-help" type="button">?</button></div>
      <div class="property-tabs">
        <button class="${app.propertyTab === "properties" ? "is-active" : ""}" data-property-tab="properties">Properties</button>
        <button class="${app.propertyTab === "connections" ? "is-active" : ""}" data-property-tab="connections">Connections</button>
      </div>
      ${
        app.propertyTab === "connections"
          ? connectionsGridMarkup(selected)
          : `<div class="property-options">
              <label><input type="radio" checked> All Properties</label>
              <label><input type="radio"> Shared Properties</label>
            </div>
            <label class="check-row"><input type="checkbox" checked> Include Grouped Objects</label>
            <div class="property-grid">
              ${propertyFields
                .map((field) => {
                  const prefix = selected.length === 1 ? selected[0].type[0].toUpperCase() + selected[0].type.slice(1) : "Object";
                  return `<label class="property-row"><span>(${prefix}${field.label})</span>${propertyInputMarkup(field, selected)}</label>`;
                })
                .join("")}
            </div>`
      }
    </div>
  `;
}

function canvasPropertyPanelMarkup(): string {
  const page = activePage();
  return `
    <div class="property-panel">
      <input class="property-selected-name" value="${escapeAttribute(page?.name ?? "Display")}" disabled>
      <div class="property-tabs"><button class="is-active">Display</button></div>
      <div class="property-grid">
        <label class="property-row"><span>(DisplayName)</span><input type="text" data-page-prop="name" value="${escapeAttribute(page?.name ?? "")}"></label>
        <label class="property-row"><span>(DisplayWidth)</span><input type="number" data-page-prop="width" value="${page?.width ?? DEFAULT_CANVAS_WIDTH}"></label>
        <label class="property-row"><span>(DisplayHeight)</span><input type="number" data-page-prop="height" value="${page?.height ?? DEFAULT_CANVAS_HEIGHT}"></label>
        <label class="property-row"><span>(DisplayBackground)</span><input type="color" data-page-prop="background" value="${normalizeColor(page?.background ?? "#ffffff")}"></label>
      </div>
      <div class="button-row property-actions">
        <button class="secondary-button compact" data-action="add-nav-button">${icon("nav")} Nav Button</button>
        <button class="secondary-button compact" data-action="add-nav-menu">${icon("pages")} Full Menu</button>
      </div>
    </div>
  `;
}

function connectionsGridMarkup(selected: ForgeElement[]): string {
  const element = selected[0];
  return `
    <div class="property-grid">
      <label class="property-row"><span>(Action)</span>
        <select data-el-prop="action">
          <option value="" ${element.action === "" ? "selected" : ""}>None</option>
          <option value="page" ${element.action === "page" ? "selected" : ""}>Go to display</option>
          <option value="toggle" ${element.action === "toggle" ? "selected" : ""}>Toggle object</option>
        </select>
      </label>
      <label class="property-row"><span>(Target)</span>
        <select data-el-prop="target">
          <option value="">Choose target...</option>
          ${app.model!.pages.map((page) => `<option value="${page.id}" ${page.id === element.target ? "selected" : ""}>${escapeHtml(page.name)}</option>`).join("")}
          ${activePage()!.elements.map((candidate) => `<option value="${candidate.id}" ${candidate.id === element.target ? "selected" : ""}>${escapeHtml(candidate.name)}</option>`).join("")}
        </select>
      </label>
      <label class="property-row"><span>(ButtonText)</span><input type="text" data-el-prop="text" value="${escapeAttribute(element.text)}"></label>
    </div>
    <div class="button-row property-actions">
      <button class="secondary-button compact" data-action="add-nav-button">${icon("nav")} Add nav button</button>
      <button class="secondary-button compact" data-action="add-nav-menu">${icon("pages")} Build menu</button>
    </div>
  `;
}

function inspectorTab(id: InspectorTab, label: string): string {
  return `<button class="${app.inspectorTab === id ? "is-active" : ""}" data-inspector-tab="${id}">${label}</button>`;
}

function inspectorBodyMarkup(): string {
  const selected = selectedElement();
  if (app.inspectorTab === "canvas" || !selected) return canvasInspectorMarkup();
  if (app.inspectorTab === "layout") return layoutInspectorMarkup(selected);
  if (app.inspectorTab === "actions") return actionsInspectorMarkup(selected);
  return designInspectorMarkup(selected);
}

function selectedHeaderMarkup(selected: ForgeElement): string {
  return `
    <section class="selected-card">
      <div class="selected-icon">${escapeHtml(selected.type.slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>${escapeHtml(selected.name)}</strong>
        <span>${escapeHtml(selected.type)}${selected.locked ? " - locked" : ""}</span>
      </div>
    </section>
  `;
}

function designInspectorMarkup(selected: ForgeElement): string {
  return `
    ${selectedHeaderMarkup(selected)}
    <section class="inspector-section">
      <h2>Content</h2>
      <label class="field-label">Name <input type="text" data-el-prop="name" value="${escapeAttribute(selected.name)}"></label>
      ${
        selected.type === "html"
          ? `<label class="field-label">HTML <textarea rows="8" data-el-prop="html">${escapeHtml(selected.html)}</textarea></label>`
          : `<label class="field-label">Text <textarea rows="5" data-el-prop="text">${escapeHtml(selected.text)}</textarea></label>`
      }
      <label class="field-label">Font family
        <select data-el-prop="fontFamily">
          ${[defaultFont, "Georgia, serif", "Courier New, monospace", "system-ui, sans-serif", "Impact, sans-serif"].map((font) => `<option value="${escapeAttribute(font)}" ${font === selected.fontFamily ? "selected" : ""}>${escapeHtml(font.split(",")[0])}</option>`).join("")}
        </select>
      </label>
      <div class="field-grid two">
        <label class="field-label">Font <input type="number" data-el-prop="font" value="${selected.font}"></label>
        <label class="field-label">Weight <input type="number" min="100" max="1000" step="100" data-el-prop="weight" value="${selected.weight}"></label>
      </div>
    </section>
    <section class="inspector-section">
      <h2>Paint</h2>
      <div class="field-grid two">
        <label class="field-label">Fill <input type="color" data-el-prop="fill" value="${normalizeColor(selected.fill, "#ffffff")}"></label>
        <label class="field-label">Text <input type="color" data-el-prop="color" value="${normalizeColor(selected.color, "#172033")}"></label>
        <label class="field-label">Border <input type="color" data-el-prop="border" value="${normalizeColor(selected.border, "#cbd5e1")}"></label>
        <label class="field-label">Opacity <input type="number" min="0" max="100" data-el-prop="opacity" value="${selected.opacity}"></label>
      </div>
      <label class="field-label">Shadow <input type="text" data-el-prop="shadow" value="${escapeAttribute(selected.shadow)}" placeholder="0 12px 34px rgba(0,0,0,.15)"></label>
    </section>
    <section class="button-row">
      <button class="secondary-button compact" data-action="duplicate">${icon("reuse")} Duplicate</button>
      <button class="secondary-button compact" data-action="save-template">${icon("reuse")} Save reusable</button>
      <button class="ghost-button danger compact" data-action="delete">${icon("trash")} Delete</button>
    </section>
  `;
}

function layoutInspectorMarkup(selected: ForgeElement): string {
  return `
    ${selectedHeaderMarkup(selected)}
    <section class="inspector-section">
      <h2>Position</h2>
      <div class="field-grid two">
        <label class="field-label">X <input type="number" data-el-prop="x" value="${selected.x}"></label>
        <label class="field-label">Y <input type="number" data-el-prop="y" value="${selected.y}"></label>
        <label class="field-label">W <input type="number" data-el-prop="w" value="${selected.w}"></label>
        <label class="field-label">H <input type="number" data-el-prop="h" value="${selected.h}"></label>
        <label class="field-label">Rotate <input type="number" data-el-prop="rotation" value="${selected.rotation}"></label>
        <label class="field-label">Radius <input type="number" data-el-prop="radius" value="${selected.radius}"></label>
        <label class="field-label">Border W <input type="number" data-el-prop="borderWidth" value="${selected.borderWidth}"></label>
        <label class="field-label">Z <input type="number" data-el-prop="z" value="${selected.z}"></label>
      </div>
    </section>
    <section class="inspector-section">
      <h2>Arrange</h2>
      <div class="align-grid">
        ${["left", "center", "right", "top", "middle", "bottom", "distH", "distV"].map((action) => `<button class="mini-button" data-align="${action}">${escapeHtml(action)}</button>`).join("")}
      </div>
      <div class="button-row">
        <button class="secondary-button compact" data-action="bring-front">Bring front</button>
        <button class="secondary-button compact" data-action="send-back">Send back</button>
      </div>
    </section>
  `;
}

function actionsInspectorMarkup(selected: ForgeElement): string {
  return `
    ${selectedHeaderMarkup(selected)}
    <section class="inspector-section">
      <h2>Click Action</h2>
      <label class="field-label">Action
        <select data-el-prop="action">
          <option value="" ${selected.action === "" ? "selected" : ""}>None</option>
          <option value="page" ${selected.action === "page" ? "selected" : ""}>Go to page</option>
          <option value="toggle" ${selected.action === "toggle" ? "selected" : ""}>Toggle element</option>
        </select>
      </label>
      <label class="field-label">Target
        <select data-el-prop="target">
          <option value="">Choose target...</option>
          ${app.model!.pages.map((page) => `<option value="${page.id}" ${page.id === selected.target ? "selected" : ""}>${escapeHtml(page.name)}</option>`).join("")}
          ${activePage()!.elements.map((element) => `<option value="${element.id}" ${element.id === selected.target ? "selected" : ""}>${escapeHtml(element.name)}</option>`).join("")}
        </select>
      </label>
      <p class="muted">Page actions are exported as real product navigation.</p>
    </section>
    <section class="inspector-section">
      <h2>Element State</h2>
      <label class="check-row"><input type="checkbox" data-el-flag="locked" ${selected.locked ? "checked" : ""}> Locked</label>
      <label class="check-row"><input type="checkbox" data-el-flag="hidden" ${selected.hidden ? "checked" : ""}> Hidden</label>
    </section>
  `;
}

function canvasInspectorMarkup(): string {
  return `
    <section class="selected-card">
      <div class="selected-icon">C</div>
      <div>
        <strong>${escapeHtml(activePage()?.name ?? "Canvas")}</strong>
        <span>${activePage()?.elements.length ?? 0} elements</span>
      </div>
    </section>
    <section class="inspector-section">
      <h2>Canvas</h2>
      ${canvasFieldsMarkup()}
    </section>
    <section class="inspector-section">
      <h2>Project</h2>
      <label class="field-label">Project name <input type="text" data-project-name value="${escapeAttribute(app.project?.name ?? "")}"></label>
      <button class="secondary-button full" data-action="request-storage">Request persistent storage</button>
      <p class="muted">${escapeHtml(app.storageMessage)}</p>
    </section>
  `;
}

function canvasFieldsMarkup(): string {
  const page = activePage();
  return `
    <div class="field-grid two">
      <label class="field-label">Width <input type="number" data-page-prop="width" value="${page?.width ?? DEFAULT_CANVAS_WIDTH}"></label>
      <label class="field-label">Height <input type="number" data-page-prop="height" value="${page?.height ?? DEFAULT_CANVAS_HEIGHT}"></label>
      <label class="field-label">Background <input type="color" data-page-prop="background" value="${normalizeColor(page?.background ?? "#ffffff")}"></label>
    </div>
    <label class="check-row"><input type="checkbox" data-model-flag="grid" ${app.model?.grid ? "checked" : ""}> Show grid</label>
    <label class="check-row"><input type="checkbox" data-model-flag="snap" ${app.model?.snap ? "checked" : ""}> Snap to grid</label>
  `;
}

function statusbarMarkup(): string {
  const page = activePage();
  return `
    <footer class="statusbar">
      <span data-save-state>${escapeHtml(statusText())}</span>
      <span>${escapeHtml(page?.name ?? "No page")}</span>
      <span data-element-count>${page?.elements.length ?? 0} elements</span>
      <span>Zoom ${app.model?.zoom ?? 100}%</span>
      <span>${app.storageUsage}</span>
    </footer>
  `;
}

function importDialogMarkup(): string {
  const report = app.importDraft?.report;
  return `
    <div class="modal-backdrop">
      <section class="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header>
          <h2 id="import-title">Import HTML</h2>
          <button class="icon-button" data-action="close-import" aria-label="Close">X</button>
        </header>
        <div class="import-grid">
          <section class="panel-section">
            <label class="file-button full">Choose HTML<input type="file" accept=".html,.htm,text/html" data-action="import-html-file"></label>
            <label class="field-label">File name <input type="text" data-action="import-file-name" value="${escapeAttribute(app.importFileName)}"></label>
            <label class="check-row"><input type="checkbox" data-action="retain-source" ${app.importRetainSource ? "checked" : ""}> Retain source locally</label>
            <label class="field-label">Paste HTML <textarea rows="14" data-action="import-source">${escapeHtml(app.importSourceText)}</textarea></label>
            <button class="primary-button full" data-action="analyze-import">Analyze safely</button>
          </section>
          <section class="panel-section">
            <h2>Import Result</h2>
            ${
              report
                ? `<div class="metric-grid">
                    <div><strong>${report.stats.screenCount}</strong><span>Screens</span></div>
                    <div><strong>${report.stats.interactionCount}</strong><span>Actions</span></div>
                    <div><strong>${report.resources.length}</strong><span>Resources</span></div>
                    <div><strong>${app.importDraft?.report.sanitization.quarantinedScripts.length ?? 0}</strong><span>Scripts blocked</span></div>
                  </div>
                  <button class="primary-button full" data-action="accept-import">Convert to editor</button>`
                : `<p class="muted">The file is parsed as inert text, sanitized, and converted into editable canvas elements.</p>`
            }
          </section>
          <section class="preview-surface">
            <iframe title="Safe import preview" sandbox="" srcdoc="${escapeAttribute(report?.sanitizedPreviewHtml ?? "<p>No preview yet.</p>")}"></iframe>
          </section>
        </div>
      </section>
    </div>
  `;
}

function openRunPreview(): void {
  if (!app.project) return;
  syncProjectModel();
  const runtimeUrl = new URL(`${import.meta.env.BASE_URL}product-runtime.js`, window.location.origin).toString();
  app.previewHtml = createProductHtml(app.project, { interactive: true, runtimeScriptUrl: runtimeUrl });
  app.previewOpen = true;
  render();
}

function closeRunPreview(): void {
  app.previewOpen = false;
  app.previewHtml = "";
  render();
}

function previewDialogMarkup(): string {
  return `
    <div class="modal-backdrop">
      <section class="preview-modal" role="dialog" aria-modal="true">
        <header>
          <h2>Run Product</h2>
          <button class="icon-button" data-action="close-preview" aria-label="Close">X</button>
        </header>
        <iframe title="Product run preview" sandbox="allow-scripts" srcdoc="${escapeAttribute(app.previewHtml)}"></iframe>
      </section>
    </div>
  `;
}

function bindEvents(): void {
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    const action = element.dataset.action ?? "";
    if (element instanceof HTMLInputElement && action === "asset-upload") {
      element.addEventListener("change", () => void uploadAsset(element.files?.[0]));
      return;
    }
    if (element instanceof HTMLInputElement && action === "import-html-file") {
      element.addEventListener("change", () => void importHtmlFile(element.files?.[0]));
      return;
    }
    if (element instanceof HTMLTextAreaElement && action === "import-source") {
      element.addEventListener("input", () => {
        app.importSourceText = element.value;
      });
      return;
    }
    if (element instanceof HTMLInputElement && action === "import-file-name") {
      element.addEventListener("input", () => {
        app.importFileName = element.value || "import.html";
      });
      return;
    }
    if (element instanceof HTMLInputElement && action === "retain-source") {
      element.addEventListener("change", () => {
        app.importRetainSource = element.checked;
      });
      return;
    }
    if (element instanceof HTMLSelectElement && action === "open-project-select") {
      element.addEventListener("change", () => {
        if (element.value) void openProject(element.value);
      });
      return;
    }
    element.addEventListener("click", () => void handleAction(action));
  });

  root.querySelectorAll<HTMLElement>("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      app.activeTool = button.dataset.tool as ToolId;
      render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      app.activePanel = button.dataset.panel as PanelId;
      app.leftCollapsed = false;
      render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      app.inspectorTab = button.dataset.inspectorTab as InspectorTab;
      app.rightCollapsed = false;
      render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-utility-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      app.utilityTab = button.dataset.utilityTab as UtilityTab;
      app.rightCollapsed = false;
      render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-property-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      app.propertyTab = button.dataset.propertyTab as PropertyTab;
      render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-add-element]").forEach((button) => {
    button.addEventListener("click", () => addElement(button.dataset.addElement as ElementType));
  });
  root.querySelectorAll<HTMLElement>("[data-add-tool]").forEach((button) => {
    button.addEventListener("click", () => addToolPreset(button.dataset.addTool ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-page-id]").forEach((button) => {
    button.addEventListener("click", () => selectPage(button.dataset.pageId ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-page-nav-target]").forEach((button) => {
    button.addEventListener("click", () => addNavigationButton(button.dataset.pageNavTarget ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((button) => {
    button.addEventListener("click", (event) => selectElement(button.dataset.layerId ?? "", event.shiftKey));
  });
  root.querySelectorAll<HTMLElement>("[data-object-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleObjectCollapsed(button.dataset.objectToggle ?? "");
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-object-visible]").forEach((field) => {
    field.addEventListener("change", () => setObjectVisible(field.dataset.objectVisible ?? "", field.checked));
  });
  root.querySelectorAll<HTMLElement>("[data-object-lock]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleObjectLocked(button.dataset.objectLock ?? "");
    });
  });
  root.querySelectorAll<HTMLElement>("[data-template-id]").forEach((button) => {
    button.addEventListener("click", () => insertTemplate(button.dataset.templateId ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-library-id]").forEach((button) => {
    button.addEventListener("click", () => insertLibraryItem(button.dataset.libraryId ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((button) => {
    button.addEventListener("click", () => insertAsset(button.dataset.assetId ?? ""));
  });
  root.querySelectorAll<HTMLElement>("[data-theme-id]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeId as ThemeId));
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-el-prop]").forEach((field) => {
    const eventName = field instanceof HTMLTextAreaElement || field.type === "color" || field.tagName === "SELECT" ? "input" : "change";
    field.addEventListener(eventName, () => updateSelectedProp(field.dataset.elProp ?? "", field.value));
  });
  root.querySelectorAll<HTMLInputElement>("[data-el-flag]").forEach((field) => {
    field.addEventListener("change", () => updateSelectedFlag(field.dataset.elFlag ?? "", field.checked));
  });
  root.querySelectorAll<HTMLInputElement>("[data-property-flag]").forEach((field) => {
    field.addEventListener("change", () => {
      const flag = field.dataset.propertyFlag ?? "";
      updateSelectedFlag(flag, flag === "hidden" ? !field.checked : field.checked);
    });
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-page-prop]").forEach((field) => {
    const eventName = field.type === "color" ? "input" : "change";
    field.addEventListener(eventName, () => updatePageProp(field.dataset.pageProp ?? "", field.value));
  });
  root.querySelectorAll<HTMLInputElement>("[data-model-flag]").forEach((field) => {
    field.addEventListener("change", () => updateModelFlag(field.dataset.modelFlag ?? "", field.checked));
  });
  root.querySelectorAll<HTMLElement>("[data-align]").forEach((button) => {
    button.addEventListener("click", () => alignSelection(button.dataset.align ?? ""));
  });
  root.querySelector<HTMLInputElement>("[data-project-name]")?.addEventListener("change", (event) => {
    if (!app.project) return;
    app.project.name = (event.target as HTMLInputElement).value || app.project.name;
    markDirty(true);
  });

  const canvas = root.querySelector<HTMLElement>("#design-canvas");
  const workspace = root.querySelector<HTMLElement>("#workspace");
  const viewport = root.querySelector<HTMLElement>("#stage-viewport");
  canvas?.addEventListener("pointerdown", startCanvasPointer);
  workspace?.addEventListener("pointerdown", startWorkspacePointer);
  viewport?.addEventListener("wheel", onViewportWheel, { passive: false });
  root.querySelectorAll<HTMLElement>("[data-element-id]").forEach((element) => element.addEventListener("pointerdown", startElementPointer));
  root.querySelectorAll<HTMLElement>("[data-resize-handle]").forEach((handle) => handle.addEventListener("pointerdown", startResizePointer));
  root.querySelectorAll<HTMLElement>("[data-resize-panel]").forEach((handle) => handle.addEventListener("pointerdown", startPanelResize));
  root.querySelectorAll<HTMLElement>("[data-inline-edit]").forEach((editable) => {
    editable.addEventListener("input", () => {
      const element = activePage()?.elements.find((candidate) => candidate.id === editable.dataset.inlineEdit);
      if (!element) return;
      element.text = editable.textContent ?? "";
      markDirty(false);
    });
    editable.addEventListener("pointerdown", (event) => event.stopPropagation());
  });
}

async function handleAction(action: string): Promise<void> {
  switch (action) {
    case "new-project":
      await createNew();
      break;
    case "open-import":
      app.importOpen = true;
      render();
      break;
    case "close-import":
      app.importOpen = false;
      render();
      break;
    case "analyze-import":
      analyzeImport();
      break;
    case "accept-import":
      await acceptImport();
      break;
    case "save":
      await saveNow(true);
      break;
    case "preview":
      openRunPreview();
      break;
    case "close-preview":
      closeRunPreview();
      break;
    case "add-page":
      addPage();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "zoom-out":
      setZoom((app.model?.zoom ?? 100) - 10);
      break;
    case "zoom-in":
      setZoom((app.model?.zoom ?? 100) + 10);
      break;
    case "fit":
      fitCanvas();
      break;
    case "zoom-100":
      setZoom(100);
      break;
    case "toggle-left":
      app.leftCollapsed = !app.leftCollapsed;
      render();
      break;
    case "toggle-right":
      app.rightCollapsed = !app.rightCollapsed;
      render();
      break;
    case "toggle-top":
      app.topCollapsed = !app.topCollapsed;
      render();
      break;
    case "duplicate":
      duplicateSelection();
      break;
    case "delete":
      deleteSelection();
      break;
    case "save-template":
      await saveTemplate();
      break;
    case "add-nav-button":
      addNavigationButton();
      break;
    case "add-nav-menu":
      addNavigationMenu();
      break;
    case "expand-objects":
      app.collapsedObjectIds.clear();
      render();
      break;
    case "collapse-objects":
      collapseAllObjects();
      break;
    case "toggle-highlight":
      app.highlightObjects = !app.highlightObjects;
      render();
      break;
    case "group-selection":
      groupSelection();
      break;
    case "ungroup-selection":
      ungroupSelection();
      break;
    case "bring-front":
      arrangeSelection("front");
      break;
    case "send-back":
      arrangeSelection("back");
      break;
    case "request-storage":
      await requestStorage();
      break;
    case "export-html":
      downloadHtml();
      break;
    case "export-json":
      downloadJson();
      break;
    case "export-zip":
      await downloadZip();
      break;
  }
}

function addElement(type: ElementType, at?: { x: number; y: number }, overrides: Partial<ForgeElement> = {}): ForgeElement | undefined {
  const page = activePage();
  if (!app.model || !page) return undefined;
  pushHistory("add element");
  const element = makeElement(type, at?.x ?? 90 + page.elements.length * 12, at?.y ?? 90 + page.elements.length * 12, overrides);
  element.z = nextZ(page);
  page.elements.push(element);
  app.selectedIds = [element.id];
  app.inspectorTab = type === "frame" ? "layout" : "design";
  app.utilityTab = "properties";
  app.activeTool = "select";
  markDirty(true);
  return element;
}

function addToolPreset(id: string): void {
  const page = activePage();
  if (!page) return;
  const x = 80 + (page.elements.length % 8) * 14;
  const y = 80 + (page.elements.length % 8) * 14;
  const presets: Record<string, { type: ElementType; overrides: Partial<ForgeElement> }> = {
    text: { type: "text", overrides: { name: "Text", text: "Text", w: 180, h: 42, font: 18, weight: 600 } },
    image: { type: "image", overrides: { name: "Image", text: "Image" } },
    panel: { type: "frame", overrides: { name: "Panel", w: 360, h: 220, fill: "#f8fafc", border: "#8ba2bd", radius: 0 } },
    rectangle: { type: "shape", overrides: { name: "Rectangle", w: 160, h: 96, radius: 0, fill: "#e5e7eb", border: "#64748b" } },
    "rounded-rectangle": { type: "shape", overrides: { name: "Rounded Rectangle", w: 160, h: 96, radius: 14, fill: "#e5e7eb", border: "#64748b" } },
    ellipse: { type: "shape", overrides: { name: "Ellipse", w: 130, h: 92, radius: 999, fill: "#e0f2fe", border: "#0284c7" } },
    line: { type: "shape", overrides: { name: "Line", w: 180, h: 4, radius: 999, fill: "#334155", border: "#334155" } },
    polygon: { type: "shape", overrides: { name: "Polygon", w: 120, h: 120, radius: 12, fill: "#fde68a", border: "#92400e" } },
    "momentary-button": { type: "button", overrides: { name: "Momentary Button", text: "Momentary", fill: "#2563eb", border: "#1d4ed8" } },
    "maintained-button": { type: "button", overrides: { name: "Maintained Button", text: "Maintained", fill: "#0f766e", border: "#115e59" } },
    "latched-button": { type: "button", overrides: { name: "Latched Button", text: "Latched", fill: "#7c3aed", border: "#6d28d9" } },
    "interlocked-button": { type: "button", overrides: { name: "Interlocked Button", text: "Interlock", fill: "#b45309", border: "#92400e" } },
    "numeric-display": { type: "text", overrides: { name: "Numeric Display", text: "123", w: 120, h: 42, font: 20, weight: 800 } },
    "numeric-input": { type: "input", overrides: { name: "Numeric Input", text: "0" } },
    "string-display": { type: "text", overrides: { name: "String Display", text: "String", w: 180, h: 42, font: 18, weight: 700 } },
    "string-input": { type: "input", overrides: { name: "String Input", text: "Value" } },
    "goto-display": { type: "button", overrides: { name: "Goto Display", text: "Goto", action: "page", target: app.model?.pages.find((candidate) => candidate.id !== page.id)?.id ?? "" } },
    "return-display": { type: "button", overrides: { name: "Return To Display", text: "Return" } },
    "close-display": { type: "button", overrides: { name: "Close Display", text: "Close" } },
    "display-menu": { type: "frame", overrides: { name: "Display List Selector", w: 240, h: 300, fill: "#f8fafc", border: "#94a3b8", radius: 0 } },
    "multistate-indicator": { type: "shape", overrides: { name: "Multistate Indicator", w: 90, h: 90, radius: 999, fill: "#22c55e", border: "#166534" } },
    "symbol-indicator": { type: "shape", overrides: { name: "Symbol Indicator", w: 96, h: 96, radius: 10, fill: "#38bdf8", border: "#075985" } },
    "list-indicator": { type: "card", overrides: { name: "List Indicator", text: "Status\nRunning\nReady", w: 220, h: 150 } },
    "bar-graph": { type: "shape", overrides: { name: "Bar Graph", w: 220, h: 44, radius: 2, fill: "linear-gradient(90deg,#22c55e 62%,#e2e8f0 62%)", border: "#64748b" } },
    gauge: { type: "shape", overrides: { name: "Gauge", w: 140, h: 90, radius: 90, fill: "#e0f2fe", border: "#0284c7" } },
    scale: { type: "shape", overrides: { name: "Scale", w: 180, h: 12, radius: 0, fill: "repeating-linear-gradient(90deg,#334155 0 2px,transparent 2px 20px)", border: "transparent" } }
  };
  const preset = presets[id] ?? presets.text;
  addElement(preset.type, { x, y }, preset.overrides);
}

function addPage(): void {
  if (!app.model) return;
  pushHistory("add page");
  const page: ForgeDesignPage = {
    id: createId("page"),
    generatedId: generatedScreenId(app.model.pages.length),
    name: `Page ${app.model.pages.length + 1}`,
    slug: `page-${app.model.pages.length + 1}`,
    width: activePage()?.width ?? DEFAULT_CANVAS_WIDTH,
    height: activePage()?.height ?? DEFAULT_CANVAS_HEIGHT,
    background: "#ffffff",
    elements: [makeElement("text", 80, 80, { text: `Page ${app.model.pages.length + 1}`, font: 42, w: 520, h: 88, z: 1 })]
  };
  app.model.pages.push(page);
  app.model.currentPageId = page.id;
  app.model.panX = 0;
  app.model.panY = 0;
  app.selectedIds = [];
  app.activePanel = "pages";
  markDirty(true);
}

function selectPage(id: string): void {
  if (!app.model?.pages.some((page) => page.id === id)) return;
  app.model.currentPageId = id;
  app.model.panX = 0;
  app.model.panY = 0;
  app.selectedIds = [];
  fitCanvas();
}

function addNavigationButton(targetId?: string): void {
  const page = activePage();
  if (!app.model || !page) return;
  const target = app.model.pages.find((candidate) => candidate.id === targetId) ?? app.model.pages.find((candidate) => candidate.id !== page.id) ?? page;
  addElement("button", { x: 40, y: 40 + page.elements.filter((element) => element.name.startsWith("Nav:")).length * 54 }, {
    name: `Nav: ${target.name}`,
    text: target.name,
    action: "page",
    target: target.id,
    w: 210,
    h: 42,
    radius: 2,
    fill: "#1f2937",
    border: "#475569"
  });
}

function addNavigationMenu(): void {
  const page = activePage();
  if (!app.model || !page) return;
  pushHistory("add navigation menu");
  const x = 24;
  const y = 24;
  const width = 250;
  const rowHeight = 34;
  const menuHeight = Math.min(page.height - 48, Math.max(120, app.model.pages.length * rowHeight + 54));
  const group = makeElement("frame", x, y, {
    name: "Display Navigation",
    w: width,
    h: menuHeight,
    fill: "#f8fafc",
    border: "#64748b",
    borderWidth: 1,
    radius: 0,
    z: nextZ(page)
  });
  page.elements.push(group);
  app.model.pages.forEach((target, index) => {
    const button = makeElement("button", x + 12, y + 14 + index * rowHeight, {
      name: `Nav: ${target.name}`,
      text: `${String(index + 1).padStart(3, "0")} ${target.name}`,
      action: "page",
      target: target.id,
      parentId: group.id,
      w: width - 24,
      h: 28,
      radius: 0,
      fill: target.id === page.id ? "#f59e0b" : "#1f2937",
      color: target.id === page.id ? "#111827" : "#ffffff",
      border: "#334155",
      font: 12,
      weight: 800,
      z: nextZ(page) + index
    });
    page.elements.push(button);
  });
  app.selectedIds = [group.id];
  app.utilityTab = "objects";
  markDirty(true);
}

function selectElement(id: string, append = false): void {
  const element = activePage()?.elements.find((candidate) => candidate.id === id);
  if (!element) return;
  if (append) {
    app.selectedIds = app.selectedIds.includes(id) ? app.selectedIds.filter((selected) => selected !== id) : [...app.selectedIds, id];
  } else {
    app.selectedIds = [id];
  }
  app.rightCollapsed = false;
  if (app.utilityTab !== "objects") app.utilityTab = "properties";
  render();
}

function duplicateSelection(): void {
  const page = activePage();
  const selected = selectedElements();
  if (!page || !selected.length) return;
  pushHistory("duplicate");
  const copies = selected.map((element) => ({ ...structuredClone(element), id: createId("el"), name: `${element.name} copy`, x: element.x + 24, y: element.y + 24, z: nextZ(page) }));
  page.elements.push(...copies);
  app.selectedIds = copies.map((copy) => copy.id);
  markDirty(true);
}

function deleteSelection(): void {
  const page = activePage();
  if (!page || !app.selectedIds.length) return;
  pushHistory("delete");
  page.elements = page.elements.filter((element) => !app.selectedIds.includes(element.id) || element.locked);
  app.selectedIds = [];
  markDirty(true);
}

async function saveTemplate(): Promise<void> {
  if (!app.model || !app.project) return;
  const selected = selectedElements();
  if (!selected.length) {
    toast("Select something first.");
    return;
  }
  const template: ForgeTemplate = {
    id: createId("tpl"),
    name: selected.length === 1 ? selected[0].name : `${selected.length} elements`,
    category: "component",
    elements: selected.map((element) => structuredClone(element))
  };
  pushHistory("save template");
  app.model.templates.push(template);
  await saveLibraryItem({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: template.id,
    scope: "reusable",
    name: template.name,
    category: "component",
    html: selected.map((element) => compileElementContent(element, true)).join("\n"),
    data: template,
    fingerprint: slugify(`${template.name}-${template.elements.length}`),
    createdAt: nowIso(),
    modifiedAt: nowIso()
  });
  app.library = await listLibraryItems();
  app.activePanel = "reuse";
  markDirty(true);
  toast("Saved as reusable UI.");
}

function insertTemplate(id: string): void {
  const template = app.model?.templates.find((item) => item.id === id);
  const page = activePage();
  if (!template || !page) return;
  pushHistory("insert template");
  const copies = template.elements.map((element, index) => ({ ...structuredClone(element), id: createId("el"), x: element.x + 36 + index * 8, y: element.y + 36 + index * 8, z: nextZ(page) + index }));
  page.elements.push(...copies);
  app.selectedIds = copies.map((copy) => copy.id);
  markDirty(true);
}

function insertLibraryItem(id: string): void {
  const item = app.library.find((candidate) => candidate.id === id);
  if (!item) return;
  const template = item.data as ForgeTemplate | undefined;
  if (template?.elements) {
    insertTemplateFromData(template);
    return;
  }
  addElement("html", { x: 100, y: 100 });
  const selected = selectedElement();
  if (selected) {
    selected.name = item.name;
    selected.html = item.html ?? "<p>Reusable component</p>";
    markDirty(true);
  }
}

function insertTemplateFromData(template: ForgeTemplate): void {
  const page = activePage();
  if (!page) return;
  pushHistory("insert library item");
  const copies = template.elements.map((element, index) => ({ ...structuredClone(element), id: createId("el"), x: element.x + 40 + index * 8, y: element.y + 40 + index * 8, z: nextZ(page) + index }));
  page.elements.push(...copies);
  app.selectedIds = copies.map((copy) => copy.id);
  markDirty(true);
}

async function uploadAsset(file?: File): Promise<void> {
  if (!file || !app.project) return;
  if (file.size > MAX_IMAGE_BYTES) {
    toast("Image must be under 1.5 MB.");
    return;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  pushHistory("upload asset");
  const asset: ForgeAsset = { id: createId("asset"), name: file.name, mimeType: file.type, size: file.size, dataUrl };
  app.project.assets.push(asset);
  app.activePanel = "assets";
  markDirty(true);
}

function insertAsset(id: string): void {
  const asset = app.project?.assets.find((item) => item.id === id);
  const page = activePage();
  if (!asset || !page) return;
  pushHistory("insert asset");
  const element = makeElement("image", 90, 90, { name: asset.name, text: asset.name, assetId: asset.id, assetData: asset.dataUrl, z: nextZ(page) });
  page.elements.push(element);
  app.selectedIds = [element.id];
  markDirty(true);
}

function applyTheme(id: ThemeId): void {
  if (!app.model) return;
  pushHistory("theme");
  app.model.theme = id;
  const theme = themes[id];
  activePage()!.background = theme.canvas;
  markDirty(true);
}

function updateSelectedProp(prop: string, value: string): void {
  const selected = selectedElements();
  if (!selected.length) return;
  pushHistory("property");
  selected.forEach((element) => {
    if (["x", "y", "w", "h", "rotation", "borderWidth", "radius", "font", "weight", "opacity", "z"].includes(prop)) {
      (element as unknown as Record<string, number>)[prop] = Number(value) || 0;
    } else if (prop === "action") {
      element.action = value as ForgeElement["action"];
    } else {
      (element as unknown as Record<string, string>)[prop] = value;
    }
  });
  markDirty(true);
}

function updateSelectedFlag(flag: string, value: boolean): void {
  const selected = selectedElements();
  if (!selected.length || !["locked", "hidden"].includes(flag)) return;
  pushHistory("state");
  selected.forEach((element) => {
    (element as unknown as Record<string, boolean>)[flag] = value;
  });
  markDirty(true);
}

function updatePageProp(prop: string, value: string): void {
  const page = activePage();
  if (!page || !["name", "width", "height", "background"].includes(prop)) return;
  pushHistory("page");
  if (prop === "width" || prop === "height") (page as unknown as Record<string, number>)[prop] = Math.max(prop === "width" ? 320 : 420, Number(value) || 0);
  else (page as unknown as Record<string, string>)[prop] = value;
  if (prop === "name") page.slug = slugify(value);
  markDirty(true);
}

function updateModelFlag(flag: string, value: boolean): void {
  if (!app.model || !["grid", "snap"].includes(flag)) return;
  pushHistory("model flag");
  (app.model as unknown as Record<string, boolean>)[flag] = value;
  markDirty(true);
}

function alignSelection(action: string): void {
  const selected = selectedElements();
  if (selected.length < 2) {
    toast(action.startsWith("dist") ? "Select 3+ elements to distribute." : "Select 2+ elements to align.");
    return;
  }
  if (action.startsWith("dist") && selected.length < 3) {
    toast("Select 3+ elements to distribute.");
    return;
  }
  pushHistory("align");
  const minX = Math.min(...selected.map((element) => element.x));
  const maxX = Math.max(...selected.map((element) => element.x + element.w));
  const minY = Math.min(...selected.map((element) => element.y));
  const maxY = Math.max(...selected.map((element) => element.y + element.h));
  selected.forEach((element) => {
    if (action === "left") element.x = minX;
    if (action === "right") element.x = maxX - element.w;
    if (action === "center") element.x = minX + (maxX - minX - element.w) / 2;
    if (action === "top") element.y = minY;
    if (action === "bottom") element.y = maxY - element.h;
    if (action === "middle") element.y = minY + (maxY - minY - element.h) / 2;
  });
  if (action === "distH") {
    const sorted = selected.slice().sort((a, b) => a.x - b.x);
    const total = sorted.reduce((sum, element) => sum + element.w, 0);
    const gap = (maxX - minX - total) / (sorted.length - 1);
    let cursor = minX;
    sorted.forEach((element) => {
      element.x = Math.round(cursor);
      cursor += element.w + gap;
    });
  }
  if (action === "distV") {
    const sorted = selected.slice().sort((a, b) => a.y - b.y);
    const total = sorted.reduce((sum, element) => sum + element.h, 0);
    const gap = (maxY - minY - total) / (sorted.length - 1);
    let cursor = minY;
    sorted.forEach((element) => {
      element.y = Math.round(cursor);
      cursor += element.h + gap;
    });
  }
  markDirty(true);
}

function arrangeSelection(direction: "front" | "back"): void {
  const page = activePage();
  const selected = selectedElements();
  if (!page || !selected.length) return;
  pushHistory("arrange");
  if (direction === "front") selected.forEach((element) => (element.z = nextZ(page)));
  else selected.forEach((element, index) => (element.z = index + 1));
  markDirty(true);
}

function toggleObjectCollapsed(id: string): void {
  if (!id) return;
  if (app.collapsedObjectIds.has(id)) app.collapsedObjectIds.delete(id);
  else app.collapsedObjectIds.add(id);
  render();
}

function setObjectVisible(id: string, visible: boolean): void {
  const element = activePage()?.elements.find((candidate) => candidate.id === id);
  if (!element) return;
  pushHistory("visibility");
  element.hidden = !visible;
  markDirty(true);
}

function toggleObjectLocked(id: string): void {
  const element = activePage()?.elements.find((candidate) => candidate.id === id);
  if (!element) return;
  pushHistory("lock");
  element.locked = !element.locked;
  markDirty(true);
}

function collapseAllObjects(): void {
  const page = activePage();
  if (!page) return;
  app.collapsedObjectIds = new Set(page.elements.filter((element) => page.elements.some((candidate) => candidate.parentId === element.id)).map((element) => element.id));
  render();
}

function groupSelection(): void {
  const page = activePage();
  const selected = selectedElements().filter((element) => !element.locked);
  if (!app.model || !page || selected.length < 2) {
    toast("Select 2+ objects to group.");
    return;
  }
  pushHistory("group");
  const minX = Math.min(...selected.map((element) => element.x));
  const minY = Math.min(...selected.map((element) => element.y));
  const maxX = Math.max(...selected.map((element) => element.x + element.w));
  const maxY = Math.max(...selected.map((element) => element.y + element.h));
  const group = makeElement("frame", minX, minY, {
    name: `Group${app.model.nextNumber}`,
    w: maxX - minX,
    h: maxY - minY,
    fill: "transparent",
    border: "#38bdf8",
    borderWidth: 1,
    radius: 0,
    z: Math.max(1, Math.min(...selected.map((element) => element.z)) - 1)
  });
  const commonParent = selected.every((element) => element.parentId === selected[0].parentId) ? selected[0].parentId : undefined;
  group.parentId = commonParent;
  page.elements.push(group);
  selected.forEach((element) => {
    element.parentId = group.id;
  });
  app.selectedIds = [group.id];
  app.utilityTab = "objects";
  markDirty(true);
}

function ungroupSelection(): void {
  const page = activePage();
  const groups = selectedElements();
  if (!page || !groups.length) return;
  const groupIds = new Set(groups.map((element) => element.id));
  if (!page.elements.some((element) => element.parentId && groupIds.has(element.parentId))) {
    toast("Select a group that contains objects.");
    return;
  }
  pushHistory("ungroup");
  groups.forEach((group) => {
    page.elements.forEach((element) => {
      if (element.parentId === group.id) element.parentId = group.parentId;
    });
  });
  page.elements = page.elements.filter((element) => !groupIds.has(element.id));
  app.selectedIds = [];
  markDirty(true);
}

function startWorkspacePointer(event: PointerEvent): void {
  if (app.activeTool !== "hand" || !(event.target instanceof HTMLElement) || !event.target.closest("#stage-viewport")) return;
  startCameraPan(event);
}

function startCameraPan(event: PointerEvent): void {
  if (!app.model) return;
  event.preventDefault();
  app.drag = {
    kind: "pan",
    startClientX: event.clientX,
    startClientY: event.clientY,
    startCanvasX: 0,
    startCanvasY: 0,
    startPanX: app.model.panX,
    startPanY: app.model.panY,
    originals: []
  };
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
}

function startPanelResize(event: PointerEvent): void {
  const side = (event.currentTarget as HTMLElement).dataset.resizePanel as PanelResizeState["side"];
  if (!side) return;
  event.preventDefault();
  app.panelResize = {
    side,
    startClientX: event.clientX,
    startWidth: side === "left" ? app.leftWidth : app.rightWidth
  };
  document.body.classList.add("is-resizing-panel");
  document.addEventListener("pointermove", onPanelResizeMove);
  document.addEventListener("pointerup", onPanelResizeUp, { once: true });
}

function onPanelResizeMove(event: PointerEvent): void {
  if (!app.panelResize) return;
  const delta = event.clientX - app.panelResize.startClientX;
  if (app.panelResize.side === "left") app.leftWidth = clampNumber(app.panelResize.startWidth + delta, 220, 520);
  else app.rightWidth = clampNumber(app.panelResize.startWidth - delta, 260, 560);
  const shell = root.querySelector<HTMLElement>(".forge-app");
  if (shell) {
    shell.style.setProperty("--left-width", `${app.leftWidth}px`);
    shell.style.setProperty("--right-width", `${app.rightWidth}px`);
  }
  clampCameraPan();
  updateCameraOnly();
}

function onPanelResizeUp(): void {
  app.panelResize = undefined;
  document.body.classList.remove("is-resizing-panel");
  document.removeEventListener("pointermove", onPanelResizeMove);
  render();
}

function startCanvasPointer(event: PointerEvent): void {
  if (event.target !== event.currentTarget) return;
  if (app.activeTool === "hand") {
    startCameraPan(event);
    return;
  }
  const point = canvasPoint(event);
  if (!point) return;
  if (app.activeTool === "text") {
    addElement("text", point);
    return;
  }
  if (app.activeTool === "frame") {
    addElement("frame", point);
    return;
  }
  app.selectedIds = [];
  render();
}

function startElementPointer(event: PointerEvent): void {
  const node = event.currentTarget as HTMLElement;
  const id = node.dataset.elementId ?? "";
  const element = activePage()?.elements.find((candidate) => candidate.id === id);
  if (app.activeTool === "hand") {
    startCameraPan(event);
    return;
  }
  if (!element || element.locked || app.activeTool !== "select") return;
  event.stopPropagation();
  if (!app.selectedIds.includes(id)) app.selectedIds = event.shiftKey ? [...app.selectedIds, id] : [id];
  const point = canvasPoint(event);
  if (!point) return;
  const selected = selectedElements();
  app.drag = {
    kind: "drag",
    id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startCanvasX: point.x,
    startCanvasY: point.y,
    originals: selected.map((item) => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h }))
  };
  pushHistory("move");
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
  render();
}

function startResizePointer(event: PointerEvent): void {
  const handle = (event.currentTarget as HTMLElement).dataset.resizeHandle ?? "";
  const selected = selectedElement();
  if (!selected || selected.locked) return;
  event.stopPropagation();
  const point = canvasPoint(event);
  if (!point) return;
  app.drag = {
    kind: "resize",
    id: selected.id,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startCanvasX: point.x,
    startCanvasY: point.y,
    originals: [{ id: selected.id, x: selected.x, y: selected.y, w: selected.w, h: selected.h }],
    ratio: selected.w / selected.h
  };
  pushHistory("resize");
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
}

function canvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } | undefined {
  const canvas = root.querySelector<HTMLElement>("#design-canvas");
  if (!canvas || !app.model) return undefined;
  const rect = canvas.getBoundingClientRect();
  const scale = app.model.zoom / 100;
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}

function clampCameraPan(): void {
  const page = activePage();
  const viewport = root.querySelector<HTMLElement>("#stage-viewport");
  if (!app.model || !page || !viewport) return;
  const scale = app.model.zoom / 100;
  const overflowX = Math.max(0, page.width * scale - viewport.clientWidth);
  const overflowY = Math.max(0, page.height * scale - viewport.clientHeight);
  app.model.panX = overflowX ? clampNumber(app.model.panX, -overflowX, 0) : 0;
  app.model.panY = overflowY ? clampNumber(app.model.panY, -overflowY, 0) : 0;
}

function updateCameraOnly(): void {
  const camera = root.querySelector<HTMLElement>("#stage-camera");
  if (!camera || !app.model) return;
  camera.style.transform = `translate(${app.model.panX}px, ${app.model.panY}px) scale(${app.model.zoom / 100})`;
  root.querySelectorAll<HTMLElement>(".zoom-readout").forEach((node) => {
    node.textContent = `${app.model?.zoom ?? 100}%`;
  });
}

function onViewportWheel(event: WheelEvent): void {
  if (!app.model || !event.ctrlKey) return;
  event.preventDefault();
  const step = event.deltaY > 0 ? -10 : 10;
  setZoom(app.model.zoom + step);
}

function onPointerMove(event: PointerEvent): void {
  if (!app.drag) return;
  if (app.drag.kind === "pan") {
    if (!app.model) return;
    app.model.panX = (app.drag.startPanX ?? 0) + (event.clientX - app.drag.startClientX);
    app.model.panY = (app.drag.startPanY ?? 0) + (event.clientY - app.drag.startClientY);
    clampCameraPan();
    updateCameraOnly();
    return;
  }
  const point = canvasPoint(event);
  if (!point) return;
  const page = activePage();
  if (!page) return;
  if (app.drag.kind === "drag") {
    const dx = point.x - app.drag.startCanvasX;
    const dy = point.y - app.drag.startCanvasY;
    app.drag.originals.forEach((original) => {
      const element = page.elements.find((item) => item.id === original.id);
      if (!element || element.locked) return;
      element.x = snap(original.x + dx);
      element.y = snap(original.y + dy);
    });
    updateCanvasElementsOnly();
    return;
  }
  if (app.drag.kind === "resize") {
    const original = app.drag.originals[0];
    const element = page.elements.find((item) => item.id === original.id);
    if (!element) return;
    let x = original.x;
    let y = original.y;
    let w = original.w;
    let h = original.h;
    const dx = point.x - app.drag.startCanvasX;
    const dy = point.y - app.drag.startCanvasY;
    const handle = app.drag.handle ?? "";
    if (handle.includes("e")) w = original.w + dx;
    if (handle.includes("s")) h = original.h + dy;
    if (handle.includes("w")) {
      x = original.x + dx;
      w = original.w - dx;
    }
    if (handle.includes("n")) {
      y = original.y + dy;
      h = original.h - dy;
    }
    if (event.shiftKey && app.drag.ratio) {
      if (handle.includes("e") || handle.includes("w")) h = w / app.drag.ratio;
      else w = h * app.drag.ratio;
    }
    element.x = snap(x);
    element.y = snap(y);
    element.w = Math.max(12, snap(w));
    element.h = Math.max(12, snap(h));
    updateCanvasElementsOnly();
  }
}

function onPointerUp(): void {
  if (!app.drag) return;
  const kind = app.drag.kind;
  app.drag = undefined;
  document.removeEventListener("pointermove", onPointerMove);
  if (kind === "pan") render();
  else markDirty(true);
}

function updateCanvasElementsOnly(): void {
  const page = activePage();
  if (!page) return;
  page.elements.forEach((element) => {
    const node = root.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`);
    if (!node) return;
    node.style.left = `${element.x}px`;
    node.style.top = `${element.y}px`;
    node.style.width = `${element.w}px`;
    node.style.height = `${element.h}px`;
    node.style.transform = `rotate(${element.rotation}deg)`;
  });
}

function undo(): void {
  if (!app.model || !app.history.length) return;
  app.redo.push(cloneModel(app.model));
  app.model = app.history.pop();
  app.selectedIds = [];
  markDirty(true);
}

function redo(): void {
  if (!app.model || !app.redo.length) return;
  app.history.push(cloneModel(app.model));
  app.model = app.redo.pop();
  app.selectedIds = [];
  markDirty(true);
}

function setZoom(value: number): void {
  if (!app.model) return;
  app.model.zoom = Math.min(400, Math.max(10, Math.round(value)));
  clampCameraPan();
  render();
}

function fitCanvas(): void {
  const page = activePage();
  const viewport = root.querySelector<HTMLElement>("#stage-viewport");
  if (!app.model || !page || !viewport) return;
  const availableW = Math.max(1, viewport.clientWidth);
  const availableH = Math.max(1, viewport.clientHeight);
  app.model.zoom = Math.max(10, Math.min(200, Math.floor(Math.min(availableW / page.width, availableH / page.height) * 100)));
  app.model.panX = 0;
  app.model.panY = 0;
  render();
}

function normalizeColor(value: string, fallback = "#ffffff"): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const match = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (match) return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  if (value === "transparent") return fallback;
  return fallback;
}

async function createNew(): Promise<void> {
  const project = createBlankProject("Forge UI Project");
  app.project = project;
  app.model = await modelFromProject(project);
  app.model.pages[0].elements = [
    makeElement("text", 86, 82, { text: "New interface", font: 48, w: 640, h: 92, z: 1 }),
    makeElement("card", 86, 190, { text: "Start from here\nAdd UI pieces from the Toolbox, then save anything reusable.", w: 420, h: 180, z: 2 })
  ];
  syncProjectModel();
  await putProject(project);
  app.projects = await listProjects();
  app.history = [];
  app.redo = [];
  app.selectedIds = [];
  renderThenFit();
}

async function openProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) {
    toast("Project not found.");
    return;
  }
  app.project = project;
  app.model = await modelFromProject(project);
  if (repairedStoredImport) {
    syncProjectModel();
    await putProject(app.project);
    app.projects = await listProjects();
    toast("Rebuilt imported HTML into editable layers.");
  }
  app.selectedIds = [];
  app.history = [];
  app.redo = [];
  renderThenFit();
}

async function importHtmlFile(file?: File): Promise<void> {
  if (!file) return;
  app.importFileName = file.name;
  app.importSourceText = await file.text();
  analyzeImport();
}

function analyzeImport(): void {
  if (!app.importSourceText.trim()) {
    toast("Add HTML before analyzing.");
    return;
  }
  app.importDraft = analyzeHtmlImport(app.importSourceText, app.importFileName, app.importRetainSource);
  render();
}

async function acceptImport(): Promise<void> {
  if (!app.importDraft) return;
  const imported = app.importDraft.project;
  app.project = imported;
  app.model = await modelFromImport(app.importDraft);
  app.project.notes[MODEL_NOTE_KEY] = JSON.stringify(app.model);
  app.project.importReportId = app.importDraft.report.id;
  app.importDraft.report.projectId = app.project.id;
  syncProjectModel();
  await putProject(app.project);
  await saveImportReport(app.importDraft.report);
  await Promise.all(
    app.model.templates.map((template) =>
      saveLibraryItem({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: template.id,
        scope: "review",
        name: template.name,
        category: "component",
        html: template.elements.map((element) => element.html || compileElementContent(element, true)).join("\n"),
        data: template,
        fingerprint: slugify(template.name),
        createdAt: nowIso(),
        modifiedAt: nowIso()
      })
    )
  );
  app.projects = await listProjects();
  app.library = await listLibraryItems();
  app.importOpen = false;
  app.activePanel = "pages";
  app.selectedIds = [];
  app.history = [];
  app.redo = [];
  renderThenFit();
  toast("Imported into editable canvas.");
}

async function importProjectFile(file?: File): Promise<void> {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const projectEntry = file.name.endsWith(".zip") || file.name.endsWith(".htmlforge.zip") ? unzipSync(bytes)["project.htmlforge.json"] ?? unzipSync(bytes)["project.json"] : undefined;
  const text = projectEntry ? strFromU8(projectEntry) : new TextDecoder().decode(bytes);
  const project = migrateProject(JSON.parse(text));
  project.id = createId("project");
  project.name = `${project.name} Imported`;
  project.slug = slugify(project.name);
  project.revision = 1;
  await putProject(project);
  app.projects = await listProjects();
  await openProject(project.id);
}

async function requestStorage(): Promise<void> {
  const status = await requestPersistentStorage();
  app.storageMessage = status.message;
  app.storageUsage = status.estimate ? `${humanBytes(status.estimate.usage)} / ${humanBytes(status.estimate.quota)}` : "";
  render();
}

function downloadHtml(): void {
  if (!app.project) return;
  syncProjectModel();
  downloadBlob(new Blob([createProductHtml(app.project, { interactive: true })], { type: "text/html" }), `${slugify(app.project.name)}_${formatFileStamp()}.html`);
}

function downloadJson(): void {
  if (!app.project) return;
  syncProjectModel();
  downloadBlob(new Blob([createProjectJson(app.project)], { type: "application/json" }), `${slugify(app.project.name)}_${formatFileStamp()}.htmlforge.json`);
}

async function downloadZip(): Promise<void> {
  if (!app.project) return;
  syncProjectModel();
  const report = app.project.importReportId ? await getImportReport(app.project.importReportId) : undefined;
  const pkg = exportProjectPackage(app.project, report);
  downloadBlob(pkg.blob, pkg.fileName);
}

function bindKeyboard(): void {
  window.addEventListener("keydown", (event) => {
    if (app.importOpen || app.previewOpen) {
      if (event.key === "Escape") {
        app.importOpen = false;
        if (app.previewOpen) closeRunPreview();
        else render();
      }
      return;
    }
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNow(true);
      return;
    }
    if (command && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (command && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
      event.preventDefault();
      redo();
      return;
    }
    if (command && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (command && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      setZoom((app.model?.zoom ?? 100) + 10);
      return;
    }
    if (command && event.key === "-") {
      event.preventDefault();
      setZoom((app.model?.zoom ?? 100) - 10);
      return;
    }
    if (command && event.key === "0") {
      event.preventDefault();
      fitCanvas();
      return;
    }
    if (typing) return;
    if (event.key === "Escape") {
      app.selectedIds = [];
      app.activeTool = "select";
      render();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      const selected = selectedElements().filter((element) => !element.locked);
      if (!selected.length) return;
      event.preventDefault();
      pushHistory("arrow move");
      const step = event.shiftKey ? 10 : event.altKey ? 1 : 5;
      selected.forEach((element) => {
        if (event.key === "ArrowUp") element.y -= step;
        if (event.key === "ArrowDown") element.y += step;
        if (event.key === "ArrowLeft") element.x -= step;
        if (event.key === "ArrowRight") element.x += step;
      });
      markDirty(true);
    }
  });
}

async function boot(): Promise<void> {
  bindKeyboard();
  app.projects = await listProjects();
  app.library = await listLibraryItems();
  const storage = await getStorageStatus();
  app.storageMessage = storage.message;
  app.storageUsage = storage.estimate ? `${humanBytes(storage.estimate.usage)} / ${humanBytes(storage.estimate.quota)}` : "";
  if (app.projects[0]) await openProject(app.projects[0].id);
  else await createNew();
}

window.addEventListener("beforeunload", (event) => {
  if (!app.dirty && !app.saving) return;
  event.preventDefault();
  event.returnValue = "";
});

void boot().catch((error) => {
  root.innerHTML = `<main class="fatal-error"><h1>Forge failed to start</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></main>`;
});
