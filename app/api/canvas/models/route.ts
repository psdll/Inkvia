import { apiMessage } from "@/i18n/api-message";
// 画布节点的可选模型清单（登录可用，不含 Key）。
//   - image：复用现有 IMAGE_EDIT_MODEL_DEFINITIONS（createImageGeneration 实际接受的模型）
//   - video：复用现有 VIDEO_MODEL_DEFINITIONS
//   - chat ：来自供应商注册表（一键配置里管理员添加的 LLM 模型），供「开源版 LLM 节点」使用

import { NextRequest, NextResponse } from "next/server";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";
import { isOpenRouterGpt26Model } from "@/lib/openrouter-image-params";
import { getUserId } from "@/lib/server-auth";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { readProxySettingRaw, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import { resolveLlmRoute, resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { getVisibleImageEditModels, getVisibleToolboxModels } from "@/lib/image-edit-models";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getLlmModelVisibility, isLlmModelVisible, getLlmModelDisplayNames, getLlmModelDisplayName } from "@/lib/llm-routing/visibility";
import { getLlmThinkingCapabilities } from "@/lib/llm-routing/reasoning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId && !requireAdminRequest(req).ok) return json({ success: false, error: apiMessage("m48144f96c150") }, 401);

  const [providers, visibleImageModels, visibleVideoModels, visibleAudioModels, llmVisibility, llmDisplayNames] = await Promise.all([
    getRegisteredProviders(),
    getVisibleImageEditModels(),
    getVisibleToolboxModels("video"),
    getVisibleToolboxModels("audio").then(models => models.filter(model => !("purpose" in model && model.purpose === "speech-recognition"))),
    getLlmModelVisibility(),
    getLlmModelDisplayNames(),
  ]);
  const rawProxy = providers.some((provider) => provider.egressMode === "proxy")
    ? await readProxySettingRaw()
    : null;
  const proxyStatusByProviderId = Object.fromEntries(providers
    .filter((provider) => provider.egressMode === "proxy")
    .map((provider) => [provider.id, resolveProviderProxyFromRaw(provider.id, rawProxy).status]));
  const chat = [];
  for (const p of providers) {
    for (const m of p.chatModels || []) {
      if (!isLlmModelVisible(llmVisibility, p.id, m)) continue;
      const candidate = resolveLlmRouteFromProviders({
        scenarioId: "canvas.chat",
        binding: { providerId: p.id, modelId: m },
        providers,
        proxyStatusByProviderId,
      });
      if (candidate.status !== "ready") continue;
      chat.push({
        id: m,
        modelId: m,
        label: getLlmModelDisplayName(llmDisplayNames, p.id, m),
        providerId: candidate.route.providerId,
        providerName: candidate.route.providerName,
        protocol: candidate.route.protocol,
        status: candidate.route.status,
        ...getLlmThinkingCapabilities(candidate.route),
      });
    }
  }

  const resolvedDefault = await resolveLlmRoute("canvas.chat");
  const defaultVisible = resolvedDefault.status === "ready"
    && isLlmModelVisible(llmVisibility, resolvedDefault.route.providerId, resolvedDefault.route.modelId);
  const canvasDefault = resolvedDefault.status === "ready" && defaultVisible
    ? {
        scenarioId: resolvedDefault.route.scenarioId,
        providerId: resolvedDefault.route.providerId,
        providerName: resolvedDefault.route.providerName,
        modelId: resolvedDefault.route.modelId,
        protocol: resolvedDefault.route.protocol,
        source: resolvedDefault.route.source,
        status: resolvedDefault.route.status,
      }
    : { status: resolvedDefault.status === "ready" ? "hidden" : resolvedDefault.status };

  return json({
    success: true,
    image: visibleImageModels
      .filter((model) => (model.id !== APIMART_GPT_IMAGE_26_MODEL_ID && !isOpenRouterGpt26Model(model.id)) || isProviderModelEnabled(providers, "image", model.id))
      .map((model) => ({
        ...model,
        params: getCanvasImageModelParams(model.id),
      })),
    video: visibleVideoModels,
    audio: visibleAudioModels.filter((model) => isProviderModelEnabled(providers, "audio", model.id)),
    chat,
    canvasDefault,
  });
}
