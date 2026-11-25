import { buildAicomingHaiyaGptImage25Request, type AicomingGptImage25Input } from "@/lib/aicoming-gpt-image-25";
import {
  mapGptImage2OfficialPixels,
  normalizeGptImage2OfficialParams,
  normalizeGptImage2OfficialReferences,
  uniqueHttpUrls,
} from "@/lib/gpt-image-2-official";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS,
  AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
  AICOMING_HAIYA_PROVIDER_ID,
} from "@/lib/aicoming-merchant-models";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import {
  axiosWithProviderEgress,
  fetchWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";

type AicomingMerchantImageRequestInput = {
  prompt: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  quality?: unknown;
  imageUrls?: unknown;
  requestKey?: unknown;
};
type AicomingImageRequest = {
  endpoint: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
};

export function buildAicomingHaiyaGptImage2Request(input: AicomingMerchantImageRequestInput) {
  const params = normalizeGptImage2OfficialParams({
    ...input,
    model: AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  });
  const imageUrls = normalizeGptImage2OfficialReferences(input.imageUrls);
  return {
    endpoint: "/images/generations",
    idempotencyKey: String(input.requestKey ?? "").trim(),
    body: {
      model: AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS[params.resolution],
      prompt: String(input.prompt ?? "").trim(),
      size: mapGptImage2OfficialPixels(params.aspectRatio, params.resolution),
      quality: params.quality,
      n: 1,
      response_format: "url",
      async: true,
      ...(imageUrls.length ? { image: imageUrls } : {}),
    },
  };
}

const AICOMING_HAIYA_NANO_BANANA_PRO_RATIOS = new Set([
  "auto",
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
]);
const AICOMING_HAIYA_NANO_BANANA_PRO_RESOLUTIONS = new Set(["1K", "2K", "4K"]);

export function buildAicomingHaiyaNanoBananaProRequest(input: AicomingMerchantImageRequestInput) {
  const rawAspectRatio = String(input.aspectRatio ?? "").trim();
  const rawResolution = String(input.resolution ?? "").trim().toUpperCase();
  const imageUrls = uniqueHttpUrls(Array.isArray(input.imageUrls) ? input.imageUrls : []);
  return {
    endpoint: "/images/generations",
    idempotencyKey: String(input.requestKey ?? "").trim(),
    body: {
      model: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
      prompt: String(input.prompt ?? "").trim(),
      aspect_ratio: AICOMING_HAIYA_NANO_BANANA_PRO_RATIOS.has(rawAspectRatio)
        ? rawAspectRatio
        : "auto",
      image_size: AICOMING_HAIYA_NANO_BANANA_PRO_RESOLUTIONS.has(rawResolution)
        ? rawResolution
        : "2K",
      n: 1,
      return_url: true,
      async: true,
      ...(imageUrls.length ? { image: imageUrls } : {}),
    },
  };
}

export function getAicomingGptImage2PollPath(taskId: unknown) {
  return `/images/generations/${encodeURIComponent(String(taskId ?? "").trim())}`;
}

export function extractAicomingImageUrls(data: any) {
  return uniqueHttpUrls(Array.isArray(data?.data) ? data.data.map((item: any) => item?.url) : []);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function readError(data: any, fallback: string) {
  return clean(data?.error?.message || data?.message || data?.error || fallback);
}

async function readJsonResponse(response: Response, sensitive: string[]) {
  const text = await response.text();
  let data: any = null;
  try {
    data = sanitizeProviderErrorFields(JSON.parse(text), sensitive);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const fallback = `AIComing request failed (${response.status})`;
    throw new Error(sanitizeProviderErrorText(readError(data, text || fallback), sensitive, fallback));
  }
  return data;
}

async function resolveAicomingEndpoint(providerId: string) {
  const context = await resolveProviderRequestContext(providerId);
  return {
    base: clean(context.provider.baseUrl).replace(/\/+$/, ""),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

async function submitWithOneIdempotentRetry(input: {
  decision: ProviderEgressDecision;
  url: string;
  headers: Record<string, string>;
  body: string;
}) {
  let firstError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchWithProviderEgress(input.decision, input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      firstError ??= error;
      if (attempt === 1) throw firstError;
    }
  }
  throw firstError;
}

async function submitAicomingImageRequest(
  providerId: string,
  request: AicomingImageRequest,
) {
  const { base, apiKey, decision } = await resolveAicomingEndpoint(providerId);
  const url = `${base}${request.endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {}),
  };
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url, request.idempotencyKey);
  const response = await submitWithOneIdempotentRetry({
    decision,
    url,
    headers,
    body: JSON.stringify(request.body),
  });
  const data = await readJsonResponse(response, sensitive);
  const taskId = clean(
    data?.task_id || data?.taskId || data?.id || data?.data?.task_id || data?.data?.taskId || data?.data?.id,
  );
  if (!taskId) throw new Error("AIComing 未返回异步任务 ID，未执行同步付费回退");
  return { taskId, raw: data, request: request.body };
}

export async function aicomingHaiyaSubmitImage(input: AicomingMerchantImageRequestInput) {
  return submitAicomingImageRequest(
    AICOMING_HAIYA_PROVIDER_ID,
    buildAicomingHaiyaGptImage2Request(input),
  );
}

export async function aicomingHaiyaGenerateGptImage25(input: AicomingGptImage25Input) {
  const request = buildAicomingHaiyaGptImage25Request(input);
  const { base, apiKey, decision } = await resolveAicomingEndpoint(AICOMING_HAIYA_PROVIDER_ID);
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url, request.idempotencyKey);
  let response;
  try {
    // Both 2.5 modes reject async tasks. The synchronous facade may wait up to 600 seconds.
    // Do not replay an uncertain synchronous request: async idempotency is not proof of sync deduplication.
    response = await axiosWithProviderEgress<any>(decision, {
      method: "POST",
      url,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {}),
      },
      data: request.body,
      timeout: 610000,
      validateStatus: () => true,
    });
  } catch {
    throw new Error("海牙 GPT-Image-2.5 连接中断，生成结果未知；请先核对海牙调用记录，避免重复提交计费");
  }
  if (response.status < 200 || response.status >= 300) {
    const fallback = `AIComing request failed (${response.status})`;
    throw new Error(sanitizeProviderErrorText(readError(response.data, fallback), sensitive, fallback));
  }
  const images: string[] = [];
  for (const item of Array.isArray(response.data?.data) ? response.data.data : []) {
    const image = clean(item?.url) || (clean(item?.b64_json) ? `data:image/png;base64,${clean(item.b64_json)}` : "");
    if (image && !images.includes(image)) images.push(image);
  }
  if (!images.length) throw new Error("海牙 GPT-Image-2.5 同步响应未返回图片");
  return { images, request: request.body };
}

export async function aicomingHaiyaSubmitNanoBananaPro(input: AicomingMerchantImageRequestInput) {
  return submitAicomingImageRequest(
    AICOMING_HAIYA_PROVIDER_ID,
    buildAicomingHaiyaNanoBananaProRequest(input),
  );
}

async function getAicomingImageTask(providerId: string, taskId: string) {
  const { base, apiKey, decision } = await resolveAicomingEndpoint(providerId);
  const url = `${base}${getAicomingGptImage2PollPath(taskId)}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  return readJsonResponse(response, sensitive);
}

export async function aicomingHaiyaGetImageTask(taskId: string) {
  return getAicomingImageTask(AICOMING_HAIYA_PROVIDER_ID, taskId);
}
