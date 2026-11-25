import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadAdminAnalysisTrends } from "@/lib/admin/analysis-aggregates";

const panelSource = readFileSync(
  resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "app/api/admin/user/route.ts"),
  "utf8",
);

describe("user analysis log trend", () => {
  it("shows warning and error levels instead of the disconnected system category", () => {
    expect(panelSource).toContain('{ key: "warning", label: "警告"');
    expect(panelSource).toContain('{ key: "error", label: "错误"');
    expect(panelSource).not.toContain('{ key: "system", label: "系统"');
    expect(panelSource).toContain("警告或错误升高：优先排查对应日期的失败原因。");
  });

  it("aggregates warning and error counts independently of known log categories", async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: BigInt(0) }]).mockResolvedValueOnce([
      { day: "2026-09-30", category: "generation", level: "warning", count: BigInt(3) },
      { day: "2026-09-30", category: "unknown", level: "warning", count: BigInt(2) },
      { day: "2026-09-30", category: "api", level: "error", count: BigInt(4) },
      { day: "2026-09-30", category: "unknown", level: "info", count: BigInt(8) },
    ]).mockResolvedValueOnce([]);
    const result = await loadAdminAnalysisTrends({
      authUserId: 7, requestedUserId: "7", linkedGuestUserIds: [], logWhere: { userId: "7" },
    } as any, new Date("2026-09-30T12:00:00Z"), { $queryRaw: query } as any);
    expect(result.dailyByCategory).toEqual({
      generation: { "2026-09-30": 3 }, warning: { "2026-09-30": 5 },
      api: { "2026-09-30": 4 }, error: { "2026-09-30": 4 },
    });
    expect(routeSource).toContain("loadAdminAnalysisTrends(scopeInfo, modelFailureNow)");
    expect(routeSource).toContain("dailyByCategory: logDailyByCategory");
  });
});
