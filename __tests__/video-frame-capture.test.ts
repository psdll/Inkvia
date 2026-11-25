// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureVideoFrame, captureVideoFrameFromSource } from "@/lib/browser/video-frame-capture";
import { videoFrameNodeName, videoFrameTime } from "@/lib/video-frame";

let draw: ReturnType<typeof vi.fn>;
let live: HTMLVideoElement;
function readyVideo() {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    duration: { configurable: true, value: 15.1 }, readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 2560 }, videoHeight: { configurable: true, value: 1440 },
  });
  video.src = "/uploads/video_results/source.mp4";
  video.currentTime = 4.25;
  return video;
}
beforeEach(() => {
  vi.useFakeTimers();
  draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["png"], { type: "image/png" })));
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  live = readyVideo();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("video frame extraction", () => {
  it("captures the visible current frame synchronously at original resolution", async () => {
    const promise = captureVideoFrame(live, "current");
    expect(draw).toHaveBeenCalledWith(live, 0, 0, 2560, 1440);
    const result = await promise;
    expect(result.time).toBe(4.25);
    expect(result.file.type).toBe("image/png");
    expect(result).toMatchObject({ width: 2560, height: 1440 });
    expect(live.currentTime).toBe(4.25);
  });
  it.each(["first", "last"] as const)("uses an independent decoder for %s without changing playback", async mode => {
    const decoder = readyVideo();
    decoder.currentTime = 0;
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((name: string) => name === "video" ? decoder : originalCreate(name)) as any);
    const result = await captureVideoFrame(live, mode);
    expect(result.time).toBe(mode === "first" ? 0 : 15.1 - 0.000001);
    expect(draw).toHaveBeenCalledWith(decoder, 0, 0, 2560, 1440);
    expect(live.currentTime).toBe(4.25);
    expect(decoder.getAttribute("src")).toBeNull();
    expect(decoder.load).toHaveBeenCalled();
  });
  it("waits for decoded pixels instead of drawing at metadata readiness", async () => {
    const decoder = readyVideo();
    decoder.currentTime = 0;
    Object.defineProperty(decoder, "readyState", { configurable: true, value: 1 });
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((name: string) => name === "video" ? decoder : originalCreate(name)) as any);
    const pending = captureVideoFrame(live, "first");
    decoder.dispatchEvent(new Event("loadedmetadata"));
    expect(draw).not.toHaveBeenCalled();
    Object.defineProperty(decoder, "readyState", { value: 2 });
    decoder.dispatchEvent(new Event("loadeddata"));
    await pending;
    expect(draw).toHaveBeenCalledTimes(1);
  });
  it("times out and releases an unreadable decoder", async () => {
    const decoder = readyVideo();
    Object.defineProperty(decoder, "readyState", { value: 0 });
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((name: string) => name === "video" ? decoder : originalCreate(name)) as any);
    const pending = expect(captureVideoFrame(live, "last")).rejects.toThrow("视频帧读取失败");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(decoder.getAttribute("src")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails clearly on tainted canvases and unready current frames", async () => {
    draw.mockImplementation(() => { throw new DOMException("tainted", "SecurityError"); });
    await expect(captureVideoFrame(live, "current")).rejects.toThrow("等待视频保存完成");
    Object.defineProperty(live, "readyState", { value: 1 });
    await expect(captureVideoFrame(live, "current")).rejects.toThrow("尚未就绪");
  });
  it("targets the actual final frame interval even for short clips", () => {
    expect(videoFrameTime("first", 5, 15)).toBe(0);
    expect(videoFrameTime("last", 0, 0.01)).toBeCloseTo(0.009999, 6);
    expect(videoFrameTime("last", 0, 15.1)).toBeGreaterThan(15.1 - 1 / 120);
    expect(() => videoFrameTime("last", 0, Infinity)).toThrow();
  });
  it.each(["first", "current", "last"] as const)("captures %s from an unloaded canvas player with original dimensions", async mode => {
    const decoder = readyVideo(); decoder.currentTime = 0;
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "video" ? decoder : create(tag)) as any);
    const result = await captureVideoFrameFromSource("/source.mp4", mode, 4.98);
    expect(result).toMatchObject({ width: 2560, height: 1440, time: mode === "first" ? 0 : mode === "current" ? 4.98 : 15.1 - .000001 });
    expect(decoder.getAttribute("src")).toBeNull();
    expect(draw).toHaveBeenCalledWith(decoder, 0, 0, 2560, 1440);
  });
  it("names canvas frames with a millisecond timestamp or endpoint label", () => {
    expect(videoFrameNodeName("current", 2.271)).toBe("截图 00:02.271");
    expect(videoFrameNodeName("current", 62.007)).toBe("截图 01:02.007");
    expect(videoFrameNodeName("first", 0)).toBe("首帧");
    expect(videoFrameNodeName("last", 15)).toBe("尾帧");
  });
});
