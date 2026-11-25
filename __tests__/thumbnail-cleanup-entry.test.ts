import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readChineseUiSource } from "./helpers/chinese-ui-source";

describe("thumbnail lifecycle entry points", () => {
  it("physically deletes a user asset instead of only marking the generation deleted", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/assets/[id]/route.ts"), "utf8");
    expect(route).not.toContain('data: { status: "deleted" }');
    expect(route).toContain("computeDeletableRefsForGenerationIds");
    expect(route).toContain("deleteGenerationRowsAndBatchCards");
    expect(route).toContain("deleteStoredMediaRefs");
  });

  it("exposes a reference-safe cleanup action for thumbnails already stored online", () => {
    const api = readFileSync(resolve(process.cwd(), "app/api/admin/storage/route.ts"), "utf8");
    const overview = readChineseUiSource(resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");
    const cleanup = readFileSync(resolve(process.cwd(), "lib/thumbnail-asset-cleanup.ts"), "utf8");

    for (const source of [api, overview, page]) {
      expect(source).toContain("cleanup_thumbnail_assets");
    }
    expect(overview).toContain("清理缩略图和孤立预览图");
    expect(cleanup).toContain('status: { not: "deleted" }');
    expect(cleanup).toContain("canvasNodeState.findMany");
    expect(cleanup).toContain('FROM "CanvasUndoMediaHold"');
  });
});
