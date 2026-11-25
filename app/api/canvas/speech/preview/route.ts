import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { validate as validateUuid } from "uuid";
import {
  AudioGenerationError,
} from "@/lib/generation/audio-service";
import { getOrCreateMiniMaxVoicePreview } from "@/lib/generation/audio-preview-cache";
import {
  MINIMAX_SPEECH_DEFAULT_VOICE_ID,
  type MiniMaxSpeechModelId,
} from "@/lib/minimax-speech-models";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId)
    return NextResponse.json(
      { success: false, error: apiMessage("m48144f96c150") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const requestKey = String(body?.requestKey || "")
    .trim()
    .toLowerCase();
  if (!validateUuid(requestKey)) {
    return NextResponse.json(
      { success: false, error: apiMessage("m089a5763bdce") },
      { status: 400 },
    );
  }

  try {
    const result = await getOrCreateMiniMaxVoicePreview({
      authUserId,
      requestKey,
      model: String(body?.model || "") as MiniMaxSpeechModelId,
      voiceId: String(body?.voiceId || MINIMAX_SPEECH_DEFAULT_VOICE_ID),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AudioGenerationError) {
      return NextResponse.json(
        {
          success: false,
          error: apiErrorMessage(error.message),
          generationId: error.generationId,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, error: apiMessage("mb99415d23815") },
      { status: 500 },
    );
  }
}
