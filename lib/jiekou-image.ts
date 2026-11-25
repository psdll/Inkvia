import { getJiekouBaseUrl } from "@/lib/config";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";

export const JIEKOU_GPT_IMAGE_2_MODEL_ID = "gpt-image-2-jiekou";
export const JIEKOU_GPT_IMAGE_2_TEXT_MODEL = "gpt-image-2-text-to-image";
export const JIEKOU_GPT_IMAGE_2_EDIT_MODEL = "gpt-image-2-edit";

type JiekouImageInput = {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  maskUrl?: string;
  quality?: string;
  background?: string;
  moderation?: string;
  outputFormat?: string;
  n?: number;
};

type JiekouImageRequest = {
  endpoint: string;
  providerModel: string;
  body: Record<string, any>;
};

type JiekouImageResult = {
  images: string[];
  raw: any;
  endpoint: string;
  request: Record<string, any>;
  providerModel: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function trimSlash(value: string) {
  return clean(value).replace(/\/+$/, "");
}

function normalizeQuality(value: unknown, hasInputImage: boolean) {
  const quality = clean(value).toLowerCase();
  if (quality === "low" || quality === "medium" || quality === "high") return quality;
  return hasInputImage ? "low" : "medium";
}

function normalizeBackground(value: unknown) {
  return clean(value).toLowerCase() === "opaque" ? "opaque" : "auto";
}

function normalizeModeration(value: unknown) {
  return clean(value).toLowerCase() === "low" ? "low" : "auto";
}

function normalizeOutputFormat(value: unknown) {
  return clean(value).toLowerCase() === "jpeg" ? "jpeg" : "png";
}

function normalizeNumImages(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

export function mapJiekouGptImage2Size(aspectRatio?: string, resolution?: string) {
  const ratio = clean(aspectRatio) || "1:1";
  if (ratio === "auto") return "auto";
  const res = clean(resolution).toUpperCase();
  const byResolution: Record<string, Record<string, string>> = {
    "1K": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
    },
    "2K": {
      "1:1": "2048x2048",
      "16:9": "2048x1152",
      "9:16": "1152x2048",
      "3:2": "2048x1360",
      "2:3": "1360x2048",
      "4:3": "2048x1536",
      "3:4": "1536x2048",
      "21:9": "2048x880",
      "9:21": "880x2048",
      "1:3": "688x2048",
      "3:1": "2048x688",
      "2:1": "2048x1024",
      "1:2": "1024x2048",
    },
    "4K": {
      "16:9": "3840x2160",
      "9:16": "2160x3840",
    },
  };
  return byResolution[res]?.[ratio] || "1024x1024";
}

export function buildJiekouGptImage2Request(input: JiekouImageInput): JiekouImageRequest {
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls.map(clean).filter(Boolean).slice(0, 16) : [];
  const hasInputImage = imageUrls.length > 0;
  const endpoint = hasInputImage ? "/v3/gpt-image-2-edit" : "/v3/gpt-image-2-text-to-image";
  const providerModel = hasInputImage ? JIEKOU_GPT_IMAGE_2_EDIT_MODEL : JIEKOU_GPT_IMAGE_2_TEXT_MODEL;
  const body: Record<string, any> = {
    n: normalizeNumImages(input.n),
    size: mapJiekouGptImage2Size(input.aspectRatio, input.resolution),
    prompt: clean(input.prompt),
    quality: normalizeQuality(input.quality, hasInputImage),
    background: normalizeBackground(input.background),
    output_format: normalizeOutputFormat(input.outputFormat),
  };

  if (hasInputImage) {
    body.image = imageUrls.length === 1 ? imageUrls[0] : imageUrls;
    const mask = clean(input.maskUrl);
    if (mask) body.mask = mask;
  } else {
    body.moderation = normalizeModeration(input.moderation);
  }

  return { endpoint, providerModel, body };
}

function readMessage(data: any, fallback: string) {
  const detail = data?.detail;
  if (Array.isArray(detail)) {
    const message = detail.map((item: any) => clean(item?.msg || item?.message)).filter(Boolean).join("; ");
    if (message) return message;
  }
  return clean(data?.error?.message || data?.message || data?.error || fallback);
}

export function extractJiekouImageUrls(data: any) {
  const images = Array.isArray(data?.images)
    ? data.images
    : Array.isArray(data?.data?.images)
      ? data.data.images
      : [];
  const urls: string[] = images.map(clean).filter(Boolean);
  return Array.from(new Set(urls));
}

export async function resolveJiekouEndpoint() {
  const context = await resolveProviderRequestContext("jiekou");
  return {
    base: trimSlash(context.provider.baseUrl || getJiekouBaseUrl()),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

export async function jiekouGptImage2Generate(input: JiekouImageInput): Promise<JiekouImageResult> {
  const { base, apiKey, decision } = await resolveJiekouEndpoint();
  const request = buildJiekouGptImage2Request(input);
  const url = `${base}${request.endpoint}`;
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = sanitizeProviderErrorFields(JSON.parse(text), sensitiveValues);
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data, text || `Jiekou request failed (${response.status})`),
      sensitiveValues,
      `Jiekou request failed (${response.status})`,
    ));
  }
  const images = extractJiekouImageUrls(data);
  if (!images.length) {
    throw new Error(sanitizeProviderErrorText(
      readMessage(data, "Jiekou did not return any usable image"),
      sensitiveValues,
      "Jiekou did not return any usable image",
    ));
  }
  return {
    images,
    raw: data,
    endpoint: request.endpoint,
    request: request.body,
    providerModel: request.providerModel,
  };
}
