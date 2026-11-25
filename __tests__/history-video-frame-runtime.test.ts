import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtuosoMockContext } from "react-virtuoso";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/browser/video-frame-capture", () => ({ captureVideoFrame: mocks.capture }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/canvas-board", () => ({ CanvasBoard: ({ src, dimensions }: { src: string; dimensions?: { width: number; height: number } }) => React.createElement("img", { src, "data-result": true, "data-dimensions": JSON.stringify(dimensions) }) }));
vi.mock("@/components/ui/video-poster-preview", () => ({ VideoPosterPreview: () => null }));
vi.mock("@/components/ui/media-image", () => ({ MediaImage: () => null }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null }));
import { UnifiedHistoryPanel } from "@/components/history/unified-history-panel";

let root: Root;
let host: HTMLDivElement;
let records: any[];
let userIndex = 0;
let failSave = false;
let request: ReturnType<typeof vi.fn>;
const sourcePath = "/uploads/video_results/source.mp4";
const framePath = "/uploads/image_results/captured.png";
const click = (selector: string) => {
  const element = host.querySelector<HTMLButtonElement>(selector);
  expect(element).not.toBeNull();
  act(() => element!.click());
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  failSave = false;
  mocks.capture.mockReset().mockResolvedValue({ file: new File(["png"], "frame.png", { type: "image/png" }), time: 4.25 });
  records = [{ id: 12, type: "video_gen", status: "success", localPath: sourcePath, createdAt: new Date().toISOString(), model: "minimax-h3", prompt: "Source video" }];
  request = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname === "/api/history/summary") return new Response(JSON.stringify({ inProgressCount: 0, completedCount: records.length }));
    if (parsed.pathname === "/api/history") return new Response(JSON.stringify({ items: records, hasMore: false }));
    if (parsed.pathname === "/api/video-frames") {
      if (failSave) return new Response(JSON.stringify({ error: "截帧保存失败，请重试" }), { status: 500 });
      const form = init!.body as FormData;
      expect(form.get("generationId")).toBe("12");
      expect(form.get("file")).toBeInstanceOf(File);
      const saved = { id: 13, type: "image_edit", status: "success", model: "video-frame", prompt: "视频截帧", localPath: framePath, createdAt: new Date().toISOString(), params: { videoFrame: { mode: form.get("mode"), time: 4.25, width: 2560, height: 1440 } } };
      records.unshift(saved);
      return new Response(JSON.stringify({ success: true, item: saved }));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", request);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount() {
  await act(async () => root.render(React.createElement(VirtuosoMockContext.Provider, {
    value: { viewportHeight: 1200, itemHeight: 72 },
  }, React.createElement(UnifiedHistoryPanel, { userId: `frame-${++userIndex}`, staticVideoPreviews: true }))));
  const video = host.querySelector<HTMLVideoElement>("[data-app-video-player] video");
  if (video) {
    Object.defineProperty(video, "duration", { value: 15 });
    act(() => video.dispatchEvent(new Event("loadedmetadata")));
  }
}

describe("history video frame workflow", () => {
  it.each(["current", "first", "last"])("does not play, pause or seek the video when choosing %s", async mode => {
    let finish!: (value: any) => void;
    mocks.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    const video = host.querySelector<HTMLVideoElement>("[data-app-video-player] video")!;
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    video.currentTime = 6.25;
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="视频截帧"]')!;
    act(() => video.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: trigger })));
    click('[aria-label="视频截帧"]');
    const option = host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[["current", "first", "last"].indexOf(mode)];
    act(() => option.click());
    // Closing the menu exposes the video beneath the cursor and emits mouseover.
    act(() => video.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: option })));
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(6.25);
    await act(async () => finish({ file: new File(["png"], "frame.png", { type: "image/png" }), time: 6.25 }));
  });
  it.each(["current", "first", "last"])("shows and downloads a saved %s frame immediately and reloads it from history", async mode => {
    await mount();
    click('[aria-label="视频截帧"]');
    const options = [...host.querySelectorAll<HTMLButtonElement>('[data-video-frame-menu] button')];
    expect(options.map(option => option.textContent)).toEqual(["截取当前帧", "截取首帧", "截取尾帧"]);
    await act(async () => options[["current", "first", "last"].indexOf(mode)].click());
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(HTMLVideoElement), mode);
    expect(host.querySelector("[data-result]")?.getAttribute("src")).toBe(framePath);
    expect(host.querySelector(`a[download][href="${framePath}"]`)).not.toBeNull();
    const expectedLabel = mode === "first" ? "首帧" : mode === "last" ? "尾帧" : "截图 4.25秒";
    const assertFrameActions = () => {
      expect(host.querySelector("[data-result]")?.getAttribute("data-dimensions")).toBe(JSON.stringify({ width: 2560, height: 1440 }));
      const thumbnail = host.querySelector('[data-history-thumbnail="item:13"]')!;
      expect(thumbnail.textContent).toContain(expectedLabel);
      expect(thumbnail.textContent).not.toContain("图片");
      expect(thumbnail.querySelector('[aria-label="重新生成这张结果"]')).toBeNull();
      expect([...host.querySelectorAll("button")].some(button => button.textContent?.trim() === "重新生成")).toBe(false);
      expect(thumbnail.querySelector('[aria-label="删除"]')).not.toBeNull();
    };
    assertFrameActions();
    expect(records).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(host.querySelector("[data-result]")?.getAttribute("src")).toBe(framePath);
    assertFrameActions();
  });
  it("keeps regeneration actions without redundant labels on normal generated images", async () => {
    records = [{ ...records[0], type: "image_edit", model: "nano-banana-pro", localPath: framePath }];
    await mount();
    const thumbnail = host.querySelector('[data-history-thumbnail="item:12"]')!;
    expect(thumbnail.textContent).not.toContain("图片");
    expect(thumbnail.querySelector('[aria-label="重新生成这张结果"]')).not.toBeNull();
    expect([...host.querySelectorAll("button")].some(button => button.textContent?.trim() === "重新生成")).toBe(true);
  });
  it.each([[0, "截图 0秒"], [6.7, "截图 6.7秒"], [15.084, "截图 15.08秒"]])("formats captured seconds %s without trailing zeroes", async (time, label) => {
    records = [{ ...records[0], type: "image_edit", model: "video-frame", localPath: framePath, params: { videoFrame: { mode: "current", time } } }];
    await mount();
    expect(host.querySelector('[data-history-thumbnail="item:12"]')?.textContent).toContain(label);
  });
  it("keeps the original video when saving fails and shows the error", async () => {
    failSave = true;
    await mount();
    click('[aria-label="视频截帧"]');
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(host.textContent).toContain("截帧保存失败，请重试");
    expect(host.querySelector(`a[download][href="${sourcePath}"]`)).not.toBeNull();
    expect(records).toHaveLength(1);
  });
  it("prevents duplicate clicks during extraction", async () => {
    let finish!: (value: any) => void;
    mocks.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    click('[aria-label="视频截帧"]');
    const first = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    act(() => { first.click(); first.click(); });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="正在截帧"]')?.disabled).toBe(true);
    await act(async () => finish({ file: new File(["png"], "frame.png", { type: "image/png" }), time: 1 }));
    expect(request.mock.calls.filter(([url]) => url === "/api/video-frames")).toHaveLength(1);
  });
  it("supports keyboard navigation, escape and outside click", async () => {
    await mount();
    click('[aria-label="视频截帧"]');
    const first = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(document.activeElement).toBe(first);
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("截取尾帧");
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[data-video-frame-menu]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("视频截帧");
    click('[aria-label="视频截帧"]');
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector('[data-video-frame-menu]')).toBeNull();
  });
});
