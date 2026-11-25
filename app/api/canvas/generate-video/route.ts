import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
// 画布视频节点 → 复用现有 createVideoGeneration（产物自动落 Generation = 资产）。
//   POST /api/canvas/generate-video
//     body: { model, prompt, mediaPaths?, inputMode?, resolution?, ratio?, duration?, generateAudio? }
//   返回 { generationId, taskId, status }
//
// 与 /api/canvas/generate 同构：画布壳 + 复用，不重写视频生成逻辑。轮询走 /api/canvas/generation/[id]。

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import { createVideoGeneration, VideoGenerationError, type CreateVideoGenerationInput } from "@/lib/generation/video-service";
import { validate as validateUuid } from "uuid";

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
  const requestKey = String(body?.requestKey || "").trim().toLowerCase();
  if (!validateUuid(requestKey)) {
    return NextResponse.json({ success: false, error: apiMessage("m089a5763bdce") }, { status: 400 });
  }
  let prompt: string;
  try {
    prompt = composeCanvasCreativePrompt({ kind: "video", prompt: String(body?.prompt ?? ""), textList: body?.textList,
      creativePresets: body?.creativePresets, imageAngle: body?.imageAngle, cameraFixed: body?.cameraFixed === true });
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("mb76c1688d7a6")) }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ success: false, error: apiMessage("me7ce7fbc55ea") }, { status: 400 });

  const input: CreateVideoGenerationInput = {
    authUserId,
    requestKey,
    prompt,
    source: "canvas",
      canvasId: Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : undefined,
    model: body?.model ? String(body.model) : undefined,
    mediaPaths: Array.isArray(body?.mediaPaths) ? body.mediaPaths.map(String).filter(Boolean) : undefined,
    inputMode: body?.inputMode ? String(body.inputMode) : undefined,
    resolution: body?.resolution ? String(body.resolution) : undefined,
    ratio: body?.ratio ? String(body.ratio) : undefined,
    duration: body?.duration != null ? Number(body.duration) : undefined,
    generateAudio: typeof body?.generateAudio === "boolean" ? body.generateAudio : undefined,
    omniReferenceTaskType: body?.omniReferenceTaskType ? String(body.omniReferenceTaskType) as CreateVideoGenerationInput["omniReferenceTaskType"] : undefined,
    outputFormat: body?.outputFormat ? String(body.outputFormat) as CreateVideoGenerationInput["outputFormat"] : undefined,
  };

  try {
    const result = await createVideoGeneration(input);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof VideoGenerationError) {
      return NextResponse.json(
        { success: false, error: apiErrorMessage(error.friendlyError.message), generationId: error.generationId },
        { status: error.status },
      );
    }
    return NextResponse.json({ success: false, error: apiErrorMessage(String(error?.message || "生成失败")) }, { status: 500 });
  }
}
