import type { CssSafetyReport } from "./types";

const URL_PATTERN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const IMPORT_PATTERN = /@import\s+(?:url\()?\s*["']?([^"');]+)["']?\s*\)?[^;]*;/gi;
const FONT_FACE_PATTERN = /@font-face\s*{[^}]*}/gi;
const KEYFRAME_PATTERN = /@keyframes\s+([a-zA-Z0-9_-]+)/gi;
const TOKEN_PATTERN = /--([a-zA-Z0-9_-]+)\s*:/g;
const EXECUTABLE_PATTERNS = [
  { pattern: /expression\s*\(/gi, label: "expression(...)" },
  { pattern: /(?:^|[;{\s])behavior\s*:/gi, label: "behavior" },
  { pattern: /-moz-binding\s*:/gi, label: "-moz-binding" },
  { pattern: /paint\s*\(/gi, label: "paint(...)" },
  { pattern: /worklet/gi, label: "worklet" }
];

const URL_BEARING_PROPERTIES = [
  "background",
  "background-image",
  "content",
  "cursor",
  "border-image",
  "border-image-source",
  "list-style-image",
  "mask",
  "mask-image",
  "-webkit-mask",
  "-webkit-mask-image",
  "filter",
  "clip-path"
];

export interface CssSafetyOptions {
  allowDataUrls?: boolean;
  allowBlobUrls?: boolean;
  allowRelativeUrls?: boolean;
  approvedAssetPrefixes?: string[];
}

export interface CssSafetyResult {
  css: string;
  report: CssSafetyReport;
}

export function createEmptyCssReport(): CssSafetyReport {
  return {
    blockedImports: [],
    blockedResources: [],
    blockedConstructs: [],
    tokens: [],
    keyframes: []
  };
}

export function isSafeLocalUrl(url: string, options: CssSafetyOptions = {}): boolean {
  const trimmed = url.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return true;
  if (trimmed.startsWith("#")) return true;
  if (options.allowDataUrls !== false && /^data:(image|font|application\/font|application\/octet-stream)/i.test(trimmed)) return true;
  if (options.allowBlobUrls !== false && /^blob:/i.test(trimmed)) return true;
  if (options.approvedAssetPrefixes?.some((prefix) => trimmed.startsWith(prefix))) return true;
  if (options.allowRelativeUrls !== false && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith("//")) return true;
  return false;
}

export function sanitizeCss(input: string, options: CssSafetyOptions = {}): CssSafetyResult {
  const report = createEmptyCssReport();
  let css = input || "";

  css = css.replace(IMPORT_PATTERN, (match, resource: string) => {
    report.blockedImports.push(resource.trim());
    report.blockedResources.push({ url: resource.trim(), property: "@import", reason: "External stylesheet imports are blocked." });
    return "";
  });

  css = css.replace(FONT_FACE_PATTERN, (block) => {
    let blocked = false;
    const cleaned = block.replace(URL_PATTERN, (_match, _quote, url: string) => {
      if (isSafeLocalUrl(url, options)) return `url(${url})`;
      blocked = true;
      report.blockedResources.push({ url, property: "@font-face src", reason: "Remote font sources are blocked." });
      return "local(system-ui)";
    });
    return blocked ? cleaned : block;
  });

  for (const executable of EXECUTABLE_PATTERNS) {
    css = css.replace(executable.pattern, () => {
      report.blockedConstructs.push({ construct: executable.label, reason: "Executable or worklet CSS constructs are blocked." });
      return "/* blocked */";
    });
  }

  css = css.replace(/([a-zA-Z-]+)\s*:\s*([^;{}]+);?/g, (match, property: string, value: string) => {
    const normalized = property.toLowerCase();
    const hasUrl = URL_PATTERN.test(value);
    URL_PATTERN.lastIndex = 0;
    if (!hasUrl) return match;

    const sanitizedValue = value.replace(URL_PATTERN, (_urlMatch, _quote, url: string) => {
      if (isSafeLocalUrl(url, options)) return `url(${url})`;
      report.blockedResources.push({ url, property: normalized, reason: "Remote CSS resources are blocked by default." });
      return "none";
    });

    if (URL_BEARING_PROPERTIES.includes(normalized) && sanitizedValue.includes("none")) {
      return `${property}: ${sanitizedValue};`;
    }
    return `${property}: ${sanitizedValue};`;
  });

  for (const match of input.matchAll(TOKEN_PATTERN)) {
    const token = `--${match[1]}`;
    if (!report.tokens.includes(token)) report.tokens.push(token);
  }
  for (const match of input.matchAll(KEYFRAME_PATTERN)) {
    if (!report.keyframes.includes(match[1])) report.keyframes.push(match[1]);
  }

  return { css, report };
}

export function mergeCssReports(...reports: CssSafetyReport[]): CssSafetyReport {
  const merged = createEmptyCssReport();
  for (const report of reports) {
    merged.blockedImports.push(...report.blockedImports);
    merged.blockedResources.push(...report.blockedResources);
    merged.blockedConstructs.push(...report.blockedConstructs);
    for (const token of report.tokens) if (!merged.tokens.includes(token)) merged.tokens.push(token);
    for (const keyframe of report.keyframes) if (!merged.keyframes.includes(keyframe)) merged.keyframes.push(keyframe);
  }
  return merged;
}
