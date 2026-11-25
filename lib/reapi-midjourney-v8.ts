import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";
import {
  MIDJOURNEY_V8_UPSTREAM_MODEL,
  MIDJOURNEY_V8_VERSION,
  normalizeMidjourneyV8Ratio,
  normalizeMidjourneyV8Speed,
} from "@/lib/midjourney-v8";

export {
  MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_MODEL_LABEL,
  MIDJOURNEY_V8_OUTPUT_COUNT,
  MIDJOURNEY_V8_RATIOS,
  MIDJOURNEY_V8_SPEEDS,
  MIDJOURNEY_V8_UPSTREAM_MODEL,
  MIDJOURNEY_V8_VERSION,
  isMidjourneyV8Model,
  normalizeMidjourneyV8Ratio,
  normalizeMidjourneyV8Speed,
} from "@/lib/midjourney-v8";

function normalizePublicImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = String(item ?? "").trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Midjourney V8.2 参考图必须是公开 HTTP(S) URL");
    }
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function buildReapiMidjourneyV8Request(input: {
  prompt: unknown;
  aspectRatio?: unknown;
  speed?: unknown;
  imageUrls?: unknown;
}) {
  const imageUrls = normalizePublicImageUrls(input.imageUrls);
  return {
    endpoint: "/images/generations",
    body: {
      model: MIDJOURNEY_V8_UPSTREAM_MODEL,
      action: imageUrls.length ? "edits" : "imagine",
      prompt: String(input.prompt ?? "").trim(),
      version: MIDJOURNEY_V8_VERSION,
      size: normalizeMidjourneyV8Ratio(input.aspectRatio),
      speed: normalizeMidjourneyV8Speed(input.speed),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    },
  };
}

export function extractReapiMidjourneyTaskId(data: any): string {
  return String(
    data?.id
    || data?.task_id
    || data?.taskId
    || data?.data?.[0]?.task_id
    || data?.data?.[0]?.taskId
    || data?.data?.[0]?.id
    || "",
  ).trim();
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function readError(data: any, fallback: string) {
  return clean(data?.error?.message || data?.message || data?.error || fallback);
}

async function readJsonResponse(
  response: Response,
  _decision: ProviderEgressDecision,
  sensitive: string[],
) {
  const text = await response.text();
  let data: any = null;
  try {
    data = sanitizeProviderErrorFields(JSON.parse(text), sensitive);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const fallback = `reAPI request failed (${response.status})`;
    throw new Error(sanitizeProviderErrorText(readError(data, text || fallback), sensitive, fallback));
  }
  return data;
}

export async function reapiSubmitMidjourneyV8(
  input: Parameters<typeof buildReapiMidjourneyV8Request>[0],
) {
  const context = await resolveProviderRequestContext("reapi");
  const base = clean(context.provider.baseUrl).replace(/\/+$/, "");
  const apiKey = resolvedProviderApiKey(context.provider);
  const request = buildReapiMidjourneyV8Request(input);
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(context.decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(context.decision, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await readJsonResponse(response, context.decision, sensitive);
  const taskId = extractReapiMidjourneyTaskId(data);
  if (!taskId) throw new Error("reAPI 未返回异步任务 ID");
  return { taskId, raw: data, request: request.body };
}
