// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminActivityChart from "@/components/admin/AdminActivityChart";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const points = [
  { label: "2026-10-11", values: { a: 4, b: 6 } },
  { label: "2026-10-12", values: { a: 3, b: 2 } },
];
const series = [
  { key: "a", label: "模型 A", color: "#0090ff" },
  { key: "b", label: "模型 B", color: "#00bfa5" },
];
function render(props = {}) {
  act(() =>
    root.render(
      React.createElement(AdminActivityChart, {
        title: "调用量",
        points,
        series,
        ...props,
      }),
    ),
  );
}
function focusDay(index: number) {
  act(() =>
    (host.querySelectorAll('svg [role="button"]')[index] as SVGElement).focus(),
  );
}
function click(selector: string) {
  act(() => (host.querySelector(selector) as HTMLElement).click());
}

describe("activity chart interactions", () => {
  it("dismisses chart settings for outside actions, scrolling, Escape and a completed selection", () => {
    render();
    const settings = host.querySelector("details")!;
    const summary = settings.querySelector("summary")!;
    const open = () => { settings.open = true; };
    open();
    act(() => settings.querySelector("div")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(settings.open).toBe(true);
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(settings.open).toBe(false);
    open();
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(settings.open).toBe(false);
    open();
    act(() => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(settings.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    open();
    act(() => (host.querySelector('[title="仅显示 模型 A"]') as HTMLButtonElement).focus());
    expect(settings.open).toBe(false);
    open();
    click('[aria-label="折线图"]');
    expect(settings.open).toBe(false);
    expect(host.querySelector('[aria-label="折线图"]')?.getAttribute("aria-pressed")).toBe("true");
  });
  it("selects whole adjacent cells immediately without rendering again for movement inside a cell", () => {
    const commit = vi.fn();
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 270 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(250);
    const week = Array.from({ length: 7 }, (_, index) => ({
      label: `2026-10-${String(index + 6).padStart(2, "0")}`,
      values: { a: index, b: 7 - index },
    }));
    act(() =>
      root.render(
        React.createElement(
          React.Profiler,
          { id: "chart", onRender: commit },
          React.createElement(AdminActivityChart, {
            title: "调用量",
            points: week,
            series,
          }),
        ),
      ),
    );
    const cells = [
      ...host.querySelectorAll<SVGRectElement>('svg [role="button"]'),
    ];
    cells.forEach((cell, index) => {
      if (index)
        expect(Number(cell.getAttribute("x"))).toBeCloseTo(
          Number(cells[index - 1].getAttribute("x")) +
            Number(cells[index - 1].getAttribute("width")),
        );
      expect(Number(cell.getAttribute("height"))).toBe(214);
    });
    act(() => Simulate.pointerEnter(cells[0], { clientX: 50, clientY: 40 }));
    const overlay = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(overlay.textContent).toContain("2026年10月6日");
    expect(overlay.style.transform).toBe("translate3d(60px, 50px, 0)");
    commit.mockClear();
    for (let i = 0; i < 100; i++) {
      act(() =>
        Simulate.pointerMove(cells[0], {
          clientX: 50 + i / 2,
          clientY: 27 + i,
        }),
      );
    }
    expect(commit).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    act(flush);
    expect(overlay.style.transform).toBe("translate3d(109.5px, 136px, 0)");
    expect(overlay.textContent).toContain("2026年10月6日");
    for (let i = 1; i < cells.length; i++) {
      act(() => Simulate.pointerEnter(cells[i], { clientX: 50 + i * 85, clientY: 260 }));
      expect(host.querySelector('[role="tooltip"]')).toBe(overlay);
      expect(overlay.textContent).toContain(`2026年10月${i + 6}日`);
      const left = Number(
        overlay.style.transform.match(/translate3d\(([^p]+)/)?.[1],
      );
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 250).toBeLessThanOrEqual(600);
    }
    act(() => Simulate.pointerMove(cells[6], { clientX: 599, clientY: 265 }));
    act(() => Simulate.pointerLeave(cells[0].parentElement!));
    expect(frames.size).toBe(0);
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
  });
  it("shows a date, all visible values and their sum, then excludes a hidden series", () => {
    render();
    focusDay(0);
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "2026年10月11日",
    );
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "合计10",
    );
    click('[aria-label="隐藏 模型 B"]');
    focusDay(0);
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "合计4",
    );
    expect(host.querySelector('[role="tooltip"]')?.textContent).not.toContain(
      "模型 B",
    );
  });
  it("isolates a legend series and restores all series on a second click", () => {
    render();
    click('[title="仅显示 模型 A"]');
    expect(
      host
        .querySelector('[aria-label="显示 模型 B"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    click('[title="仅显示 模型 A"]');
    expect(
      host.querySelectorAll('[role="checkbox"][aria-checked="true"]').length,
    ).toBe(2);
  });
  it("moves across dates with the keyboard and computes cumulative values", () => {
    render();
    focusDay(0);
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "2026年10月12日",
    );
    click('input[type="checkbox"]');
    focusDay(1);
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "合计15",
    );
  });
  it("keeps a missing rate distinct from zero and does not offer cumulative percentages", () => {
    render({
      points: [
        { label: "10:00", values: { a: null } },
        { label: "11:00", values: { a: 0 } },
      ],
      series: [series[0]],
      initialType: "line",
      showTotal: false,
      allowCumulative: false,
    });
    focusDay(0);
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "暂无数据",
    );
    focusDay(1);
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain(
      "模型 A0",
    );
    expect(host.querySelector('[role="tooltip"]')?.textContent).not.toContain(
      "合计",
    );
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

import AdminActivityTable from "@/components/admin/AdminActivityTable";
describe("activity table interactions", () => {
  it("sorts numeric values in both directions without changing labels or percentages", () => {
    act(() =>
      root.render(
        React.createElement(AdminActivityTable, {
          label: "用户产出",
          columns: [
            { key: "name", label: "用户" },
            { key: "count", label: "产出", numeric: true },
          ],
          rows: [
            { key: "a", cells: { name: { value: "甲" }, count: { value: 2 } } },
            {
              key: "b",
              cells: { name: { value: "乙" }, count: { value: 10 } },
            },
            { key: "c", cells: { name: { value: "丙" }, count: { value: 3 } } },
          ],
        }),
      ),
    );
    click("th:nth-child(2) button");
    expect(
      [...host.querySelectorAll("tbody td:first-child")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["乙", "丙", "甲"]);
    expect(
      host.querySelector("th:nth-child(2)")?.getAttribute("aria-sort"),
    ).toBe("descending");
    click("th:nth-child(2) button");
    expect(
      [...host.querySelectorAll("tbody td:first-child")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["甲", "丙", "乙"]);
  });
});
