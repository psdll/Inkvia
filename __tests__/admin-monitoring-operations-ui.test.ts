import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("administrator controlled operations UI", () => {
  it("opens a shared confirmation dialog from service cards and polls every two seconds", () => {
    const panel = source("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const grid = source("components/admin/monitoring/ServiceStatusGrid.tsx");
    const dialog = source("components/admin/monitoring/MonitoringOperationDialog.tsx");

    expect(panel).toContain("MonitoringOperationDialog");
    expect(grid).toContain("onOperate");
    expect(dialog).toContain("FrostedSelect");
    expect(dialog).toContain("/api/admin/monitoring/v1/actions");
    expect(dialog).toContain("2_000");
    expect(dialog).toContain("crypto.randomUUID()");
    expect(dialog).toContain("fixed inset-0 !mt-0");
    expect(dialog).not.toMatch(/<select[\s>]/);
    expect(dialog).not.toMatch(/shell|sql|unit|serviceName|filePath/i);
  });

  it("keeps the controlled operation dialog opaque in the dark theme", () => {
    const dialog = source("components/admin/monitoring/MonitoringOperationDialog.tsx");

    expect(dialog).toContain(
      "max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]",
    );
    expect(dialog).not.toContain(
      "max-w-md rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)]",
    );
  });

  it("enables rotation and delete-plan/apply only through dedicated endpoints", () => {
    const drawer = source("components/admin/monitoring/LogManagementDrawer.tsx");

    expect(drawer).not.toContain("const operationsReady = false");
    expect(drawer).toContain("/api/admin/monitoring/v1/logs/rotate");
    expect(drawer).toContain("/api/admin/monitoring/v1/logs/delete-plan");
    expect(drawer).toContain("/api/admin/monitoring/v1/logs/delete-apply");
    expect(drawer).toContain("planId");
  });
});
