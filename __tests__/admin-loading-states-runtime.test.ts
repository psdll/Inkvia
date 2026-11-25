/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/media-image", () => ({ MediaImage: () => null }));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: ({ value, options, onChange, ariaLabel }: any) => React.createElement("select", { value, "aria-label": ariaLabel, onChange: (e: any) => onChange(e.target.value) }, options.map((o: any) => React.createElement("option", { key: o.value, value: o.value }, o.label))) }));
import FeedbackCenterPanel, { type FeedbackCenterPanelHandle } from "@/components/admin/FeedbackCenterPanel";
import { AlertsCenter } from "@/components/admin/monitoring/AlertsCenter";
import ModelReliabilityPanel from "@/components/admin/ModelReliabilityPanel";
let root: Root; let host: HTMLDivElement; let fetchMock: ReturnType<typeof vi.fn>;
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const text = () => host.textContent || "";

describe("administrator asynchronous state", () => {
  it("shows feedback failure with retry, then distinguishes a genuinely empty response", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "服务暂不可用" }, false)).mockResolvedValueOnce(response({ items: [] }));
    await act(async () => root.render(React.createElement(FeedbackCenterPanel, { openDetailZoom: vi.fn(), onRequestDeleteFeedback: vi.fn() })));
    expect(text()).toContain("服务暂不可用"); expect(text()).not.toContain("暂无反馈记录");
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "重试")!.click());
    expect(text()).toContain("暂无反馈记录"); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("preserves loaded feedback and draft replies when a refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [{ id: 1, createdAt: "2026-09-07", userId: "test", username: "测试", feedbackType: "bug", content: "需要保留的反馈", attachments: [] }] })).mockRejectedValueOnce(new Error("网络中断"));
    const ref = React.createRef<FeedbackCenterPanelHandle>();
    await act(async () => root.render(React.createElement(FeedbackCenterPanel, { ref, openDetailZoom: vi.fn(), onRequestDeleteFeedback: vi.fn() })));
    const input = host.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "未提交的回复"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => ref.current!.refresh());
    expect(text()).toContain("需要保留的反馈"); expect(text()).toContain("网络中断"); expect(host.querySelector("textarea")?.value).toBe("未提交的回复");
  });
  it("does not treat malformed feedback data as an empty list", async () => {
    fetchMock.mockResolvedValue(response(null));
    await act(async () => root.render(React.createElement(FeedbackCenterPanel, { openDetailZoom: vi.fn(), onRequestDeleteFeedback: vi.fn() })));
    expect(text()).toContain("反馈数据不完整"); expect(text()).not.toContain("暂无反馈记录");
  });
  it("withholds the no-alert conclusion until the first response completes", async () => {
    let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(React.createElement(AlertsCenter)));
    expect(text()).toContain("正在读取告警"); expect(text()).not.toContain("当前没有需要处理的告警"); expect(text()).not.toContain("当前未接入外部");
    await act(async () => resolve(response({ alerts: [], supported: true, externalState: "healthy" })));
    expect(text()).toContain("当前没有需要处理的告警");
  });
  it.each([response({ error: "查询失败" }, false), response({ alerts: [], projectError: "读取超时" })])("does not declare healthy after a failed first alert read", async (reply) => {
    fetchMock.mockResolvedValue(reply);
    await act(async () => root.render(React.createElement(AlertsCenter)));
    expect(text()).toContain("告警状态暂时无法确认"); expect(text()).not.toContain("当前没有需要处理的告警");
  });
  it("retains existing alerts after a failed refresh and recovers on the next read", async () => {
    vi.useFakeTimers();
    const alert = { fingerprint: "test-disk", name: "disk", component: "disk", summary: "磁盘空间告警", severity: "warning", state: "firing", startedAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z", labels: {}, annotations: {} };
    fetchMock.mockResolvedValueOnce(response({ alerts: [alert], supported: true, externalState: "healthy" })).mockRejectedValueOnce(new Error("请求超时")).mockResolvedValueOnce(response({ alerts: [], supported: true, externalState: "healthy" }));
    try {
      await act(async () => root.render(React.createElement(AlertsCenter)));
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(text()).toContain("磁盘空间告警"); expect(text()).toContain("请求超时");
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(text()).toContain("当前没有需要处理的告警"); expect(text()).not.toContain("请求超时");
    } finally { vi.useRealTimers(); }
  });
  it("uses neutral selection, distinguishes zero failures from no completed calls", async () => {
    fetchMock.mockResolvedValue(response({ generatedAt: "2026-09-07", periods: [
      { key: "today", label: "今天", failedCount: 0, completedCount: 10, failureRate: 0, unavailableRawErrorCount: 0, series: [], models: [], errors: [] },
      { key: "last3Days", label: "近 3 天", failedCount: 2, completedCount: 10, failureRate: 20, unavailableRawErrorCount: 0, series: [], models: [], errors: [] },
      { key: "last7Days", label: "近 7 天", failedCount: 0, completedCount: 0, failureRate: 0, unavailableRawErrorCount: 0, series: [], models: [], errors: [] },
    ] }));
    await act(async () => root.render(React.createElement(ModelReliabilityPanel)));
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs[0].textContent).toContain("0.0%"); expect(tabs[0].querySelector(".text-rose-600")).toBeNull(); expect(tabs[0].className).not.toContain("rose");
    expect(tabs[1].querySelector(".text-rose-600")).not.toBeNull();
    expect(tabs[2].textContent).toContain("暂无已完成调用"); expect(tabs[2].textContent).not.toContain("0.0%");
  });
});
