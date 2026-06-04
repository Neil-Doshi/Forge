import "./styles.css";
import { unzipSync, strFromU8 } from "fflate";
import { analyzeHtmlImport, type ImportAnalysisResult } from "./analyzer";
import { createPrototypeHtml, createProjectJson, createImportReportMarkdown, exportAiHandoff, exportProjectPackage } from "./exporter";
import { mountGrapesEditor, type EditorSnapshot, type MountedEditor, type SelectedComponentSnapshot } from "./editor";
import { createBlankProject } from "./projectFactory";
import { migrateProject } from "./migrations";
import { suggestLibraryItems } from "./library";
import { acquireProjectLock, type ProjectLockHandle } from "./locks";
import {
  deleteProject,
  getImportReport,
  getProject,
  getStorageStatus,
  listDecisions,
  listLibraryItems,
  listProjects,
  putProject,
  requestPersistentStorage,
  saveDecision,
  saveImportReport,
  saveLibraryItem,
  saveProject
} from "./storage";
import { PROJECT_SCHEMA_VERSION, type DecisionRecord, type HtmlForgeProject, type ImportReport, type LibraryItem, type RouteId } from "./types";
import { cloneProject, createId, debounce, downloadBlob, escapeAttribute, escapeHtml, formatFileStamp, generatedScreenId, humanBytes, nowIso, slugify } from "./utils";
import { UnifiedHistoryService } from "./history";

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("HTML Forge root element is missing.");
const root: HTMLDivElement = rootElement;

const routes: Array<{ id: RouteId; label: string; shortcut: string }> = [
  { id: "home", label: "Home", shortcut: "H" },
  { id: "editor", label: "Editor", shortcut: "E" },
  { id: "connections", label: "Connections", shortcut: "C" },
  { id: "library", label: "Library", shortcut: "L" },
  { id: "report", label: "Report", shortcut: "R" },
  { id: "export", label: "Export", shortcut: "X" },
  { id: "settings", label: "Settings", shortcut: "S" }
];

const instanceId = createId("instance");
const history = new UnifiedHistoryService();

interface AppState {
  route: RouteId;
  projects: HtmlForgeProject[];
  project?: HtmlForgeProject;
  report?: ImportReport;
  importDraft?: ImportAnalysisResult;
  importSourceText: string;
  importFileName: string;
  importRetainSource: boolean;
  importOpen: boolean;
  previewOpen: boolean;
  previewHtml: string;
  library: LibraryItem[];
  decisions: DecisionRecord[];
  storageMessage: string;
  storageUsage: string;
  connectionFilter: "all" | "issues" | "mapped";
  libraryFilter: "reusable" | "project" | "review";
  editorTab: "screens" | "layers" | "insert" | "warnings";
  inspectorTab: "content" | "style" | "layout" | "behavior" | "effects";
  editorZoom: number;
  editorLeftWidth: number;
  editorRightWidth: number;
  editorCanvasHeight: number;
  focusCanvas: boolean;
  activeEditorPageId?: string;
  selectedComponent?: SelectedComponentSnapshot;
  editorError?: string;
  dirty: boolean;
  saving: boolean;
  saveError?: string;
  lockMessage: string;
  toast?: string;
}

const state: AppState = {
  route: "home",
  projects: [],
  importSourceText: "",
  importFileName: "import.html",
  importRetainSource: true,
  importOpen: false,
  previewOpen: false,
  previewHtml: "",
  library: [],
  decisions: [],
  storageMessage: "Checking storage...",
  storageUsage: "",
  connectionFilter: "all",
  libraryFilter: "reusable",
  editorTab: "screens",
  inspectorTab: "content",
  editorZoom: 90,
  editorLeftWidth: 248,
  editorRightWidth: 280,
  editorCanvasHeight: 720,
  focusCanvas: false,
  dirty: false,
  saving: false,
  lockMessage: "No project lock active."
};

let mountedEditor: MountedEditor | undefined;
let mountedEditorProjectId: string | undefined;
let mountedEditorSnapshotKey = "";
let editorMountToken = 0;
let activeLock: ProjectLockHandle | undefined;

function icon(
  name: "undo" | "redo" | "zoomIn" | "zoomOut" | "fit" | "save" | "preview" | "focus" | "trash" | "pages" | "toolbox" | "connections" | "inspector"
): string {
  const paths: Record<typeof name, string> = {
    undo: '<path d="M9 7H4v5"/><path d="M4 12c2.2-4.4 8.5-6.2 13-2.7 2.8 2.2 3.7 6 2 9"/>',
    redo: '<path d="M15 7h5v5"/><path d="M20 12c-2.2-4.4-8.5-6.2-13-2.7-2.8 2.2-3.7 6-2 9"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M10.5 7.5v6M7.5 10.5h6M15.5 15.5 21 21"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.5 15.5 21 21"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M9 4 4 9M15 4l5 5M9 20l-5-5M15 20l5-5"/>',
    save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    preview: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
    focus: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    pages: '<path d="M7 3h10l4 4v14H7z"/><path d="M17 3v5h5"/><path d="M3 7v14h4"/>',
    toolbox: '<path d="M4 7h16v12H4z"/><path d="M8 7V5h8v2M4 12h16"/><path d="M12 12v3"/>',
    connections: '<circle cx="6" cy="7" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8.5 9.5 15.5 14.5"/>',
    inspector: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>'
  };
  return `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function setToast(message: string): void {
  state.toast = message;
  render();
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = undefined;
      render();
    }
  }, 3200);
}

function editorSnapshotKey(snapshot: EditorSnapshot): string {
  return JSON.stringify(snapshot.pages.map((page) => ({ id: page.id, name: page.name, html: page.html, css: page.css })));
}

function syncProjectFromEditorSnapshot(snapshot: EditorSnapshot): void {
  if (!state.project) return;
  state.project.grapesProjectData = snapshot.grapesProjectData;
  snapshot.pages.forEach((pageSnapshot, index) => {
    const page = state.project?.pages[index];
    if (!state.project || !page) return;
    page.html = pageSnapshot.html;
    page.css = pageSnapshot.css;
    page.modifiedAt = nowIso();
  });
}

function unmountEditor(): void {
  editorMountToken += 1;
  try {
    if (mountedEditor && state.project) {
      const snapshot = mountedEditor.saveSnapshot();
      const key = editorSnapshotKey(snapshot);
      if (key !== mountedEditorSnapshotKey) {
        const before = cloneProject(state.project);
        syncProjectFromEditorSnapshot(snapshot);
        mountedEditorSnapshotKey = key;
        markDirty("Visual editor change", before);
      }
    }
    mountedEditor?.destroy();
  } catch (error) {
    console.warn("Editor teardown recovered", error);
  }
  mountedEditor = undefined;
  mountedEditorProjectId = undefined;
  mountedEditorSnapshotKey = "";
  state.selectedComponent = undefined;
}

function statusLabel(): string {
  if (!state.project) return "No project open";
  if (state.saveError) return `Save issue: ${state.saveError}`;
  if (state.saving) return "Saving locally...";
  if (state.dirty) return "Unsaved local edits";
  return `Saved locally, revision ${state.project.revision}`;
}

const scheduleSave = debounce(async () => {
  if (!state.project) return;
  try {
    state.saving = true;
    const expected = state.project.revision;
    state.project = await saveProject(state.project, instanceId, expected);
    state.projects = await listProjects();
    state.dirty = false;
    state.saveError = undefined;
  } catch (error) {
    state.saveError = error instanceof Error ? error.message : String(error);
  } finally {
    state.saving = false;
    renderStatusOnly();
  }
}, 700);

function markDirty(label: string, before?: HtmlForgeProject): void {
  if (state.project && before) history.record(label, before, state.project);
  state.dirty = true;
  scheduleSave();
  renderStatusOnly();
}

function renderStatusOnly(): void {
  root.querySelector("[data-status-text]")?.replaceChildren(document.createTextNode(statusLabel()));
  const save = root.querySelector("[data-save-state]");
  if (save) save.textContent = state.saving ? "Saving" : state.dirty ? "Pending" : "Saved";
}

function routeMarkup(): string {
  switch (state.route) {
    case "home":
      return homeView();
    case "editor":
      return editorView();
    case "connections":
      return connectionsView();
    case "library":
      return libraryView();
    case "report":
      return reportView();
    case "export":
      return exportView();
    case "settings":
      return settingsView();
  }
}

function render(): void {
  unmountEditor();
  root.innerHTML = `
    <div class="app-shell">
      <aside class="rail" aria-label="HTML Forge workspaces">
        <div class="brand-block">
          <div class="brand-mark" aria-hidden="true">HF</div>
          <div>
            <p class="eyebrow">Local-only app</p>
            <h1>HTML Forge</h1>
          </div>
        </div>
        <nav class="rail-nav">
          ${routes
            .map(
              (route) =>
                `<button type="button" class="rail-link ${state.route === route.id ? "is-active" : ""}" data-route="${route.id}" aria-current="${
                  state.route === route.id ? "page" : "false"
                }"><span aria-hidden="true">${route.shortcut}</span>${route.label}</button>`
            )
            .join("")}
        </nav>
        <div class="rail-footer">
          <span class="lock-dot" aria-hidden="true"></span>
          <span>${escapeHtml(activeLock?.state ?? "local")}</span>
        </div>
      </aside>
      <main class="workspace">
        <header class="project-header">
          <div>
            <p class="eyebrow">Projects stay in this browser unless exported</p>
            <h2>${escapeHtml(state.project?.name ?? "HTML Forge")}</h2>
          </div>
          <div class="header-actions">
            <span class="save-pill" data-save-state>${state.saving ? "Saving" : state.dirty ? "Pending" : "Saved"}</span>
            <button type="button" class="secondary-button" data-action="open-import">Import HTML</button>
            <button type="button" class="primary-button" data-action="new-project">New</button>
          </div>
        </header>
        <div class="status-strip" role="status">
          <span data-status-text>${escapeHtml(statusLabel())}</span>
          <span>${escapeHtml(state.lockMessage)}</span>
        </div>
        ${routeMarkup()}
      </main>
      ${state.importOpen ? importStudio() : ""}
      ${state.previewOpen ? previewDialog() : ""}
      ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
  bindEvents();
  if (state.route === "editor" && !state.editorError) void mountEditorIfNeeded();
}

function homeView(): string {
  const projectRows = state.projects.length
    ? state.projects
        .map(
          (project) => `
            <article class="item-row">
              <div>
                <strong>${escapeHtml(project.name)}</strong>
                <span>${escapeHtml(project.importSummary ?? `${project.pages.length} screen${project.pages.length === 1 ? "" : "s"}`)}</span>
              </div>
              <div class="row-actions">
                <button type="button" class="secondary-button compact" data-open-project="${project.id}">Open</button>
                <button type="button" class="ghost-button compact" data-duplicate-project="${project.id}">Duplicate</button>
                <button type="button" class="ghost-button compact danger" data-delete-project="${project.id}">Delete</button>
              </div>
            </article>`
        )
        .join("")
    : `<div class="empty-panel"><h3>No local projects yet</h3><p>Create a blank project or import an HTML file. Nothing is uploaded.</p></div>`;

  return `
    <section class="home-grid">
      <div class="intro-panel">
        <p class="eyebrow">Ready to ship locally</p>
        <h2>Import, repair, edit, and export safe HTML prototypes.</h2>
        <p>HTML Forge analyzes untrusted source as inert text, shows sanitized previews in sandboxed frames, and saves editable projects in IndexedDB.</p>
        <div class="button-row">
          <button type="button" class="primary-button" data-action="open-import">Launch Import Studio</button>
          <button type="button" class="secondary-button" data-action="new-project">Create blank project</button>
          <label class="file-button">
            Import project/package
            <input type="file" accept=".json,.htmlforge.json,.zip,.htmlforge.zip,application/json,application/zip" data-action="import-project-file">
          </label>
        </div>
      </div>
      <section class="workspace-panel">
        <div class="panel-heading">
          <h3>Recent Local Projects</h3>
          <span>${state.projects.length}</span>
        </div>
        <div class="list-stack">${projectRows}</div>
      </section>
      <section class="workspace-panel">
        <div class="panel-heading"><h3>Import Boundaries</h3><span>3 surfaces</span></div>
        <div class="metric-grid">
          <div><strong>Source analysis</strong><span>DOMParser only, no active render.</span></div>
          <div><strong>Safe preview</strong><span><code>iframe sandbox=""</code></span></div>
          <div><strong>Behavior preview</strong><span><code>allow-scripts</code>, no same-origin.</span></div>
        </div>
      </section>
      <section class="workspace-panel">
        <div class="panel-heading"><h3>Storage</h3><span>${escapeHtml(state.storageUsage)}</span></div>
        <p>${escapeHtml(state.storageMessage)}</p>
        <button type="button" class="secondary-button" data-action="persist-storage">Request persistent storage</button>
      </section>
    </section>
  `;
}

function editorView(): string {
  if (!state.project) return noProjectView("Create or open a project to use the editor.");
  const tabs = ["screens", "layers", "insert", "warnings"] as const;
  const inspectors = ["content", "style", "layout", "behavior", "effects"] as const;
  const activePageId = state.activeEditorPageId ?? state.project.pages[0]?.id;
  const focusClass = state.focusCanvas ? `focus-canvas ${state.editorTab === "insert" ? "focus-toolbox" : ""}` : "";
  return `
    <section class="editor-shell ${focusClass}" style="--left-pane:${state.editorLeftWidth}px;--right-pane:${state.editorRightWidth}px;--canvas-height:${state.editorCanvasHeight}px">
      <div class="editor-toolbar" role="toolbar" aria-label="Editor controls">
        <label>Screen
          <select data-action="select-editor-page">
            ${state.project.pages.map((page) => `<option value="${page.id}" ${page.id === activePageId ? "selected" : ""}>${escapeHtml(page.name)}</option>`).join("")}
          </select>
        </label>
        <div class="quick-command-bar" aria-label="Editing areas">
          <button type="button" class="secondary-button compact ${state.editorTab === "screens" && !state.focusCanvas ? "is-active" : ""}" data-action="show-pages">${icon("pages")} Pages</button>
          <button type="button" class="secondary-button compact ${state.editorTab === "insert" ? "is-active" : ""}" data-action="show-toolbox">${icon("toolbox")} Toolbox</button>
          <button type="button" class="secondary-button compact" data-action="open-connections">${icon("connections")} Connections</button>
          <button type="button" class="secondary-button compact ${!state.focusCanvas ? "is-active" : ""}" data-action="show-inspector">${icon("inspector")} Inspector</button>
        </div>
        <div class="segmented device-segment" aria-label="Device preview">
          <button type="button" aria-pressed="true">Desktop</button>
          <button type="button">Tablet</button>
          <button type="button">Phone</button>
        </div>
        <button type="button" class="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" data-action="undo">${icon("undo")}</button>
        <button type="button" class="icon-button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" data-action="redo">${icon("redo")}</button>
        <span class="toolbar-separator" aria-hidden="true"></span>
        <button type="button" class="icon-button" title="Zoom out (Ctrl+-)" aria-label="Zoom out" data-action="zoom-out">${icon("zoomOut")}</button>
        <span class="zoom-readout" data-zoom-readout>${state.editorZoom}%</span>
        <button type="button" class="icon-button" title="Zoom in (Ctrl++)" aria-label="Zoom in" data-action="zoom-in">${icon("zoomIn")}</button>
        <button type="button" class="icon-button" title="Fit canvas (Ctrl+0)" aria-label="Fit canvas" data-action="fit-canvas">${icon("fit")}</button>
        <button type="button" class="secondary-button compact" title="Toggle full canvas" data-action="focus-canvas">${icon("focus")} ${state.focusCanvas ? "Show panels" : "Full canvas"}</button>
        <span class="toolbar-separator" aria-hidden="true"></span>
        <button type="button" class="secondary-button compact" data-action="preview-project">${icon("preview")} Preview</button>
        <button type="button" class="primary-button compact" data-action="save-now">${icon("save")} Save</button>
      </div>
      <aside class="context-pane">
        <div class="tab-row">
          ${tabs.map((tab) => `<button type="button" class="${state.editorTab === tab ? "is-active" : ""}" data-editor-tab="${tab}">${tab}</button>`).join("")}
        </div>
        ${editorContextMarkup()}
      </aside>
      <div class="pane-resizer left-resizer" data-resize-pane="left" role="separator" aria-label="Resize screen panel"></div>
      <section class="canvas-pane">
        <div id="gjs-mount" class="gjs-mount">${
          state.editorError
            ? `<div class="editor-error-panel"><h3>Editor did not open</h3><p>${escapeHtml(state.editorError)}</p><button type="button" class="primary-button" data-action="retry-editor">Try again</button></div>`
            : `<div class="loading-panel">Loading visual editor...</div>`
        }</div>
        <div class="canvas-height-resizer" data-resize-pane="canvas-height" role="separator" aria-label="Resize canvas height"></div>
      </section>
      <div class="pane-resizer right-resizer" data-resize-pane="right" role="separator" aria-label="Resize inspector panel"></div>
      <aside class="inspector-pane">
        <div class="tab-row">
          ${inspectors.map((tab) => `<button type="button" class="${state.inspectorTab === tab ? "is-active" : ""}" data-inspector-tab="${tab}">${tab}</button>`).join("")}
        </div>
        ${inspectorMarkup()}
      </aside>
    </section>
  `;
}

function editorContextMarkup(): string {
  if (!state.project) return "";
  if (state.editorTab === "screens") {
    const activePageId = state.activeEditorPageId ?? state.project.pages[0]?.id;
    return `
      <div class="list-stack">
        ${state.project.pages
          .map(
            (page, index) => `<button type="button" class="screen-row ${page.id === activePageId ? "is-active" : ""}" data-open-page="${page.id}">
              <span>${index + 1}</span><strong>${escapeHtml(page.name)}</strong><small>${page.componentCount} nodes</small>
            </button>`
          )
          .join("")}
      </div>
      <button type="button" class="secondary-button full" data-action="add-screen">Add screen</button>
    `;
  }
  if (state.editorTab === "layers") {
    return `<div class="list-stack">${state.project.pages
      .map((page) => `<div class="item-row"><div><strong>${escapeHtml(page.name)}</strong><span>${escapeHtml(page.slug)}</span></div></div>`)
      .join("")}</div>`;
  }
  if (state.editorTab === "insert") {
    return `
      <div class="block-grid">
        <button type="button" data-action="insert-block" data-block="section">Section</button>
        <button type="button" data-action="insert-block" data-block="card">Card</button>
        <button type="button" data-action="insert-block" data-block="button">Button</button>
        <button type="button" data-action="insert-block" data-block="input">Input</button>
      </div>
      <button type="button" class="secondary-button full" data-action="save-selection-library">Save selected as reusable</button>
    `;
  }
  const warnings = [
    ...state.project.connections.filter((connection) => connection.status !== "mapped").map((connection) => `${connection.triggerLabel} points to ${connection.targetName ?? "an unresolved target"}.`),
    ...(state.report?.accessibility ?? [])
  ];
  return warnings.length ? `<ul class="warning-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : `<p class="muted">No current-screen warnings.</p>`;
}

function inspectorMarkup(): string {
  if (!state.project) return "";
  if (state.inspectorTab === "content") {
    return `
      <div data-selected-inspector>
        ${selectedInspectorMarkup()}
      </div>
      <div class="inspector-divider"></div>
      <label>Project name <input type="text" value="${escapeAttribute(state.project.name)}" data-action="project-name"></label>
      <label>Project notes <textarea rows="5" data-action="project-notes">${escapeHtml(state.project.notes.general ?? "")}</textarea></label>
    `;
  }
  if (state.inspectorTab === "behavior") {
    return `
      <p class="muted">Behavior is approved in Connections, then tested in the sandboxed behavior preview.</p>
      <button type="button" class="secondary-button full" data-route="connections">Open Connections</button>
    `;
  }
  if (state.inspectorTab === "effects") {
    return `<div class="token-list">${(state.report?.css.keyframes ?? []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<p class='muted'>No imported keyframes detected.</p>"}</div>`;
  }
  return `<p class="muted">Use GrapesJS controls in the canvas for ${escapeHtml(state.inspectorTab)} edits. HTML Forge saves editor data into the project model.</p>`;
}

function selectedInspectorMarkup(): string {
  const selected = state.selectedComponent;
  if (!selected) {
    return `
      <section class="selected-card empty-selection">
        <h4>No element selected</h4>
        <p>Click text, a button, a card, or any component on the canvas. The quick editor will appear here.</p>
      </section>
    `;
  }
  return `
    <section class="selected-card">
      <div class="panel-heading compact-heading">
        <h4>${escapeHtml(selected.name || selected.tagName)}</h4>
        <span>${escapeHtml(selected.tagName)}</span>
      </div>
      <label>Text <textarea rows="3" data-selected-prop="text">${escapeHtml(selected.text)}</textarea></label>
      <div class="field-grid two">
        <label>Width <input type="text" placeholder="auto" value="${escapeAttribute(selected.width)}" data-selected-prop="width"></label>
        <label>Height <input type="text" placeholder="auto" value="${escapeAttribute(selected.height)}" data-selected-prop="height"></label>
      </div>
      <div class="field-grid two">
        <label>Fill <input type="color" value="${normalizeColor(selected.background)}" data-selected-prop="background"></label>
        <label>Text <input type="color" value="${normalizeColor(selected.color, "#1b2433")}" data-selected-prop="color"></label>
      </div>
      <div class="field-grid two">
        <label>Padding <input type="text" placeholder="12px" value="${escapeAttribute(selected.padding)}" data-selected-prop="padding"></label>
        <label>Radius <input type="text" placeholder="6px" value="${escapeAttribute(selected.radius)}" data-selected-prop="radius"></label>
      </div>
      <div class="button-row">
        <button type="button" class="secondary-button compact" data-action="apply-selected-edit">Apply</button>
        <button type="button" class="ghost-button compact danger" data-action="delete-selected">${icon("trash")} Delete</button>
      </div>
    </section>
  `;
}

function normalizeColor(value: string, fallback = "#ffffff"): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const match = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (match) {
    return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  }
  return fallback;
}

function selectEditorPage(pageId: string): void {
  if (!state.project || !state.project.pages.some((page) => page.id === pageId)) return;
  state.activeEditorPageId = pageId;
  mountedEditor?.selectPage(pageId);
  state.selectedComponent = undefined;
  updateSelectedInspectorOnly();
  root.querySelectorAll<HTMLButtonElement>("[data-open-page]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.openPage === pageId);
  });
}

function updateZoomReadout(): void {
  root.querySelector("[data-zoom-readout]")?.replaceChildren(document.createTextNode(`${Math.round(state.editorZoom)}%`));
}

function zoomEditor(delta: number): void {
  state.editorZoom = Math.round(mountedEditor?.zoomBy(delta) ?? Math.min(160, Math.max(25, state.editorZoom + delta)));
  updateZoomReadout();
}

function fitEditorCanvas(): void {
  state.editorZoom = Math.round(mountedEditor?.fitCanvas() ?? state.editorZoom);
  updateZoomReadout();
}

function toggleFocusCanvas(): void {
  state.focusCanvas = !state.focusCanvas;
  if (state.focusCanvas) state.editorTab = "insert";
  render();
}

function showPagesPanel(): void {
  state.focusCanvas = false;
  state.editorTab = "screens";
  render();
}

function showToolboxPanel(): void {
  state.editorTab = "insert";
  render();
}

function showInspectorPanel(): void {
  state.focusCanvas = false;
  state.inspectorTab = "content";
  render();
}

function applySelectedEdit(): void {
  const selected = state.selectedComponent;
  const read = (prop: keyof SelectedComponentSnapshot): string =>
    root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-selected-prop="${prop}"]`)?.value.trim() ?? "";
  const background = read("background");
  const color = read("color");
  const change: Partial<SelectedComponentSnapshot> = {
    text: read("text"),
    width: read("width"),
    height: read("height"),
    padding: read("padding"),
    radius: read("radius")
  };
  if (selected?.background || background !== "#ffffff") change.background = background;
  if (selected?.color || color !== "#1b2433") change.color = color;
  mountedEditor?.updateSelected(change);
  state.selectedComponent = mountedEditor?.getSelectedSnapshot();
  updateSelectedInspectorOnly();
}

function deleteSelectedComponent(): void {
  mountedEditor?.deleteSelected();
  state.selectedComponent = undefined;
  updateSelectedInspectorOnly();
}

function insertEditorBlock(block: string): void {
  if (!mountedEditor) {
    setToast("The editor is still opening. Try the toolbox again in a moment.");
    return;
  }
  mountedEditor.insertBlock(block);
  state.selectedComponent = mountedEditor.getSelectedSnapshot();
  updateSelectedInspectorOnly();
}

function updateSelectedInspectorOnly(): void {
  const target = root.querySelector<HTMLElement>("[data-selected-inspector]");
  if (!target) return;
  target.innerHTML = selectedInspectorMarkup();
  target.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", () => void handleAction(element.dataset.action ?? "", element));
  });
}

function startPaneResize(kind: string, event: PointerEvent): void {
  if (!["left", "right", "canvas-height"].includes(kind)) return;
  const shell = root.querySelector<HTMLElement>(".editor-shell");
  if (!shell) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = state.editorLeftWidth;
  const startRight = state.editorRightWidth;
  const startHeight = state.editorCanvasHeight;
  document.body.classList.add("is-resizing");

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const onMove = (moveEvent: PointerEvent): void => {
    if (kind === "left") {
      state.editorLeftWidth = clamp(startLeft + moveEvent.clientX - startX, 176, 440);
      shell.style.setProperty("--left-pane", `${state.editorLeftWidth}px`);
    }
    if (kind === "right") {
      state.editorRightWidth = clamp(startRight - (moveEvent.clientX - startX), 220, 460);
      shell.style.setProperty("--right-pane", `${state.editorRightWidth}px`);
    }
    if (kind === "canvas-height") {
      state.editorCanvasHeight = clamp(startHeight + moveEvent.clientY - startY, 460, 1300);
      shell.style.setProperty("--canvas-height", `${state.editorCanvasHeight}px`);
    }
    mountedEditor?.refreshCanvas();
  };
  const onEnd = (): void => {
    document.body.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    mountedEditor?.refreshCanvas();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd, { once: true });
}

function connectionsView(): string {
  if (!state.project) return noProjectView("Open a project to repair connections.");
  const filtered = state.project.connections.filter((connection) => {
    if (state.connectionFilter === "issues") return connection.status !== "mapped";
    if (state.connectionFilter === "mapped") return connection.status === "mapped";
    return true;
  });
  const pageOptions = state.project.pages.map((page) => `<option value="${page.id}">${escapeHtml(page.name)}</option>`).join("");
  return `
    <section class="workspace-panel full-height">
      <div class="panel-heading">
        <h3>Connections</h3>
        <div class="segmented">
          ${(["all", "issues", "mapped"] as const)
            .map((filter) => `<button type="button" class="${state.connectionFilter === filter ? "is-active" : ""}" data-connection-filter="${filter}">${filter}</button>`)
            .join("")}
        </div>
      </div>
      <div class="connections-layout">
        <div class="table-wrap" role="region" aria-label="Connection table">
          <table>
            <thead><tr><th>Trigger</th><th>Action</th><th>Target</th><th>Status</th><th>Repair</th></tr></thead>
            <tbody>
              ${filtered
                .map(
                  (connection) => `<tr>
                    <td>${escapeHtml(connection.triggerLabel)}</td>
                    <td>${escapeHtml(connection.action)}</td>
                    <td>${escapeHtml(connection.targetName ?? "Unresolved")}</td>
                    <td><span class="status-badge ${connection.status}">${escapeHtml(connection.status)}</span></td>
                    <td>
                      <select data-repair-target="${connection.id}" aria-label="Select target for ${escapeAttribute(connection.triggerLabel)}">
                        <option value="">Choose target</option>${pageOptions}
                      </select>
                      <button type="button" class="secondary-button compact" data-create-missing="${connection.id}">Create</button>
                      <button type="button" class="ghost-button compact" data-unresolve="${connection.id}">Mark unresolved</button>
                    </td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <figure class="map-panel">
          <figcaption>SVG map mirrors the table for quick scanning; the table is the complete editor.</figcaption>
          ${connectionSvg()}
        </figure>
      </div>
    </section>
  `;
}

function connectionSvg(): string {
  if (!state.project) return "";
  const pages = state.project.pages;
  const width = 760;
  const height = Math.max(260, pages.length * 86);
  const nodes = pages
    .map((page, index) => {
      const y = 30 + index * 78;
      return `<g><rect x="28" y="${y}" width="180" height="42" rx="6"></rect><text x="44" y="${y + 26}">${escapeHtml(page.name)}</text></g>`;
    })
    .join("");
  const edges = state.project.connections
    .map((connection) => {
      const source = Math.max(0, pages.findIndex((page) => page.id === connection.sourcePageId));
      const target = Math.max(0, pages.findIndex((page) => page.id === connection.targetId));
      const sy = 51 + source * 78;
      const ty = connection.targetId ? 51 + target * 78 : 38 + pages.length * 78;
      const color = connection.status === "mapped" ? "#0f766e" : "#b45309";
      return `<path d="M210 ${sy} C330 ${sy}, 390 ${ty}, 520 ${ty}" stroke="${color}" fill="none" stroke-width="2"></path><text x="532" y="${ty + 4}" fill="${color}">${escapeHtml(
        connection.targetName ?? "missing target"
      )}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Connections map showing pages and navigation edges">${edges}${nodes}</svg>`;
}

function libraryView(): string {
  if (!state.project) return noProjectView("Open a project to use the library.");
  const suggestions = suggestLibraryItems(state.project);
  const items = [...state.library, ...suggestions].filter((item) => item.scope === state.libraryFilter);
  return `
    <section class="workspace-panel full-height">
      <div class="panel-heading">
        <h3>Library</h3>
        <div class="segmented">
          ${(["reusable", "project", "review"] as const)
            .map((filter) => `<button type="button" class="${state.libraryFilter === filter ? "is-active" : ""}" data-library-filter="${filter}">${filter === "review" ? "Needs Review" : filter === "project" ? "This Project" : "Reusable"}</button>`)
            .join("")}
        </div>
      </div>
      <div class="library-grid">
        ${
          items.length
            ? items
                .map(
                  (item) => `<article class="library-card">
                    <h4>${escapeHtml(item.name)}</h4>
                    <p>${escapeHtml(item.category)} - ${escapeHtml(item.scope)} - ${escapeHtml(item.fingerprint)}</p>
                    <div class="preview-box">${item.html ?? escapeHtml(item.css ?? "")}</div>
                    <div class="button-row">
                      ${item.scope === "review" ? `<button type="button" class="primary-button compact" data-approve-library='${escapeAttribute(JSON.stringify(item))}'>Approve</button>` : ""}
                      <button type="button" class="secondary-button compact" data-insert-library='${escapeAttribute(JSON.stringify(item))}'>Insert/apply</button>
                    </div>
                  </article>`
                )
                .join("")
            : `<div class="empty-panel"><h3>No items here</h3><p>Reusable suggestions appear after importing repeated patterns or saving selections.</p></div>`
        }
      </div>
    </section>
  `;
}

function reportView(): string {
  if (!state.project) return noProjectView("Open or import a project to view reports.");
  const report = state.report;
  const source = state.project.source?.rawText ?? "Original source was not retained.";
  const generated = createPrototypeHtml(state.project, { interactive: true });
  return `
    <section class="report-layout">
      <div class="workspace-panel">
        <div class="panel-heading"><h3>Import Report</h3><span>${report ? report.stats.warningCount : 0} warnings</span></div>
        ${
          report
            ? `<div class="metric-grid">
                <div><strong>${report.stats.screenCount}</strong><span>Screens</span></div>
                <div><strong>${report.stats.overlayCount}</strong><span>Overlays</span></div>
                <div><strong>${report.stats.interactionCount}</strong><span>Interactions</span></div>
                <div><strong>${report.stats.importMs}ms</strong><span>Import time</span></div>
              </div>
              <h4>Blocked Resources</h4>
              <ul class="warning-list">${(report.resources.length ? report.resources : []).map((resource) => `<li>${escapeHtml(resource.url)} <small>${escapeHtml(resource.context)}</small></li>`).join("") || "<li>None</li>"}</ul>
              <h4>Quarantined Scripts</h4>
              <ul class="warning-list">${report.sanitization.quarantinedScripts.map((script) => `<li>${escapeHtml(script.location)} <small>${escapeHtml(script.sample)}</small></li>`).join("") || "<li>None</li>"}</ul>
              <h4>Missing Targets</h4>
              <ul class="warning-list">${report.missingTargets.map((target) => `<li>${escapeHtml(target)}</li>`).join("") || "<li>None</li>"}</ul>`
            : `<p class="muted">This project has no import report.</p>`
        }
      </div>
      <div class="comparison-grid">
        <section class="workspace-panel">
          <div class="panel-heading"><h3>Safe Source Preview</h3><span>sandboxed</span></div>
          <iframe title="Safe source preview" sandbox="" srcdoc="${escapeAttribute(report?.sanitizedPreviewHtml ?? "")}"></iframe>
        </section>
        <section class="workspace-panel">
          <div class="panel-heading"><h3>Edited Preview</h3><span>approved runtime</span></div>
          <iframe title="Approved behavior preview" sandbox="allow-scripts" srcdoc="${escapeAttribute(generated)}"></iframe>
        </section>
      </div>
      <div class="code-grid">
        <label>Quarantined source <textarea readonly>${escapeHtml(source)}</textarea></label>
        <label>Generated output <textarea readonly>${escapeHtml(generated)}</textarea></label>
      </div>
    </section>
  `;
}

function exportView(): string {
  if (!state.project) return noProjectView("Open a project to export.");
  const hasAssets = state.project.assets.length > 0;
  return `
    <section class="export-grid">
      <article class="export-option primary-export">
        <h3>Portable Project Backup</h3>
        <p>Includes project JSON, prototype HTML, report, local assets, and retained source when selected during import.</p>
        <button type="button" class="primary-button" data-action="export-zip">Download .htmlforge.zip</button>
      </article>
      <article class="export-option primary-export">
        <h3>HTML Prototype</h3>
        <p>Standalone interactive HTML compiled from approved HTML Forge behavior only.</p>
        <button type="button" class="primary-button" data-action="export-html">Download .html</button>
      </article>
      <article class="export-option">
        <h3>Editable JSON</h3>
        <p>${hasAssets ? "This project has assets; JSON alone is not portable." : "Safe for projects without external asset payloads."}</p>
        <button type="button" class="secondary-button" data-action="export-json">Download JSON</button>
      </article>
      <article class="export-option">
        <h3>Import Report</h3>
        <p>Markdown report covering sanitization, blocked resources, interactions, and accessibility findings.</p>
        <button type="button" class="secondary-button" data-action="export-report">Download report</button>
      </article>
      <article class="export-option">
        <h3>AI Handoff Package</h3>
        <p>Structured Markdown, JSON, and HTML for future iteration. Quarantined executable source is excluded.</p>
        <button type="button" class="secondary-button" data-action="export-ai">Download handoff</button>
      </article>
    </section>
  `;
}

function settingsView(): string {
  return `
    <section class="settings-grid">
      <div class="workspace-panel">
        <div class="panel-heading"><h3>Storage Status</h3><span>${escapeHtml(state.storageUsage)}</span></div>
        <p>${escapeHtml(state.storageMessage)}</p>
        <button type="button" class="primary-button" data-action="persist-storage">Request persistent storage</button>
      </div>
      <div class="workspace-panel">
        <div class="panel-heading"><h3>Privacy</h3><span>local only</span></div>
        <p>No backend, cloud save, analytics, or runtime CDN scripts are used. GitHub Pages hosts the application files only.</p>
      </div>
      <div class="workspace-panel">
        <div class="panel-heading"><h3>Cache Repair</h3><span>browser shell</span></div>
        <p>Clear old production shell caches if the editor ever appears stuck after an update. Local projects remain in browser storage.</p>
        <button type="button" class="secondary-button" data-action="check-update">Clear cached shell</button>
      </div>
      <div class="workspace-panel">
        <div class="panel-heading"><h3>Decision History</h3><span>${state.decisions.length}</span></div>
        <div class="list-stack">${state.decisions.slice(-12).map((decision) => `<div class="item-row"><div><strong>${escapeHtml(decision.label)}</strong><span>${escapeHtml(decision.decision)}</span></div></div>`).join("") || "<p class='muted'>No decisions recorded yet.</p>"}</div>
      </div>
    </section>
  `;
}

function noProjectView(message: string): string {
  return `<section class="empty-panel centered"><h3>No project open</h3><p>${escapeHtml(message)}</p><div class="button-row"><button type="button" class="primary-button" data-action="new-project">New project</button><button type="button" class="secondary-button" data-action="open-import">Import HTML</button></div></section>`;
}

function importStudio(): string {
  const report = state.importDraft?.report;
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="import-studio" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header>
          <div>
            <p class="eyebrow">Guided workflow</p>
            <h2 id="import-title">Import Studio</h2>
          </div>
          <button type="button" class="icon-button" aria-label="Close Import Studio" data-action="close-import">X</button>
        </header>
        <div class="import-grid">
          <section class="workspace-panel">
            <div class="panel-heading"><h3>Source Intake</h3><span>inert</span></div>
            <label class="file-button full">Choose HTML file<input type="file" accept=".html,.htm,text/html" data-action="import-html-file"></label>
            <label>File name <input type="text" value="${escapeAttribute(state.importFileName)}" data-action="import-file-name"></label>
            <label class="check-row"><input type="checkbox" data-action="retain-source" ${state.importRetainSource ? "checked" : ""}> Retain original source locally in the project backup</label>
            <label>Paste HTML <textarea rows="12" data-action="import-source">${escapeHtml(state.importSourceText)}</textarea></label>
            <button type="button" class="primary-button full" data-action="analyze-import">Analyze safely</button>
          </section>
          <section class="workspace-panel">
            <div class="panel-heading"><h3>Summary</h3><span>${report ? `${report.stats.warningCount} warnings` : "waiting"}</span></div>
            ${
              report
                ? `<div class="metric-grid">
                    <div><strong>${report.stats.screenCount}</strong><span>Screens</span></div>
                    <div><strong>${report.stats.overlayCount}</strong><span>Overlays</span></div>
                    <div><strong>${report.stats.interactionCount}</strong><span>Behaviors</span></div>
                    <div><strong>${report.resources.length}</strong><span>Resources blocked</span></div>
                  </div>
                  <p>${escapeHtml(state.importDraft?.project.importSummary ?? "")}</p>
                  <div class="resource-list">${report.resources.map((resource) => `<span>${escapeHtml(resource.type)}: ${escapeHtml(resource.url)}</span>`).join("") || "<span>No remote resources blocked.</span>"}</div>
                  <button type="button" class="primary-button full" data-action="accept-import">Convert to editable project</button>`
                : `<p class="muted">Choose or paste HTML, then analyze. Source code is parsed without active rendering.</p>`
            }
          </section>
          <section class="workspace-panel preview-surface">
            <div class="panel-heading"><h3>Safe Visual Preview</h3><span><code>sandbox=""</code></span></div>
            <iframe title="Safe visual import preview" sandbox="" srcdoc="${escapeAttribute(report?.sanitizedPreviewHtml ?? "<p>No preview yet.</p>")}"></iframe>
          </section>
        </div>
      </section>
    </div>
  `;
}

function previewDialog(): string {
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header>
          <h2 id="preview-title">Approved Behavior Preview</h2>
          <button type="button" class="icon-button" aria-label="Close preview" data-action="close-preview">X</button>
        </header>
        <iframe title="Approved behavior preview" sandbox="allow-scripts" srcdoc="${escapeAttribute(state.previewHtml)}"></iframe>
      </section>
    </div>
  `;
}

function bindEvents(): void {
  root.querySelectorAll<HTMLElement>("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = button.dataset.route as RouteId;
      state.route = route;
      render();
    });
  });

  root.querySelectorAll<HTMLElement>("[data-open-project]").forEach((button) => {
    button.addEventListener("click", () => void openProject(button.dataset.openProject as string));
  });

  root.querySelectorAll<HTMLElement>("[data-delete-project]").forEach((button) => {
    button.addEventListener("click", () => void removeProject(button.dataset.deleteProject as string));
  });

  root.querySelectorAll<HTMLElement>("[data-duplicate-project]").forEach((button) => {
    button.addEventListener("click", () => void duplicateProject(button.dataset.duplicateProject as string));
  });

  root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    const action = element.dataset.action;
    if (element instanceof HTMLInputElement && action === "import-project-file") {
      element.addEventListener("change", () => void importProjectFile(element.files?.[0]));
      return;
    }
    if (element instanceof HTMLInputElement && action === "import-html-file") {
      element.addEventListener("change", () => void importHtmlFile(element.files?.[0]));
      return;
    }
    if (element instanceof HTMLTextAreaElement && action === "import-source") {
      element.addEventListener("input", () => {
        state.importSourceText = element.value;
      });
      return;
    }
    if (element instanceof HTMLInputElement && action === "import-file-name") {
      element.addEventListener("input", () => {
        state.importFileName = element.value || "import.html";
      });
      return;
    }
    if (element instanceof HTMLInputElement && action === "retain-source") {
      element.addEventListener("change", () => {
        state.importRetainSource = element.checked;
      });
      return;
    }
    if (element instanceof HTMLInputElement && action === "project-name") {
      element.addEventListener("change", () => updateProjectName(element.value));
      return;
    }
    if (element instanceof HTMLTextAreaElement && action === "project-notes") {
      element.addEventListener("change", () => updateProjectNotes(element.value));
      return;
    }
    if (element instanceof HTMLSelectElement && action === "select-editor-page") {
      element.addEventListener("change", () => selectEditorPage(element.value));
      return;
    }
    element.addEventListener("click", () => void handleAction(action ?? "", element));
  });

  root.querySelectorAll<HTMLButtonElement>("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editorTab = button.dataset.editorTab as AppState["editorTab"];
      render();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.inspectorTab = button.dataset.inspectorTab as AppState["inspectorTab"];
      render();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-connection-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.connectionFilter = button.dataset.connectionFilter as AppState["connectionFilter"];
      render();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-library-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.libraryFilter = button.dataset.libraryFilter as AppState["libraryFilter"];
      render();
    });
  });
  root.querySelectorAll<HTMLSelectElement>("[data-repair-target]").forEach((select) => {
    select.addEventListener("change", () => repairConnection(select.dataset.repairTarget as string, select.value));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-create-missing]").forEach((button) => {
    button.addEventListener("click", () => createMissingTarget(button.dataset.createMissing as string));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-unresolve]").forEach((button) => {
    button.addEventListener("click", () => markConnectionUnresolved(button.dataset.unresolve as string));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-page]").forEach((button) => {
    button.addEventListener("click", () => selectEditorPage(button.dataset.openPage as string));
  });
  root.querySelectorAll<HTMLElement>("[data-resize-pane]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startPaneResize(handle.dataset.resizePane ?? "", event));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-approve-library]").forEach((button) => {
    button.addEventListener("click", () => void approveLibrary(button.dataset.approveLibrary));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-insert-library]").forEach((button) => {
    button.addEventListener("click", () => void insertLibrary(button.dataset.insertLibrary));
  });
}

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  switch (action) {
    case "new-project":
      await createNewProject();
      break;
    case "open-import":
      state.importOpen = true;
      render();
      break;
    case "close-import":
      state.importOpen = false;
      render();
      break;
    case "analyze-import":
      analyzeImportFromState();
      break;
    case "accept-import":
      await acceptImport();
      break;
    case "persist-storage":
      await persistStorage();
      break;
    case "save-now":
      await saveNow();
      break;
    case "preview-project":
      openPreview();
      break;
    case "close-preview":
      state.previewOpen = false;
      render();
      break;
    case "add-screen":
      addScreen();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "zoom-out":
      zoomEditor(-10);
      break;
    case "zoom-in":
      zoomEditor(10);
      break;
    case "fit-canvas":
      fitEditorCanvas();
      break;
    case "focus-canvas":
      toggleFocusCanvas();
      break;
    case "show-pages":
      showPagesPanel();
      break;
    case "show-toolbox":
      showToolboxPanel();
      break;
    case "show-inspector":
      showInspectorPanel();
      break;
    case "open-connections":
      state.route = "connections";
      render();
      break;
    case "apply-selected-edit":
      applySelectedEdit();
      break;
    case "delete-selected":
      deleteSelectedComponent();
      break;
    case "retry-editor":
      state.editorError = undefined;
      render();
      break;
    case "save-selection-library":
      await saveSelectionAsLibrary();
      break;
    case "export-zip":
      await downloadZip();
      break;
    case "export-html":
      downloadHtml();
      break;
    case "export-json":
      downloadJson();
      break;
    case "export-report":
      downloadReport();
      break;
    case "export-ai":
      downloadAiHandoff();
      break;
    case "check-update":
      await checkServiceWorkerUpdate();
      break;
    case "insert-block":
      insertEditorBlock(element.dataset.block ?? "section");
      break;
  }
}

async function createNewProject(): Promise<void> {
  const project = createBlankProject();
  await putProject(project);
  state.projects = await listProjects();
  state.project = project;
  state.report = undefined;
  state.route = "editor";
  state.activeEditorPageId = project.pages[0]?.id;
  state.editorError = undefined;
  await establishLock(project.id);
  render();
}

async function openProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) {
    setToast("Project was not found in local storage.");
    return;
  }
  state.project = project;
  state.report = project.importReportId ? await getImportReport(project.importReportId) : undefined;
  state.route = "editor";
  state.activeEditorPageId = project.pages[0]?.id;
  state.editorError = undefined;
  await establishLock(project.id);
  render();
}

async function establishLock(projectId: string): Promise<void> {
  activeLock?.release();
  activeLock = await acquireProjectLock(projectId, instanceId, (message) => {
    state.lockMessage = message;
    renderStatusOnly();
  });
  state.lockMessage =
    activeLock.state === "writable"
      ? "Writable project lock active."
      : activeLock.state === "readonly"
        ? "Another tab has the write lock. This tab is read-only until takeover."
        : "Project lock API unavailable; BroadcastChannel fallback is active.";
}

async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  if (state.project?.id === id) {
    state.project = undefined;
    state.report = undefined;
    unmountEditor();
  }
  state.projects = await listProjects();
  render();
}

async function duplicateProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (!project) return;
  const copy = cloneProject(project);
  copy.id = createId("project");
  copy.name = `${project.name} Copy`;
  copy.slug = slugify(copy.name);
  copy.revision = 1;
  copy.createdAt = nowIso();
  copy.modifiedAt = nowIso();
  copy.importReportId = undefined;
  await putProject(copy);
  state.projects = await listProjects();
  setToast("Project duplicated locally.");
  render();
}

async function importHtmlFile(file?: File): Promise<void> {
  if (!file) return;
  state.importFileName = file.name;
  state.importSourceText = await file.text();
  analyzeImportFromState();
}

function analyzeImportFromState(): void {
  if (!state.importSourceText.trim()) {
    setToast("Add HTML source before analysis.");
    return;
  }
  state.importDraft = analyzeHtmlImport(state.importSourceText, state.importFileName, state.importRetainSource);
  render();
}

async function acceptImport(): Promise<void> {
  if (!state.importDraft) return;
  const { project, report } = state.importDraft;
  await putProject(project);
  await saveImportReport(report);
  for (const resource of report.resources) {
    await saveDecision({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: createId("decision"),
      projectId: project.id,
      kind: "resource",
      label: resource.url,
      decision: resource.decision,
      details: resource.context,
      createdAt: nowIso()
    });
  }
  state.projects = await listProjects();
  state.decisions = await listDecisions(project.id);
  state.project = project;
  state.report = report;
  state.importOpen = false;
  state.route = "editor";
  state.activeEditorPageId = project.pages[0]?.id;
  state.editorError = undefined;
  await establishLock(project.id);
  render();
}

async function importProjectFile(file?: File): Promise<void> {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.endsWith(".zip") || file.name.endsWith(".htmlforge.zip")) {
    const entries = unzipSync(bytes);
    const projectEntry = entries["project.htmlforge.json"] ?? entries["project.json"];
    if (!projectEntry) throw new Error("Package does not contain project.htmlforge.json.");
    const project = migrateProject(JSON.parse(strFromU8(projectEntry)));
    project.id = createId("project");
    project.name = `${project.name} Imported`;
    project.slug = slugify(project.name);
    project.revision = 1;
    project.createdAt = nowIso();
    project.modifiedAt = nowIso();
    await putProject(project);
    state.projects = await listProjects();
    setToast("Portable package imported as a new local copy.");
    await openProject(project.id);
    return;
  }
  const text = new TextDecoder().decode(bytes);
  const project = migrateProject(JSON.parse(text));
  project.id = createId("project");
  project.name = `${project.name} Imported`;
  project.slug = slugify(project.name);
  project.revision = 1;
  await putProject(project);
  state.projects = await listProjects();
  state.activeEditorPageId = project.pages[0]?.id;
  state.editorError = undefined;
  await openProject(project.id);
}

async function mountEditorIfNeeded(): Promise<void> {
  if (!state.project) return;
  const mount = root.querySelector<HTMLElement>("#gjs-mount");
  if (!mount) return;
  if (mountedEditor && mountedEditorProjectId === state.project.id) return;
  unmountEditor();
  const mountToken = ++editorMountToken;
  try {
    const editor = await mountGrapesEditor(mount, state.project, {
      onChange(snapshot) {
        if (mountToken !== editorMountToken) return;
        if (!state.project) return;
        const before = cloneProject(state.project);
        syncProjectFromEditorSnapshot(snapshot);
        mountedEditorSnapshotKey = editorSnapshotKey(snapshot);
        markDirty("Visual editor change", before);
      },
      onSelection(snapshot) {
        if (mountToken !== editorMountToken) return;
        state.selectedComponent = snapshot;
        updateSelectedInspectorOnly();
      },
      onError(error) {
        if (mountToken !== editorMountToken) return;
        state.saveError = `Editor failed: ${error.message}`;
        state.editorError = error.message;
      }
    });
    if (mountToken !== editorMountToken || !mount.isConnected || state.route !== "editor" || state.editorError) {
      editor.destroy();
      return;
    }
    mountedEditor = editor;
    mountedEditorProjectId = state.project.id;
    state.editorError = undefined;
    state.editorZoom = Math.round(mountedEditor.setZoom(state.editorZoom));
    mountedEditorSnapshotKey = editorSnapshotKey(mountedEditor.saveSnapshot());
    updateZoomReadout();
    selectEditorPage(state.activeEditorPageId ?? state.project.pages[0]?.id ?? "");
  } catch (error) {
    if (mountToken !== editorMountToken) return;
    state.editorError = error instanceof Error ? error.message : String(error);
    mountedEditor = undefined;
    mountedEditorProjectId = undefined;
    render();
  }
}

function updateProjectName(value: string): void {
  if (!state.project) return;
  const before = cloneProject(state.project);
  state.project.name = value || state.project.name;
  state.project.slug = slugify(state.project.name);
  markDirty("Rename project", before);
  render();
}

function updateProjectNotes(value: string): void {
  if (!state.project) return;
  const before = cloneProject(state.project);
  state.project.notes.general = value;
  markDirty("Update project notes", before);
}

async function saveNow(): Promise<void> {
  if (!state.project) return;
  if (mountedEditor) {
    const snapshot = mountedEditor.saveSnapshot();
    state.project.grapesProjectData = snapshot.grapesProjectData;
  }
  try {
    state.project = await saveProject(state.project, instanceId, state.project.revision);
    state.projects = await listProjects();
    state.dirty = false;
    state.saveError = undefined;
    setToast("Project saved locally.");
  } catch (error) {
    state.saveError = error instanceof Error ? error.message : String(error);
    render();
  }
}

function addScreen(): void {
  if (!state.project) return;
  const before = cloneProject(state.project);
  const name = `Screen ${state.project.pages.length + 1}`;
  const page = {
    id: createId("page"),
    generatedId: generatedScreenId(state.project.pages.length),
    name,
    slug: slugify(name),
    html: `<main><h1>${escapeHtml(name)}</h1><p>New screen.</p></main>`,
    css: "",
    notes: "",
    componentCount: 3,
    createdAt: nowIso(),
    modifiedAt: nowIso()
  };
  state.project.pages.push(page);
  state.activeEditorPageId = page.id;
  mountedEditor?.addPage(name, page.id);
  mountedEditor?.selectPage(page.id);
  markDirty("Add screen", before);
  render();
}

function repairConnection(connectionId: string, targetId: string): void {
  if (!state.project || !targetId) return;
  const before = cloneProject(state.project);
  const connection = state.project.connections.find((item) => item.id === connectionId);
  const target = state.project.pages.find((page) => page.id === targetId);
  if (!connection || !target) return;
  connection.targetId = target.id;
  connection.targetName = target.name;
  connection.status = "mapped";
  connection.action = "navigate";
  connection.modifiedAt = nowIso();
  markDirty("Repair connection", before);
  render();
}

function createMissingTarget(connectionId: string): void {
  if (!state.project) return;
  const connection = state.project.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  const before = cloneProject(state.project);
  const name = connection.targetName ? connection.targetName.replace(/[-_]+/g, " ") : "Repaired Screen";
  const page = {
    id: createId("page"),
    generatedId: generatedScreenId(state.project.pages.length),
    name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    slug: slugify(name),
    html: `<main><h1>${escapeHtml(name)}</h1><p>Created to repair an imported connection.</p></main>`,
    css: "",
    notes: "",
    componentCount: 3,
    createdAt: nowIso(),
    modifiedAt: nowIso()
  };
  state.project.pages.push(page);
  connection.targetId = page.id;
  connection.targetName = page.name;
  connection.status = "mapped";
  markDirty("Create missing target", before);
  render();
}

function markConnectionUnresolved(connectionId: string): void {
  if (!state.project) return;
  const before = cloneProject(state.project);
  const connection = state.project.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  connection.status = "intentionally-unresolved";
  connection.action = "unresolved";
  connection.modifiedAt = nowIso();
  markDirty("Mark connection unresolved", before);
  render();
}

function undo(): void {
  if (!state.project) return;
  state.project = history.undo(state.project);
  state.dirty = true;
  scheduleSave();
  render();
}

function redo(): void {
  if (!state.project) return;
  state.project = history.redo(state.project);
  state.dirty = true;
  scheduleSave();
  render();
}

async function approveLibrary(raw?: string): Promise<void> {
  if (!raw) return;
  const item = JSON.parse(raw) as LibraryItem;
  item.scope = "reusable";
  item.modifiedAt = nowIso();
  await saveLibraryItem(item);
  state.library = await listLibraryItems();
  setToast("Reusable library item saved locally.");
  render();
}

async function insertLibrary(raw?: string): Promise<void> {
  if (!raw || !state.project) return;
  const item = JSON.parse(raw) as LibraryItem;
  const before = cloneProject(state.project);
  const page = state.project.pages[0];
  if (item.html) page.html += `\n${item.html}`;
  if (item.css) page.css += `\n${item.css}`;
  page.componentCount += 1;
  markDirty("Insert library item", before);
  render();
}

async function saveSelectionAsLibrary(): Promise<void> {
  if (!state.project) return;
  const html = mountedEditor?.getSelectedHtml?.() || state.project.pages[0]?.html || "";
  const item: LibraryItem = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId("library"),
    scope: "reusable",
    name: "Saved selection",
    category: "component",
    html,
    css: "",
    fingerprint: slugify(html.slice(0, 60)) || createId("fingerprint"),
    createdAt: nowIso(),
    modifiedAt: nowIso()
  };
  await saveLibraryItem(item);
  state.library = await listLibraryItems();
  setToast("Selection saved to the reusable library.");
  render();
}

function openPreview(): void {
  if (!state.project) return;
  state.previewHtml = createPrototypeHtml(state.project, { interactive: true });
  state.previewOpen = true;
  render();
}

async function downloadZip(): Promise<void> {
  if (!state.project) return;
  const report = state.report ?? (state.project.importReportId ? await getImportReport(state.project.importReportId) : undefined);
  const pkg = exportProjectPackage(state.project, report);
  downloadBlob(pkg.blob, pkg.fileName);
}

function downloadHtml(): void {
  if (!state.project) return;
  const html = createPrototypeHtml(state.project, { interactive: true });
  downloadBlob(new Blob([html], { type: "text/html" }), `${slugify(state.project.name)}_${formatFileStamp()}.html`);
}

function downloadJson(): void {
  if (!state.project) return;
  if (state.project.assets.length && !window.confirm("This project has assets. JSON alone will not be portable to another machine. Export a ZIP backup instead unless you accept that limitation.")) return;
  downloadBlob(new Blob([createProjectJson(state.project)], { type: "application/json" }), `${slugify(state.project.name)}_${formatFileStamp()}.htmlforge.json`);
}

function downloadReport(): void {
  if (!state.report) {
    setToast("No import report is attached to this project.");
    return;
  }
  downloadBlob(new Blob([createImportReportMarkdown(state.report)], { type: "text/markdown" }), `${slugify(state.project?.name ?? "html-forge")}_${formatFileStamp()}_import-report.md`);
}

function downloadAiHandoff(): void {
  if (!state.project) return;
  const pkg = exportAiHandoff(state.project, state.report);
  downloadBlob(pkg.blob, pkg.fileName);
}

async function persistStorage(): Promise<void> {
  const status = await requestPersistentStorage();
  state.storageMessage = status.message;
  state.storageUsage = status.estimate ? `${humanBytes(status.estimate.usage)} / ${humanBytes(status.estimate.quota)}` : "";
  render();
}

async function clearLegacyServiceWorkerCaches(): Promise<number> {
  let cleared = 0;
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(async (registration) => {
        if (await registration.unregister()) cleared += 1;
      })
    );
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    const forgeKeys = keys.filter((key) => key.startsWith("html-forge"));
    await Promise.all(forgeKeys.map((key) => caches.delete(key)));
    cleared += forgeKeys.length;
  }
  return cleared;
}

async function checkServiceWorkerUpdate(): Promise<void> {
  const cleared = await clearLegacyServiceWorkerCaches();
  setToast(cleared ? "Cached app shell cleared. Reload if the editor was already open." : "No cached app shell was found.");
}

async function refreshLocalState(): Promise<void> {
  state.projects = await listProjects();
  state.library = await listLibraryItems();
  state.decisions = await listDecisions(state.project?.id);
  const storage = await getStorageStatus();
  state.storageMessage = storage.message;
  state.storageUsage = storage.estimate ? `${humanBytes(storage.estimate.usage)} / ${humanBytes(storage.estimate.quota)}` : "";
}

function bindUnloadProtection(): void {
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty && !state.saving && !state.saveError) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.project && state.dirty) void saveNow();
  });
  window.addEventListener("pagehide", () => {
    if (state.project && state.dirty) void saveNow();
    activeLock?.release();
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

function bindEditorKeyboardShortcuts(): void {
  window.addEventListener("keydown", (event) => {
    if (state.route !== "editor" || state.previewOpen || state.importOpen) return;
    const key = event.key.toLowerCase();
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && key === "s") {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (commandKey && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      zoomEditor(10);
      return;
    }
    if (commandKey && event.key === "-") {
      event.preventDefault();
      zoomEditor(-10);
      return;
    }
    if (commandKey && event.key === "0") {
      event.preventDefault();
      fitEditorCanvas();
      return;
    }
    if (commandKey && key === "z" && event.shiftKey) {
      event.preventDefault();
      redo();
      return;
    }
    if (commandKey && key === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (commandKey && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (key === "f") {
      event.preventDefault();
      toggleFocusCanvas();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelectedComponent();
    }
  });
}

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  const cleared = await clearLegacyServiceWorkerCaches();
  if (cleared) setToast("Old app cache cleared. Reload once if the editor was already open.");
}

async function boot(): Promise<void> {
  bindUnloadProtection();
  bindEditorKeyboardShortcuts();
  await refreshLocalState();
  render();
  await registerServiceWorker();
}

void boot().catch((error) => {
  root.innerHTML = `<main class="fatal-error"><h1>HTML Forge failed to start</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></main>`;
});
