import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readChineseUiSource(path.join(process.cwd(), relativePath), "utf8");
}

describe("administrator monitoring navigation", () => {
  it("adds monitoring without moving monitoring logic into the admin page", () => {
    const header = read("components/admin/AdminTopHeader.tsx");
    const page = read("app/admin/page.tsx");

    expect(header).toContain('"monitoring"');
    expect(header).toContain('label="系统监控"');
    expect(page).toContain("<AdminMonitoringPanel");
    expect(page).toContain("AdminMonitoringPanelHandle");
    expect(page).not.toContain("host.cpu.percent");
  });

  it("defines five URL-addressable monitoring views", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const subnav = read("components/admin/monitoring/MonitoringSubnav.tsx");

    for (const view of ["overview", "services", "logs", "reliability", "alerts"]) {
      expect(`${panel}\n${subnav}`).toContain(`"${view}"`);
    }
    expect(panel).toContain('searchParams.get("view")');
    expect(panel).toContain('params.set("tab", "monitoring")');
  });
});
