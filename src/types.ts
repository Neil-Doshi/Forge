export const PROJECT_SCHEMA_VERSION = 1 as const;

export type RouteId = "home" | "editor" | "connections" | "library" | "report" | "export" | "settings";
export type ConnectionAction = "navigate" | "open-overlay" | "close-overlay" | "toggle" | "unresolved";
export type DecisionKind = "resource" | "behavior" | "component" | "sanitization" | "manual-repair";
export type LibraryScope = "reusable" | "project" | "review";

export interface ForgePage {
  id: string;
  generatedId: string;
  name: string;
  slug: string;
  html: string;
  css: string;
  notes: string;
  componentCount: number;
  createdAt: string;
  modifiedAt: string;
}

export interface ForgeOverlay {
  id: string;
  generatedId: string;
  name: string;
  html: string;
  css: string;
}

export interface ForgeConnection {
  id: string;
  sourcePageId: string;
  triggerLabel: string;
  action: ConnectionAction;
  targetId?: string;
  targetName?: string;
  selector?: string;
  status: "mapped" | "missing-target" | "unsupported" | "manual" | "intentionally-unresolved";
  sourceSnippet?: string;
  createdAt: string;
  modifiedAt: string;
}

export interface SharedComponentMaster {
  id: string;
  name: string;
  category: "header" | "sidebar" | "navigation" | "custom";
  grapesComponentData: unknown;
  createdAt: string;
  modifiedAt: string;
}

export interface SharedComponentInstance {
  instanceId: string;
  masterId: string;
  pageId: string;
  detached: boolean;
  localOverrides?: Record<string, unknown>;
}

export interface ForgeAsset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  missing?: boolean;
}

export interface DecisionRecord {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  projectId?: string;
  kind: DecisionKind;
  label: string;
  decision: string;
  details?: string;
  createdAt: string;
}

export interface SanitizationReport {
  removedTags: Record<string, number>;
  removedAttributes: Array<{ element: string; attribute: string; value?: string; reason: string }>;
  blockedUrls: Array<{ url: string; context: string; reason: string }>;
  quarantinedScripts: Array<{ type: "script" | "handler"; sample: string; location: string }>;
  strippedEditorMetadata: number;
}

export interface CssSafetyReport {
  blockedImports: string[];
  blockedResources: Array<{ url: string; property: string; reason: string }>;
  blockedConstructs: Array<{ construct: string; reason: string }>;
  tokens: string[];
  keyframes: string[];
}

export interface ImportInteractionCandidate {
  id: string;
  type: "switchView" | "data-target" | "anchor" | "onclick" | "form" | "unknown";
  sourceName: string;
  targetName?: string;
  selector?: string;
  status: "mapped" | "missing-target" | "unsupported" | "suspected";
  snippet: string;
}

export interface ImportReport {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  projectId?: string;
  importedAt: string;
  fileName: string;
  sourceBytes: number;
  rawSourceRetained: boolean;
  sanitizedPreviewHtml: string;
  sanitizedHtml: string;
  sanitizedCss: string;
  stats: {
    elementCount: number;
    componentCount: number;
    screenCount: number;
    overlayCount: number;
    interactionCount: number;
    warningCount: number;
    importMs: number;
  };
  screens: Array<{ id: string; name: string; selector: string; html: string; css: string; componentCount: number }>;
  overlays: Array<{ id: string; name: string; selector: string; html: string; css: string }>;
  css: CssSafetyReport;
  sanitization: SanitizationReport;
  interactions: ImportInteractionCandidate[];
  missingTargets: string[];
  resources: Array<{ url: string; type: "font" | "image" | "stylesheet" | "other"; context: string; decision: "blocked" | "ignored" | "fallback" | "local-supplied" }>;
  accessibility: string[];
  unsupported: string[];
  decisions: DecisionRecord[];
}

export interface LibraryItem {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  scope: LibraryScope;
  name: string;
  category: "component" | "theme" | "effect" | "behavior";
  html?: string;
  css?: string;
  data?: unknown;
  fingerprint: string;
  createdAt: string;
  modifiedAt: string;
}

export interface HtmlForgeProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  revision: number;
  lastWriterInstanceId: string;
  storagePersistence: "unknown" | "granted" | "not-granted" | "unavailable";
  pages: ForgePage[];
  overlays: ForgeOverlay[];
  connections: ForgeConnection[];
  sharedMasters: SharedComponentMaster[];
  sharedInstances: SharedComponentInstance[];
  libraryRefs: string[];
  assets: ForgeAsset[];
  source?: {
    fileName: string;
    rawText?: string;
    retained: boolean;
  };
  importReportId?: string;
  importSummary?: string;
  grapesProjectData?: unknown;
  notes: Record<string, string>;
}

export interface StorageStatus {
  persisted: boolean | null;
  estimate?: StorageEstimate;
  message: string;
}

export interface PackageExport {
  fileName: string;
  blob: Blob;
}
