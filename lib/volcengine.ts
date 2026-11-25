import { getVolcengineArkBaseUrl } from "@/lib/config";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { providerErrorSensitiveValues, sanitizeProviderErrorFields, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
  type ProviderEgressDecision,
} from "@/lib/providers/transport";
import { DOUBAO_SEEDREAM_5_LITE_MODEL, DOUBAO_SEEDREAM_5_PRO_MODEL } from "@/lib/toolbox-models";

export type VolcSeedreamGenerationBody = {
  model: string;
  prompt?: string;
  background?: "auto" | "opaque" | "transparent";
  layer_decomposition?: boolean;
  layer_decomposition_options?: { max_images: number; text_recognition: boolean };
  image?: string | string[];
  size?: string;
  n?: number;
  sequential_image_generation?: "auto" | "disabled";
  sequential_image_generation_options?: {
    max_images?: number;
  };
  watermark?: boolean;
  stream?: boolean;
  output_format?: "png" | "jpeg";
  response_format?: "url" | "b64_json";
  tools?: Array<{ type: "web_search" }>;
};

function extractVolcImageUrls(payload: any) {
  const data = payload?.data;
  if (!Array.isArray(data)) return [];
  const urls: string[] = [];
  for (const item of data) {
    const u = String(item?.url || "").trim();
    if (u) urls.push(u);
  }
  return urls;
}

function trimSlash(s: string) {
  return String(s || "").trim().replace(/\/+$/, "");
}

async function resolveVolcengineEndpoint() {
  const context = await resolveProviderRequestContext("volcengine");
  const base = trimSlash(context.provider.baseUrl || getVolcengineArkBaseUrl());
  const apiKey = resolvedProviderApiKey(context.provider);
  return { base, apiKey, decision: context.decision };
}

function isModelAccessError(msg: string) {
  const s = String(msg || "").toLowerCase();
  return /model or endpoint .* does not exist/.test(s) || /do not have access/.test(s);
}

function extractRequestId(payload: any) {
  const rid = String(payload?.request_id || payload?.requestId || payload?.error?.request_id || payload?.error?.requestId || "").trim();
  return rid;
}

function normalizeSeedreamModelFamily(model: string) {
  const m = String(model || "").trim().toLowerCase();
  if (!m) return "5.0-lite";
  if (m.includes("5.0-pro") || m.includes("5-0-pro")) return "5.0-pro";
  if (m.includes("4.5") || m.includes("4-5")) return "4.5";
  if (m.includes("4.0") || m.includes("4-0")) return "4.0";
  return "5.0-lite";
}

type VolcModelCache = {
  fetchedAt: number;
  ids: string[];
};

let volcModelsCache: VolcModelCache | null = null;

async function getVolcModelIds(base: string, apiKey: string, decision: ProviderEgressDecision) {
  const now = Date.now();
  if (volcModelsCache && now - volcModelsCache.fetchedAt < 5 * 60 * 1000) {
    return volcModelsCache.ids;
  }
  try {
    const res = await fetchWithProviderEgress(decision, `${base}/api/v3/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = (await res.json().catch(() => null)) as any;
    const ids = Array.isArray(data?.data)
      ? data.data.map((x: any) => String(x?.id || "").trim()).filter(Boolean)
      : [];
    volcModelsCache = { fetchedAt: now, ids };
    return ids;
  } catch {
    return [];
  }
}

function getSeedreamModelCandidates(model: string, availableIds: string[] = []) {
  const family = normalizeSeedreamModelFamily(model);
  const ids = availableIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (family === "4.5") {
    return Array.from(
      new Set([
        ...ids.filter((x) => x.startsWith("doubao-seedream-4-5-")).sort().reverse(),
        ...ids.filter((x) => x === "doubao-seedream-4.5" || x === "doubao-seedream-4-5"),
        "doubao-seedream-4-5-251128",
        "doubao-seedream-4.5",
        "doubao-seedream-4-5"
      ])
    );
  }
  if (family === "4.0") {
    return Array.from(
      new Set([
        ...ids.filter((x) => x.startsWith("doubao-seedream-4-0-")).sort().reverse(),
        ...ids.filter((x) => x === "doubao-seedream-4.0" || x === "doubao-seedream-4-0"),
        "doubao-seedream-4-0-250828",
        "doubao-seedream-4.0",
        "doubao-seedream-4-0"
      ])
    );
  }
  if (family === "5.0-pro") {
    return Array.from(
      new Set([
        ...ids.filter((x) => x.startsWith("doubao-seedream-5-0-pro-")).sort().reverse(),
        ...ids.filter((x) => x === "doubao-seedream-5-0-pro" || x === DOUBAO_SEEDREAM_5_PRO_MODEL),
        "doubao-seedream-5-0-pro-260628",
        "doubao-seedream-5-0-pro",
        DOUBAO_SEEDREAM_5_PRO_MODEL
      ])
    );
  }
  return Array.from(
    new Set([
      ...ids.filter((x) => x.startsWith("doubao-seedream-5-0-") && !x.startsWith("doubao-seedream-5-0-pro-")).sort().reverse(),
      ...ids.filter((x) => x === "doubao-seedream-5-0" || x === "doubao-seedream-5-0-lite" || x === DOUBAO_SEEDREAM_5_LITE_MODEL),
      "doubao-seedream-5-0-260128",
      "doubao-seedream-5-0",
      "doubao-seedream-5-0-lite",
      DOUBAO_SEEDREAM_5_LITE_MODEL
    ])
  );
}

async function callVolcImageGeneration(
  base: string,
  apiKey: string,
  decision: ProviderEgressDecision,
  body: VolcSeedreamGenerationBody
): Promise<{ urls: string[]; raw: any; modelUsed: string }> {
  const url = `${base}/api/v3/images/generations`;
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, base, url);
  const res = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = sanitizeProviderErrorFields((await res.json().catch(() => null)) as any, sensitiveValues);
  if (!res.ok) {
    const msg =
      String(data?.error?.message || data?.message || data?.msg || "").trim() ||
      `Volcengine images/generations 失败（${res.status}）`;
    const safeMessage = sanitizeProviderErrorText(msg, sensitiveValues, `Volcengine images/generations 失败（${res.status}）`);
    const err = new Error(safeMessage) as Error & { requestId?: string };
    err.requestId = extractRequestId(data) || undefined;
    throw err;
  }
  const urls = extractVolcImageUrls(data);
  if (!urls.length) {
    throw new Error("Volcengine 未返回可用图片 URL");
  }
  return { urls, raw: data, modelUsed: body.model };
}

export async function volcSeedreamGenerate(body: VolcSeedreamGenerationBody, options?: { exactModel: boolean }) {
  const { base, apiKey, decision } = await resolveVolcengineEndpoint();
  if (options?.exactModel) return callVolcImageGeneration(base, apiKey, decision, body);
  const availableIds = await getVolcModelIds(base, apiKey, decision);
  const candidates = getSeedreamModelCandidates(body.model, availableIds);
  const firstModel = candidates.includes(body.model) ? body.model : candidates[0];
  try {
    return await callVolcImageGeneration(base, apiKey, decision, { ...body, model: firstModel });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (isModelAccessError(msg)) {
      for (const id of candidates) {
        if (id === firstModel) continue;
        try {
          return await callVolcImageGeneration(base, apiKey, decision, { ...body, model: id });
        } catch {}
      }
    }
    if (isModelAccessError(msg)) {
      const rid = String((e as any)?.requestId || "").trim();
      throw new Error(
        `Doubao-Seedream 当前不可用：请确认已在 Volcengine Ark（cn-beijing）开通并对 API Key 授权（可用ID示例：doubao-seedream-5-0-260128 / doubao-seedream-4.5 / doubao-seedream-4.0）${rid ? `（request_id: ${rid}）` : ""}`
      );
    }
    throw e;
  }
}
