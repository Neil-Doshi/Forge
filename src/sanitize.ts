import DOMPurify from "dompurify";
import { sanitizeCss, mergeCssReports } from "./cssSafety";
import type { CssSafetyReport, SanitizationReport } from "./types";

const BLOCKED_TAGS = new Set(["script", "object", "embed", "base", "iframe"]);
const SAFE_DATA_ATTRIBUTES = new Set(["data-page", "data-page-id", "data-view", "data-target", "data-action"]);
const URL_ATTRIBUTES = new Set(["href", "src", "xlink:href", "action", "formaction", "poster"]);

export interface SanitizedDocument {
  html: string;
  css: string;
  previewHtml: string;
  report: SanitizationReport;
  cssReport: CssSafetyReport;
  resources: Array<{ url: string; type: "font" | "image" | "stylesheet" | "other"; context: string; decision: "blocked" | "ignored" | "fallback" | "local-supplied" }>;
}

export function createEmptySanitizationReport(): SanitizationReport {
  return {
    removedTags: {},
    removedAttributes: [],
    blockedUrls: [],
    quarantinedScripts: [],
    strippedEditorMetadata: 0
  };
}

export function isSafeDataAttribute(name: string): boolean {
  return SAFE_DATA_ATTRIBUTES.has(name) || name.startsWith("data-hf-");
}

export function isBlockedUrl(value: string): boolean {
  const trimmed = value.trim().replace(/[\u0000-\u001f\s]+/g, "");
  if (!trimmed) return false;
  if (/^javascript:/i.test(trimmed)) return true;
  if (/^vbscript:/i.test(trimmed)) return true;
  if (/^data:text\/html/i.test(trimmed)) return true;
  if (/^https?:/i.test(trimmed)) return true;
  if (/^\/\//.test(trimmed)) return true;
  return false;
}

function countRemovedTag(report: SanitizationReport, tag: string): void {
  report.removedTags[tag] = (report.removedTags[tag] ?? 0) + 1;
}

function resourceTypeFromContext(context: string): "font" | "image" | "stylesheet" | "other" {
  if (context.includes("stylesheet")) return "stylesheet";
  if (context.includes("font")) return "font";
  if (context.includes("img") || context.includes("image") || context.includes("poster")) return "image";
  return "other";
}

export function sanitizeImportedHtml(rawHtml: string): SanitizedDocument {
  const started = performance.now();
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");
  const report = createEmptySanitizationReport();
  const resources: SanitizedDocument["resources"] = [];
  const cssReports: CssSafetyReport[] = [];
  const sanitizedStyleBlocks: string[] = [];

  doc.querySelectorAll("script").forEach((script, index) => {
    report.quarantinedScripts.push({ type: "script", sample: script.textContent?.slice(0, 220) ?? "", location: `script[${index}]` });
  });

  doc.querySelectorAll("style").forEach((style) => {
    const result = sanitizeCss(style.textContent ?? "");
    style.textContent = result.css;
    sanitizedStyleBlocks.push(result.css);
    cssReports.push(result.report);
  });

  doc.querySelectorAll('link[rel~="stylesheet" i]').forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (href) {
      report.blockedUrls.push({ url: href, context: "link rel=stylesheet", reason: "External stylesheets are blocked." });
      resources.push({ url: href, type: "stylesheet", context: "link rel=stylesheet", decision: "blocked" });
    }
    countRemovedTag(report, "link[stylesheet]");
    link.remove();
  });

  doc.querySelectorAll(Array.from(BLOCKED_TAGS).join(",")).forEach((element) => {
    const tag = element.tagName.toLowerCase();
    countRemovedTag(report, tag);
    element.remove();
  });

  doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on")) {
        report.quarantinedScripts.push({ type: "handler", sample: value.slice(0, 220), location: `${element.tagName.toLowerCase()}[${name}]` });
        report.removedAttributes.push({ element: element.tagName.toLowerCase(), attribute: name, value, reason: "Inline event handlers are disabled." });
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name.startsWith("data-gjs-")) {
        report.strippedEditorMetadata += 1;
        report.removedAttributes.push({ element: element.tagName.toLowerCase(), attribute: name, reason: "Imported GrapesJS metadata is reserved." });
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name.startsWith("data-") && !isSafeDataAttribute(name)) {
        report.removedAttributes.push({ element: element.tagName.toLowerCase(), attribute: name, value, reason: "Unapproved imported data attribute." });
        element.removeAttribute(attribute.name);
        continue;
      }

      if (URL_ATTRIBUTES.has(name) && isBlockedUrl(value)) {
        const context = `${element.tagName.toLowerCase()}[${name}]`;
        report.blockedUrls.push({ url: value, context, reason: "Remote or executable URL blocked." });
        resources.push({ url: value, type: resourceTypeFromContext(context), context, decision: "blocked" });
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "target") {
        report.removedAttributes.push({ element: element.tagName.toLowerCase(), attribute: name, value, reason: "Navigation targets are disabled in safe preview." });
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "style") {
        const styleResult = sanitizeCss(value);
        cssReports.push(styleResult.report);
        if (styleResult.css.trim()) element.setAttribute("style", styleResult.css);
        else element.removeAttribute(attribute.name);
      }
    }
  });

  const bodyHtml = doc.body.innerHTML;
  const purified = DOMPurify.sanitize(bodyHtml, {
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: Array.from(BLOCKED_TAGS),
    FORBID_ATTR: ["srcdoc"],
    RETURN_TRUSTED_TYPE: false
  }) as string;

  const headStyle = sanitizedStyleBlocks.length ? `<style>${sanitizedStyleBlocks.join("\n")}</style>` : "";
  const previewHtml = `<!doctype html><html><head><meta charset="utf-8">${headStyle}</head><body>${purified}</body></html>`;

  const cssReport = mergeCssReports(...cssReports);
  const elapsed = Math.round(performance.now() - started);
  if (elapsed > 1200) {
    report.removedAttributes.push({ element: "document", attribute: "import-time", value: `${elapsed}ms`, reason: "Large import complexity noted." });
  }

  return {
    html: purified,
    css: sanitizedStyleBlocks.join("\n"),
    previewHtml,
    report,
    cssReport,
    resources: [
      ...resources,
      ...cssReport.blockedResources.map((resource) => ({
        url: resource.url,
        type: resourceTypeFromContext(resource.property),
        context: resource.property,
        decision: "blocked" as const
      }))
    ]
  };
}
