import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { migrateProject } from "./migrations";
import { PROJECT_SCHEMA_VERSION, type DecisionRecord, type HtmlForgeProject, type ImportReport, type LibraryItem, type StorageStatus } from "./types";
import { cloneProject, nowIso } from "./utils";

const DB_NAME = "html-forge-local";
const DB_VERSION = 1;

interface HtmlForgeDb extends DBSchema {
  projects: {
    key: string;
    value: HtmlForgeProject;
    indexes: { "by-modified": string; "by-slug": string };
  };
  importReports: {
    key: string;
    value: ImportReport;
    indexes: { "by-project": string };
  };
  libraries: {
    key: string;
    value: LibraryItem;
    indexes: { "by-scope": string; "by-category": string };
  };
  decisionHistory: {
    key: string;
    value: DecisionRecord;
    indexes: { "by-project": string; "by-kind": string };
  };
  settings: {
    key: string;
    value: { id: string; schemaVersion: typeof PROJECT_SCHEMA_VERSION; value: unknown; modifiedAt: string };
  };
  backups: {
    key: string;
    value: { id: string; projectId: string; project: HtmlForgeProject; createdAt: string };
    indexes: { "by-project": string };
  };
}

let dbPromise: Promise<IDBPDatabase<HtmlForgeDb>> | undefined;

export function getDb(): Promise<IDBPDatabase<HtmlForgeDb>> {
  dbPromise ??= openDB<HtmlForgeDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const projects = db.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("by-modified", "modifiedAt");
      projects.createIndex("by-slug", "slug");

      const reports = db.createObjectStore("importReports", { keyPath: "id" });
      reports.createIndex("by-project", "projectId");

      const libraries = db.createObjectStore("libraries", { keyPath: "id" });
      libraries.createIndex("by-scope", "scope");
      libraries.createIndex("by-category", "category");

      const decisions = db.createObjectStore("decisionHistory", { keyPath: "id" });
      decisions.createIndex("by-project", "projectId");
      decisions.createIndex("by-kind", "kind");

      db.createObjectStore("settings", { keyPath: "id" });

      const backups = db.createObjectStore("backups", { keyPath: "id" });
      backups.createIndex("by-project", "projectId");
    }
  });
  return dbPromise;
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (!navigator.storage?.persist) {
    return { persisted: null, estimate: await navigator.storage?.estimate?.(), message: "Persistence request unavailable in this browser." };
  }
  const persistedBefore = await navigator.storage.persisted?.();
  const persisted = persistedBefore || (await navigator.storage.persist());
  return {
    persisted,
    estimate: await navigator.storage.estimate?.(),
    message: persisted
      ? "Persistent storage granted. Browser data is protected from automatic eviction except explicit user action."
      : "Persistence was not granted. Export portable backups before clearing browser data."
  };
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const estimate = await navigator.storage?.estimate?.();
  if (!navigator.storage?.persisted) {
    return { persisted: null, estimate, message: "Storage persistence status is unavailable in this browser." };
  }
  const persisted = await navigator.storage.persisted();
  return {
    persisted,
    estimate,
    message: persisted
      ? "Persistent storage granted."
      : "Persistence not granted. IndexedDB may be cleared by browser storage cleanup."
  };
}

export async function saveProject(project: HtmlForgeProject, writerInstanceId: string, expectedRevision?: number): Promise<HtmlForgeProject> {
  const db = await getDb();
  const existing = await db.get("projects", project.id);
  if (existing && expectedRevision !== undefined && existing.revision !== expectedRevision) {
    throw new Error(`Save conflict: stored revision ${existing.revision}, editor revision ${expectedRevision}.`);
  }
  if (existing) {
    await db.put("backups", { id: `${project.id}:${existing.revision}:${Date.now()}`, projectId: project.id, project: cloneProject(existing), createdAt: nowIso() });
  }
  const saved = cloneProject(project);
  saved.modifiedAt = nowIso();
  saved.revision = existing ? existing.revision + 1 : project.revision || 1;
  saved.lastWriterInstanceId = writerInstanceId;
  const status = await getStorageStatus();
  saved.storagePersistence = status.persisted === true ? "granted" : status.persisted === false ? "not-granted" : "unavailable";
  await db.put("projects", saved);
  return saved;
}

export async function putProject(project: HtmlForgeProject): Promise<void> {
  const db = await getDb();
  await db.put("projects", project);
}

export async function getProject(id: string): Promise<HtmlForgeProject | undefined> {
  const db = await getDb();
  const value = await db.get("projects", id);
  return value ? migrateProject(value) : undefined;
}

export async function listProjects(): Promise<HtmlForgeProject[]> {
  const db = await getDb();
  const values = await db.getAllFromIndex("projects", "by-modified");
  return values.map(migrateProject).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("projects", id);
}

export async function saveImportReport(report: ImportReport): Promise<void> {
  const db = await getDb();
  await db.put("importReports", report);
}

export async function getImportReport(id: string): Promise<ImportReport | undefined> {
  const db = await getDb();
  return db.get("importReports", id);
}

export async function listProjectReports(projectId: string): Promise<ImportReport[]> {
  const db = await getDb();
  return db.getAllFromIndex("importReports", "by-project", projectId);
}

export async function saveLibraryItem(item: LibraryItem): Promise<void> {
  const db = await getDb();
  await db.put("libraries", item);
}

export async function listLibraryItems(): Promise<LibraryItem[]> {
  const db = await getDb();
  return db.getAll("libraries");
}

export async function saveDecision(record: DecisionRecord): Promise<void> {
  const db = await getDb();
  await db.put("decisionHistory", record);
}

export async function listDecisions(projectId?: string): Promise<DecisionRecord[]> {
  const db = await getDb();
  if (projectId) return db.getAllFromIndex("decisionHistory", "by-project", projectId);
  return db.getAll("decisionHistory");
}

export async function exportStorageSnapshot(): Promise<unknown> {
  const db = await getDb();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: nowIso(),
    projects: await db.getAll("projects"),
    importReports: await db.getAll("importReports"),
    libraries: await db.getAll("libraries"),
    decisionHistory: await db.getAll("decisionHistory")
  };
}
