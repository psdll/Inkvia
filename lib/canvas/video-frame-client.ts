"use client";

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked", errorMessage: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener("error", handleError);
    };
    const handleSuccess = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

export async function captureCanvasVideoReferenceFrame(sourceUrl: string) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  try {
    await waitForVideoEvent(video, "loadedmetadata", "视频加载失败");
    const targetTime = Number.isFinite(video.duration)
      ? Math.min(Math.max(video.duration / 2, 0), Math.max(video.duration - 0.05, 0))
      : 0;
    if (targetTime > 0) {
      const seeked = waitForVideoEvent(video, "seeked", "视频关键帧读取失败");
      video.currentTime = targetTime;
      await seeked;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("视频关键帧读取失败");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("视频关键帧导出失败");
    return new File([blob], `llm-video-frame-${Date.now()}.png`, { type: "image/png" });
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
