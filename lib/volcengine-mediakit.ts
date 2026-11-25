import "server-only";
import { open } from "node:fs/promises";
import path from "node:path";
import { Headers } from "undici";
import { resolveProvider } from "@/lib/providers/resolve";
import { providerFetch } from "@/lib/providers/transport";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { buildSubtitleRemovalRequest, type SubtitleRemovalOptions } from "@/lib/canvas/subtitle-removal";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL } from "./volcengine-mediakit-models";

const VIDEO_UPLOAD_MIME: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".flv": "video/x-flv", ".ts": "video/mp2t",
  ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv",
};

export class MediaKitError extends Error {
  constructor(message: string, public status = 502) { super(message); this.name = "MediaKitError"; }
}

export async function requireMediaKitProvider() {
  const provider = await resolveProvider(MEDIAKIT_PROVIDER);
  if (!provider) throw new MediaKitError("请在管理员 API 配置中启用火山引擎 AI MediaKit", 400);
  if (!provider.apiKey) throw new MediaKitError("请在管理员 API 配置中填写 AI MediaKit API Key（与方舟 Key 独立）", 400);
  if (!provider.videoModels.includes(MEDIAKIT_SUBTITLE_MODEL)) throw new MediaKitError("火山字幕擦除 V5 未启用", 400);
  return provider;
}

async function requestMediaKit(endpoint: string, body?: Record<string, unknown>) {
  const provider = await requireMediaKitProvider();
  const url = `${provider.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}/api/v1/${endpoint}`;
  const response = await providerFetch(MEDIAKIT_PROVIDER, url, {
    method: body ? "POST" : "GET", redirect: "error",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false) {
    throw new MediaKitError(sanitizeProviderErrorText(data?.error?.message || data?.message || `AI MediaKit 请求失败（HTTP ${response.status}）`, [provider.apiKey]), response.ok ? 502 : response.status);
  }
  return data;
}

export async function uploadMediaKitVideo(source: string, size: number) {
  const data = await requestMediaKit("tools-sync/request-media-upload-url", {});
  const result = data.result;
  const fileId = typeof result?.file_id === "string" ? result.file_id.trim().replace(/^mediakit:\/\//, "") : "";
  if (!fileId || result?.method !== "PUT" || typeof result.upload_url !== "string" || !URL.canParse(result.upload_url)) {
    throw new MediaKitError("AI MediaKit 返回的上传地址无效");
  }
  const uploadUrl = new URL(result.upload_url);
  // The signing endpoint can hand off uploads to Volcengine's VOD or TOS hosts.
  if (uploadUrl.protocol !== "https:" || uploadUrl.username || uploadUrl.password || uploadUrl.port
      || !/\.(?:volcvod\.com|volces\.com)$/.test(uploadUrl.hostname)) {
    throw new MediaKitError("AI MediaKit 返回的上传地址无效");
  }

  const headers = new Headers();
  for (const { key, value } of result.upload_headers ?? []) headers.set(key, value);
  if (!headers.has("content-type")) {
    headers.set("content-type", VIDEO_UPLOAD_MIME[path.extname(source).toLowerCase()] ?? "application/octet-stream");
  }
  headers.set("content-length", String(size));
  const file = await open(source, "r");
  const body = file.createReadStream();
  try {
    const response = await providerFetch(MEDIAKIT_PROVIDER, uploadUrl, {
      method: "PUT", redirect: "error", duplex: "half", headers, body, signal: AbortSignal.timeout(300_000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new MediaKitError(`AI MediaKit 本地视频上传失败（HTTP ${response.status}）`);
    return `mediakit://${fileId}`;
  } finally {
    body.destroy();
    await file.close();
  }
}

export async function submitMediaKitSubtitleRemoval(input: { videoUrl: string; options: SubtitleRemovalOptions; requestKey: string }) {
  const data = await requestMediaKit("tools/erase-video-subtitle-pro", { ...buildSubtitleRemovalRequest(input.videoUrl, input.options), client_token: input.requestKey });
  if (typeof data.task_id !== "string" || !data.task_id) throw new MediaKitError("AI MediaKit 未返回任务编号，请核对上游任务后重试");
  return data.task_id;
}

export function getMediaKitSubtitleTask(taskId: string) {
  return requestMediaKit(`tasks/${encodeURIComponent(taskId)}`);
}

export function parseMediaKitSubtitleTask(data: any) {
  const state = String(data?.status || "").toLowerCase();
  if (["failed", "cancelled", "canceled", "expired"].includes(state)) return {
    kind: "failed" as const, providerStatus: state,
    message: sanitizeProviderErrorText(data.error?.message || data.error || "火山字幕擦除失败"),
  };
  if (state === "completed") {
    const result = data.result;
    if (typeof result?.video_url !== "string" || !/^https?:\/\//i.test(result.video_url)) return {
      kind: "failed" as const, providerStatus: state, message: "火山字幕擦除已完成但未返回可下载的视频",
    };
    const duration = Number(result.duration);
    return {
      kind: "done" as const, urls: [result.video_url], providerStatus: state,
      providerUsage: { duration: Number.isFinite(duration) && duration > 0 ? duration : null },
      ...(Number.isFinite(duration) && duration > 0 ? { templatePatch: { duration, durationSeconds: duration } } : {}),
    };
  }
  return { kind: "pending" as const, providerStatus: state || "processing" };
}
