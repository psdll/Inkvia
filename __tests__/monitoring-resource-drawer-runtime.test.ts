import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceDetailsDrawer } from "@/components/admin/monitoring/ResourceDetailsDrawer";
import type { MonitoringOverview } from "@/lib/monitoring/contracts";

vi.mock("@/components/admin/monitoring/ResourceTrendGrid", () => ({
  ResourceTrendGrid: () => React.createElement("div", null, "资源内容"),
}));
vi.mock("@/components/admin/monitoring/BusinessImpactGrid", () => ({
  BusinessImpactGrid: () => React.createElement("div", null, "业务影响内容"),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onRefresh = vi.fn() }: { onRefresh?: () => void | Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("button", { ref: triggerRef, onClick: () => setOpen(true) }, "打开资源详情"),
    React.createElement(ResourceDetailsDrawer, {
      open,
      triggerRef,
      hostState: "healthy",
      mode: "production",
      overview: {} as MonitoringOverview,
      historySupported: true,
      series: {},
      metricErrors: {},
      checkedAt: Date.now(),
      evidenceAvailable: true,
      range: { preset: "1h", from: "2026-08-13", to: "2026-08-14" },
      onRangeChange: vi.fn(),
      onRefresh,
      onClose: () => setOpen(false),
    }),
  );
}

describe("monitoring resource details drawer", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  function openDrawer() {
    act(() => root.render(React.createElement(Harness)));
    const trigger = host.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());
    return trigger;
  }

  it("locks scrolling, focuses the close button, traps Tab, and restores focus after Escape", () => {
    const trigger = openDrawer();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const close = host.querySelector('[aria-label="关闭服务器资源详情"]') as HTMLButtonElement;
    const refresh = host.querySelector('[aria-label="刷新监控数据"]') as HTMLButtonElement;

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(close);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(refresh);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(close);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes only when the backdrop itself is pressed", () => {
    const trigger = openDrawer();
    const backdrop = host.querySelector("[data-resource-drawer-backdrop]") as HTMLElement;
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows visible busy feedback while a manual refresh is running", async () => {
    vi.useFakeTimers();
    let finishRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));

    act(() => root.render(React.createElement(Harness, { onRefresh })));
    const trigger = host.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());
    const refresh = host.querySelector('[aria-label="刷新监控数据"]') as HTMLButtonElement;

    await act(async () => refresh.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");

    await act(async () => {
      finishRefresh?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(refresh.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    vi.useRealTimers();
  });
});
