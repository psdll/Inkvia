import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: () => null }));
import { UnifiedHistoryActions } from "@/components/history/unified-history-actions";

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("renders all active server statuses in Chinese and keeps their elapsed time ticking", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const now = new Date("2026-09-09T04:20:00Z").getTime();
  vi.setSystemTime(now);
  const statuses = ["processing", "submitted", "running", "queued", "pending", "success", "failed", "cancelled"];
  const tasks = statuses.map((status, index) => ({
    id: index + 1, type: "video_gen", status, localPath: null,
    createdAt: new Date(now - 120_000 - index).toISOString(),
    finishedAt: index >= 5 ? new Date(now - 60_000 - index).toISOString() : null,
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes("/summary") ? { inProgressCount: 5, completedCount: 3 } : { items: tasks },
  })));
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(React.createElement(UnifiedHistoryActions, {
    userId: "status-regression", historyRef: { current: null }, historyCount: 8, onFocusHistoryId: vi.fn(),
  })));
  await act(async () => {
    const trigger = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("任务进度"));
    trigger!.click();
  });
  const rows = Array.from(host.querySelectorAll(".task-progress-item"));
  expect(rows).toHaveLength(8);
  const labels = ["处理中", "已提交", "执行中", "排队中", "排队中", "已完成", "失败", "已取消"];
  rows.forEach((row, index) => {
    expect(row.textContent).toContain(labels[index]);
    expect(row.textContent).toContain(index < 5 ? "耗时: 2m 0s" : "耗时: 1m 0s");
    if (index < 3) expect(row.querySelector(".text-blue-600")?.textContent).toBe(labels[index]);
  });
  expect(host.textContent).toContain("清空队列 (5)");
  expect(host.textContent).toContain("已完成：3");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  rows.forEach((row, index) => {
    expect(row.textContent).toContain(index < 5 ? "耗时: 2m 1s" : "耗时: 1m 0s");
  });
});
