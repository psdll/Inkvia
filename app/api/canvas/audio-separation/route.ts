import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { extractCanvasAudioStem } from "@/lib/canvas/audio-separation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const stem = request.nextUrl.searchParams.get("stem");
  if (stem !== "vocals" && stem !== "background") return NextResponse.json({ success: false, error: apiMessage("mbaca077f1e96") }, { status: 400 });
  try {
    const audio = await extractCanvasAudioStem(request, userId, stem);
    return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("m010c47265bd0")) }, { status: 422 });
  }
}
