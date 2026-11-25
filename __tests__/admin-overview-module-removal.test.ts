import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"), "utf8");

describe("admin overview module removal", () => {
  it("does not retain the removed output-storage comparison or trend modules", () => {
    expect(source).not.toContain("用户产出/磁盘对比");
    expect(source).not.toContain("趋势与结构");
    expect(source).not.toContain("const imbalanceUsers =");
    expect(source).not.toContain("const trend30 =");
    expect(source).not.toContain("const trendMaxGeneration =");
    expect(source).not.toContain("const trendMaxStorage =");
    expect(source).not.toContain("const typeDistribution =");
  });
});
