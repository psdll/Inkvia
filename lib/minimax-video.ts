import {
  MINIMAX_H3_MAX_UPSTREAM_MODEL,
  MINIMAX_PROVIDER_ID,
  MINIMAX_H3_UPSTREAM_MODEL,
} from "@/lib/minimax-models";
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
import type { VideoInputMode } from "@/lib/sora2";

export type MiniMaxH3Media = {
  type: "image" | "video" | "audio";
  url: string;
};

export type MiniMaxH3CreateInput = {
  model?: typeof MINIMAX_H3_UPSTREAM_MODEL | typeof MINIMAX_H3_MAX_UPSTREAM_MODEL;
  prompt: string;
  inputMode: VideoInputMode;
  resolution: "480p" | "768p" | "2k";
  ratio: string;
  duration: number;
  watermark: boolean;
  media: MiniMaxH3Media[];
};

function buildContent(input: MiniMaxH3CreateInput): object[] {
  const content: object[] = [{ type: "text", text: input.prompt }];
  input.media.forEach((media, index) => {
    const role = input.inputMode === "first_frame"
      ? "first_frame"
      : input.inputMode === "first_last_frame"
        ? index === 0 ? "first_frame" : "last_frame"
        : media.type === "video"
          ? "reference_video"
          : media.type === "audio"
            ? "reference_audio"
            : "reference_image";
    if (media.type === "image") {
      content.push({ type: "image_url", image_url: { url: media.url }, role });
    } else if (media.type === "video") {
      content.push({ type: "video_url", video_url: { url: media.url }, role });
    } else {
      content.push({ type: "audio_url", audio_url: { url: media.url }, role });
    }
  });
  return content;
}

export function buildMiniMaxH3Request(input: MiniMaxH3CreateInput) {
  const model = input.model || MINIMAX_H3_UPSTREAM_MODEL;
  if (model === MINIMAX_H3_MAX_UPSTREAM_MODEL) {
    if (input.inputMode === "multimodal") {
      throw new Error("MiniMax-H3-Max does not support multimodal reference inputs");
    }
    if (input.resolution === "2k") {
      throw new Error("MiniMax-H3-Max does not support 2K resolution");
    }
    if (input.duration < 5 || input.duration > 15) {
      throw new Error("MiniMax-H3-Max duration must be between 5 and 15 seconds");
    }
    if (input.media.some((media) => media.type !== "image")) {
      throw new Error("MiniMax-H3-Max frame inputs must be images");
    }
  }
  return {
    endpoint: "/v2/video_generation",
    body: {
      model,
      content: buildContent(input),
      resolution: input.resolution === "2k" ? "2K" : input.resolution === "480p" ? "480P" : "768P",
      duration: input.duration,
      ratio: input.inputMode === "first_frame" || input.inputMode === "first_last_frame"
        ? "adaptive"
        : input.ratio,
      aigc_watermark: input.watermark,
    },
  };
}

export function getMiniMaxH3PollPath(taskId: string): string {
  return `/v2/query/video_generation/${encodeURIComponent(taskId)}`;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
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
    const fallback = `MiniMax request failed (${response.status})`;
    const raw = clean(data?.error?.message || data?.message || text || fallback);
    const detail = sanitizeProviderErrorText(raw, sensitive, fallback);
    const error = new Error(detail === fallback ? fallback : `${fallback}: ${detail}`) as Error & {
      statusCode: number;
    };
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function resolveMiniMaxEndpoint() {
  const context = await resolveProviderRequestContext(MINIMAX_PROVIDER_ID);
  return {
    base: clean(context.provider.baseUrl).replace(/\/+$/, ""),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

export async function miniMaxSubmitVideo(input: MiniMaxH3CreateInput) {
  const request = buildMiniMaxH3Request(input);
  const { base, apiKey, decision } = await resolveMiniMaxEndpoint();
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  try {
    const response = await fetchWithProviderEgress(decision, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await readJsonResponse(response, sensitive);
    const taskId = clean(data?.task_id);
    if (!taskId) throw new Error("MiniMax 未返回异步视频任务 ID");
    return { taskId, raw: data, request: request.body };
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(error.message, sensitive, "MiniMax 请求失败");
      throw error;
    }
    throw new Error("MiniMax 请求失败");
  }
}

export async function miniMaxGetVideoTask(taskId: string) {
  const { base, apiKey, decision } = await resolveMiniMaxEndpoint();
  const url = `${base}${getMiniMaxH3PollPath(taskId)}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  try {
    const response = await fetchWithProviderEgress(decision, url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    return readJsonResponse(response, sensitive);
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(error.message, sensitive, "MiniMax 查询任务失败");
      throw error;
    }
    throw new Error("MiniMax 查询任务失败");
  }
}
