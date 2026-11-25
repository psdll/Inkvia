import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adjustVideoClipRange, getCanvasVideoClipName, trimCanvasVideo, cropCanvasVideo } from "@/lib/canvas/video-clip";

const media = vi.hoisted(() => ({ execute: vi.fn(), dispose: vi.fn(), valid: true, discarded: [] as unknown[], options: null as any, source: null as any }));
vi.mock("mediabunny", () => ({
  Input: class { constructor(options: any) { media.source = options.source; } dispose = media.dispose; getPrimaryVideoTrack = async () => ({ displayWidth: 1920, displayHeight: 1080 }); computeDuration = async () => 25; },
  BlobSource: class { constructor(public blob: Blob) {} },
  UrlSource: class {}, ALL_FORMATS: [], BufferTarget: class { buffer = new ArrayBuffer(16); }, Mp4OutputFormat: class {},
  Output: class { target: any; constructor(options: any) { this.target = options.target; } },
  Conversion: { init: async (options: any) => { media.options = options; return { isValid: media.valid, discardedTracks: media.discarded, execute: media.execute, cancel: vi.fn() }; } },
}));
const sourceBlob = new Blob(["source-video"], { type: "video/mp4" });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => sourceBlob }))); });
afterEach(() => vi.unstubAllGlobals());
describe("video clip range", () => {
  it("moves the whole selection without changing its length at either boundary", () => {
    const range = { start: 2.15, end: 7.3, duration: 25 };
    expect(adjustVideoClipRange(range, "move", -10, false)).toEqual({ start: 0, end: 5.15, duration: 25 });
    expect(adjustVideoClipRange(range, "move", 100, false)).toEqual({ start: 19.85, end: 25, duration: 25 });
  });
  it("snaps to whole seconds and keeps a nonempty selection when crossing handles", () => {
    expect(adjustVideoClipRange({ start: 2, end: 7, duration: 25 }, "start", .7, true).start).toBe(3);
    expect(adjustVideoClipRange({ start: 2, end: 7, duration: 25 }, "start", 10, false).start).toBe(6.99);
    expect(adjustVideoClipRange({ start: 2, end: 7, duration: 25 }, "end", -10, false).end).toBe(2.01);
  });
  it("names the actual downloadable result from its source", () => expect(getCanvasVideoClipName("演员.mp4")).toBe("演员_截取"));
});
describe("video clip export", () => {
  it("crops source pixels while preserving the full duration and audio", async () => {
    const crop = { left: 192, top: 108, width: 1536, height: 864, sourceWidth: 1920, sourceHeight: 1080 };
    const result = await cropCanvasVideo("/clip.mp4", crop);
    expect(media.options.trim).toBeUndefined();
    expect(media.options.video.crop).toEqual({ left: 192, top: 108, width: 1536, height: 864 });
    expect(media.options.audio?.discard).not.toBe(true);
    expect(result).toMatchObject({ width: 1536, height: 864, durationSeconds: 25 });
    expect(getCanvasVideoClipName("演员.mp4", "crop")).toBe("演员_裁剪");
    await expect(cropCanvasVideo("/clip.mp4", { ...crop, left: 1000 })).rejects.toThrow("尺寸");
    await expect(cropCanvasVideo("/clip.mp4", { ...crop, width: 1535 })).rejects.toThrow("范围");
  });
  it("reads a complete abortable response before decoding, without background range requests", async () => {
    const controller = new AbortController();
    await trimCanvasVideo("/clip.mp4", 3.15, 8.3, undefined, controller.signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/clip.mp4", { signal: controller.signal });
    expect(media.source.blob).toBe(sourceBlob);
  });
  it("reports HTTP failures instead of attempting to decode an error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(trimCanvasVideo("/clip.mp4", 1, 3)).rejects.toThrow("503");
  });
  it("propagates cancellation during download through the export promise", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    vi.mocked(fetch).mockRejectedValueOnce(error);
    await expect(trimCanvasVideo("/clip.mp4", 1, 3)).rejects.toBe(error);
  });
  it("exports the requested time range with video and audio intact", async () => {
    const clip = await trimCanvasVideo("/clip.mp4", 3.15, 8.3);
    expect(media.options.trim).toEqual({ start: 3.15, end: 8.3 });
    expect(media.options.video.forceTranscode).toBe(true);
    expect(media.options.copy.boundaryPolicy).toBe("shrink");
    expect(media.options.audio?.discard).not.toBe(true);
    expect(clip).toMatchObject({ width: 1920, height: 1080, durationSeconds: 5.15 });
    expect(clip.blob.type).toBe("video/mp4");
    expect(media.execute).toHaveBeenCalled();
    expect(media.dispose).toHaveBeenCalled();
  });
  it("rejects out of bounds input", async () => {
    await expect(trimCanvasVideo("/clip.mp4", 10, 8)).rejects.toThrow();
    await expect(trimCanvasVideo("/clip.mp4", 20, 28)).rejects.toThrow();
  });
  it("fails instead of silently dropping an unsupported audio track", async () => {
    media.discarded = [{ reason: "undecodable_source" }];
    try { await expect(trimCanvasVideo("/clip.mp4", 1, 3)).rejects.toThrow("音轨"); }
    finally { media.discarded = []; }
  });
});
