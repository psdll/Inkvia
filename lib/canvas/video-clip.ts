"use client";

import type { VideoCrop } from "./video-crop";

export type VideoClipRange = { start: number; end: number; duration: number };
export type CanvasVideoClip = { blob: Blob; width: number; height: number; durationSeconds: number };
export type VideoClipHandle = "start" | "end" | "move";
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number) => Math.round(n * 1000000) / 1000000;
export const getCanvasVideoClipName = (name: string, operation?: "crop") => `${name.replace(/\.(mp4|mov|webm|mkv|m4v|avi)$/i, "")}_${operation === "crop" ? "裁剪" : "截取"}`;

export function adjustVideoClipRange(range: VideoClipRange, handle: VideoClipHandle, delta: number, snap: boolean): VideoClipRange {
  const min = Math.min(.01, range.duration);
  const value = (n: number) => snap ? Math.round(n) : n;
  if (handle === "move") {
    const length = range.end - range.start;
    const start = clamp(value(range.start + delta), 0, range.duration - length);
    return { ...range, start: round(start), end: round(start + length) };
  }
  return handle === "start"
    ? { ...range, start: round(clamp(value(range.start + delta), 0, range.end - min)) }
    : { ...range, end: round(clamp(value(range.end + delta), range.start + min, range.duration)) };
}

export async function trimCanvasVideo(src: string, start: number, end: number, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<CanvasVideoClip> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("请选择有效的视频截取范围");
  return processCanvasVideo(src, { trim: { start, end } }, onProgress, signal);
}

export async function cropCanvasVideo(src: string, crop: VideoCrop, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<CanvasVideoClip> {
  if (![crop.left, crop.top, crop.width, crop.height].every(Number.isInteger) || crop.left < 0 || crop.top < 0 || crop.width < 2 || crop.height < 2 || crop.width % 2 || crop.height % 2) throw new Error("请选择有效的视频裁切范围");
  return processCanvasVideo(src, { crop }, onProgress, signal);
}

async function processCanvasVideo(src: string, edit: { trim?: { start: number; end: number }; crop?: VideoCrop }, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<CanvasVideoClip> {
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } = await import("mediabunny");
  signal?.throwIfAborted();
  // Keep reads inside this awaited request; UrlSource's cancelled range prefetches can reject in the background.
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`视频下载失败（${response.status}），请重试`);
  const source = await response.blob();
  signal?.throwIfAborted();
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  const cancel = () => { void conversion?.cancel(); input.dispose(); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    if (!video || !Number.isFinite(duration) || duration <= 0 || (edit.trim && edit.trim.end > duration + .001)) throw new Error("视频时长已变化，请重新选择截取范围");
    const crop = edit.crop;
    if (crop && (crop.sourceWidth !== video.displayWidth || crop.sourceHeight !== video.displayHeight || crop.left + crop.width > video.displayWidth || crop.top + crop.height > video.displayHeight)) throw new Error("视频尺寸已变化，请重新选择裁切范围");
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    // Video needs exact frame boundaries; keep compatible audio without adding encoder priming/padding.
    conversion = await Conversion.init({ input, output, trim: edit.trim, video: { forceTranscode: true, ...(crop ? { crop: { left: crop.left, top: crop.top, width: crop.width, height: crop.height } } : {}) }, copy: { boundaryPolicy: "shrink" } });
    signal?.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error("当前浏览器无法完整处理此视频或音轨，请使用最新版 Chrome 重试");
    conversion.onProgress = progress => onProgress?.(progress);
    await conversion.execute();
    signal?.throwIfAborted();
    if (!output.target.buffer) throw new Error("视频片段导出失败");
    return { blob: new Blob([output.target.buffer], { type: "video/mp4" }), width: crop?.width ?? video.displayWidth, height: crop?.height ?? video.displayHeight, durationSeconds: round(edit.trim ? edit.trim.end - edit.trim.start : duration) };
  } finally { signal?.removeEventListener("abort", cancel); input.dispose(); }
}

/** A separate decoder keeps thumbnail seeking from disturbing the node's preview. */
export async function loadVideoClipTimeline(src: string, signal: AbortSignal, onFrame: (url: string, index: number) => void) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; video.preload = "auto"; video.muted = true; video.playsInline = true;
  const wait = (ready: () => boolean) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); for (const event of ["loadeddata", "seeked", "error"]) video.removeEventListener(event, check); signal.removeEventListener("abort", aborted); };
    const aborted = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    const check = () => { if (video.error) { cleanup(); reject(new Error("视频加载失败")); } else if (ready()) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error("视频加载超时，请重试")); }, 20000);
    for (const event of ["loadeddata", "seeked", "error"]) video.addEventListener(event, check);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
  try {
    video.src = src;
    await wait(() => video.readyState >= 2);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法读取视频时长");
    const duration = video.duration;
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 68;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成视频时间轴");
    for (let i = 0; i < 12; i++) {
      signal.throwIfAborted();
      video.currentTime = Math.min(duration - .001, duration * i / 12);
      await wait(() => video.readyState >= 2 && !video.seeking);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      onFrame(canvas.toDataURL("image/jpeg", .65), i);
    }
    return duration;
  } finally { video.removeAttribute("src"); video.load(); }
}
