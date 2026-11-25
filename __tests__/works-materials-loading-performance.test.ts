import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("works and materials loading performance", () => {
  it("bounds works prefetch to a few screens near the current viewport", () => {
    const source = read("app/works/page.tsx");

    expect(source).not.toContain("window.setTimeout(() => {\n      void loadMore();");
    expect(source).toContain("scrollHeight - el.scrollTop - el.clientHeight < lookahead");
  });

  it("does not prewarm the whole works collection or request oversized card thumbnails", () => {
    const source = read("app/works/page.tsx");

    expect(source).not.toContain("warmResilientImageCandidatesBatch");
    expect(source).not.toContain('getWarmParams("works")');
    expect(read("lib/client/works-entry.ts")).toContain("width: 600, height: 600");
    expect(source).not.toContain("width: 1280, height: 1280");
  });

  it("opens a material detail with the original media", () => {
    const source = read("app/materials/page.tsx");

    expect(source).toContain("currentMedia ? [materialMediaOriginalUrl(currentMedia)]");
    expect(source).not.toContain("materialMediaOriginalCandidates(currentMedia)");
  });

  it("uses a cancellable bounded queue for material thumbnails", () => {
    const source = read("app/materials/page.tsx");
    expect(source).toContain("subscribeMaterialPreview(candidates, priority");
    expect(source).not.toContain("warmResilientImageCandidatesBatch");
    expect(source).toContain("warmOnLoad={false}");
  });
});
