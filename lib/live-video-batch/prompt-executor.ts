import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import fs from "node:fs/promises";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { kieGeminiUsesMediaUrls } from "@/lib/media-delivery/llm";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";
import { resolveLlmRoute } from "@/lib/llm-routing/resolver";
import { Logger } from "@/lib/logger";
import { normalizeMediaUrl } from "@/lib/media-url";
import { isOssReady, uploadBufferToOss } from "@/lib/oss";
import { buildPromptReverseMessages } from "@/lib/prompt-reverse";
import { preparePromptReverseRelayImage } from "@/lib/prompt-reverse-media";
import { llmAcceptsInlineImage, resolvePromptReverseMediaUrl } from "@/lib/prompt-reverse-media-url";
import { resolvePublicPath } from "@/lib/public-path";

export class LiveVideoPromptExecutionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = "LiveVideoPromptExecutionError";
  }
}

function localUploadPathFromUrl(raw: string) {
  const value = String(raw || "").trim().replaceAll("\\", "/");
  if (value.startsWith("/uploads/")) return value;
  if (value.startsWith("uploads/")) return `/${value}`;
  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch {}
  return "";
}

async function resolvePromptMediaUrl(mediaUrl: string, origin: string, providerId?: string, modelId?: string) {
  if (kieGeminiUsesMediaUrls(providerId, modelId)) {
    return resolvePromptReverseMediaUrl(mediaUrl, origin, providerId, modelId, "live-video-prompt-inputs");
  }
  const localPath = localUploadPathFromUrl(mediaUrl);
  if (localPath && llmAcceptsInlineImage(providerId, modelId) && await getMediaDeliveryMode() === "platform") {
    const input = await fs.readFile(resolvePublicPath(localPath.replace(/^\/+/, "")));
    return `data:image/jpeg;base64,${(await preparePromptReverseRelayImage(input)).toString("base64")}`;
  }
  if (localPath && await isOssReady()) {
    const input = await fs.readFile(resolvePublicPath(localPath.replace(/^\/+/, "")));
    const relayImage = await preparePromptReverseRelayImage(input);
    return uploadBufferToOss(
      relayImage,
      "live-video-prompt-inputs",
      `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
      "image/jpeg",
    );
  }
  const absolute = mediaUrl.startsWith("/")
    ? new URL(mediaUrl, origin).toString()
    : mediaUrl;
  return resolveAssetUrlForExternalApi(absolute, "live-video-prompt-inputs");
}

export async function generateLiveVideoPrompt(input: {
  systemPrompt: string;
  userPrompt?: string;
  mediaUrl: string;
  origin: string;
  logUserId?: string;
}) {
  const startedAt = Date.now();
  const systemPrompt = String(input.systemPrompt || "").trim();
  const userPrompt = String(input.userPrompt || "").trim();
  const mediaUrl = normalizeMediaUrl(input.mediaUrl);
  if (!systemPrompt) {
    throw new LiveVideoPromptExecutionError(
      "Skill 系统提示词为空",
      400,
      "LIVE_VIDEO_PROMPT_SYSTEM_REQUIRED",
    );
  }
  if (!mediaUrl) {
    throw new LiveVideoPromptExecutionError(
      "任务缺少待分析图片",
      400,
      "LIVE_VIDEO_PROMPT_MEDIA_REQUIRED",
    );
  }

  const resolvedRoute = await resolveLlmRoute("image.role_prompt");
  if (resolvedRoute.status !== "ready") {
    throw new LiveVideoPromptExecutionError(
      `角色定位 LLM 路由不可用：${resolvedRoute.status}`,
      503,
      "LIVE_VIDEO_PROMPT_ROUTE_UNAVAILABLE",
    );
  }

  let resolvedMediaUrl: string;
  try {
    resolvedMediaUrl = await resolvePromptMediaUrl(mediaUrl, input.origin, resolvedRoute.route.providerId, resolvedRoute.route.modelId);
  } catch (error) {
    throw new LiveVideoPromptExecutionError(
      error instanceof Error ? error.message : "图片链接不可用",
      400,
      "LIVE_VIDEO_PROMPT_MEDIA_UNAVAILABLE",
    );
  }

  const gatewayResult = await callLlmForScenario(
    resolvedRoute.route,
    buildPromptReverseMessages({
      systemPrompt,
      userPrompt,
      mediaUrls: [resolvedMediaUrl],
    }),
    { billingIdentity: { userId: input.logUserId } },
  );
  const generatedPrompt = String(gatewayResult.text || "").trim();
  if (!generatedPrompt) {
    throw new LiveVideoPromptExecutionError(
      "LLM 返回空提示词，请重试",
      502,
      "LIVE_VIDEO_PROMPT_EMPTY",
    );
  }

  if (input.logUserId) {
    await Logger.log({
      userId: input.logUserId,
      category: "api",
      action: "live_video_prompt",
      level: "success",
      message: "Live 视频任务 Skill 分析成功",
      metadata: {
        llmProviderId: resolvedRoute.route.providerId,
        model: resolvedRoute.route.modelId,
        mediaCount: 1,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        generatedLength: generatedPrompt.length,
      },
      duration: Date.now() - startedAt,
    });
  }

  return {
    generatedPrompt,
    llmProviderId: resolvedRoute.route.providerId,
    model: resolvedRoute.route.modelId,
    resolvedMediaUrl,
    rawResponse: gatewayResult,
  };
}
