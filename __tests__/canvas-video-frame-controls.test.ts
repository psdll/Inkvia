// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ live: vi.fn(), source: vi.fn() }));
vi.mock("@/lib/browser/video-frame-capture", () => ({ captureVideoFrame: mocks.live, captureVideoFrameFromSource: mocks.source }));
import { CanvasVideoFrameProvider, CanvasVideoFrameContext, CanvasVideoFrameControl } from "@/components/canvas/CanvasVideoFrameControls";

let host: HTMLDivElement, root: Root;
let actions: NonNullable<React.ContextType<typeof CanvasVideoFrameContext>>;
const frame = () => ({ file: new File(["png"], "frame.png", { type: "image/png" }), time: 2.271, width: 1440, height: 2560 });
function Controls() {
  actions = React.useContext(CanvasVideoFrameContext)!;
  return React.createElement(React.Fragment, null,
    React.createElement(CanvasVideoFrameControl, { placement: "toolbar" }),
    React.createElement(CanvasVideoFrameControl, { placement: "player" }));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.live.mockReset().mockResolvedValue(frame()); mocks.source.mockReset().mockResolvedValue(frame());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const mount = async (onCapture = vi.fn().mockResolvedValue(undefined), src = "/video.mp4") => {
  await act(async () => root.render(React.createElement(CanvasVideoFrameProvider, { key: src, src, onCapture, children: React.createElement(Controls) })));
  return onCapture;
};
const click = async (selector: string) => { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); };

describe("canvas frame menus", () => {
  it.each(["toolbar", "player"])("offers all three modes in the %s entry and closes with Escape", async placement => {
    await mount();
    const label = placement === "toolbar" ? "截取当前帧" : "视频截帧";
    await click(`[aria-label="${label}"]`);
    expect([...host.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim())).toEqual(["截取当前帧", "截取首帧", "截取尾帧"]);
    expect(host.querySelector('[role="menu"]')!.className).toContain(placement === "toolbar" ? "top-full" : "bottom-7");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement!.textContent?.trim()).toBe("截取首帧");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(label);
  });
  it("captures the live video immediately and locks both entries until upload finishes", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await mount(save);
    const video = document.createElement("video"); actions.videoRef.current = video;
    await click('[aria-label="视频截帧"]');
    await click('[role="menuitem"]');
    expect(mocks.live).toHaveBeenCalledWith(video, "current");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ time: 2.271, width: 1440, height: 2560 }), "current");
    expect([...host.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    act(() => actions.capture("last"));
    expect(mocks.source).not.toHaveBeenCalled();
    await act(async () => finish());
    expect([...host.querySelectorAll("button")].every(button => !button.disabled)).toBe(true);
  });
  it("retains the previous playback time after releasing a lazy video and isolates endpoint extraction", async () => {
    await mount(); actions.timeRef.current = 4.98;
    await act(async () => actions.capture("current"));
    expect(mocks.source).toHaveBeenLastCalledWith("/video.mp4", "current", 4.98);
    actions.videoRef.current = document.createElement("video");
    await act(async () => actions.capture("last"));
    expect(mocks.source).toHaveBeenLastCalledWith("/video.mp4", "last", 4.98);
    expect(mocks.live).not.toHaveBeenCalled();
  });
  it("shows a recoverable error and permits a successful retry", async () => {
    const save = await mount(); mocks.source.mockRejectedValueOnce(new Error("视频加载失败"));
    await act(async () => actions.capture("first"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("视频加载失败");
    expect(save).not.toHaveBeenCalled();
    await act(async () => actions.capture("first"));
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(save).toHaveBeenCalledOnce();
  });
  it("does not save an old frame after the source changes", async () => {
    let finish!: (value: ReturnType<typeof frame>) => void;
    mocks.source.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const save = await mount();
    act(() => actions.capture("first"));
    await mount(save, "/replacement.mp4");
    await act(async () => finish(frame()));
    expect(save).not.toHaveBeenCalled(); expect(actions.timeRef.current).toBe(0);
  });
});
