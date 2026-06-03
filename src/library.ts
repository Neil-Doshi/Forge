import { PROJECT_SCHEMA_VERSION, type HtmlForgeProject, type LibraryItem } from "./types";
import { createId, nowIso, slugify } from "./utils";

export function fingerprintMarkup(html = "", css = ""): string {
  const normalized = `${html}|${css}`.replace(/\s+/g, " ").trim();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(36)}`;
}

export function suggestLibraryItems(project: HtmlForgeProject): LibraryItem[] {
  const items: LibraryItem[] = [];
  const now = nowIso();
  const structuralGroups = new Map<string, { count: number; html: string; css: string; name: string }>();

  for (const page of project.pages) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(page.html, "text/html");
    doc.querySelectorAll("header,nav,aside,.topbar,.sidebar,.card,.panel").forEach((element) => {
      const html = element.outerHTML;
      const fingerprint = fingerprintMarkup(html.replace(/>[^<]{1,80}</g, "><"), page.css.slice(0, 400));
      const current = structuralGroups.get(fingerprint) ?? { count: 0, html, css: page.css, name: element.getAttribute("aria-label") || element.className?.toString() || element.tagName };
      current.count += 1;
      structuralGroups.set(fingerprint, current);
    });
  }

  structuralGroups.forEach((group, fingerprint) => {
    if (group.count < 2) return;
    items.push({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: createId("library"),
      scope: "review",
      name: `${slugify(group.name).replace(/-/g, " ")} pattern`,
      category: "component",
      html: group.html,
      css: group.css,
      fingerprint,
      createdAt: now,
      modifiedAt: now
    });
  });

  const themeTokens = Array.from(new Set(project.pages.flatMap((page) => Array.from(page.css.matchAll(/--[a-zA-Z0-9_-]+/g), (match) => match[0]))));
  if (themeTokens.length) {
    items.push({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: createId("library"),
      scope: "project",
      name: `${project.name} theme tokens`,
      category: "theme",
      css: themeTokens.join("\n"),
      fingerprint: fingerprintMarkup("", themeTokens.join("|")),
      createdAt: now,
      modifiedAt: now
    });
  }

  return items;
}
