import { describe, expect, it } from "vitest";
import { sanitizeImportedHtml } from "../src/sanitize";

describe("sanitizeImportedHtml", () => {
  it("quarantines scripts and handlers, strips unsafe URLs and data-gjs metadata", () => {
    const result = sanitizeImportedHtml(`
      <base href="https://evil.invalid/">
      <div data-gjs-type="spoof" data-page="home" onclick="alert(1)" style="background:url(https://evil.invalid/x.png)">Hello</div>
      <a href="javascript:alert(1)">Bad</a>
      <iframe src="https://evil.invalid"></iframe>
      <script>alert("run")</script>
    `);

    expect(result.html).toContain("data-page=\"home\"");
    expect(result.html).not.toContain("data-gjs");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("<script");
    expect(result.report.quarantinedScripts.length).toBeGreaterThanOrEqual(2);
    expect(result.report.strippedEditorMetadata).toBe(1);
    expect(result.report.removedTags.iframe).toBe(1);
    expect(result.cssReport.blockedResources.length).toBeGreaterThanOrEqual(1);
  });
});
