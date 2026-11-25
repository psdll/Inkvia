import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OPS_STATUS_SERVICE_IDS } from "@/lib/monitoring/ops-client";

function read(relativePath: string) {
  return readChineseUiSource(path.join(process.cwd(), relativePath), "utf8");
}

const UI_FILES = [
  "components/admin/monitoring/AdminMonitoringPanel.tsx",
  "components/admin/monitoring/LogsExplorer.tsx",
  "components/admin/monitoring/LogDetailsDrawer.tsx",
  "components/admin/monitoring/TraceDetailsDrawer.tsx",
  "components/admin/monitoring/LogManagementDrawer.tsx",
  "components/admin/monitoring/AlertsCenter.tsx",
  "components/admin/monitoring/MonitoringLogsCenter.tsx",
  "components/admin/monitoring/ServerEventsExplorer.tsx",
];

describe("monitoring logs and alerts UI", () => {
  it("uses bounded shared filters and a virtualized realtime log list", () => {
    const logs = read(UI_FILES[1]);

    expect(logs).toContain("Virtuoso");
    expect(logs).toContain("itemContent");
    expect(logs).toContain("followOutput");
    expect(logs).toContain("FrostedSelect");
    expect(logs).toContain("DateRangePicker");
    expect(logs).toContain("controllerRef.current === controller");
    expect(logs).toContain("实时刷新");
    expect(logs).toContain("useRefreshFeedback");
    for (const service of OPS_STATUS_SERVICE_IDS) {
      expect(logs).toContain(`value: "${service}"`);
    }
    expect(logs).not.toMatch(/<select[\s>]/);
    expect(logs).not.toContain("LogQL");
  });

  it("separates project logs from administrator-readable server events", () => {
    const center = read(UI_FILES[6]);
    const events = read(UI_FILES[7]);

    expect(center).toContain("项目日志");
    expect(center).toContain("服务器事件");
    expect(center).toContain("<LogsExplorer");
    expect(center).toContain("<ServerEventsExplorer");
    expect(events).toContain("/api/admin/monitoring/v1/server-events");
    expect(events).toContain("DateRangePicker");
    expect(events).toContain("FrostedSelect");
    expect(events).toContain("controllerRef.current === controller");
    expect(events).toContain("最近 7 天");
    expect(events).toContain("useRefreshFeedback");
    expect(events).toContain("历史记录覆盖不完整");
    expect(events).toContain("检查时确认已恢复");
    expect(events).not.toContain("已于 ${formatDateTime(event.recoveredAt)} 恢复");
    expect(events).toContain("查看技术证据");
    expect(events).toContain("服务器事件仅在生产服务器启用");
    expect(events).not.toMatch(/<select[\s>]/);
  });

  it("links logs to trace details and exposes only controlled log management", () => {
    const details = read(UI_FILES[2]);
    const trace = read(UI_FILES[3]);
    const management = read(UI_FILES[4]);

    expect(details).toContain("TraceDetailsDrawer");
    expect(details).toContain("trace_id");
    expect(trace).toContain("/api/admin/monitoring/v1/traces/");
    expect(management).toContain("立即轮转");
    expect(management).toContain("只删除已轮转旧日志");
    expect(management).toContain("不删除当前日志");
    expect(management).toContain("数据库业务日志");
    expect(management).toContain("普通 15 天");
    expect(management).toContain("错误 30 天");
    expect(management).toContain("管理员审计 180 天");
    expect(details).toContain("fixed inset-0 !mt-0");
    expect(trace).toContain("fixed inset-0 !mt-0");
    expect(management).toContain("fixed inset-0 !mt-0");
    expect(management).not.toMatch(/name=["']path|path\s*:/);
  });

  it("uses the solid panel surface for the log management drawer", () => {
    const management = read(UI_FILES[4]);

    expect(management).toMatch(/max-w-lg[^"]*bg-\[var\(--panel-bg\)\]/);
    expect(management).not.toMatch(/max-w-lg[^"]*bg-\[var\(--sidebar-bg\)\]/);
  });

  it("supports acknowledgement, bounded silence, recovery state, and diagnostic download", () => {
    const alerts = read(UI_FILES[5]);
    const panel = read(UI_FILES[0]);

    expect(alerts).toContain("/alerts/acknowledge");
    expect(alerts).toContain("/alerts/silence");
    expect(alerts).toContain("确认告警");
    expect(alerts).toContain("静默");
    expect(alerts).toContain("已恢复");
    expect(alerts).toContain("首次发生时间");
    expect(alerts).toContain("最近观察时间");
    expect(alerts).toContain("恢复时间");
    expect(alerts).toContain("持续时间");
    expect(alerts).toContain("自动删除时间");
    expect(alerts).toContain("externalState");
    expect(alerts).toContain("15_000");
    expect(alerts).toContain("useRefreshFeedback");
    expect(alerts).toContain("supportsAcknowledge");
    expect(alerts).toContain("supportsSilence");
    expect(alerts).toContain("FrostedSelect");
    expect(alerts).not.toMatch(/<select[\s>]/);
    expect(alerts).not.toContain("dark:bg-[#");
    expect(alerts).toContain("/reports/diagnostic");
    expect(panel).toContain("<MonitoringLogsCenter");
    expect(panel).toContain("<AlertsCenter");
  });
});
