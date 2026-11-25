import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import {
  CANVAS_UNDO_HOLD_MAX_REFS,
  releaseCanvasUndoMediaHolds,
  syncCanvasUndoMediaHolds,
} from "@/lib/canvas/undo-media-holds";
import type { CanvasUndoMediaRef } from "@/lib/canvas/undo-media";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteParams = { params: { id: string } };

function parseCanvasId(value: string) {
  const canvasId = Number(value);
  return Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : null;
}

function parseSessionId(value: unknown) {
  const sessionId = String(value || "").trim().toLowerCase();
  return UUID_PATTERN.test(sessionId) ? sessionId : null;
}

function parseRefs(value: unknown): CanvasUndoMediaRef[] | null {
  if (!Array.isArray(value) || value.length > CANVAS_UNDO_HOLD_MAX_REFS) return null;
  return value.flatMap((item): CanvasUndoMediaRef[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const mediaId = String(candidate.mediaId || "").trim().toLowerCase();
    const publicRef = String(candidate.publicRef || "").trim();
    if (!UUID_PATTERN.test(mediaId) && !publicRef) return [];
    const key = UUID_PATTERN.test(mediaId) ? `media:${mediaId}` : `url:${publicRef}`;
    return [{
      key,
      mediaId: UUID_PATTERN.test(mediaId) ? mediaId : undefined,
      publicRef: publicRef || undefined,
    }];
  });
}

async function editableCanvas(canvasId: number, authUserId: number) {
  return prisma.canvas.findFirst({
    where: {
      id: canvasId,
      deletedAt: null,
      OR: [
        { authUserId },
        { members: { some: { userId: authUserId, role: { in: ["OWNER", "EDITOR"] } } } },
      ],
    },
    select: { id: true, authUserId: true },
  });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const canvasId = parseCanvasId(params.id);
  if (!canvasId) return NextResponse.json({ success: false, error: apiMessage("mcea79a32013a") }, { status: 400 });
  const canvas = await editableCanvas(canvasId, authUserId);
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m207df07f17b9") }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    undoSessionId?: unknown;
    refs?: unknown;
    currentRefs?: unknown;
  } | null;
  const undoSessionId = parseSessionId(body?.undoSessionId);
  const refs = parseRefs(body?.refs);
  const currentRefs = parseRefs(body?.currentRefs ?? []);
  if (!undoSessionId || !refs || !currentRefs) {
    return NextResponse.json({ success: false, error: apiMessage("m89fb1248be63") }, { status: 400 });
  }
  try {
    const result = await syncCanvasUndoMediaHolds(prisma, {
      undoSessionId,
      canvasId,
      ownerUserId: canvas.authUserId,
      refs,
      currentRefs,
    });
    return NextResponse.json({ success: true, held: result.held });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: apiErrorMessage(String((error as Error)?.message || "撤回素材保护同步失败")),
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const canvasId = parseCanvasId(params.id);
  if (!canvasId) return NextResponse.json({ success: false, error: apiMessage("mcea79a32013a") }, { status: 400 });
  const canvas = await editableCanvas(canvasId, authUserId);
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m207df07f17b9") }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    undoSessionId?: unknown;
    currentRefs?: unknown;
  } | null;
  const undoSessionId = parseSessionId(body?.undoSessionId);
  const currentRefs = parseRefs(body?.currentRefs ?? []);
  if (!undoSessionId || !currentRefs) {
    return NextResponse.json({ success: false, error: apiMessage("mc6e26002d0f7") }, { status: 400 });
  }
  try {
    const result = await releaseCanvasUndoMediaHolds(prisma, {
      undoSessionId,
      canvasId,
      ownerUserId: canvas.authUserId,
      currentRefs,
    });
    return NextResponse.json({ success: true, released: result.releasedRefs.length });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: apiErrorMessage(String((error as Error)?.message || "撤回素材保护释放失败")),
    }, { status: 500 });
  }
}
