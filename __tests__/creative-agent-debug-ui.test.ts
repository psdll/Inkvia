// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ data: null as any, load: vi.fn() }));
vi.mock("@/components/creative-agent/debug/use-debug-inspector", () => ({ useDebugInspector: () => state.data }));
vi.mock("@/components/creative-agent/debug/debug-client", async original => ({ ...await original<any>(), loadDebugDetails: state.load }));
import AgentDebugInspector from "@/components/creative-agent/debug/AgentDebugInspector";

let host: HTMLDivElement, root: Root;
const close = vi.fn(), locate = vi.fn(), status = vi.fn(), canvasKey = vi.fn(), canvasWheel = vi.fn();
const event = (sequence: number) => ({ id: String(sequence), sequence, runId: "run", spanId: "model:1", parentSpanId: "run:run", category: "model", type: sequence === 1 ? "model.prepared" : "model.response.delta", title: "模型请求", status: "running", summary: {}, hasDetail: true, createdAt: new Date().toISOString() });
async function render(visible = true) { await act(async () => root.render(React.createElement("div", { onKeyDown: canvasKey, onWheel: canvasWheel }, React.createElement(AgentDebugInspector, { canvasId: 1, userId: 1, activeSessionId: "session", visible, onClose: close, onLocateNode: locate, onStatus: status })))); }
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  state.data = { selected: "run", session: "", pinnedRun: "", run: { id: "run", status: "running" }, index: { sessions: [], runs: [], hasMore: false }, runs: [], events: [event(1)], connected: true };
  state.load.mockReset().mockImplementation(async () => [{ ...event(1), detail: { body: { model: "fixture", messages: [{ role: "user", content: "模拟请求" }] } } }]);
  for (const fn of [close, locate, status, canvasKey, canvasWheel]) fn.mockClear();
  localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Agent inspector interactions", () => {
  it("contains canvas shortcuts and scrolling, and persists keyboard resize", async () => {
    await render();
    const input = host.querySelector("input")!;
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); input.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true })); });
    expect(canvasKey).not.toHaveBeenCalled(); expect(canvasWheel).not.toHaveBeenCalled();
    const resize = host.querySelector('[aria-label="调整调试窗口大小"]')!;
    act(() => resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect((host.querySelector('[role="dialog"]') as HTMLElement).style.width).toBe("580px");
    expect(JSON.parse(localStorage.getItem("creative-debug:frame:v1:1:1")!).width).toBe(580);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps refreshing details during continuous events and stops when collapsed", async () => {
    await render(); await act(async () => (host.querySelector('[role="option"]') as HTMLButtonElement).click());
    expect(state.load).toHaveBeenCalledTimes(1);
    for (let n = 2; n <= 8; n++) {
      state.data = { ...state.data, events: [...state.data.events, event(n)] };
      await render(); await act(async () => vi.advanceTimersByTimeAsync(200));
    }
    expect(state.load.mock.calls.length).toBeGreaterThan(2);
    await render(false); const calls = state.load.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(state.load).toHaveBeenCalledTimes(calls);
    expect(host.querySelector('[aria-label="步骤详情"]')).toBeNull();
    await render(); expect(host.querySelector('[aria-label="步骤详情"]')).not.toBeNull();
  });
  it("shows missing historical data honestly and does not request a model", async () => {
    state.data.events = [{ ...event(1), id: "public:1", spanId: "run:run", category: "run", hasDetail: false }];
    await render();
    expect(host.textContent).toContain("详细调用次数未采集");
    expect(host.textContent).toContain("上线前的请求无法补录");
    expect(state.load).not.toHaveBeenCalled();
  });
});
