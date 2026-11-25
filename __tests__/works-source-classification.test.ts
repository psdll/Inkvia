import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

import { buildAssetSourceWhere, getAssetSourceLabel } from "@/lib/assets/source-filter";

const worksPageSource = readFileSync("app/works/page.tsx", "utf8");
const assetsRouteSource = readFileSync("app/api/assets/route.ts", "utf8");
const assetSourceSelectSource = readFileSync("components/ui/asset-source-select.tsx", "utf8");
const workDetailSource = readFileSync("components/works/work-detail-modal.tsx", "utf8");

describe("works source classification", () => {
  it("queries toolbox and canvas assets together without including agent assets", () => {
    expect(buildAssetSourceWhere("tool_canvas")).toEqual({
      AND: [
        { source: { in: ["tool", "canvas"] } },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
    expect(assetsRouteSource).toContain('if (source === "tool_canvas")');
    expect(assetsRouteSource).toContain('Prisma.join([...TOOL_CANVAS_ASSET_SOURCES])');
  });

  it("keeps exact source filters available", () => {
    expect(buildAssetSourceWhere("canvas")).toEqual({ source: "canvas" });
    expect(buildAssetSourceWhere("batch", "live_video")).toEqual({
      liveVideoBatchOutput: { isNot: null },
    });
    expect(buildAssetSourceWhere("tool")).toEqual({
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
  });

  it("maps stored source values to user-facing labels", () => {
    expect(getAssetSourceLabel("canvas")).toBe("画布");
    expect(getAssetSourceLabel("tool")).toBe("创作");
    expect(getAssetSourceLabel("agent")).toBe("Agent");
    expect(getAssetSourceLabel("custom-source")).toBe("custom-source");
    expect(getAssetSourceLabel(null)).toBe("其他");
  });

  it("binds the works page request and cache to the selected source", () => {
    expect(worksPageSource).toContain("AssetSourceFilterValue");
    expect(worksPageSource).toContain("applyAssetSourceFilterSearchParams(url.searchParams, sourceFilter)");
    expect(worksPageSource).toContain("getWorksCacheKey(userId, typeFilter, timeFilter, sourceFilter, orderCacheKey)");
    expect(worksPageSource).toContain("getWorksStorageKey(userId, typeFilter, timeFilter, sourceFilter, q)");
  });

  it("keeps source classification in the filter without overlaying labels on assets", () => {
    expect(worksPageSource).toContain('const [sourceFilter, setSourceFilter] = React.useState<AssetSourceFilterValue>(() => worksPreferences.get(userId)?.source || "creation");');
    expect(worksPageSource).toContain("<AssetSourceSelect");
    expect(worksPageSource).not.toContain('function sourceLabel(source: AssetItem["source"])');
    expect(worksPageSource).not.toContain("sourceLabel(it.source)");
    expect(assetSourceSelectSource).toContain("画布");
    expect(assetSourceSelectSource).toContain("创作");
  });

  it("shows the localized source only inside the work detail modal", () => {
    expect(workDetailSource).toContain("source?: string | null;");
    expect(workDetailSource).toContain("const sourceLabel = getAssetSourceLabel(item.source || item.params?.source, item.params);");
    expect(workDetailSource).toContain("{sourceLabel}");
    expect(workDetailSource).toContain('bp("来源", getAssetSourceLabel(item.source || p.source, p));');
  });
});
