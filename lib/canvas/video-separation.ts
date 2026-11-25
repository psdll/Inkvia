"use client";

export type CanvasVideoSeparation = { audio: Blob; video: Blob; width: number; height: number; durationSeconds: number };

export type CanvasVideoSeparationMode = "tracks" | "vocals" | "background";
export type CanvasVideoSeparationJob = {
  mode: CanvasVideoSeparationMode;
  status: "running" | "success" | "error";
  progress: number;
  error?: string;
};

export async function extractCanvasVideoAudio(audio: Blob, mode: "vocals" | "background", signal?: AbortSignal) {
  const response = await fetch(`/api/canvas/audio-separation?stem=${mode}`, {
    method: "POST", headers: { "Content-Type": audio.type }, body: audio, signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "音频提取失败，请重试");
  }
  return response.blob();
}

export function getCanvasVideoSeparationNames(name: string, mode: CanvasVideoSeparationMode = "tracks") {
  const base = name.replace(/\.(mp4|mov|webm|mkv|m4v|avi)$/i, "");
  return { audio: `${base}_${mode === "vocals" ? "人声" : mode === "background" ? "背景音" : "音轨"}`, video: `${base}_无声` };
}

export async function separateCanvasVideo(src: string, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<CanvasVideoSeparation> {
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } = await import("mediabunny");
  signal?.throwIfAborted();
  // Download once so cancelled range prefetches cannot reject outside this operation.
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`视频下载失败（${response.status}），请重试`);
  const blob = await response.blob();
  signal?.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  const cancel = () => { void conversion?.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new Error("素材中没有视频轨道");
    if (!audio) throw new Error("此视频没有音轨，无需进行音视频分离");
    const durationSeconds = await input.computeDuration();
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("无法读取视频时长");
    const outputs: Blob[] = [];
    for (const kind of ["audio", "video"] as const) {
      signal?.throwIfAborted();
      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      // MP4 with only audio is an M4A file. Compatible packets are copied without re-encoding.
      conversion = await Conversion.init({ input, output, tracks: "all", ...(kind === "audio" ? { video: { discard: true } } : { audio: { discard: true } }) });
      signal?.throwIfAborted();
      if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== "discarded_by_user")) {
        throw new Error("当前浏览器无法完整分离此视频的轨道，请使用其他视频格式重试");
      }
      conversion.onProgress = progress => onProgress?.((outputs.length + progress) / 2);
      await conversion.execute();
      signal?.throwIfAborted();
      if (!output.target.buffer) throw new Error("音视频分离导出失败，请重试");
      outputs.push(new Blob([output.target.buffer], { type: kind === "audio" ? "audio/mp4" : "video/mp4" }));
    }
    return { audio: outputs[0], video: outputs[1], width: video.displayWidth, height: video.displayHeight, durationSeconds };
  } finally {
    signal?.removeEventListener("abort", cancel);
    input.dispose();
  }
}
