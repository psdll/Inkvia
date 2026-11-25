import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const overviewSource = readFileSync(
  resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"),
  "utf8",
);
const panelSource = readFileSync(
  resolve(process.cwd(), "components/admin/ModelReliabilityPanel.tsx"),
  "utf8",
);

describe("admin model reliability UI", () => {
  it("adds the isolated platform reliability panel to the overview", () => {
    expect(overviewSource).toContain(
      'import ModelReliabilityPanel from "@/components/admin/ModelReliabilityPanel"',
    );
    expect(overviewSource).toContain("<ModelReliabilityPanel />");
  });

  it("shows the requested periods, failure curve, raw errors, and complete model table", () => {
    expect(panelSource).toContain("全平台模型稳定性");
    expect(panelSource).toContain("今天");
    expect(panelSource).toContain("近 3 天");
    expect(panelSource).toContain("近 7 天");
    expect(panelSource).toContain("失败率趋势");
    expect(panelSource).toContain("真实平台错误");
    expect(panelSource).toContain("历史记录未保留上游原文");
    expect(panelSource).toContain("本周期无完成调用");
  });

  it("keeps the complete reliability layout mounted while data is loading", () => {
    expect(panelSource).toContain("EMPTY_RELIABILITY_PERIODS");
    expect(panelSource).toContain(
      "const periods = data?.periods.length ? data.periods : EMPTY_RELIABILITY_PERIODS;",
    );
    expect(panelSource).not.toContain("!data || !activePeriod ? (");
  });

  it("uses the shared activity chart while keeping rates distinct from counts", () => {
    expect(panelSource).toContain("<AdminActivityChart");
    expect(panelSource).toContain('initialType="line"');
    expect(panelSource).toContain("rate: point.failureRate");
    expect(panelSource).toContain("showTotal={false}");
    expect(panelSource).toContain("allowCumulative={false}");
  });

  it("uses the project theme contract for ordinary surfaces", () => {
    expect(panelSource).toContain("var(--panel-bg)");
    expect(panelSource).toContain("var(--panel-2)");
    expect(panelSource).toContain("var(--border)");
    expect(panelSource).toContain("var(--app-fg)");
    expect(panelSource).toContain("var(--app-muted)");
  });
});
