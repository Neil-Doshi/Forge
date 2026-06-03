import { PROJECT_SCHEMA_VERSION, type HtmlForgeProject } from "./types";
import { isRecord } from "./utils";

export function isHtmlForgeProject(value: unknown): value is HtmlForgeProject {
  return isRecord(value) && value.schemaVersion === PROJECT_SCHEMA_VERSION && Array.isArray(value.pages) && typeof value.id === "string";
}

export function migrateProject(input: unknown): HtmlForgeProject {
  if (!isRecord(input)) throw new Error("Project file is not a JSON object.");
  const version = input.schemaVersion;
  if (version === PROJECT_SCHEMA_VERSION) {
    if (!isHtmlForgeProject(input)) throw new Error("Project file is missing required HTML Forge fields.");
    return input;
  }
  if (typeof version === "number" && version > PROJECT_SCHEMA_VERSION) {
    throw new Error(`This project uses schema ${version}. This build supports schema ${PROJECT_SCHEMA_VERSION}.`);
  }
  throw new Error("Unsupported or missing project schema version.");
}

export function migrateProjectV1ToV2(data: HtmlForgeProject): never {
  void data;
  throw new Error("Project schema v2 is not defined yet.");
}
