"use client";

import { VIDEO_FRAME_LABELS, videoFrameTime, type VideoFrameMode } from "@/lib/video-frame";

export type CapturedVideoFrame = { file: File; time: number; width: number; height: number };

function waitForFrame(video: HTMLVideoElement, ready: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const events = ["loadedmetadata", "loadeddata", "canplay", "seeked"];
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach((event) => video.removeEventListener(event, check));
      video.removeEventListener("error", fail);
    };
    const check = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("视频帧读取失败，请等待视频加载后重试"));
    };
    const timer = setTimeout(fail, 15_000);
    events.forEach((event) => video.addEventListener(event, check));
    video.addEventListener("error", fail);
    if (video.error) fail();
    else check();
  });
}

export async function captureVideoFrame(video: HTMLVideoElement, mode: VideoFrameMode): Promise<CapturedVideoFrame> {
  const time = videoFrameTime(mode, video.currentTime, video.duration);
  let decoder: HTMLVideoElement | null = null;
  try {
    let source = video;
    if (mode !== "current") {
      decoder = document.createElement("video");
      decoder.crossOrigin = "anonymous";
      decoder.preload = "auto";
      decoder.muted = true;
      decoder.playsInline = true;
      decoder.src = video.currentSrc || video.src;
      source = decoder;
      await waitForFrame(source, () => source.readyState >= 2 && !source.seeking);
      if (time !== source.currentTime) {
        source.currentTime = time;
        await waitForFrame(source, () => !source.seeking && source.readyState >= 2);
      }
    } else if (source.readyState < 2 || source.seeking) {
      throw new Error("当前画面尚未就绪，请等待视频加载后重试");
    }

    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("无法读取视频画面");
    // Draw synchronously before awaiting PNG encoding so current means the clicked frame.
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("视频帧导出失败")), "image/png");
    });
    return { file: new File([blob], `${VIDEO_FRAME_LABELS[mode]}.png`, { type: "image/png" }), time, width: canvas.width, height: canvas.height };
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new Error("该视频暂不支持截帧，请等待视频保存完成后重试");
    }
    throw error;
  } finally {
    if (decoder) {
      decoder.removeAttribute("src");
      decoder.load();
    }
  }
}

// Lazy canvas players may have released their decoder before the toolbar is used.
export async function captureVideoFrameFromSource(src: string, mode: VideoFrameMode, currentTime = 0) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = src;
  try {
    await waitForFrame(video, () => video.readyState >= 2 && !video.seeking);
    const time = videoFrameTime(mode, currentTime, video.duration);
    if (video.currentTime !== time) {
      video.currentTime = time;
      await waitForFrame(video, () => !video.seeking && video.readyState >= 2);
    }
    const frame = await captureVideoFrame(video, "current");
    return { ...frame, file: new File([frame.file], `${VIDEO_FRAME_LABELS[mode]}.png`, { type: "image/png" }), time };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
