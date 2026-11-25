import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasVideoSubtitleRemovalProvider, CanvasVideoSubtitleRemovalButton, CanvasSubtitleRemovalOverlay } from "@/components/canvas/CanvasVideoSubtitleRemoval";
import { CanvasVideoFrameContext } from "@/components/canvas/CanvasVideoFrameControls";
vi.mock("@xyflow/react", () => ({ NodeToolbar: ({ children }: any) => children, Position: { Bottom: "bottom" } }));
let host: HTMLDivElement, root: Root;
const submit = vi.fn();
const video = { videoWidth: 834, videoHeight: 1112, pause: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  submit.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = async (name: string) => { await act(async () => (Array.from(host.querySelectorAll("button")).find(b => (b.getAttribute("aria-label") || b.textContent) === name) as HTMLButtonElement).click()); };
function render(selected = true) { act(() => root.render(React.createElement(CanvasVideoFrameContext.Provider, { value: { videoRef: { current: video } } as any }, React.createElement(CanvasVideoSubtitleRemovalProvider, { nodeId: "source", selected, onRemove: submit, children: React.createElement(React.Fragment, null, React.createElement(CanvasVideoSubtitleRemovalButton), React.createElement(CanvasSubtitleRemovalOverlay)) })))); }
it("submits smart mode immediately and leaves the job alive when the panel closes", async () => {
  let finish!: () => void;
  submit.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(); await click("智能去字幕");
  await act(async () => host.querySelectorAll("button")[1].click());
  expect(submit).toHaveBeenCalledWith({ mode: "auto" }, { width: 834, height: 1112 });
  render(false); await act(async () => finish());
  expect(submit).toHaveBeenCalledTimes(1);
});
it("shows the bounded selection and submits normalized video coordinates", async () => {
  render(); await click("智能去字幕"); await click("框选去字幕");
  expect(host.querySelector('[aria-label="去字幕选区"]')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
  await click("确认框选去字幕");
  expect(submit).toHaveBeenCalledWith({ mode: "region", regions: [expect.objectContaining({ y: .75 })] }, { width: 834, height: 1112 });
  expect(host.querySelector('[aria-label="去字幕选区"]')).toBeNull();
});
it("shows submission failures rather than silently ignoring clicks", async () => {
  submit.mockRejectedValue(new Error("执行器不可用")); render(); await click("智能去字幕");
  await act(async () => host.querySelectorAll("button")[1].click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("执行器不可用");
});
it("draws multiple boxes, undoes/redoes, resets and submits all restored boxes", async () => {
  render(); await click("智能去字幕"); await click("框选去字幕");
  await click("添加选区");
  const surface = host.querySelector('[data-subtitle-regions]') as HTMLElement;
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 834, height: 1112 } as DOMRect);
  surface.setPointerCapture = vi.fn();
  const pointer = async (type: string, x: number, y: number) => {
    await act(async () => surface.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })));
  };
  await pointer("pointerdown", 100, 100); await pointer("pointermove", 400, 300); await pointer("pointerup", 400, 300);
  expect(host.querySelectorAll('[data-subtitle-region]')).toHaveLength(2);
  await click("撤回选区操作"); expect(host.querySelectorAll('[data-subtitle-region]')).toHaveLength(1);
  await click("重做选区操作"); expect(host.querySelectorAll('[data-subtitle-region]')).toHaveLength(2);
  await click("重置选区"); expect(host.querySelectorAll('[data-subtitle-region]')).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="确认框选去字幕"]')?.disabled).toBe(true);
  await click("撤回选区操作");
  await click("确认框选去字幕");
  expect(submit.mock.calls[0][0].regions).toHaveLength(2);
  expect(submit.mock.calls[0][0].regions[1]).toEqual({ x: 100 / 834, y: 100 / 1112, width: 300 / 834, height: 200 / 1112 });
});
it("records a whole move as one undo and cancels unfinished gestures", async () => {
  render(); await click("智能去字幕"); await click("框选去字幕");
  const surface = host.querySelector('[data-subtitle-regions]') as HTMLElement;
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 834, height: 1112 } as DOMRect);
  surface.setPointerCapture = vi.fn();
  const box = host.querySelector('[data-subtitle-region]') as HTMLElement;
  const original = box.style.top;
  const event = async (target: HTMLElement, type: string, x: number, y: number) => { await act(async () => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))); };
  await event(box, "pointerdown", 100, 900);
  await event(surface, "pointermove", 100, 800);
  await event(surface, "pointermove", 100, 700);
  await event(surface, "pointerup", 100, 700);
  expect(box.style.top).not.toBe(original);
  await click("撤回选区操作"); expect(box.style.top).toBe(original);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="撤回选区操作"]')?.disabled).toBe(true);
  await event(box, "pointerdown", 100, 900); await event(surface, "pointermove", 100, 750); await event(surface, "pointercancel", 100, 750);
  expect(box.style.top).toBe(original);
  await click("重置选区");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="重做选区操作"]')?.disabled).toBe(true);
});
