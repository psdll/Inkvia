import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");
const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"), "utf8");

describe("user analysis model success-rate UI", () => {
  it("passes the API periods into the analysis panel", () => {
    expect(pageSource).toContain("modelFailurePeriods?: ModelFailurePeriod[]");
    expect(pageSource).toContain("modelFailurePeriods={payload.analytics?.modelFailurePeriods || []}");
  });

  it("keeps the redesigned analysis surfaces on the project theme", () => {
    const styles = readFileSync(resolve(process.cwd(), "components/admin/user-analysis.module.css"), "utf8");
    for (const token of ["--panel-bg", "--panel-2", "--border", "--app-fg", "--app-muted", "--primary-bg"]) expect(styles).toContain(token);
    expect(styles).not.toMatch(/background(?:-color)?:\s*(?:#|rgb|hsl)/);
    expect(panelSource).toContain('aria-label="近期分析统计周期"');
  });
});
