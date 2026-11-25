import { WAN_VIDEO_MODEL_ID, WAN_PROVIDER_ID, WAN_VIDEO_RATIOS } from "@/lib/wan-models";
import type { VideoInputMode } from "@/lib/sora2";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";

export type WanVideoInput = {
  prompt: string;
  inputMode: VideoInputMode;
  resolution: string;
  ratio: string;
  duration: number;
  generateAudio?: boolean;
  watermark?: boolean;
  seed?: number;
  media: Array<{ type: "image" | "video" | "audio"; url: string }>;
};

// Exact-model contract: https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference
export function buildWanVideoRequest(input: WanVideoInput) {
  const resolution = input.resolution.toUpperCase();
  if (!["480P", "720P", "1080P"].includes(resolution)) throw new Error("Wan3.0 分辨率仅支持 480P、720P、1080P");
  if (!WAN_VIDEO_RATIOS.includes(input.ratio)) throw new Error("Wan3.0 画面比例无效");
  if (!Number.isInteger(input.duration) || (input.duration !== -1 && (input.duration < 2 || input.duration > 30))) {
    throw new Error("Wan3.0 时长仅支持 2–30 秒整数或智能时长 -1");
  }
  if (input.seed !== undefined && (!Number.isInteger(input.seed) || input.seed < -1 || input.seed > 2147483647)) {
    throw new Error("Wan3.0 随机种子仅支持 -1 或 0–2147483647 整数");
  }
  if (!input.prompt.trim() && !input.media.length) throw new Error("Wan3.0 需要提示词或素材");
  if (input.inputMode === "text_to_video") {
    if (input.media.length) throw new Error("Wan3.0 文生视频不接受素材");
  } else if (input.inputMode === "first_frame" || input.inputMode === "first_last_frame") {
    if (input.media.length !== (input.inputMode === "first_frame" ? 1 : 2) || input.media.some((m) => m.type !== "image")) {
      throw new Error("Wan3.0 首帧模式需要 1 张图片，首尾帧模式需要 2 张图片，不能混用其他素材");
    }
  } else if (input.inputMode === "multimodal") {
    if (!input.media.length) throw new Error("Wan3.0 多模态参考至少需要 1 个素材");
    if (input.media.length > 20 || input.media.filter((m) => m.type === "image").length > 10
      || input.media.filter((m) => m.type === "video").length > 5 || input.media.filter((m) => m.type === "audio").length > 5) {
      throw new Error("Wan3.0 最多支持 10 张图片、5 段视频、5 段音频，共 20 个素材");
    }
  } else throw new Error("Wan3.0 输入模式无效");
  const media = input.media.map((item, index) => {
    if (!["image", "video", "audio"].includes(item.type)) throw new Error("Wan3.0 素材类型无效");
    if (!/^https?:\/\//i.test(item.url) && !/^oss:\/\//i.test(item.url) && !(item.type === "image" && /^data:image\//i.test(item.url))) {
      throw new Error("Wan3.0 素材需要可访问的 HTTP(S) URL 或图片 Base64");
    }
    const type = input.inputMode === "first_frame" ? "first_frame"
      : input.inputMode === "first_last_frame" ? (index === 0 ? "first_frame" : "last_frame")
        : `reference_${item.type}`;
    return { type, url: item.url };
  });
  return {
    endpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    body: {
      model: WAN_VIDEO_MODEL_ID,
      input: { ...(input.prompt ? { prompt: input.prompt.slice(0, 20000) } : {}), ...(media.length ? { media } : {}) },
      parameters: {
        resolution, ratio: input.ratio, duration: input.duration,
        audio: input.generateAudio ?? true,
        watermark: input.watermark ?? false,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    },
  };
}

export function getWanApiBase(baseUrl: string): string {
  const base = String(baseUrl || "").trim();
  if (!base || /[{}<>]/.test(base)) throw new Error("请在管理员 API 配置中填写百炼业务空间的完整接口地址");
  const invalidAddress = "百炼接口地址应为 HTTPS 业务空间域名、/api/v1 或 /compatible-mode/v1 基础地址，也可填写完整的视频生成 URL";
  let url: URL;
  try { url = new URL(base); } catch { throw new Error(invalidAddress); }
  // Both console base URLs and the complete URL copied from the video docs
  // identify the same workspace. Build submit and poll paths from its origin.
  const path = url.pathname.replace(/\/+$/, "");
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:"
    || !["", "/api/v1", "/compatible-mode/v1", "/api/v1/services/aigc/video-generation/video-synthesis"].includes(path)) {
    throw new Error(invalidAddress);
  }
  return url.origin;
}

export function getWanVideoPollPath(taskId: string) {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}`;
}

async function wanRequest(endpoint: string, body?: unknown) {
  const context = await resolveProviderRequestContext(WAN_PROVIDER_ID);
  const apiKey = resolvedProviderApiKey(context.provider);
  const base = getWanApiBase(context.provider.baseUrl);
  const url = `${base}${endpoint}`;
  const sensitive = providerErrorSensitiveValues(context.decision, apiKey, base, url);
  try {
    const response = await fetchWithProviderEgress(context.decision, url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { "Content-Type": "application/json", "X-DashScope-Async": "enable", "X-DashScope-OssResourceResolve": "enable" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(body ? 60000 : 30000),
    });
    const raw = await response.text();
    let data: any;
    try { data = sanitizeProviderErrorFields(JSON.parse(raw), sensitive); } catch { data = null; }
    if (!response.ok || !data || data.code) {
      const error = new Error(sanitizeProviderErrorText(data?.message || `百炼请求失败 (${response.status})`, sensitive)) as Error & { statusCode: number };
      error.statusCode = response.ok ? 502 : response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(error.message, sensitive, "百炼请求失败");
      throw error;
    }
    throw new Error("百炼请求失败");
  }
}

export async function wanSubmitVideo(input: WanVideoInput) {
  const request = buildWanVideoRequest(input);
  const data = await wanRequest(request.endpoint, request.body);
  const taskId = String(data?.output?.task_id || "").trim();
  if (!taskId) throw new Error("百炼未返回异步视频任务 ID");
  return { taskId, request: request.body };
}

export async function wanGetVideoTask(taskId: string) {
  return wanRequest(getWanVideoPollPath(taskId));
}
