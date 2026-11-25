import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"), "utf8");
const pageSource = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");

describe("user analysis module removal", () => {
  it("removes the data-caliber and billing-distribution UI paths", () => {
    expect(panelSource).not.toContain("数据口径");
    expect(panelSource).not.toContain("计费状态分布");
    expect(panelSource).not.toContain("计费模块分布");
    expect(panelSource).not.toContain("billingStatusItems:");
    expect(panelSource).not.toContain("billingModuleItems:");
    expect(pageSource).not.toContain("const billingStatusItems = React.useMemo");
    expect(pageSource).not.toContain("const billingModuleItems = React.useMemo");
    expect(pageSource).not.toContain("billingStatusItems={billingStatusItems}");
    expect(pageSource).not.toContain("billingModuleItems={billingModuleItems}");
  });
});
