import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/assets/route.ts", "utf8");
const page = readFileSync("app/works/page.tsx", "utf8");

describe("asset batch-mode API filtering", () => {
  it("validates and applies batchMode before count and pagination", () => {
    expect(route).toContain('searchParams.get("batchMode")');
    expect(route).toContain('return NextResponse.json({ error: "invalid batchMode" }, { status: 400 })');
    expect(route).toContain('INNER JOIN "ImageBatch"');
    expect(route).toContain('FROM "LiveVideoBatchOutput"');
    expect(route.lastIndexOf("buildAssetFilters({")).toBeLessThan(route.indexOf("countAssets(sqlWhere)"));
    expect(route.lastIndexOf("buildAssetFilters({")).toBeLessThan(route.lastIndexOf("fetchPagedRows(where"));
  });

  it("keys requests and caches by the composite filter value", () => {
    expect(page).toContain("AssetSourceFilterValue");
    expect(page).toContain("applyAssetSourceFilterSearchParams(url.searchParams, sourceFilter)");
    expect(page).toContain("<AssetSourceSelect");
    expect(page).not.toContain('{ value: "batch", label: "批量" }');
  });
});
