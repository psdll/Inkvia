// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), document: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-canvas-cache", () => ({ loadAdminCanvasList: mocks.load, loadAdminCanvas: mocks.document }));
vi.mock("@/components/admin/UserCanvasViewer", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null }));
import UserCanvasesPanel from "@/components/admin/UserCanvasesPanel";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

it("prefetches the intended canvas before opening and cancels a passing pointer", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.load.mockResolvedValue({ items: [{ id: 7, title: "730S", updatedAt: "2026-09-30", nodeCount: 782 }], hasMore: false });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(UserCanvasesPanel, { adminKey: "auth:30", userName: "用户" })));
    const card = host.querySelector<HTMLButtonElement>('[aria-label="查看画布：730S"]')!;
    await act(async () => { card.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); vi.advanceTimersByTime(50); card.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })); vi.advanceTimersByTime(200); });
    expect(mocks.document).not.toHaveBeenCalled();
    await act(async () => { card.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); vi.advanceTimersByTime(150); });
    expect(mocks.document).toHaveBeenCalledWith("auth:30", 7);
    mocks.document.mockClear();
    await act(async () => card.click());
    expect(mocks.document).toHaveBeenCalledWith("auth:30", 7);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("loads subsequent projects on scroll, deduplicates overlap and resets on refresh without pagination buttons", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let intersect: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect = disconnect;
  });
  const item = (id: number) => ({ id, title: `项目${id}`, thumbnail: null, updatedAt: "2026-09-22", nodeCount: 0 });
  let resolveNext!: (value: unknown) => void;
  mocks.load.mockResolvedValueOnce({ items: [item(1)], hasMore: true })
    .mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }))
    .mockResolvedValueOnce({ items: [item(3)], hasMore: false });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(UserCanvasesPanel, { adminKey: "auth:30", userName: "用户" })));
    expect(host.textContent).not.toContain("下一页");
    await act(async () => { intersect(); intersect(); });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenLastCalledWith("auth:30", 2, "", false);
    await act(async () => resolveNext({ items: [item(1), item(2)], hasMore: false }));
    expect(host.querySelectorAll('[aria-label^="查看画布："]')).toHaveLength(2);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    const refresh = [...host.querySelectorAll("button")].find(button => button.textContent === "刷新")!;
    await act(async () => refresh.click());
    expect(mocks.load).toHaveBeenLastCalledWith("auth:30", 1, "", true);
    expect(host.querySelectorAll('[aria-label^="查看画布："]')).toHaveLength(1);
    expect(host.textContent).toContain("项目3");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
