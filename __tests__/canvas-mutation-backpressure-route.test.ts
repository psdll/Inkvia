import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas mutation route backpressure", () => {
  it("returns bounded 429 responses with Retry-After", () => {
    const source = readFileSync("app/api/canvas/[id]/mutations/route.ts", "utf8");
    expect(source).toContain("tryAcquireCanvasMutation");
    expect(source).toContain('status: 429');
    expect(source).toContain('"Retry-After"');
    expect(source).toContain("permit.release()");
  });

  it("rejects mutation writes without a live editor session", () => {
    const source = readFileSync("app/api/canvas/[id]/mutations/route.ts", "utf8");

    expect(source).toContain('req.headers.get("X-Canvas-Session-Id")?.trim()');
    expect(source).toMatch(/if \(!editorSessionId \|\| !await canvasEditorSessionMatches/);
    expect(source).toContain('code: "CANVAS_SESSION_EXPIRED"');
    expect(source).toContain('{ status: 409 }');
  });
});
