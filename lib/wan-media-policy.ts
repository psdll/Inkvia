import type { SeedanceMediaProbe, SeedanceMediaIssue } from "@/lib/seedance-media-policy";
import { isWanVideoModel } from "@/lib/wan-models";

export function getWanUploadContract(model: string) {
  if (!isWanVideoModel(model)) return null;
  const audio = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];
  return {
    allowedKinds: ["image", "video", "audio"] as Array<"image" | "video" | "audio">,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/bmp", "image/webp", "video/mp4", "video/quicktime", ...audio],
    allowedAudioMimeTypes: audio,
    maxBytes: { image: 20 * 1024 * 1024, video: 100 * 1024 * 1024, audio: 15 * 1024 * 1024 },
  };
}

// Wan3.0 exact-model limits, verified 2026-09-08 against the official API reference.
export function validateWanMediaSet(input: {
  duration?: number;
  media: Array<{ fileName?: string; byteSize: number; probe: SeedanceMediaProbe }>;
}): SeedanceMediaIssue[] {
  const issues: SeedanceMediaIssue[] = [];
  let videoSeconds = 0;
  let audioSeconds = 0;
  for (const media of input.media) {
    const p = media.probe;
    const fail = (message: string) => issues.push({ code: "WAN_MEDIA_INVALID", message, fileName: media.fileName });
    const image = p.kind === "image";
    const video = p.kind === "video";
    const mimes = image ? ["image/jpeg", "image/png", "image/bmp", "image/webp"]
      : video ? ["video/mp4", "video/quicktime"] : ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];
    if (!mimes.includes(p.detectedMime)) fail("Wan3.0 图片支持 JPEG/PNG/BMP/WebP，视频支持 MP4/MOV，音频支持 MP3/WAV");
    if (media.byteSize > (image ? 20 : video ? 100 : 15) * 1024 * 1024) fail(`Wan3.0 当前素材不能超过 ${image ? 20 : video ? 100 : 15}MB`);
    if (image || video) {
      const max = image ? 8000 : 4096;
      if (!p.width || !p.height || p.width < 240 || p.height < 240 || p.width > max || p.height > max) fail(`Wan3.0 素材单边尺寸须为 240–${max} 像素`);
      if (p.width && p.height && Math.max(p.width / p.height, p.height / p.width) > 8) fail("Wan3.0 素材长宽比不能超过 8:1");
    }
    if (!image) {
      if (!Number.isFinite(p.durationSeconds) || p.durationSeconds! < 1 || p.durationSeconds! > 15) fail("Wan3.0 单段视频或音频须为 1–15 秒");
      if (video) videoSeconds += p.durationSeconds || 0;
      else audioSeconds += p.durationSeconds || 0;
    }
    if (video && (!Number.isFinite(p.frameRate) || p.frameRate! < 16)) fail("Wan3.0 参考视频帧率至少为 16fps");
  }
  if (videoSeconds > 15) issues.push({ code: "WAN_VIDEO_DURATION", message: "Wan3.0 参考视频总时长不能超过 15 秒" });
  if (audioSeconds > 15) issues.push({ code: "WAN_AUDIO_DURATION", message: "Wan3.0 参考音频总时长不能超过 15 秒" });
  if (videoSeconds > 0 && input.duration !== -1 && videoSeconds + (input.duration ?? 5) > 30) {
    issues.push({ code: "WAN_TOTAL_DURATION", message: "Wan3.0 输入视频总时长与输出时长之和不能超过 30 秒" });
  }
  return issues;
}
