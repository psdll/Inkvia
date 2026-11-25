import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/canvas/page.tsx", "utf8");

describe("canvas list loading performance", () => {
  it("keeps the project workspace shell visible while auth and list data settle", () => {
    expect(page).toContain("const pagePending = authLoading;");
    expect(page).not.toContain("if (authLoading) return");
    expect(page).toContain("!pagePending && hasSettledInitialLoad && !loadError && visibleItems.length === 0");
    expect(page).toContain("(pagePending || (!hasSettledInitialLoad && loading)) &&");
  });

  it("coalesces duplicate development GETs for canvases without loading removed folder data", () => {
    const entry = readFileSync("lib/client/canvas-entry.ts", "utf8");
    expect(page).toContain("loadCanvasProjects(");
    expect(entry).toContain('import { fetchJsonOnce } from "./inflight-json"');
    expect(entry).toContain("if (pending) return pending;");
    expect(entry).toContain('`/api/canvas${trash ? "?trash=1" : ""}`, String(owner)');
    expect(page).not.toContain("ProjectListPayload");
    expect(page).not.toContain("/api/canvas/projects");
  });

  it("loads card previews through the shared thumbnail pipeline instead of eager originals", () => {
    expect(page).toContain('import { ResilientImage } from "@/components/ui/resilient-image"');
    expect(page).toContain('import { buildMediaPreviewCandidates } from "@/lib/media-url"');
    expect(page).toContain("buildMediaPreviewCandidates(canvas.thumbnail");
    expect(page).toContain("visibleItems.map((canvas, index) =>");
    expect(page).toContain('loading={index < 4 ? "eager" : "lazy"}');
    expect(page).toContain('fetchPriority={index === 0 ? "high" : "auto"}');
    expect(page).toContain('decoding="async"');
    expect(page).toContain("cacheInMemory={false}");
    expect(page).not.toContain("canvas.thumbnail ? <img src={canvas.thumbnail}");
  });
});
