/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */

import * as React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceMetricCard } from "@/components/admin/monitoring/ResourceMetricCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("monitoring resource metric help popover", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(React.createElement(ResourceMetricCard, {
      label: "服务器内存",
      value: "72.0",
      unit: "%",
      detail: "已用 22.5 GB / 31.3 GB",
      statusLabel: "当前充足",
      impact: "接近上限时，系统可能终止进程并导致任务失败。",
      helpText: "整台服务器已经使用的物理内存比例。",
      historySupported: false,
    })));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the explanation open when pressed and closes it after pressing elsewhere", () => {
    const helpButton = host.querySelector('[aria-label="了解服务器内存"]') as HTMLButtonElement;
    act(() => helpButton.click());

    const note = host.querySelector('[role="note"]') as HTMLElement;
    expect(note).not.toBeNull();

    act(() => note.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="note"]')).not.toBeNull();

    act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="note"]')).toBeNull();
  });

  it("shows an honest compact empty state without a fabricated chart", () => {
    expect(host.textContent).toContain("未配置历史指标");
    expect(host.querySelector('svg[role="img"]')).toBeNull();
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("shows real samples by keyboard and does not show a value inside a sampling gap", () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { nextFrame = undefined; });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 100 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(150);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(50);
    act(() => root.render(React.createElement(ResourceMetricCard, {
      label: "服务器内存", value: "72.0", unit: "%", detail: "内存读数",
      statusLabel: "当前充足", impact: "资源状态", helpText: "物理内存比例",
      historySupported: true, trendStepMs: 60_000,
      trend: [
        { timestamp: 60_000, value: 70 }, { timestamp: 120_000, value: 72 },
        { timestamp: 180_000, value: NaN },
        { timestamp: 600_000, value: 75 }, { timestamp: 660_000, value: 77 },
      ],
    })));
    const chart = host.querySelector('svg[role="img"]') as SVGElement;
    act(() => chart.focus());
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("70.0%");
    act(() => chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("72.0%");
    chart.getBoundingClientRect = () => ({ left: 0, width: 300 } as DOMRect);
    act(() => Simulate.pointerMove(chart, { clientX: 20, clientY: 20 }));
    act(() => nextFrame?.(0));
    expect((host.querySelector('[role="tooltip"]') as HTMLElement).style.transform).toBe("translate3d(30px, 30px, 0)");
    act(() => Simulate.pointerMove(chart, { clientX: 25, clientY: 30 }));
    act(() => nextFrame?.(0));
    expect((host.querySelector('[role="tooltip"]') as HTMLElement).style.transform).toBe("translate3d(35px, 40px, 0)");
    act(() => Simulate.pointerMove(chart, { clientX: 150, clientY: 30 }));
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    act(() => Simulate.pointerMove(chart, { clientX: 270, clientY: 30 }));
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("75.0%");
    act(() => chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
});
