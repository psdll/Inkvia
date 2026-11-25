import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const pageSource = readSource("app/admin/page.tsx");
const routeSource = readSource("app/api/admin/user/route.ts");
const panelSource = readSource("components/admin/UserAnalysisPanel.tsx");

describe("admin user analysis progressive loading", () => {
  it("returns the profile summary before requesting detailed analysis", () => {
    expect(pageSource).toContain('url.searchParams.set("section", "profile")');
    expect(pageSource).toContain('detailsUrl.searchParams.set("section", "analysis")');
    expect(pageSource).toContain("analysisDetailsIncluded");
    expect(pageSource).toContain("mergeAdminUserAnalysisPayload");
  });

  it("does not run detailed analytics for the profile summary request", () => {
    expect(routeSource).toContain('const includeAnalysisDetails = section === "full" || section === "analysis"');
    expect(routeSource).toContain("includeAnalysisDetails\n    ? loadAdminAnalysisTrends(scopeInfo, modelFailureNow)");
    expect(routeSource).toContain("analysisDetailsIncluded: includeAnalysisDetails");
  });

  it("does not make user analysis depend on prompt preset initialization", () => {
    expect(routeSource).toContain(
      'const includePresetDetail = section === "full" || section === "presets";',
    );
    expect(routeSource).not.toContain(
      'section === "presets" || section === "analysis"',
    );
  });

  it("computes active days from detailed generation dates instead of reporting zero", () => {
    expect(routeSource).toContain("daily14, activeDays, modelFailurePeriods");
    expect(routeSource).not.toContain("activeGenerationDatesPromise");
  });

  it("cancels stale detail requests when the selected user changes", () => {
    expect(pageSource).toContain("analysisDetailAbortRef.current?.abort()");
    expect(pageSource).toContain("if (requestSeq !== loadUserSeqRef.current) return");
    expect(pageSource).toContain("if (!details || controller.signal.aborted) return;");
    expect(pageSource).not.toContain("signal: controller.signal");
  });

  it("keeps the overview visible while details load and hides empty advanced modules", () => {
    expect(panelSource).toContain("detailsLoading?: boolean");
    expect(panelSource).toContain("正在补充模型、日志与存储明细");
    expect(panelSource).toContain("更多分析");
    expect(panelSource).not.toContain("<CompactEmptyGroup />");
  });
});
