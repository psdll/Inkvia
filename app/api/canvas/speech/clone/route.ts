import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import {
  CANVAS_CLONE_MAX_BYTES,
  CANVAS_CLONE_MAX_SECONDS,
  CANVAS_CLONE_MIN_SECONDS,
  inspectPcmWav,
} from "@/lib/canvas/pcm-wav";
import { isAudioModelVisible } from "@/lib/image-edit-models";
import {
  createMiniMaxCloneVoiceId,
  isMiniMaxSpeechModel,
} from "@/lib/minimax-speech-models";
import {
  miniMaxCloneVoice,
  resolveMiniMaxVoiceCatalogSource,
} from "@/lib/minimax-speech";
import { invalidateMiniMaxVoiceCache } from "@/lib/minimax-voice-cache";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { getUserId } from "@/lib/server-auth";
import { saveCanvasClonedVoice } from "@/lib/canvas/cloned-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAV_MIME_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId)
    return NextResponse.json(
      { success: false, error: apiMessage("m48144f96c150") },
      { status: 401 },
    );

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const model = String(form?.get("model") || "").trim();

  if (!(file instanceof File) || !file.size) {
    return NextResponse.json(
      { success: false, error: apiMessage("m33950b3f2c6c") },
      { status: 400 },
    );
  }
  if (file.size > CANVAS_CLONE_MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: apiMessage("m0da55fa21f64") },
      { status: 400 },
    );
  }
  if (
    !/\.wav$/i.test(file.name) ||
    !WAV_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return NextResponse.json(
      { success: false, error: apiMessage("mfaeaceba01f5") },
      { status: 400 },
    );
  }
  if (!isMiniMaxSpeechModel(model)) {
    return NextResponse.json(
      { success: false, error: apiMessage("m9951b0a407bb") },
      { status: 400 },
    );
  }
  let durationSeconds = 0;
  try {
    durationSeconds = inspectPcmWav(await file.arrayBuffer()).durationSeconds;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("me8cbaa5883d6")),
      },
      { status: 400 },
    );
  }
  if (
    durationSeconds < CANVAS_CLONE_MIN_SECONDS ||
    durationSeconds > CANVAS_CLONE_MAX_SECONDS
  ) {
    return NextResponse.json(
      { success: false, error: apiMessage("m4f78b77902c2") },
      { status: 400 },
    );
  }

  const [providers, visible] = await Promise.all([
    getRegisteredProviders(),
    isAudioModelVisible(model),
  ]);
  if (!visible || !isProviderModelEnabled(providers, "audio", model)) {
    return NextResponse.json(
      { success: false, error: apiMessage("m39b2b226b4e6") },
      { status: 400 },
    );
  }

  try {
    const source = await resolveMiniMaxVoiceCatalogSource();
    const voiceId = createMiniMaxCloneVoiceId();
    const result = await miniMaxCloneVoice(file, {
      model,
      voiceId,
      previewText: "",
      needNoiseReduction: false,
      needVolumeNormalization: false,
    });
    invalidateMiniMaxVoiceCache(source.scopeKey);
    let warning: string | undefined;
    try {
      await saveCanvasClonedVoice({
        userId: authUserId,
        providerScope: source.scopeKey,
        voiceId: result.voiceId,
        name: file.name === "minimax-voice-clone.wav" ? "我的录制音色" : file.name.replace(/\.wav$/i, "").slice(0, 120),
      });
    } catch {
      warning = `音色已生成，但保存失败。请保留音色 ID：${result.voiceId}，不要重复生成。`;
    }
    return NextResponse.json({ success: true, voiceId: result.voiceId, warning });
  } catch (error) {
    const status =
      Number((error as { statusCode?: unknown })?.statusCode) || 502;
    return NextResponse.json(
      {
        success: false,
        error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("m1031558b0b9f")),
      },
      { status },
    );
  }
}
