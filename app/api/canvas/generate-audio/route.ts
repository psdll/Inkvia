import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { composeCanvasModelPrompt } from "@/lib/canvas/text-references";
import { NextRequest, NextResponse } from "next/server";
import { validate as validateUuid } from "uuid";
import prisma from "@/lib/prisma";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import {
  AudioGenerationError,
  createAudioGeneration,
} from "@/lib/generation/audio-service";
import { getUserId } from "@/lib/server-auth";
import { isSeedAudioModel } from "@/lib/seed-audio-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim() || "";
  const canvasId = Number(req.headers.get("X-Canvas-Id"));
  if ((editorSessionId || req.headers.has("X-Canvas-Id")) && (
    !editorSessionId
    || !Number.isSafeInteger(canvasId)
    || canvasId < 1
    || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId, sessionId: editorSessionId })
  )) {
    return NextResponse.json(
      { success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, any> | null;
  const requestKey = String(body?.requestKey || "").trim().toLowerCase();
  if (!validateUuid(requestKey)) {
    return NextResponse.json({ success: false, error: apiMessage("m089a5763bdce") }, { status: 400 });
  }

  try {
    const result = await createAudioGeneration({
      authUserId,
      requestKey,
      source: "canvas",
      canvasId: Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : undefined,
      model: String(body?.model || "") as any,
      suno: body?.suno,
      text: composeCanvasModelPrompt(String(body?.text || ""), body?.textList),
      ...(isSeedAudioModel(String(body?.model || "")) ? {
        audioFormat: body?.audioFormat,
        sampleRate: body?.sampleRate === undefined ? undefined : Number(body.sampleRate),
        references: body?.references ?? [],
      } : {}),
      voiceId: String(body?.voiceId || ""),
      speed: Number(body?.speed),
      pitch: Number(body?.pitch),
      volume: Number(body?.volume),
      modifyPitch: Number(body?.modifyPitch),
      modifyIntensity: Number(body?.modifyIntensity),
      modifyTimbre: Number(body?.modifyTimbre),
      soundEffect: String(body?.soundEffect || "") as any,
      ...(body?.emotion ? { emotion: String(body.emotion) as import("@/lib/minimax-speech-models").MiniMaxSpeechEmotion } : {}),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AudioGenerationError) {
      return NextResponse.json(
        { success: false, error: apiErrorMessage(error.message), generationId: error.generationId },
        { status: error.status },
      );
    }
    return NextResponse.json({ success: false, error: apiMessage("mda11b5d15a13") }, { status: 500 });
  }
}
