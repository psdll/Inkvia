import { requestJsonViaProxy, resolveApimartEndpoint } from "@/lib/apimart-image";
import { APIMART_SEEDANCE_25_MODEL_ID, APIMART_SEEDANCE_25_UPSTREAM_MODEL, type SeedanceOmniReferenceTaskType, type SeedanceOutputFormat } from "@/lib/sora2";

export const APIMART_SEEDANCE_FACE_MODEL = "doubao-seedance-2.0-face";
export const APIMART_SEEDANCE_FAST_FACE_MODEL = "doubao-seedance-2.0-fast-face";

export type ApimartSeedanceFaceModel =
  | typeof APIMART_SEEDANCE_FACE_MODEL
  | typeof APIMART_SEEDANCE_FAST_FACE_MODEL;

export type ApimartVideoSubmitInput = {
  model: ApimartSeedanceFaceModel | typeof APIMART_SEEDANCE_25_MODEL_ID;
  prompt: string;
  mediaFiles?: Array<{
    type: "image" | "video" | "audio";
    url: string;
    role?: string;
  }>;
  resolution?: string;
  size?: string;
  duration?: number;
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  webSearch?: boolean;
  watermark?: boolean;
  outputFormat?: SeedanceOutputFormat;
  omniReferenceTaskType?: SeedanceOmniReferenceTaskType;
};

const REQUEST_TIMEOUT_MS = 60000;

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeResolution(value: unknown, model: string) {
  const resolution = clean(value).toLowerCase();
  if (resolution === "1080p" && model === APIMART_SEEDANCE_FACE_MODEL) return "1080p";
  if (resolution === "720p") return "720p";
  if (resolution === "480p") return "480p";
  return "720p";
}

function normalizeSize(value: unknown) {
  const size = clean(value);
  const allowed = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]);
  return allowed.has(size) ? size : "16:9";
}

function normalizeDuration(value: unknown) {
  const n = typeof value === "number" ? value : Number.parseInt(clean(value), 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(15, Math.max(4, Math.trunc(n)));
}

function extractTaskId(data: any) {
  const fromArray = Array.isArray(data?.data)
    ? clean(data.data[0]?.task_id || data.data[0]?.taskId || data.data[0]?.id)
    : "";
  return clean(data?.task_id || data?.taskId || data?.data?.task_id || data?.data?.taskId || data?.data?.id || fromArray);
}

function pushUrlValue(urls: string[], raw: unknown) {
  if (Array.isArray(raw)) {
    for (const item of raw) pushUrlValue(urls, item);
    return;
  }
  if (raw && typeof raw === "object") {
    const item = raw as Record<string, unknown>;
    pushUrlValue(urls, item.url || item.video_url || item.videoUrl || item.download_url || item.downloadUrl);
    return;
  }
  const url = clean(raw);
  if (url) urls.push(url);
}

export function isApimartSeedanceFaceModel(model: string): model is ApimartSeedanceFaceModel {
  const value = clean(model);
  return value === APIMART_SEEDANCE_FACE_MODEL || value === APIMART_SEEDANCE_FAST_FACE_MODEL;
}

export function buildApimartVideoRequest(input: ApimartVideoSubmitInput) {
  const isSeedance25 = input.model === APIMART_SEEDANCE_25_MODEL_ID;
  const imageWithRoles: Array<{ url: string; role: string }> = [];
  const videoUrls: string[] = [];
  const audioUrls: string[] = [];

  for (const file of input.mediaFiles || []) {
    const url = clean(file?.url);
    if (!url) continue;
    if (/^asset:/i.test(url)) throw new Error("参考素材地址不受支持，请重新上传素材");
    if (file.type === "video") videoUrls.push(url);
    else if (file.type === "audio") audioUrls.push(url);
    else imageWithRoles.push({ url, role: clean(file.role) || "reference_image" });
  }

  const body: Record<string, any> = {
    model: isSeedance25 ? APIMART_SEEDANCE_25_UPSTREAM_MODEL : input.model,
    prompt: clean(input.prompt),
    resolution: normalizeResolution(input.resolution, isSeedance25 ? APIMART_SEEDANCE_FACE_MODEL : input.model),
    size: normalizeSize(input.size),
    duration: isSeedance25 ? input.duration ?? 5 : normalizeDuration(input.duration),
    generate_audio: Boolean(input.generateAudio),
  };

  if (isSeedance25) {
    if (!Number.isInteger(body.duration) || (body.duration !== -1 && (body.duration < 4 || body.duration > 30))) {
      throw new Error("Seedance 2.5 时长仅支持 4–30 秒或自动时长");
    }
    body.output_format = input.outputFormat || "mp4";
    if (input.omniReferenceTaskType) body.omni_reference_task_type = input.omniReferenceTaskType;
    if (input.watermark !== undefined) body.watermark = input.watermark;
  }

  if (imageWithRoles.length) body.image_with_roles = imageWithRoles;
  if (videoUrls.length) body.video_urls = isSeedance25 ? videoUrls : videoUrls.slice(0, 3);
  if (audioUrls.length) body.audio_urls = isSeedance25 ? audioUrls : audioUrls.slice(0, 3);
  if (input.returnLastFrame) body.return_last_frame = true;
  if (input.webSearch) body.tools = [{ type: "web_search" }];
  return body;
}

export function extractApimartLastFrameUrl(data: any) {
  const result = data?.data?.result || data?.result || {};
  const candidates = [
    result?.last_frame_url,
    result?.lastFrameUrl,
    result?.last_frame,
    result?.lastFrame,
    result?.last_frame_image_url,
    result?.lastFrameImageUrl,
    data?.data?.last_frame_url,
    data?.data?.lastFrameUrl,
    data?.last_frame_url,
    data?.lastFrameUrl,
  ];
  const videos = Array.isArray(result?.videos) ? result.videos : [];
  for (const video of videos) {
    candidates.push(
      video?.last_frame_url,
      video?.lastFrameUrl,
      video?.last_frame,
      video?.lastFrame,
      video?.last_frame_image_url,
      video?.lastFrameImageUrl
    );
  }
  for (const candidate of candidates) {
    const urls: string[] = [];
    pushUrlValue(urls, candidate);
    const first = urls.find((url) => clean(url));
    if (first) return first;
  }
  return "";
}

export function extractApimartVideoUrls(data: any) {
  const result = data?.data?.result || data?.result || {};
  const videoGroups = [
    result?.videos,
    result?.video_urls,
    result?.videoUrls,
    result?.urls,
    result?.outputs,
    data?.data?.videos,
    data?.videos,
    data?.data?.video_urls,
    data?.video_urls,
    data?.data?.url,
    data?.url,
  ];
  const singleUrl =
    result?.url ||
    result?.video_url ||
    result?.videoUrl ||
    result?.download_url ||
    result?.downloadUrl ||
    data?.data?.url ||
    data?.data?.video_url ||
    data?.data?.videoUrl ||
    data?.url ||
    data?.video_url ||
    data?.videoUrl;
  const urls: string[] = [];
  for (const group of videoGroups) {
    if (Array.isArray(group)) pushUrlValue(urls, group);
  }
  pushUrlValue(urls, singleUrl);
  return Array.from(new Set(urls));
}

export async function apimartSubmitVideo(input: ApimartVideoSubmitInput) {
  const { base, apiKey, decision } = await resolveApimartEndpoint();
  const request = buildApimartVideoRequest(input);
  const data = await requestJsonViaProxy(decision, `${base}/videos/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const taskId = extractTaskId(data);
  if (!taskId) throw new Error("APIMart did not return task_id");
  return { taskId, raw: data, request };
}
