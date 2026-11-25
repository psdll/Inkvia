import {
  MINIMAX_H3_MAX_MODEL_ID,
  MINIMAX_H3_MAX_UPSTREAM_MODEL,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_UPSTREAM_MODEL,
  MINIMAX_PROVIDER_ID,
  isMiniMaxH3VideoModel,
} from "@/lib/minimax-models";
import { getSeedanceMediaPolicy } from "@/lib/seedance-media-policy";
import { isRetiredProviderModel } from "@/lib/providers/retired-models";
import { WAN_VIDEO_MODEL_ID, WAN_VIDEO_RATIOS, isWanVideoModel } from "@/lib/wan-models";

export type Sora2ModelId =
  | "doubao-seedance-2-0-260128"
  | "doubao-seedance-2-5-260628"
  | "seedance-2.5-apimart"
  | "doubao-seedance-2-0-fast-260128"
  | "doubao-seedance-2-0-mini-260615"
  | "doubao-seedance-2.0-face"
  | "doubao-seedance-2.0-fast-face"
  | "doubao-seedance-1-5-pro-251215"
  | "doubao-seedance-1-0-pro-250528";
export type Sora2AspectValue = "portrait" | "landscape";
export type Sora2ResolutionValue = "480p" | "720p" | "768p" | "1080p" | "2k" | "4k";
export type VideoInputMode = "text_to_video" | "first_frame" | "first_last_frame" | "multimodal";
export type SeedanceOmniReferenceTaskType = "auto" | "edit" | "extend";
export type SeedanceOutputFormat = "mp4" | "mov";

export type VideoReferenceLimits = {
  images: number;
  videos: number;
  audios: number;
  total: number;
  standaloneAudio: boolean;
};

export type Sora2ModelSpec = {
  id: string;
  label: string;
  provider: "volcengine" | "kie" | "apimart" | "aicoming-haiya" | "minimax" | "bailian";
  upstreamModelId?: string;
  supportedInputModes: VideoInputMode[];
  supportsGenerateAudio: boolean;
  supportsWebSearch: boolean;
  supportedResolutions: Sora2ResolutionValue[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  allowAutoDuration: boolean;
  // 可选：未提供时 UI 回退到既有 Seedance 比例列表，避免影响其他模型
  supportedRatios?: string[];
  // 可选：离散时长选项（如 gemini-omni-video 的 4/6/8/10），未提供则按 min~max 连续生成
  durationOptions?: number[];
  // 仅精确声明的模型开放参考音频，避免放宽同系列其他模型。
  supportsReferenceAudio?: boolean;
  referenceLimits?: VideoReferenceLimits;
  supportedOutputFormats?: SeedanceOutputFormat[];
  supportedOmniReferenceTaskTypes?: SeedanceOmniReferenceTaskType[];
};

export const SEEDANCE_20_MODEL_ID = "doubao-seedance-2-0-260128" as const;
export const SEEDANCE_25_MODEL_ID = "doubao-seedance-2-5-260628" as const;
export const APIMART_SEEDANCE_25_MODEL_ID = "seedance-2.5-apimart" as const;
export const APIMART_SEEDANCE_25_UPSTREAM_MODEL = "seedance-2.5" as const;

export function isSeedance25VideoModel(model: string) {
  return model === SEEDANCE_25_MODEL_ID || model === APIMART_SEEDANCE_25_MODEL_ID;
}

const videoModelSpecs: Sora2ModelSpec[] = [
  {
    id: SEEDANCE_20_MODEL_ID,
    label: "Seedance 2.0",
    provider: "volcengine",
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    // 仅 Seedance 2.0（非 Fast）支持 4k（10bit / H.265）
    supportedResolutions: ["480p", "720p", "1080p", "4k"],
    // adaptive：按输入自动选比例（图生视频按首帧图，文生视频按提示词）
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    // 官方 2.0 多模态参考上限；音频不能单独作为唯一参考。
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: false }
  },
  {
    id: SEEDANCE_25_MODEL_ID,
    label: "Seedance 2.5",
    provider: "volcengine",
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 30,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    referenceLimits: { images: 30, videos: 10, audios: 10, total: 50, standaloneAudio: true },
    supportedOutputFormats: ["mp4", "mov"],
    supportedOmniReferenceTaskTypes: ["auto", "edit", "extend"]
  },
  {
    id: APIMART_SEEDANCE_25_MODEL_ID,
    label: "Seedance 2.5（am）",
    provider: "apimart",
    upstreamModelId: APIMART_SEEDANCE_25_UPSTREAM_MODEL,
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 30,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    referenceLimits: { images: 30, videos: 10, audios: 10, total: 50, standaloneAudio: true },
    supportedOutputFormats: ["mp4", "mov"],
    supportedOmniReferenceTaskTypes: ["auto", "edit", "extend"]
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    provider: "volcengine",
    supportedInputModes: ["first_last_frame", "first_frame", "multimodal", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: false },
  },
  {
    // API 预计 2026-06-25 开放调用；属 2.0 系列，但不支持 1080p / 4k（同 Fast，仅到 720p）
    id: "doubao-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini",
    provider: "volcengine",
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: false },
  },
  {
    id: "doubao-seedance-2.0-face",
    label: "Seedance 2.0（face）",
    provider: "apimart",
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: false,
    supportsReferenceAudio: true,
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: false },
  },
  {
    id: "doubao-seedance-2.0-fast-face",
    label: "Seedance 2.0 Fast（face）",
    provider: "apimart",
    supportedInputModes: ["first_last_frame", "first_frame", "multimodal", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: true,
    supportedResolutions: ["480p", "720p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: false,
    supportsReferenceAudio: true,
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: false },
  },
  {
    id: WAN_VIDEO_MODEL_ID,
    label: "Wan3.0",
    provider: "bailian",
    upstreamModelId: WAN_VIDEO_MODEL_ID,
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: true,
    supportsWebSearch: false,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedRatios: WAN_VIDEO_RATIOS,
    minDurationSeconds: 2,
    maxDurationSeconds: 30,
    allowAutoDuration: true,
    supportsReferenceAudio: true,
    referenceLimits: { images: 10, videos: 5, audios: 5, total: 20, standaloneAudio: true },
  },
  {
    id: MINIMAX_H3_MODEL_ID,
    label: "MiniMax-H3",
    provider: MINIMAX_PROVIDER_ID,
    upstreamModelId: MINIMAX_H3_UPSTREAM_MODEL,
    supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
    supportsGenerateAudio: false,
    supportsWebSearch: false,
    supportedResolutions: ["768p", "2k"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    allowAutoDuration: false,
    supportsReferenceAudio: true,
    referenceLimits: { images: 9, videos: 3, audios: 3, total: 15, standaloneAudio: true },
  },
  {
    id: MINIMAX_H3_MAX_MODEL_ID,
    label: "MiniMax-H3-Max",
    provider: MINIMAX_PROVIDER_ID,
    upstreamModelId: MINIMAX_H3_MAX_UPSTREAM_MODEL,
    supportedInputModes: ["first_frame", "first_last_frame", "text_to_video"],
    supportsGenerateAudio: false,
    supportsWebSearch: false,
    supportedResolutions: ["480p", "768p"],
    supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    minDurationSeconds: 5,
    maxDurationSeconds: 15,
    allowAutoDuration: false,
    supportsReferenceAudio: false,
    referenceLimits: { images: 2, videos: 0, audios: 0, total: 2, standaloneAudio: false },
  },
  {
    // KIE 平台 grok-imagine-video-1-5-preview（图生视频），项目内命名为 grok-video-1.5
    id: "grok-video-1.5",
    label: "grok-video-1.5",
    provider: "kie",
    supportedInputModes: ["first_frame"],
    supportsGenerateAudio: false,
    supportsWebSearch: false,
    supportedResolutions: ["480p", "720p"],
    minDurationSeconds: 1,
    maxDurationSeconds: 15,
    allowAutoDuration: false,
    supportedRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "auto"]
  },
  {
    // KIE 平台 gemini-omni-video（多模态参考生视频），项目内命名保持 gemini-omni-video
    id: "gemini-omni-video",
    label: "gemini-omni-video",
    provider: "kie",
    supportedInputModes: ["multimodal"],
    supportsGenerateAudio: false,
    supportsWebSearch: false,
    supportedResolutions: ["720p", "1080p", "4k"],
    minDurationSeconds: 4,
    maxDurationSeconds: 10,
    allowAutoDuration: false,
    supportedRatios: ["16:9", "9:16"],
    durationOptions: [4, 6, 8, 10]
  }
];

// Keep retired metadata for historical tasks; only active models enter the catalog.
export const sora2Models = videoModelSpecs.filter((model) => !isRetiredProviderModel(model.provider, model.id));

export function mapAspectRatioLabelToValue(label: string): Sora2AspectValue {
  const v = String(label || "").trim();
  if (v === "16:9") return "landscape";
  return "portrait";
}

export function isSeedance20VideoModel(model: string): boolean {
  const v = String(model || "").trim();
  return (
    v === "doubao-seedance-2-0-260128" ||
    v === "doubao-seedance-2-0-fast-260128" ||
    v === "doubao-seedance-2-0-mini-260615" ||
    v === "doubao-seedance-2.0-face" ||
    v === "doubao-seedance-2.0-fast-face"
  );
}

export function isSeedance15ProVideoModel(model: string): boolean {
  return String(model || "").trim() === "doubao-seedance-1-5-pro-251215";
}

export function isSeedance10ProVideoModel(model: string): boolean {
  return String(model || "").trim() === "doubao-seedance-1-0-pro-250528";
}

export function isVolcengineVideoModel(model: string): boolean {
  const v = String(model || "").trim();
  return (
    v === "doubao-seedance-2-0-260128" ||
    v === SEEDANCE_25_MODEL_ID ||
    v === "doubao-seedance-2-0-fast-260128" ||
    v === "doubao-seedance-2-0-mini-260615" ||
    isSeedance15ProVideoModel(v) ||
    isSeedance10ProVideoModel(v)
  );
}

export function isApimartVideoModel(model: string): boolean {
  const v = String(model || "").trim();
  return v === APIMART_SEEDANCE_25_MODEL_ID || v === "doubao-seedance-2.0-face" || v === "doubao-seedance-2.0-fast-face";
}

export function isGrokVideoModel(model: string): boolean {
  return String(model || "").trim() === "grok-video-1.5";
}

export function isGeminiOmniVideoModel(model: string): boolean {
  return String(model || "").trim() === "gemini-omni-video";
}

export function isKieVideoModel(model: string): boolean {
  return isGrokVideoModel(model) || isGeminiOmniVideoModel(model);
}

// 把项目内模型 id 映射成 KIE 平台实际调用的 model 名
export function getKieVideoApiModel(model: string): string {
  if (isGrokVideoModel(model)) return "grok-imagine-video-1-5-preview";
  if (isGeminiOmniVideoModel(model)) return "gemini-omni-video";
  return String(model || "").trim();
}

export function getVideoModelSpec(model: string): Sora2ModelSpec {
  const normalized = String(model || "").trim();
  return videoModelSpecs.find((item) => item.id === normalized) || sora2Models[0];
}

export function normalizeVideoInputMode(model: string, inputMode: string): VideoInputMode {
  const value = String(inputMode || "").trim() as VideoInputMode;
  const spec = getVideoModelSpec(model);
  if (spec.supportedInputModes.includes(value)) return value;
  return spec.supportedInputModes[0];
}

export function modelSupportsGenerateAudio(model: string): boolean {
  return getVideoModelSpec(model).supportsGenerateAudio;
}

export function modelSupportsWebSearch(model: string): boolean {
  return getVideoModelSpec(model).supportsWebSearch;
}

export function modelSupportsReferenceAudio(model: string): boolean {
  const seedancePolicy = getSeedanceMediaPolicy(String(model || "").trim());
  if (seedancePolicy) return seedancePolicy.allowedKinds.includes("audio");
  return getVideoModelSpec(model).id === String(model || "").trim()
    && getVideoModelSpec(model).supportsReferenceAudio === true;
}

export function getVideoReferenceLimits(model: string): VideoReferenceLimits | undefined {
  const normalized = String(model || "").trim();
  const seedancePolicy = getSeedanceMediaPolicy(normalized);
  if (seedancePolicy) {
    return {
      images: seedancePolicy.limits.maxImages,
      videos: seedancePolicy.limits.maxVideos,
      audios: seedancePolicy.limits.maxAudios,
      total: seedancePolicy.limits.maxTotal,
      standaloneAudio: seedancePolicy.limits.allowStandaloneAudio,
    };
  }
  const spec = sora2Models.find((item) => item.id === normalized);
  return spec?.referenceLimits;
}

export function modelSupportsResolution(model: string, resolution: string): boolean {
  return getVideoModelSpec(model).supportedResolutions.includes(String(resolution || "").trim() as Sora2ResolutionValue);
}

export function normalizeVideoModelId(model: string): string {
  const v = String(model || "").trim();
  if (isWanVideoModel(v)) return v;
  if (isVolcengineVideoModel(v)) return v;
  if (isKieVideoModel(v)) return v;
  if (isApimartVideoModel(v)) return v;
  if (isMiniMaxH3VideoModel(v)) return v;
  return "doubao-seedance-2-0-260128";
}
