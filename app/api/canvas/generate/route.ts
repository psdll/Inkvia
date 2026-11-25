import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
// 画布出图节点 → 复用现有 createImageGeneration（产物自动落 Generation = 资产）。
//   POST /api/canvas/generate  body: { model, prompt, aspectRatio?, resolution?, imagePaths? }
//   返回 { generationId, taskId, status, outputPaths }
//
// 这是「画布壳 + 复用」：不重写生成逻辑，直接调 lib/generation/image-service。

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import {
  createImageGeneration,
  ImageGenerationError,
  type CreateImageGenerationInput,
} from "@/lib/generation/image-service";
import { normalizeImageSubmissionRequestKey } from "@/lib/generation/image-request-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim() || "";
  const canvasId = Number(req.headers.get("X-Canvas-Id"));
  if ((editorSessionId || req.headers.has("X-Canvas-Id")) && (!editorSessionId || !Number.isSafeInteger(canvasId) || canvasId < 1 || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId, sessionId: editorSessionId }))) {
    return NextResponse.json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  let requestKey: string | undefined;
  try {
    requestKey = normalizeImageSubmissionRequestKey(body?.requestKey);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("ma8eda7982df6")) },
      { status: 400 },
    );
  }
  if (!requestKey) {
    return NextResponse.json({ success: false, error: apiMessage("m757c12ab42d6") }, { status: 400 });
  }
  let prompt: string;
  try {
    prompt = composeCanvasCreativePrompt({ kind: "image", prompt: String(body?.prompt ?? ""), textList: body?.textList,
      creativePresets: body?.creativePresets, imageAngle: body?.imageAngle, cameraFixed: body?.cameraFixed === true });
    if (body?.imageAngle && (!Array.isArray(body.imagePaths) || !body.imagePaths.some((path: unknown) => typeof path === "string" && path.trim()))) throw new Error("调整角度需要连接原图。");
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("mb76c1688d7a6")) }, { status: 400 });
  }
  if (!prompt && !(isSeedream55Model(body?.model) && body?.seedream55?.layerDecomposition === true)) return NextResponse.json({ success: false, error: apiMessage("me7ce7fbc55ea") }, { status: 400 });

  const input: CreateImageGenerationInput = {
    authUserId,
    requestKey,
    prompt,
    source: "canvas",
      canvasId: Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : undefined,
    model: body?.model ? String(body.model) : undefined,
    aspectRatio: body?.aspectRatio ? String(body.aspectRatio) : undefined,
    resolution: body?.resolution ? String(body.resolution) : undefined,
    customSize: body?.customSize ? String(body.customSize) : undefined,
    quality: body?.quality ? String(body.quality) : undefined,
    googleThinkingLevel: body?.googleThinkingLevel ? String(body.googleThinkingLevel) : undefined,
    googleSearchMode: body?.googleSearchMode ? String(body.googleSearchMode) : undefined,
    gptImage25Mode: body?.gptImage25Mode ? String(body.gptImage25Mode) : undefined,
    background: body?.background ? String(body.background) : undefined,
    outputFormat: body?.outputFormat ? String(body.outputFormat) : undefined,
    gifSize: body?.gifSize ? String(body.gifSize) : undefined,
    frameCount: body?.frameCount === undefined ? undefined : Number(body.frameCount),
    seedream55: body?.seedream55,
    frameDurationMs: body?.frameDurationMs === undefined ? undefined : Number(body.frameDurationMs),
    speed: body?.speed ? String(body.speed) : undefined,
    midjourneyOptions: body?.midjourneyOptions && typeof body.midjourneyOptions === "object" ? body.midjourneyOptions : undefined,
    imagePaths: Array.isArray(body?.imagePaths) ? body.imagePaths.map(String).filter(Boolean) : undefined,
  };

  try {
    const result = await createImageGeneration(input);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json(
        { success: false, error: apiErrorMessage(error.friendlyError.message), generationId: error.generationId },
        { status: error.status },
      );
    }
    return NextResponse.json({ success: false, error: apiErrorMessage(String(error?.message || "生成失败")) }, { status: 500 });
  }
}
