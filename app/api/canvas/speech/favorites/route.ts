import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";

import {
  listCanvasVoiceFavorites,
  setCanvasVoiceFavorite,
} from "@/lib/canvas/voice-favorites";
import { resolveMiniMaxVoiceCatalogSource } from "@/lib/minimax-speech";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

type AuthorizedContext =
  | { response: Response }
  | { userId: number; providerScope: string };

async function authorizedContext(
  req: NextRequest,
): Promise<AuthorizedContext> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      response: NextResponse.json(
        { success: false, error: apiMessage("m48144f96c150") },
        { status: 401, headers: PRIVATE_HEADERS },
      ),
    } as const;
  }
  const source = await resolveMiniMaxVoiceCatalogSource();
  return { userId, providerScope: source.scopeKey } as const;
}

export async function GET(req: NextRequest) {
  try {
    const context = await authorizedContext(req);
    if ("response" in context) return context.response;
    const voiceIds = await listCanvasVoiceFavorites(context);
    return NextResponse.json(
      { success: true, voiceIds },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          apiErrorMessage(error instanceof Error ? error.message : apiMessage("m50a2e893e2a2")),
      },
      { status: 502, headers: PRIVATE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const context = await authorizedContext(req).catch((error) => ({
    response: NextResponse.json(
      {
        success: false,
        error:
          apiErrorMessage(error instanceof Error ? error.message : apiMessage("m567fb23157de")),
      },
      { status: 502, headers: PRIVATE_HEADERS },
    ),
  }));
  if ("response" in context) return context.response;

  const body = await req.json().catch(() => null);
  const voiceId = String(body?.voiceId || "").trim();
  if (!voiceId || voiceId.length > 256 || typeof body?.favorite !== "boolean") {
    return NextResponse.json(
      { success: false, error: apiMessage("md37260ca091a") },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    await setCanvasVoiceFavorite({
      userId: context.userId,
      providerScope: context.providerScope,
      voiceId,
      favorite: body.favorite,
    });
    return NextResponse.json(
      { success: true, voiceId, favorite: body.favorite },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          apiErrorMessage(error instanceof Error ? error.message : apiMessage("m567fb23157de")),
      },
      { status: 502, headers: PRIVATE_HEADERS },
    );
  }
}
