import { APIMART_SEEDREAM_55_MODEL, buildApimartSeedream55Request } from "@/lib/apimart-seedream-55";
import { APIMART_NANO_BANANA_21_MODEL, buildApimartNanoBanana21Request } from "@/lib/nano-banana-21-providers";
import { isApimartGptImageVariantModel, buildApimartGptImageVariantRequest, type ApimartGptImageVariantInput } from "@/lib/apimart-gpt-image-25";
import { getApimartBaseUrl, getApimartImageModel } from "@/lib/config";
import {
  APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES,
  APIMART_NANO_BANANA_PRO_MODEL_ID,
  APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES,
  APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
  isApimartNanoBananaProModel,
} from "@/lib/apimart-image-models";
export { isApimartNanoBananaProModel } from "@/lib/apimart-image-models";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";

export const APIMART_IMAGE_MODEL_ID = "gpt-image-2-apimart";

export function isApimartImageModel(model: string) {
  const value = String(model || "").trim();
  return value === APIMART_SEEDREAM_55_MODEL || value === APIMART_NANO_BANANA_21_MODEL || value === APIMART_IMAGE_MODEL_ID || value === APIMART_NANO_BANANA_PRO_MODEL_ID || isApimartGptImageVariantModel(value);
}

type ApimartSubmitInput = {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  maskUrl?: string;
  quality?: string;
  background?: string;
  moderation?: string;
  outputFormat?: string;
  outputCompression?: number;
  n?: number;
};

type ApimartNanoBananaProSubmitInput = {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
};

type ApimartSubmitResult = {
  taskId: string;
  raw: any;
  request: Record<string, any>;
};

const REQUEST_TIMEOUT_MS = 60000;
const TASK_TIMEOUT_MS = 30000;

function clean(value: unknown) {
  return String(value || "").trim();
}

function trimSlash(value: string) {
  return clean(value).replace(/\/+$/, "");
}

function readError(data: any, fallback: string) {
  return clean(data?.error?.message || data?.message || data?.error || fallback);
}

export async function requestJsonViaProxy(
  decision: ProviderEgressDecision,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number },
) {
  const res = await fetchWithProviderEgress(decision, url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  const sensitiveValues = providerErrorSensitiveValues(decision, url, ...Object.values(init.headers));
  return readJsonResponse(res, `APIMart request failed (${res.status})`, sensitiveValues);
}

// 解析 APIMart 接入点：优先使用后台保存的 Base URL/API Key，缺失时回退环境配置。
export async function resolveApimartEndpoint() {
  const context = await resolveProviderRequestContext("apimart");
  return {
    base: trimSlash(context.provider.baseUrl || getApimartBaseUrl()),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

async function readJsonResponse(
  res: Response,
  fallback: string,
  sensitiveValues: readonly string[],
) {
  const text = await res.text();
  let data: any = null;
  try {
    data = sanitizeProviderErrorFields(JSON.parse(text), sensitiveValues);
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(sanitizeProviderErrorText(readError(data, text || fallback), sensitiveValues, fallback));
  }
  return data;
}

function normalizeAspectRatio(value: unknown) {
  const ratio = clean(value);
  const allowed = new Set([
    "auto",
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "5:4",
    "4:5",
    "16:9",
    "9:16",
    "2:1",
    "1:2",
    "3:1",
    "1:3",
    "21:9",
    "9:21",
  ]);
  if (allowed.has(ratio)) return ratio;
  if (/^\d{2,5}x\d{2,5}$/i.test(ratio)) return ratio.toLowerCase();
  return "1:1";
}

function normalizeResolution(value: unknown) {
  const resolution = clean(value).toLowerCase();
  if (resolution === "1k" || resolution === "2k" || resolution === "4k") return resolution;
  return "1k";
}

function normalizeQuality(value: unknown) {
  const quality = clean(value).toLowerCase();
  if (quality === "auto" || quality === "low" || quality === "medium" || quality === "high") return quality;
  return "auto";
}

function normalizeBackground(value: unknown) {
  const background = clean(value).toLowerCase();
  if (background === "opaque") return "opaque";
  return "auto";
}

function normalizeModeration(value: unknown) {
  const moderation = clean(value).toLowerCase();
  return moderation === "low" ? "low" : "auto";
}

function normalizeOutputFormat(value: unknown) {
  const format = clean(value).toLowerCase();
  if (format === "jpeg" || format === "png" || format === "webp") return format;
  return "png";
}

function normalizeNumImages(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(4, Math.floor(n)));
}

function normalizeOutputCompression(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function normalizeNanoBananaProAspectRatio(value: unknown) {
  const ratio = clean(value);
  return (APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES as readonly string[]).includes(ratio)
    ? ratio
    : "1:1";
}

function normalizeNanoBananaProResolution(value: unknown) {
  const resolution = clean(value).toUpperCase();
  return (APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES as readonly string[]).includes(resolution)
    ? resolution
    : "1K";
}

function extractSubmitTaskId(data: any) {
  const fromArray = Array.isArray(data?.data) ? clean(data.data[0]?.task_id || data.data[0]?.taskId) : "";
  return clean(data?.task_id || data?.taskId || data?.data?.task_id || data?.data?.taskId || fromArray);
}

export function extractApimartImageUrls(data: any) {
  const result = data?.data?.result || data?.result || {};
  const imageGroups = [
    result?.images,
    result?.image_urls,
    result?.imageUrls,
    result?.urls,
    result?.outputs,
    data?.data?.images,
    data?.images,
    data?.data?.image_urls,
    data?.image_urls,
    data?.data?.url,
    data?.url,
  ];
  const singleUrl =
    result?.url ||
    result?.image_url ||
    result?.imageUrl ||
    result?.download_url ||
    result?.downloadUrl ||
    data?.data?.url ||
    data?.data?.image_url ||
    data?.data?.imageUrl ||
    data?.url ||
    data?.image_url ||
    data?.imageUrl;
  const urls: string[] = [];
  const images = imageGroups.flatMap((group) => (Array.isArray(group) ? group : []));
  for (const image of images) {
    if (typeof image === "string") {
      const url = clean(image);
      if (url) urls.push(url);
      continue;
    }
    const rawUrl = image?.url;
    if (Array.isArray(rawUrl)) {
      for (const item of rawUrl) {
        const url = clean(item);
        if (url) urls.push(url);
      }
      continue;
    }
    const url = clean(rawUrl || image?.image_url || image?.imageUrl || image?.download_url || image?.downloadUrl);
    if (url) urls.push(url);
  }
  if (Array.isArray(singleUrl)) {
    for (const item of singleUrl) {
      const url = clean(item);
      if (url) urls.push(url);
    }
  } else {
    const url = clean(singleUrl);
    if (url) urls.push(url);
  }
  return Array.from(new Set(urls));
}

export function buildApimartImageRequest(input: ApimartSubmitInput) {
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls.map(clean).filter(Boolean).slice(0, 16) : [];
  const outputFormat = normalizeOutputFormat(input.outputFormat);
  const body: Record<string, any> = {
    model: getApimartImageModel(),
    prompt: clean(input.prompt),
    size: normalizeAspectRatio(input.aspectRatio),
    resolution: normalizeResolution(input.resolution),
    quality: normalizeQuality(input.quality),
    background: normalizeBackground(input.background),
    moderation: normalizeModeration(input.moderation),
    output_format: outputFormat,
    n: normalizeNumImages(input.n),
  };

  const outputCompression = normalizeOutputCompression(input.outputCompression);
  if ((outputFormat === "jpeg" || outputFormat === "webp") && outputCompression !== undefined) {
    body.output_compression = outputCompression;
  }
  if (imageUrls.length) {
    body.image_urls = imageUrls;
    const maskUrl = clean(input.maskUrl);
    if (maskUrl) body.mask_url = maskUrl;
  }
  return body;
}

export function buildApimartNanoBananaProRequest(input: ApimartNanoBananaProSubmitInput) {
  const imageUrls = Array.isArray(input.imageUrls)
    ? input.imageUrls.map(clean).filter(Boolean)
    : [];
  if (imageUrls.length > 14) {
    throw new Error("Nano Banana Pro（am）最多支持 14 张参考图");
  }

  return {
    model: APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
    prompt: clean(input.prompt),
    size: normalizeNanoBananaProAspectRatio(input.aspectRatio),
    n: 1,
    resolution: normalizeNanoBananaProResolution(input.resolution),
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
  };
}

async function submitApimartImageRequest(request: Record<string, any>): Promise<ApimartSubmitResult> {
  const { base, apiKey, decision } = await resolveApimartEndpoint();
  const data = await requestJsonViaProxy(decision, `${base}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const taskId = extractSubmitTaskId(data);
  if (!taskId) throw new Error("APIMart did not return task_id");
  return { taskId, raw: data, request };
}

export async function apimartSubmitImage(input: ApimartSubmitInput): Promise<ApimartSubmitResult> {
  return submitApimartImageRequest(buildApimartImageRequest(input));
}

export async function apimartSubmitNanoBananaPro(
  input: ApimartNanoBananaProSubmitInput,
): Promise<ApimartSubmitResult> {
  return submitApimartImageRequest(buildApimartNanoBananaProRequest(input));
}

export async function apimartSubmitGptImageVariant(input: ApimartGptImageVariantInput): Promise<ApimartSubmitResult> {
  return submitApimartImageRequest(buildApimartGptImageVariantRequest(input));
}

export async function apimartGetTask(taskId: string) {
  const { base, apiKey, decision } = await resolveApimartEndpoint();
  return requestJsonViaProxy(decision, `${base}/tasks/${encodeURIComponent(taskId)}?language=zh`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs: TASK_TIMEOUT_MS,
  });
}

export async function apimartSubmitNanoBanana21(input: Parameters<typeof buildApimartNanoBanana21Request>[0]) {
  return submitApimartImageRequest(buildApimartNanoBanana21Request(input));
}

export async function apimartSubmitSeedream55(input: Parameters<typeof buildApimartSeedream55Request>[0]) {
  return submitApimartImageRequest(buildApimartSeedream55Request(input));
}
