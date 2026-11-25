/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertsCenter } from "@/components/admin/monitoring/AlertsCenter";
import type { MonitoringAlert } from "@/lib/monitoring/fault-guidance";

vi.mock("@/components/ui/frosted-select", () => ({
  FrostedSelect: ({ options, onChange, ariaLabel }: any) => React.createElement("div", { "aria-label": ariaLabel },
    options.map((option: any) => React.createElement("button", {
      key: option.value, onClick: () => onChange(option.value),
    }, option.label))),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const alert: MonitoringAlert = {
  fingerprint: "abcdef0123456789", source: "alertmanager", name: "CanvasProjectionMismatch",
  summary: "Canvas 投影数据不一致", description: "", component: "canvas", severity: "critical",
  state: "firing", startsAt: "2026-10-13T09:00:00.000Z", endsAt: "2026-10-13T11:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z", labels: {}, silenceIds: [],
  supportsAcknowledge: true, supportsSilence: true,
};
let current: MonitoringAlert;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchMock: ReturnType<typeof vi.fn>;
let rejectAction: boolean;

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button, `missing button: ${label}`).toBeTruthy();
  await act(async () => button!.click());
}

beforeEach(async () => {
  vi.useFakeTimers();
  current = { ...alert };
  rejectAction = false;
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      if (rejectAction) return Response.json({ error: "请求来源无效" }, { status: 403 });
      current = { ...current, state: url.endsWith("acknowledge") ? "acknowledged" : "silenced" };
      return Response.json({ success: true });
    }
    return Response.json({ supported: true, externalState: "healthy", alerts: [current] });
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(AlertsCenter)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("alert actions and dismissal", () => {
  it.each([
    ["确认告警", "acknowledge", "已确认"],
    ["静默", "silence", "已静默"],
  ])("removes an alert after %s and preserves it in its state filter", async (label, action, filter) => {
    expect(host.querySelectorAll("article")).toHaveLength(1);
    await click(label);
    expect(host.querySelectorAll("article")).toHaveLength(0);
    expect(host.textContent).toContain("当前没有需要处理的告警");
    const request = fetchMock.mock.calls.find(([url]) => url.endsWith(action));
    expect(JSON.parse(request![1].body)).toMatchObject({ fingerprint: alert.fingerprint });

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(host.querySelectorAll("article")).toHaveLength(0);
    await click(filter);
    expect(host.querySelector("article")?.textContent).toContain(alert.summary);
    await click("全部状态");
    expect(host.querySelectorAll("article")).toHaveLength(1);
  });

  it("keeps a failed action visible until dismissed without hiding the unhandled alert", async () => {
    rejectAction = true;
    await click("确认告警");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("操作失败：请求来源无效");
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("上次读取");
    expect(host.querySelectorAll("article")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click("关闭错误提示");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll("article")).toHaveLength(1);
    rejectAction = false;
    await click("确认告警");
    expect(host.querySelectorAll("article")).toHaveLength(0);
  });

  it("returns an expired silence to the pending list on refresh", async () => {
    await click("静默");
    expect(host.querySelectorAll("article")).toHaveLength(0);
    current = { ...current, state: "firing" };
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(host.querySelectorAll("article")).toHaveLength(1);
  });
});
