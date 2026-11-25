import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/canvas/page.tsx"), "utf8");

describe("canvas independent browser tabs", () => {
  it("opens an existing canvas card in a new tab", () => {
    expect(source).toContain('`/canvas/${canvas.publicId}`');
    expect(source).toContain('target={trash ? undefined : "_blank"}');
    expect(source).toContain('rel={trash ? undefined : "noopener noreferrer"}');
  });

  it("creates a canvas through a synchronously opened tab", () => {
    expect(source).toContain('const pendingTab = window.open("", "_blank");');
    expect(source).toContain("pendingTab.opener = null;");
    expect(source).toContain('pendingTab.location.replace(`/canvas/${payload.publicId}`);');
    expect(source).not.toContain("window.location.assign");
  });
});
