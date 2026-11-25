import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { resolveMiniMaxVoiceCatalogSource } from "@/lib/minimax-speech";
import { getCachedMiniMaxVoices, invalidateMiniMaxVoiceCache } from "@/lib/minimax-voice-cache";
import { getUserId } from "@/lib/server-auth";
import { listCanvasClonedVoices, mergeCanvasClonedVoices, renameCanvasClonedVoice, deleteCanvasClonedVoice } from "@/lib/canvas/cloned-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = await req.json().catch(() => null);
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  if (!voiceId || voiceId.length > 256) {
    return NextResponse.json({ success: false, error: apiMessage("m8023344326c4") }, { status: 400 });
  }
  try {
    const source = await resolveMiniMaxVoiceCatalogSource();
    const deleted = await deleteCanvasClonedVoice({ userId, providerScope: source.scopeKey, voiceId }, async (id) => {
      await source.deleteClonedVoice(id);
      invalidateMiniMaxVoiceCache(source.scopeKey);
    });
    if (!deleted) return NextResponse.json({ success: false, error: apiMessage("m4cfc849ce173") }, { status: 404 });
    return NextResponse.json({ success: true, voiceId });
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("mcf770bc88547")) }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = await req.json().catch(() => null);
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!voiceId || voiceId.length > 256 || !name || name.length > 120) {
    return NextResponse.json({ success: false, error: apiMessage("m51b9a8a2bbce") }, { status: 400 });
  }
  try {
    const source = await resolveMiniMaxVoiceCatalogSource();
    const renamed = await renameCanvasClonedVoice({ userId, providerScope: source.scopeKey, voiceId, name });
    if (!renamed) return NextResponse.json({ success: false, error: apiMessage("m4cfc849ce173") }, { status: 404 });
    return NextResponse.json({ success: true, voiceId, name });
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("m46c09619340e")) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  try {
    const source = await resolveMiniMaxVoiceCatalogSource();
    const saved = await listCanvasClonedVoices({ userId: authUserId, providerScope: source.scopeKey });
    const result = await getCachedMiniMaxVoices(source).catch((error) => {
      if (!saved.length) throw error;
      return { voices: [], stale: true, fetchedAt: Date.now() };
    });
    return NextResponse.json(
      {
        success: true,
        voices: mergeCanvasClonedVoices(result.voices, saved),
        stale: result.stale,
        fetchedAt: new Date(result.fetchedAt).toISOString(),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie, Authorization",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("m97921611c317")) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
