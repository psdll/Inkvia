// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasInteractionFrame } from "@/lib/canvas/interaction-frame";
import { scheduleCanvasConnectionTargetTilt, resetCanvasConnectionTargetTilt } from "@/lib/canvas/connection-feedback";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ""; });
describe("gesture frame scheduling", () => {
  it("coalesces 100 inputs and flushes the final pending size on release", () => {
    const apply = vi.fn(); const frame = createCanvasInteractionFrame<number>(apply);
    for (let i = 0; i < 100; i++) frame.push(i);
    expect(apply).not.toHaveBeenCalled(); vi.advanceTimersByTime(20);
    expect(apply.mock.calls).toEqual([[99]]);
    frame.push(100); frame.flush(); vi.advanceTimersByTime(20);
    expect(apply.mock.calls).toEqual([[99], [100]]);
  });
  it("does no work after cancellation and accepts the next gesture", () => {
    const apply = vi.fn(); const frame = createCanvasInteractionFrame<number>(apply);
    frame.push(1); frame.cancel(); vi.advanceTimersByTime(20); expect(apply).not.toHaveBeenCalled();
    frame.push(2); frame.flush(); expect(apply.mock.calls).toEqual([[2]]);
  });
  it("queries tilt geometry once per frame and cannot revive a reset target", () => {
    const node = document.createElement("div"); document.body.append(node);
    const bounds = vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    for (let i = 0; i < 100; i++) scheduleCanvasConnectionTargetTilt(node, { x: i, y: 50 });
    vi.advanceTimersByTime(20); expect(bounds).toHaveBeenCalledTimes(1);
    scheduleCanvasConnectionTargetTilt(node, { x: 0, y: 0 }); resetCanvasConnectionTargetTilt(node);
    vi.advanceTimersByTime(20); expect(bounds).toHaveBeenCalledTimes(1);
    expect(node.style.getPropertyValue("--canvas-target-rotate-y")).toBe("0deg");
  });
});
