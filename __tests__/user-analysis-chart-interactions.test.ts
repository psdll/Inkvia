// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UserAnalysisPanel from "@/components/admin/UserAnalysisPanel";
import UserBillingTrend from "@/components/admin/UserBillingTrend";
import type { BillingTrendPeriod } from "@/lib/admin/billing-trend";

let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
const flushMotion = () => { const callbacks = [...frames.values()]; frames.clear(); act(() => callbacks.forEach(callback => callback(0))); };
function expectPointerFollowing(element: Element) {
  act(() => Simulate.pointerEnter(element, { clientX: 60, clientY: 40 }));
  flushMotion();
  const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  const before = tooltip.style.transform;
  act(() => Simulate.pointerMove(element, { clientX: 110, clientY: 70 }));
  flushMotion();
  expect(tooltip.style.transform).not.toBe(before);
  expect(tooltip.style.transform).toBe("translate3d(120px, 80px, 0)");
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  frames = new Map(); let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 300 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(250);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function analysis() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  act(() => root.render(React.createElement(UserAnalysisPanel, {
    overview: { totalRecordCount: 0, totalSuccessCount: 0, totalFailedCount: 0, uploads: 0, outputs: 0, successRate: 0, totalFailureRate: 0, recent14Total: 0 },
    statusItems: [], typeItems: [], last14: { points: [] }, sourceItems: [],
    logDailyByCategory: { generation: { [today]: 5 }, error: { [today]: 2 } },
    agentConversationStatusItems: [], agentRunStatusItems: [], agentRunModelItems: [], agentRunPurposeItems: [], recentActivities: [],
    files: { totalReferenced: 0, totalBytes: 0 }, presetTotalCount: 0, presetDeletedCount: 0,
    storage: { totalBytes: 1000, generatedBytes: 800, uploadedBytes: 200, privateLibraryBytes: 0, fileCount: 2, verifiedFiles: 2, unverifiedFiles: 0, averageFileBytes: 500, largestFileBytes: 800 },
  })));
}

it("shows log hover values without adding overlapping categories and supports legend filtering", () => {
  analysis();
  const days = host.querySelectorAll('[aria-label="日志趋势图表"] [role="button"]');
  act(() => (days[days.length - 1] as SVGElement).focus());
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("生成任务5");
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("错误2");
  expect(host.querySelector('[role="tooltip"]')?.textContent).not.toContain("合计");
  expect(host.querySelector('[aria-label="柱状图"]')).toBeNull();
  act(() => (host.querySelector('[aria-label="隐藏 错误"]') as HTMLElement).click());
  act(() => (days[days.length - 1] as SVGElement).focus());
  expect(host.querySelector('[role="tooltip"]')?.textContent).not.toContain("错误");
});

it("shows storage amounts and percentages when a segment receives focus", () => {
  analysis();
  const segment = host.querySelector('[aria-label="存储构成图表"] [role="img"]') as SVGElement;
  act(() => segment.focus());
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("800 B");
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("80.0%");
  act(() => segment.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="tooltip"]')).toBeNull();
  expectPointerFollowing(segment);
});

it("keeps exact billed amounts separate from pending entries and preserves bill navigation", () => {
  const period: BillingTrendPeriod = { key: "last3Days", label: "近 3 天", dateFrom: "2026-10-10", dateTo: "2026-10-12", amount: "0.00012345", dailyAverage: "0.00004115", pendingCount: 3, pricedCount: 1, count: 4,
    points: [{ key: "2026-10-10", amount: "0.00012345", pricedCount: 1, pendingCount: 0, count: 1 }, { key: "2026-10-11", amount: "0", pricedCount: 0, pendingCount: 3, count: 3 }] };
  const onViewBill = vi.fn();
  act(() => root.render(React.createElement(UserBillingTrend, { periods: [period], periodKey: "last3Days", onViewBill })));
  expect(host.querySelector('[role="tooltip"]')).toBeNull();
  const bars = host.querySelectorAll('g[tabindex="0"]');
  act(() => (bars[0] as SVGElement).focus());
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("¥0.00012345");
  act(() => bars[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("待核算3 笔");
  act(() => (host.querySelector('button') as HTMLButtonElement).click());
  expect(onViewBill).toHaveBeenCalledWith(period);
  expectPointerFollowing(bars[0].querySelectorAll("rect")[1]);
});
