import { buildReapiGptImage25Request, type ReapiGptImage25Input } from "@/lib/reapi-gpt-image-25";
import {
  GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL,
  REAPI_GPT_IMAGE_2_MODEL_ID,
  normalizeGptImage2OfficialParams,
  normalizeGptImage2OfficialReferences,
  uniqueHttpUrls,
} from "@/lib/gpt-image-2-official";
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

export { REAPI_GPT_IMAGE_2_MODEL_ID };

export function buildReapiGptImage2Request(input: {
  prompt: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  quality?: unknown;
  imageUrls?: unknown;
}) {
  const params = normalizeGptImage2OfficialParams({ ...input, allowAuto: true });
  const imageUrls = normalizeGptImage2OfficialReferences(input.imageUrls);
  return {
    endpoint: "/images/generations",
    body: {
      model: GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL,
      prompt: String(input.prompt ?? "").trim(),
      size: params.aspectRatio,
      resolution: params.resolution.toLowerCase(),
      quality: params.quality,
      n: 1,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    },
  };
}

export function getReapiGptImage2PollPath(taskId: unknown) {
  return `/tasks/${encodeURIComponent(String(taskId ?? "").trim())}`;
}

export function extractReapiImageUrls(data: any) {
  return uniqueHttpUrls(Array.isArray(data?.output?.image_urls) ? data.output.image_urls : []);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function readError(data: any, fallback: string) {
  return clean(data?.error?.message || data?.message || data?.error || fallback);
}

async function readJsonResponse(
  response: Response,
  decision: ProviderEgressDecision,
  sensitive: string[],
) {
  const text = await response.text();
  // A gateway HTML response is not a model validation error. Keep diagnostics
  // useful without exposing the block page (which may contain client details).
  const isHtml = /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)
    || (response.headers.get("content-type") || "").includes("text/html");
  if (isHtml) {
    const ray = response.headers.get("cf-ray") || "";
    const rayLabel = /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/i.test(ray) ? `；Ray ID: ${ray}` : "";
    if (/cloudflare|cf-error-details|cf-chl-/i.test(text)) {
      throw new Error(`reAPI 请求被 Cloudflare 网关拦截（HTTP ${response.status}${rayLabel}）。请联系 reAPI 平台排查 API 访问拦截；这不是模型参数校验错误。`);
    }
    throw new Error(`reAPI 返回了网页而非 API 数据（HTTP ${response.status}），请检查平台 API 地址和网关状态。`);
  }
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

async function resolveReapiEndpoint() {
  const context = await resolveProviderRequestContext("reapi");
  return {
    base: clean(context.provider.baseUrl).replace(/\/+$/, ""),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

async function submitReapiImageRequest(request: { endpoint: string; body: Record<string, unknown> }) {
  const { base, apiKey, decision } = await resolveReapiEndpoint();
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await readJsonResponse(response, decision, sensitive);
  const taskId = clean(data?.id || data?.task_id || data?.taskId);
  if (!taskId) throw new Error("reAPI 未返回异步任务 ID");
  return { taskId, raw: data, request: request.body };
}

export async function reapiSubmitImage(input: Parameters<typeof buildReapiGptImage2Request>[0]) {
  return submitReapiImageRequest(buildReapiGptImage2Request(input));
}

export async function reapiSubmitGptImage25(input: ReapiGptImage25Input) {
  return submitReapiImageRequest(buildReapiGptImage25Request(input));
}

export async function reapiGetImageTask(taskId: string) {
  const { base, apiKey, decision } = await resolveReapiEndpoint();
  const url = `${base}${getReapiGptImage2PollPath(taskId)}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  return readJsonResponse(response, decision, sensitive);
}
