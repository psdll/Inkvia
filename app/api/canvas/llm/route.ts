import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { composeCanvasModelPrompt } from "@/lib/canvas/text-references";
// 画布 LLM 节点后端（开源版，走注册表，不碰现有 Agent）。
//   POST /api/canvas/llm  body: { prompt, textList?, mediaReferences?, system?, override? }
//   返回 { text }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import { buildCanvasLlmContent, normalizeCanvasLlmMedia, CanvasLlmInputError } from "@/lib/canvas/llm-media";
import { callLlmForScenario, getPublicLlmError } from "@/lib/llm-routing/gateway";
import { resolveLlmRoute } from "@/lib/llm-routing/resolver";
import { getLlmModelVisibility, isLlmModelVisible } from "@/lib/llm-routing/visibility";
import { LLM_THINKING_LEVELS, buildLlmThinkingParams, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return json({ success: false, error: apiMessage("m48144f96c150") }, 401);
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim() || "";
  const canvasId = Number(req.headers.get("X-Canvas-Id"));
  if ((editorSessionId || req.headers.has("X-Canvas-Id")) && (!editorSessionId || !Number.isSafeInteger(canvasId) || canvasId < 1 || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId, sessionId: editorSessionId }))) {
    return json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") }, 409);
  }

  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  const prompt = composeCanvasModelPrompt(String(body?.prompt ?? ""), body?.textList);
  if (!prompt) return json({ success: false, error: apiMessage("mb8746b27b31f") }, 400);
  if (body?.thinkingLevel !== undefined && !LLM_THINKING_LEVELS.includes(body.thinkingLevel)) return json({ success: false, error: apiMessage("mca41203c873f") }, 400);
  const thinkingLevel = body?.thinkingLevel as LlmThinkingLevel | undefined;
  let mediaReferences;
  try {
    if (body?.imageUrls !== undefined && !Array.isArray(body.imageUrls)) throw new CanvasLlmInputError("参考图片参数无效");
    mediaReferences = normalizeCanvasLlmMedia(body?.mediaReferences !== undefined ? body.mediaReferences : body?.imageUrls?.map((url: unknown) => ({ kind: "image", url })), req.url);
  } catch (error) {
    return json({ success: false, error: apiErrorMessage((error as Error).message) }, 400);
  }

  let override: { providerId: string; modelId: string } | null = null;
  const hasOverride = body !== null
    && typeof body === "object"
    && Object.prototype.hasOwnProperty.call(body, "override");
  if (hasOverride) {
    const rawOverride = body?.override;
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) {
      return json({ success: false, error: apiMessage("m66f89b45e54c") }, 400);
    }
    const providerId = typeof rawOverride.providerId === "string" ? rawOverride.providerId.trim() : "";
    const modelId = typeof rawOverride.modelId === "string" ? rawOverride.modelId.trim() : "";
    if (!providerId || !modelId) {
      return json({ success: false, error: apiMessage("m66f89b45e54c") }, 400);
    }
    override = { providerId, modelId };
  }

  try {
    const resolved = await resolveLlmRoute("canvas.chat", override);
    if (resolved.status !== "ready") {
      return json({ success: false, error: apiMessage("me9712667a9f9"), status: resolved.status }, 503);
    }
    if (!isLlmModelVisible(await getLlmModelVisibility(), resolved.route.providerId, resolved.route.modelId)) {
      return json({ success: false, code: "MODEL_HIDDEN", error: apiMessage("m51f7b6dac501") }, 400);
    }
    try { buildLlmThinkingParams(resolved.route, thinkingLevel); }
    catch { return json({ success: false, error: apiMessage("m4de459873cba") }, 400); }
    const userContent = await buildCanvasLlmContent({ prompt, providerId: resolved.route.providerId, modelId: resolved.route.modelId, mediaReferences, origin: new URL(req.url).origin });
    const messages = [
      ...(body?.system ? [{ role: "system" as const, content: String(body.system) }] : []),
      { role: "user" as const, content: userContent },
    ];
    const result = await callLlmForScenario(resolved.route, messages, { billingIdentity: { authUserId }, thinkingLevel });
    return json({ success: true, ...result });
  } catch (e: any) {
    if (e instanceof CanvasLlmInputError) return json({ success: false, error: apiErrorMessage(e.message) }, 400);
    return json({ success: false, error: apiErrorMessage(getPublicLlmError(e)) }, 500);
  }
}
