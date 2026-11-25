import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getAssetSourceLabel, resolveAssetSource } from "@/lib/assets/source-filter";
import { buildHistorySourceWhere } from "@/lib/history/source-filter";

describe("live video batch source isolation", () => {
  it("labels Live video generations as their concrete batch-workbench mode", () => {
    expect(getAssetSourceLabel("batch", { batch: { mode: "live_video" } })).toBe(
      "批量 · 批量生成视频用于 Live",
    );
    expect(resolveAssetSource("tool", { batch: { mode: "live_video" } })).toBe("batch");
  });

  it("enriches user assets and administrator works from the durable Live relation", () => {
    const assetsRoute = readFileSync("app/api/assets/route.ts", "utf8");
    const adminWorks = readFileSync("lib/admin-user-works.ts", "utf8");

    for (const source of [assetsRoute, adminWorks]) {
      expect(source).toContain("prisma.liveVideoBatchOutput.findMany");
      expect(source).toContain('attachAssetBatchMode');
      expect(source).toContain('resolveAssetSource');
      expect(source).toContain('"live_video"');
    }
  });

  it("excludes legacy Live relations from toolbox history without a deployment-time data rewrite", () => {
    const historyRoute = readFileSync("app/api/history/route.ts", "utf8");

    expect(historyRoute).toContain("buildHistorySourceWhere");
    expect(buildHistorySourceWhere("tool")).toEqual({
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
  });

  it("invalidates toolbox history caches created before the source split", () => {
    const history = readFileSync(
      "components/history/unified-history-panel.tsx",
      "utf8",
    );

    expect(history).toContain("studio_history_cache_v5_");
    expect(history).not.toContain("studio_history_cache_v4_");
  });
});
