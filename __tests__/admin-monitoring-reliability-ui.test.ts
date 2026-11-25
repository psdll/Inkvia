import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readChineseUiSource(path.join(process.cwd(), relativePath), "utf8");
}

describe("monitoring reliability UI", () => {
  it("renders cost, provider, capacity, and release evidence without invented certainty", () => {
    const panel = read("components/admin/monitoring/ReliabilityCenter.tsx");
    const shell = read("components/admin/monitoring/AdminMonitoringPanel.tsx");

    expect(panel).toContain("真实成本");
    expect(panel).toContain("估算成本");
    expect(panel).toContain("未定价调用");
    expect(panel).toContain("供应商健康");
    expect(panel).toContain("容量趋势");
    expect(panel).toContain("发布前后");
    expect(panel).toContain("样本不足");
    expect(panel).toContain("FrostedSelect");
    expect(panel).toContain("DateRangePicker");
    expect(panel).toContain("useRefreshFeedback");
    expect(panel).not.toMatch(/<select[\s>]/);
    expect(shell).toContain("<ReliabilityCenter");
  });

  it("uses the four bounded reliability endpoints", () => {
    const panel = read("components/admin/monitoring/ReliabilityCenter.tsx");

    expect(panel).toContain("/api/admin/monitoring/v1/costs");
    expect(panel).toContain("/api/admin/monitoring/v1/providers");
    expect(panel).toContain("/api/admin/monitoring/v1/capacity");
    expect(panel).toContain("/api/admin/monitoring/v1/deployments");
    expect(panel).not.toContain("userId=");
  });
});
