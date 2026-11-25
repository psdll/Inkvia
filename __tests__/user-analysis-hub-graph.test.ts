/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import UserAnalysisPanel from "@/components/admin/UserAnalysisPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = React.ComponentProps<typeof UserAnalysisPanel>;
const account: NonNullable<Props["account"]> = {
  requestedUserId: "auth:3", authUserId: 3, username: "测试用户", deviceCount: 1,
  registeredAt: "2026-09-28T08:00:00Z", lastGenerationAt: "2026-09-29T08:00:00Z",
  activeDays: 29, totalGenerationRecords: 1102, generatedRecords: 1060, importRecords: 42,
  logRecords: 1517, feedbackRecords: 0, privateLibraryItems: 6, privateLibraryBytes: 1024,
  billingRecords: 1191, billingAmount: 3233.643, agentConversations: 0, agentMessages: 0,
  agentRuns: 0, agentInputTokens: 0, agentOutputTokens: 0, agentAvgLatencyMs: 0,
  activeMemories: 0, totalMemories: 0,
};
const defaults: Props = {
  account,
  overview: { totalRecordCount: 1102, totalSuccessCount: 100, totalFailedCount: 0, uploads: 42, outputs: 1059, successRate: 100, totalFailureRate: 0, recent14Total: 100 },
  statusItems: [], typeItems: [], last14: { points: [] }, sourceItems: [],
  modelFailurePeriods: [
    { key: "today", label: "今天", failedCount: 0, completedCount: 0, failureRate: 0, models: [] },
    { key: "last3Days", label: "近 3 天", failedCount: 1, completedCount: 10, failureRate: 10, models: [{ model: "模型 A", failedCount: 1, completedCount: 10, failureRate: 10 }] },
    { key: "last7Days", label: "近 7 天", failedCount: 7, completedCount: 200, failureRate: 4, models: [{ model: "模型 A", failedCount: 7, completedCount: 200, failureRate: 4 }] },
  ],
  logDailyByCategory: {}, agentConversationStatusItems: [], agentRunStatusItems: [],
  agentRunModelItems: [], agentRunPurposeItems: [], recentActivities: [],
  files: { totalReferenced: 1101, totalBytes: 2048 },
  storage: { totalBytes: 2048, generatedBytes: 1024, uploadedBytes: 0, privateLibraryBytes: 1024, fileCount: 3, verifiedFiles: 2, unverifiedFiles: 1, averageFileBytes: 1024, largestFileBytes: 1024 },
  presetTotalCount: 2, presetDeletedCount: 1,
};
let dispose: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { dispose?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function mount(extra: Partial<Props> = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (props: Partial<Props>) => act(() => root.render(React.createElement(UserAnalysisPanel, { ...defaults, ...props })));
  render(extra);
  dispose = () => { act(() => root.unmount()); host.remove(); };
  return { host, render };
}
function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent?.trim() === text);
  expect(button, text).toBeTruthy();
  act(() => button!.click());
}
function region(host: HTMLElement, name: string) {
  const el = host.querySelector(`[aria-label="${name}"]`);
  expect(el, name).toBeTruthy();
  return el!;
}

describe("user analysis overview and statistics", () => {
  it("shows the user's actual cumulative data and preserves billing precision", () => {
    const { host } = mount();
    const summary = region(host, "用户数据总览");
    expect(summary.textContent).toContain("1,060");
    expect(summary.textContent).toContain("1,059");
    expect(summary.textContent).toContain("3,233");
    expect(summary.querySelector('[title="¥3233.6430"]')).toBeTruthy();
    for (const label of ["引用文件", "上传素材", "导入记录", "私有素材库", "自定义预设", "日志记录", "平均文件", "最大文件", "待核实"]) expect(host.textContent).toContain(label);
    expect(host.querySelector('[aria-label="用户数据关系图"]')).toBeNull();
  });

  it("defaults to seven days and keeps cumulative totals unchanged when switching periods", () => {
    const { host } = mount();
    const before = region(host, "用户数据总览").textContent;
    expect(region(host, "模型成功率").textContent).toContain("96.5%");
    click(host, "近 3 天");
    expect(region(host, "模型成功率").textContent).toContain("90%");
    expect(region(host, "用户数据总览").textContent).toBe(before);
  });

  it("distinguishes no completed calls from a zero percent success rate", () => {
    const { host } = mount();
    click(host, "今天");
    const models = region(host, "模型成功率");
    expect(models.textContent).toContain("暂无已完成模型调用");
    expect(models.textContent).not.toContain("0%");
    click(host, "查看近 7 天");
    expect(models.textContent).toContain("96.5%");
  });

  it("still shows zero percent when every completed call failed", () => {
    const { host } = mount({ modelFailurePeriods: [{ key: "last7Days", label: "近 7 天", failedCount: 4, completedCount: 4, failureRate: 100, models: [{ model: "失败模型", failedCount: 4, completedCount: 4, failureRate: 100 }] }] });
    expect(region(host, "模型成功率").textContent).toContain("0%");
    expect(region(host, "模型成功率").textContent).not.toContain("暂无已完成");
  });

  it("keeps detailed values pending or unavailable instead of showing empty-data zeros", () => {
    const { host, render } = mount({ detailsLoading: true, storage: undefined });
    expect(host.textContent).toContain("统计中");
    expect(host.textContent).not.toContain("暂无已完成模型调用");
    expect(region(host, "用户数据总览").textContent).toContain("1,060");
    render({ detailsError: true, storage: undefined });
    expect(host.textContent).toContain("暂不可用");
    expect(region(host, "用户数据总览").textContent).not.toContain("0 B");
  });

  it("applies the shared date filter to logs while keeping the 30-day view local", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T12:00:00"));
    const { host } = mount({ logDailyByCategory: { generation: { "2026-09-29": 21, "2026-09-10": 35 }, warning: { "2026-09-29": 2 } } });
    expect(region(host, "日志趋势").textContent).toContain("21");
    click(host, "今天");
    expect(region(host, "日志趋势").textContent).toContain("今天暂无日志记录");
    click(host, "近 30 天");
    expect(region(host, "日志趋势").textContent).toContain("56");
    expect(region(host, "模型成功率").textContent).toContain("暂无已完成模型调用");
    click(host, "近 3 天");
    expect(region(host, "日志趋势").textContent).toContain("21");
    expect(region(host, "日志趋势").querySelector('button[title="仅切换日志统计范围"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("allows every model to be inspected and collapses the list after changing periods", () => {
    const models = Array.from({ length: 6 }, (_, index) => ({ model: `模型 ${index + 1}`, failedCount: 0, completedCount: 1, failureRate: 0 }));
    const { host } = mount({ modelFailurePeriods: [{ key: "last7Days", label: "近 7 天", failedCount: 0, completedCount: 6, failureRate: 0, models }] });
    const panel = region(host, "模型成功率");
    expect(panel.textContent).not.toContain("模型 6");
    click(host, "查看全部 6 个模型");
    expect(panel.textContent).toContain("模型 6");
    click(host, "今天");
    click(host, "近 7 天");
    expect(panel.textContent).not.toContain("模型 6");
  });

  it("resets analysis controls and expanded details when the user changes", () => {
    const recentActivities = [{ id: 1, category: "生成", action: "完成", message: "测试活动详情", createdAt: "2026-09-29T08:00:00Z" }];
    const { host, render } = mount({ recentActivities });
    const disclosure = [...host.querySelectorAll("button")].find(el => el.textContent?.includes("最近行为记录"))!;
    act(() => disclosure.click());
    expect(host.textContent).toContain("测试活动详情");
    click(host, "今天");
    render({ account: { ...account, requestedUserId: "auth:4", username: "另一用户" }, recentActivities });
    expect(region(host, "模型成功率").textContent).toContain("96.5%");
    expect(host.textContent).toContain("另一用户");
    expect(host.textContent).not.toContain("测试活动详情");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });
});
