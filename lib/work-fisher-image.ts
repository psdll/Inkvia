import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";
import {
  QWEN_IMAGE_21_MODEL_ID,
  QWEN_IMAGE_21_MAX_REFERENCES,
  WORK_FISHER_PROVIDER_ID,
  normalizeQwenImage21Params,
} from "@/lib/work-fisher-image-params";

// Contract: https://api.work-fisher.com/pricing/qwen-image-global-2.1 (2026-09-21).
// Task envelope: https://api.work-fisher.com/docs/#get-image.
export function buildWorkFisherImageRequest(input: {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
}) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Qwen-Image-Global-2.1 缺少提示词");
  const params = normalizeQwenImage21Params(input);
  const images = (input.imageUrls || []).map((url) => url.trim());
  if (images.length > QWEN_IMAGE_21_MAX_REFERENCES)
    throw new Error("Qwen-Image-Global-2.1 最多支持 10 张参考图");
  if (images.some((url) => !/^https?:\/\//i.test(url)))
    throw new Error("Qwen-Image-Global-2.1 参考图必须是可访问的 HTTP(S) URL");
  return {
    endpoint: "/image/generations",
    body: {
      model: QWEN_IMAGE_21_MODEL_ID,
      prompt,
      ...(images.length ? { images } : {}),
      metadata: {
        ratio: params.aspectRatio,
        resolution: params.resolution.toLowerCase(),
      },
    },
  };
}

async function requestWorkFisher(path: string, body?: unknown) {
  const context = await resolveProviderRequestContext(WORK_FISHER_PROVIDER_ID);
  const base = context.provider.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = resolvedProviderApiKey(context.provider);
  const url = `${base}${path}`;
  const sensitive = providerErrorSensitiveValues(
    context.decision,
    apiKey,
    base,
    url,
  );
  try {
    const response = await fetchWithProviderEgress(context.decision, url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const data = sanitizeProviderErrorFields(
      await response.json(),
      sensitive,
    ) as any;
    if (
      !response.ok ||
      data?.error ||
      (data?.code !== undefined && !["success", 200, true].includes(data.code))
    ) {
      throw new Error(
        sanitizeProviderErrorText(
          `FisherAI 请求失败 (${response.status}): ${data?.error?.message || data?.message || "响应无效"}`,
          sensitive,
        ),
      );
    }
    return data;
  } catch (error) {
    throw new Error(
      sanitizeProviderErrorText(
        error instanceof Error ? error.message : String(error),
        sensitive,
        "FisherAI 请求失败",
      ),
    );
  }
}

export async function workFisherSubmitImage(
  input: Parameters<typeof buildWorkFisherImageRequest>[0],
) {
  const request = buildWorkFisherImageRequest(input);
  // Never retry POST: a lost response may already have created a billable task.
  const raw = await requestWorkFisher(request.endpoint, request.body);
  const taskId = String(raw?.task_id || raw?.id || "").trim();
  if (!taskId)
    throw new Error(
      "FisherAI 未返回任务 ID，提交结果未知，请核对平台记录后再重试",
    );
  return { taskId, raw, request: request.body };
}

export async function workFisherGetImageTask(taskId: string) {
  if (!taskId.trim()) throw new Error("FisherAI 缺少任务 ID");
  return requestWorkFisher(`/image/generations/${encodeURIComponent(taskId)}`);
}

export function parseWorkFisherImageTask(detail: any) {
  const data = detail?.data;
  const state = String(data?.status || "").toUpperCase();
  if (state === "SUCCESS") {
    const url = String(data?.result_url || "").trim();
    return {
      kind: "done" as const,
      urls: /^https?:\/\//i.test(url) ? [url] : [],
      providerStatus: state,
      providerUsage: data?.usage || null,
    };
  }
  if (state === "FAILURE") {
    return {
      kind: "failed" as const,
      message: sanitizeProviderErrorText(
        data?.fail_reason || "FisherAI 图片生成失败",
      ),
      providerStatus: state,
    };
  }
  if (!["NOT_START", "SUBMITTED", "IN_PROGRESS"].includes(state))
    throw new Error("FisherAI 返回了未知任务状态");
  return { kind: "pending" as const, providerStatus: state };
}
