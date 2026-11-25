import * as React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasVideoClipProvider, CanvasVideoClipButton } from "@/components/canvas/CanvasVideoClip";
import { CanvasVideoFrameContext } from "@/components/canvas/CanvasVideoFrameControls";
import { CanvasReadOnlyContext } from "@/components/canvas/CanvasReadOnlyContext";
import { trimCanvasVideo } from "@/lib/canvas/video-clip";
vi.mock("@xyflow/react", () => ({ NodeToolbar: ({ children }: any) => children, Position: { Bottom: "bottom" }, useStore: () => ({ left: 16, top: 16, width: 900 }) }));
vi.mock("@/lib/canvas/video-clip", async original => ({ ...await original<any>(),
  loadVideoClipTimeline: vi.fn(async () => 24), trimCanvasVideo: vi.fn(async () => ({ blob: new Blob(["clip"]), width: 1920, height: 1080, durationSeconds: 8 })),
}));
let root: Root, host: HTMLDivElement;
const save = vi.fn();
const video = { currentTime: 4, readyState: 2, paused: true, play: vi.fn(async () => {}), pause: vi.fn() };
const frame = { videoRef: { current: video }, timeRef: { current: 0 }, busy: false, openMenu: null, setOpenMenu: vi.fn(), capture: vi.fn() };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn()); host = document.createElement("div"); document.body.append(host); root = createRoot(host); video.currentTime = 4; save.mockReset().mockResolvedValue(undefined); vi.mocked(trimCanvasVideo).mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const pointer = (pointerId: number, clientX: number) => ({ pointerId, clientX, button: 0 });
const el = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
async function mount(readOnly = false) { await act(async () => root.render(React.createElement(CanvasReadOnlyContext.Provider, { value: readOnly }, React.createElement(CanvasVideoFrameContext.Provider, { value: frame as any }, React.createElement(CanvasVideoClipProvider, { nodeId: "v", src: "/video.mp4", selected: true, onExport: save, children: React.createElement(CanvasVideoClipButton) }))))); }
async function open() { await mount(); await act(async () => el("逐帧拉片").click()); await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "片段截取")!.click()); }
const key = (key: string, extra = {}) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })));
it("opens timeline, adjusts selection with precise keyboard shortcuts and exports once", async () => {
  await open(); expect(host.textContent).toContain("8.00 s");
  key("ArrowRight", { shiftKey: true }); expect(el("视频截取入点").getAttribute("aria-valuenow")).toBe("0.01");
  key("ArrowUp", { ctrlKey: true }); expect(host.textContent).toContain("9.00 s");
  await act(async () => { el("确认视频截取").click(); el("确认视频截取").click(); });
  expect(trimCanvasVideo).toHaveBeenCalledTimes(1); expect(vi.mocked(trimCanvasVideo).mock.calls[0].slice(0, 3)).toEqual(["/video.mp4", .01, 9.01]);
  expect(save).toHaveBeenCalledTimes(1); expect(el("视频截取时间轴")).toBeNull();
});
it("drags both handles and moves the selection, including whole-second snapping", async () => {
  await open(); const timeline = el("视频截取时间轴"); timeline.getBoundingClientRect = () => ({ width: 480 } as DOMRect);
  const end = el("视频截取出点"); end.setPointerCapture = vi.fn();
  act(() => Simulate.pointerDown(end, pointer(1, 160)));
  act(() => Simulate.pointerMove(timeline, pointer(1, 240)));
  act(() => Simulate.pointerUp(timeline)); expect(host.textContent).toContain("12.00 s");
  await act(async () => el("开启整秒吸附").click());
  const selection = host.querySelector<HTMLElement>(".canvas-video-clip-selection")!; selection.setPointerCapture = vi.fn();
  act(() => Simulate.pointerDown(selection, pointer(2, 100)));
  act(() => Simulate.pointerMove(timeline, pointer(2, 137)));
  act(() => Simulate.pointerUp(timeline)); expect(el("视频截取入点").getAttribute("aria-valuenow")).toBe("2"); expect(el("视频截取出点").getAttribute("aria-valuenow")).toBe("14");
});
it("shows shortcuts, toggles loop, sets I/O points and cancels without exporting", async () => {
  await open(); await act(async () => el("视频截取快捷键").click()); expect(el("视频截取快捷键").getAttribute("role")).toBe("dialog");
  key("Escape"); key("i"); expect(el("视频截取入点").getAttribute("aria-valuenow")).toBe("4");
  video.currentTime = 6; key("o"); expect(el("视频截取出点").getAttribute("aria-valuenow")).toBe("6");
  await act(async () => el("关闭选区循环播放").click()); expect(el("开启选区循环播放")).toBeTruthy();
  key("Escape"); expect(el("视频截取时间轴")).toBeNull(); expect(save).not.toHaveBeenCalled();
});
it("retains the selection on an upload error for retry", async () => { await open(); save.mockRejectedValueOnce(new Error("上传失败")); await act(async () => el("确认视频截取").click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain("上传失败"); expect(el("视频截取时间轴")).toBeTruthy(); });
it("does not offer mutation controls on a read-only canvas", async () => { await mount(true); expect(el("逐帧拉片")).toBeNull(); });
it("loops the selection when enabled and plays beyond it when disabled, including after pause", async () => {
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { tick = callback; return 1; }));
  await open(); act(() => tick(0));
  video.currentTime = 8.2; video.paused = false;
  act(() => tick(16)); expect(video.currentTime).toBe(0);
  video.currentTime = 4; video.paused = true;
  await act(async () => el("关闭选区循环播放").click());
  act(() => tick(32)); expect(video.currentTime).toBe(4);
  video.currentTime = 8.2; video.paused = false;
  video.pause.mockClear();
  act(() => tick(48)); expect(video.currentTime).toBe(8.2); expect(video.pause).not.toHaveBeenCalled();
  video.currentTime = 12; video.paused = true;
  key(" "); expect(video.currentTime).toBe(12);
  video.paused = false;
  await act(async () => el("开启选区循环播放").click());
  act(() => tick(64)); expect(video.currentTime).toBe(0);
  video.paused = true;
});
