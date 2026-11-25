import {
  describeVideoDurationOutOfRange,
  type SeedanceMediaIssue,
  type SeedanceMediaKind,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import {
  MINIMAX_H3_MAX_MODEL_ID,
  isMiniMaxH3VideoModel,
} from "@/lib/minimax-models";

const MIB = 1024 * 1024;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const VIDEO_MIMES = ["video/mp4", "video/quicktime"];
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];

type MiniMaxH3MediaInput = {
  mediaId?: string;
  fileName?: string;
  byteSize: number;
  probe: SeedanceMediaProbe;
};

function issue(
  input: MiniMaxH3MediaInput,
  code: string,
  message: string,
  actual?: string | number,
  expected?: string,
): SeedanceMediaIssue {
  return {
    code,
    message,
    ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(actual !== undefined ? { actual } : {}),
    ...(expected ? { expected } : {}),
  };
}

function inRange(value: number | undefined, min: number, max: number): boolean {
  return Number.isFinite(value) && value! >= min && value! <= max;
}

function normalizeVideoCodec(value: string): string {
  const codec = value.trim().toLowerCase();
  if (["avc", "avc1", "h.264"].includes(codec)) return "h264";
  if (["hevc", "hev1", "hvc1", "h.265"].includes(codec)) return "h265";
  return codec;
}

function normalizeAudioCodec(value: string): string {
  const codec = value.trim().toLowerCase();
  if (codec.startsWith("pcm_")) return "pcm";
  return codec;
}

export function getMiniMaxH3UploadContract(modelId: string): {
  allowedKinds: SeedanceMediaKind[];
  allowedMimeTypes: string[];
  allowedAudioMimeTypes: string[];
  maxBytes: Partial<Record<SeedanceMediaKind, number>>;
} | null {
  const normalized = String(modelId || "").trim();
  if (!isMiniMaxH3VideoModel(normalized)) return null;
  if (normalized === MINIMAX_H3_MAX_MODEL_ID) {
    return {
      allowedKinds: ["image"],
      allowedMimeTypes: [...IMAGE_MIMES],
      allowedAudioMimeTypes: [],
      maxBytes: { image: 30 * MIB },
    };
  }
  return {
    allowedKinds: ["image", "video", "audio"],
    allowedMimeTypes: [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES],
    allowedAudioMimeTypes: [...AUDIO_MIMES],
    maxBytes: { image: 30 * MIB, video: 50 * MIB, audio: 15 * MIB },
  };
}

export function validateMiniMaxH3MediaFile(input: MiniMaxH3MediaInput): SeedanceMediaIssue[] {
  const { probe } = input;
  const issues: SeedanceMediaIssue[] = [];
  if (probe.kind === "image") {
    if (!IMAGE_MIMES.includes(probe.detectedMime)) issues.push(issue(input, "image_format_unsupported", "图片格式必须是 JPG、PNG、WEBP、HEIC 或 HEIF。"));
    if (input.byteSize > 30 * MIB) issues.push(issue(input, "image_file_too_large", "图片文件不能超过 30MB。"));
    if (!inRange(probe.width, 256, 5760) || !inRange(probe.height, 256, 5760)) issues.push(issue(input, "image_dimension_out_of_range", "图片宽高必须在 256–5760 像素之间。"));
    if (Number.isFinite(probe.width) && Number.isFinite(probe.height) && !inRange(probe.width! / probe.height!, 0.4, 2.5)) issues.push(issue(input, "image_aspect_ratio_out_of_range", "图片宽高比必须在 0.4–2.5 之间。"));
    return issues;
  }
  if (probe.kind === "video") {
    if (!VIDEO_MIMES.includes(probe.detectedMime)) issues.push(issue(input, "video_format_unsupported", "视频格式必须是 MP4 或 MOV。"));
    if (input.byteSize > 50 * MIB) issues.push(issue(input, "video_file_too_large", "视频文件不能超过 50MB。"));
    if (!inRange(probe.width, 256, 5760) || !inRange(probe.height, 256, 5760)) issues.push(issue(input, "video_dimension_out_of_range", "视频宽高必须在 256–5760 像素之间。"));
    if (Number.isFinite(probe.width) && Number.isFinite(probe.height) && !inRange(probe.width! / probe.height!, 0.4, 2.5)) issues.push(issue(input, "video_aspect_ratio_out_of_range", "视频宽高比必须在 0.4–2.5 之间。"));
    if (!inRange(probe.durationSeconds, 2, 15)) {
      const actual = probe.durationSeconds;
      const hasActual = typeof actual === "number" && Number.isFinite(actual);
      issues.push(issue(
        input,
        "video_duration_out_of_range",
        hasActual
          ? describeVideoDurationOutOfRange(actual, 2, 15)
          : "视频时长必须在 2–15 秒之间。",
        hasActual ? actual : undefined,
        "2–15s",
      ));
    }
    if (!inRange(probe.frameRate, 23.976, 60)) issues.push(issue(input, "video_frame_rate_out_of_range", "视频帧率必须在 23.976–60 FPS 之间。"));
    if (!probe.videoCodec || !["h264", "h265"].includes(normalizeVideoCodec(probe.videoCodec))) issues.push(issue(input, "video_codec_unsupported", "视频编码必须是 H.264 或 H.265。"));
    const unsupportedTrack = (probe.audioCodecs ?? []).map(normalizeAudioCodec).find((codec) => !["aac", "mp3"].includes(codec));
    if (unsupportedTrack) issues.push(issue(input, "video_audio_codec_unsupported", "视频音轨编码必须是 AAC 或 MP3。"));
    return issues;
  }
  if (!AUDIO_MIMES.includes(probe.detectedMime)) issues.push(issue(input, "audio_format_unsupported", "音频格式必须是 MP3 或 WAV。"));
  if (input.byteSize > 15 * MIB) issues.push(issue(input, "audio_file_too_large", "音频文件不能超过 15MB。"));
  if (!inRange(probe.durationSeconds, 2, 15)) issues.push(issue(input, "audio_duration_out_of_range", "音频时长必须在 2–15 秒之间。"));
  const codecs = (probe.audioCodecs ?? []).map(normalizeAudioCodec);
  if (!codecs.length || codecs.some((codec) => !["mp3", "pcm"].includes(codec))) issues.push(issue(input, "audio_codec_unsupported", "音频编码必须与 MP3 或 WAV 格式匹配。"));
  return issues;
}

export function validateMiniMaxH3MediaSet(input: {
  modelId: string;
  media: MiniMaxH3MediaInput[];
}): SeedanceMediaIssue[] {
  const normalized = String(input.modelId || "").trim();
  if (!isMiniMaxH3VideoModel(normalized)) return [];
  const issues = input.media.flatMap(validateMiniMaxH3MediaFile);
  if (normalized === MINIMAX_H3_MAX_MODEL_ID) {
    const unsupported = input.media.find((media) => media.probe.kind !== "image");
    if (unsupported) {
      issues.push({
        code: "media_kind_unsupported",
        message: "MiniMax-H3-Max 仅支持首帧或尾帧图片，不支持参考视频、参考音频或多模态参考。",
        ...(unsupported.mediaId ? { mediaId: unsupported.mediaId } : {}),
        ...(unsupported.fileName ? { fileName: unsupported.fileName } : {}),
      });
    }
    if (input.media.filter((media) => media.probe.kind === "image").length > 2) {
      issues.push({ code: "too_many_images", message: "首帧与尾帧图片合计不能超过 2 张。" });
    }
    return issues;
  }
  const counts = input.media.reduce((result, media) => {
    result[media.probe.kind] += 1;
    return result;
  }, { image: 0, video: 0, audio: 0 } as Record<SeedanceMediaKind, number>);
  if (counts.image > 9) issues.push({ code: "too_many_images", message: "参考图片不能超过 9 张。" });
  if (counts.video > 3) issues.push({ code: "too_many_videos", message: "参考视频不能超过 3 个。" });
  if (counts.audio > 3) issues.push({ code: "too_many_audios", message: "参考音频不能超过 3 个。" });
  if (input.media.length > 15) issues.push({ code: "too_many_media", message: "参考素材合计不能超过 15 个。" });
  for (const kind of ["video", "audio"] as const) {
    const total = input.media.reduce((sum, media) => media.probe.kind === kind ? sum + (media.probe.durationSeconds ?? 0) : sum, 0);
    if (total > 15) issues.push({ code: "timed_media_duration_exceeded", message: `${kind === "video" ? "视频" : "音频"}总时长不能超过 15 秒。` });
  }
  return issues;
}
