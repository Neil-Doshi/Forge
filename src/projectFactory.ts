import { PROJECT_SCHEMA_VERSION, type HtmlForgeProject } from "./types";
import { createId, generatedScreenId, nowIso, slugify } from "./utils";

export function createBlankProject(name = "Untitled HTML Forge Project"): HtmlForgeProject {
  const now = nowIso();
  const projectId = createId("project");
  const pageId = createId("page");
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: projectId,
    slug: slugify(name),
    name,
    createdAt: now,
    modifiedAt: now,
    revision: 1,
    lastWriterInstanceId: "local",
    storagePersistence: "unknown",
    pages: [
      {
        id: pageId,
        generatedId: generatedScreenId(0),
        name: "Home",
        slug: "home",
        html: '<main class="hf-start"><h1>New HTML Forge Project</h1><p>Edit this page visually, add screens, then connect behavior in the Connections workspace.</p><button data-hf-action="navigate">Start</button></main>',
        css: ".hf-start{min-height:420px;display:grid;place-content:center;gap:16px;text-align:center;font-family:Inter,system-ui,sans-serif}.hf-start button{justify-self:center;padding:12px 18px;border:0;border-radius:6px;background:#0f766e;color:white;font-weight:700}",
        notes: "",
        componentCount: 4,
        createdAt: now,
        modifiedAt: now
      }
    ],
    overlays: [],
    connections: [],
    sharedMasters: [],
    sharedInstances: [],
    libraryRefs: [],
    assets: [],
    notes: {}
  };
}
