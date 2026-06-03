import { describe, expect, it } from "vitest";
import { sanitizeCss } from "../src/cssSafety";

describe("cssSafety", () => {
  it("blocks imports, remote resources, executable constructs, tokens, and keyframes", () => {
    const result = sanitizeCss(`
      @import url("https://example.invalid/a.css");
      :root { --brand: #0f766e; }
      @font-face { font-family: Remote; src: url("https://example.invalid/font.woff2"); }
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
      .card { background-image: url("https://example.invalid/card.png"); width: expression(alert(1)); }
    `);

    expect(result.css).not.toContain("@import");
    expect(result.css).not.toContain("https://example.invalid/card.png");
    expect(result.report.blockedImports).toContain("https://example.invalid/a.css");
    expect(result.report.blockedResources.length).toBeGreaterThanOrEqual(2);
    expect(result.report.blockedConstructs.some((item) => item.construct === "expression(...)")).toBe(true);
    expect(result.report.tokens).toContain("--brand");
    expect(result.report.keyframes).toContain("pulse");
  });
});
