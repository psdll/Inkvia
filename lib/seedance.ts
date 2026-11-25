import axios from "axios";
import { getVolcengineArkBaseUrl } from "@/lib/config";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields } from "@/lib/providers/error-safety";
import { attachProviderFailureContext } from "@/lib/providers/failure-capture";
import {
  axiosWithProviderEgress,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";
import {
  isSeedance20VideoModel,
  modelSupportsGenerateAudio,
  SEEDANCE_25_MODEL_ID,
  type SeedanceOmniReferenceTaskType,
  type SeedanceOutputFormat,
} from "@/lib/sora2";

export type SeedanceModelId =
  | "doubao-seedance-2-0-260128"
  | "doubao-seedance-2-5-260628"
  | "doubao-seedance-2-0-fast-260128"
  | "doubao-seedance-2-0-mini-260615"
  | "doubao-seedance-1-5-pro-251215"
  | "doubao-seedance-1-0-pro-250528";

// 4k 仅 Seedance 2.0（非 Fast）支持
export type SeedanceResolution = "480p" | "720p" | "1080p" | "4k";

export type SeedanceRatio =
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  // adaptive：按输入自动选比例，仅 Seedance 2.0 系列
  | "adaptive";

export type SeedanceInputMode =
  | "text_to_video"
  | "first_frame"
  | "first_last_frame"
  | "multimodal";

export type SeedanceMediaFile = {
  type: "image" | "video" | "audio";
  url: string;
  role:
    | "first_frame"
    | "last_frame"
    | "reference_image"
    | "reference_video"
    | "reference_audio";
};

export type SeedanceCreateTaskInput = {
  model: SeedanceModelId;
  prompt: string;
  inputMode: SeedanceInputMode;
  mediaFiles?: SeedanceMediaFile[];
  resolution?: SeedanceResolution;
  ratio?: SeedanceRatio;
  duration?: number;
  seed?: number;
  cameraFixed?: boolean;
  watermark?: boolean;
  returnLastFrame?: boolean;
  generateAudio?: boolean;
  webSearch?: boolean;
  omniReferenceTaskType?: SeedanceOmniReferenceTaskType;
  outputFormat?: SeedanceOutputFormat;
};

export type SeedanceTaskDetail = {
  id?: string;
  status?: "submitted" | "processing" | "succeeded" | "failed";
  model?: string;
  ratio?: string;
  resolution?: string;
  frames?: number;
  error?: { message?: string; code?: string } | null;
  content?: {
    video_url?: string;
    last_frame_url?: string;
  } | null;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  } | null;
  created_at?: number;
  updated_at?: number;
};

function getHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function resolveSeedanceEndpoint() {
  const context = await resolveProviderRequestContext("volcengine");
  const baseUrl = String(context.provider.baseUrl || getVolcengineArkBaseUrl()).trim().replace(/\/+$/, "");
  const apiKey = resolvedProviderApiKey(context.provider);
  return { baseUrl, apiKey, decision: context.decision };
}

function formatSeedanceApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0);
    const data = error.response?.data as any;
    const code = String(data?.error?.code || data?.code || "").trim();
    const message = String(data?.error?.message || data?.message || error.message || "").trim();

    if (code === "InputVideoSensitiveContentDetected.PrivacyInformation") {
      return "参考视频触发平台隐私风控：疑似包含真人信息，Seedance 当前拒绝处理该视频。请改用无真人素材，或截取静态图/去除真人片段后重试。";
    }

    if (code && /SensitiveContentDetected/i.test(code)) {
      return `参考素材触发平台内容风控，当前无法处理。${message || code}`;
    }

    if (message) {
      return code ? `${message} (${code})` : message;
    }
    if (status) return `Seedance 请求失败（HTTP ${status}）`;
  }
  return error instanceof Error ? error.message : "Seedance 请求失败";
}

export function detectMediaType(localPath: string): "image" | "video" | "audio" {
  const ext = String(localPath || "").split(".").pop()?.toLowerCase() || "";
  if (["mp4", "mov", "webm", "avi", "mkv", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "ogg", "flac", "m4a"].includes(ext)) return "audio";
  return "image";
}

function buildContent(input: SeedanceCreateTaskInput): object[] {
  const content: object[] = [{ type: "text", text: input.prompt }];

  if (!input.mediaFiles || input.mediaFiles.length === 0) {
    return content;
  }

  for (const f of input.mediaFiles) {
    if (f.type === "image") {
      content.push({ type: "image_url", role: f.role, image_url: { url: f.url } });
    } else if (f.type === "video") {
      content.push({ type: "video_url", role: f.role, video_url: { url: f.url } });
    } else if (f.type === "audio") {
      content.push({ type: "audio_url", role: f.role, audio_url: { url: f.url } });
    }
  }

  return content;
}

export async function seedanceCreateTask(input: SeedanceCreateTaskInput): Promise<SeedanceTaskDetail> {
  const { baseUrl, apiKey, decision } = await resolveSeedanceEndpoint();

  const body: Record<string, unknown> = {
    model: input.model,
    content: buildContent(input)
  };

  // Seedance 2.0/2.5 不支持 seed / camera_fixed，传入会被上游强校验拒绝。
  const isSeedance20 = isSeedance20VideoModel(input.model);
  const isSeedance25 = input.model === SEEDANCE_25_MODEL_ID;

  if (input.resolution) body.resolution = input.resolution;
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.duration === "number" && (input.duration !== -1 || isSeedance25)) body.duration = input.duration;
  if (!isSeedance20 && !isSeedance25 && typeof input.seed === "number" && input.seed !== -1) body.seed = input.seed;
  if (!isSeedance20 && !isSeedance25 && input.cameraFixed) body.camera_fixed = true;
  if (input.watermark) body.watermark = true;
  if (input.returnLastFrame) body.return_last_frame = true;
  // generate_audio 的 API 默认值为 true：若只在 true 时发送，用户选"无声"会被忽略而出有声视频。
  // 故对支持音频的模型显式发送布尔值（true/false 都发）；不支持音频的模型（如 1.0 Pro）不发。
  if (modelSupportsGenerateAudio(input.model)) body.generate_audio = Boolean(input.generateAudio);
  if (isSeedance25 && input.omniReferenceTaskType) {
    body.omni_reference_task_type = input.omniReferenceTaskType;
  }
  if (isSeedance25 && input.outputFormat) body.output_format = input.outputFormat;

  if (input.webSearch && input.inputMode === "text_to_video") {
    body.tools = [{ type: "web_search" }];
  }

  try {
    const url = `${baseUrl}/api/v3/contents/generations/tasks`;
    const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, baseUrl, url);
    const response = await axiosWithProviderEgress<SeedanceTaskDetail>(decision, {
      url,
      method: "POST",
      data: body,
      headers: getHeaders(apiKey),
      timeout: 60000,
    });
    return sanitizeProviderErrorFields(response.data, sensitiveValues) as SeedanceTaskDetail;
  } catch (error) {
    const wrapped = attachProviderFailureContext(new Error(formatSeedanceApiError(error)), error);
    if (axios.isAxiosError(error)) {
      (wrapped as any).statusCode = Number(error.response?.status || 0);
      (wrapped as any).providerCode = String((error.response?.data as any)?.error?.code || "");
    }
    throw wrapped;
  }
}

export async function seedanceGetTask(taskId: string): Promise<SeedanceTaskDetail> {
  const { baseUrl, apiKey, decision } = await resolveSeedanceEndpoint();
  const url = `${baseUrl}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, baseUrl, url);
  const response = await axiosWithProviderEgress<SeedanceTaskDetail>(decision, {
    url,
    method: "GET",
    headers: getHeaders(apiKey),
    timeout: 30000,
  });
  return sanitizeProviderErrorFields(response.data, sensitiveValues) as SeedanceTaskDetail;
}

export function extractSeedanceVideoUrl(detail: SeedanceTaskDetail): string {
  return String(detail?.content?.video_url || "").trim();
}

export function extractSeedanceLastFrameUrl(detail: SeedanceTaskDetail): string {
  return String(detail?.content?.last_frame_url || "").trim();
}
