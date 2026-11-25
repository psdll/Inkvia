import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

import {
  applyAssetSourceFilterSearchParams,
  buildAssetSourceWhere,
  isAssetBatchMode,
  splitAssetSourceFilter,
} from "@/lib/assets/source-filter";

describe("asset source batch-mode filter", () => {
  it.each(["style_replication", "multi_prompt", "live_video"])("accepts %s", (mode) => {
    expect(isAssetBatchMode(mode)).toBe(true);
  });

  it("splits composite values into request parameters", () => {
    expect(splitAssetSourceFilter("batch:multi_prompt")).toEqual({
      source: "batch",
      batchMode: "multi_prompt",
    });
    const params = new URLSearchParams();
    applyAssetSourceFilterSearchParams(params, "batch:live_video");
    expect(params.toString()).toBe("source=batch&batchMode=live_video");
  });

  it("keeps the batch parent broad and children relation-backed", () => {
    expect(buildAssetSourceWhere("batch")).toEqual({
      OR: [
        { source: "batch" },
        { liveVideoBatchOutput: { isNot: null } },
      ],
    });
    expect(buildAssetSourceWhere("batch", "multi_prompt")).toEqual({
      batchOutput: { is: { batch: { mode: "multi_prompt" } } },
    });
    expect(buildAssetSourceWhere("tool")).toEqual({
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
  });

  it("renders one selectable parent and three indented children", () => {
    const source = readFileSync("components/ui/asset-source-select.tsx", "utf8");
    expect(source).toContain('value: "batch", label: "批量"');
    expect(source).toContain('buttonLabel: "批量 · 统一参考复刻"');
    expect(source).toContain('buttonLabel: "批量 · 自定义分批"');
    expect(source).toContain('buttonLabel: "批量 · Live 视频"');
    expect(source.match(/depth: 1/g) || []).toHaveLength(3);
  });

  it("renders Agent as an independent exact source", () => {
    const source = readFileSync("components/ui/asset-source-select.tsx", "utf8");
    expect(source).toContain('value: "agent", label: "Agent"');
    expect(buildAssetSourceWhere("agent")).toEqual({ source: "agent" });
  });
});
