import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import { CanvasRunQueueError, createQueuedCanvasRun } from "@/lib/canvas/run-queue";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseRevision(value: unknown) {
  const revision = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(revision)) return null;
  try {
    return BigInt(revision).toString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const canvasId = parseId(params.id);
  if (!canvasId) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, deletedAt: null, OR: [{ authUserId }, { members: { some: { userId: authUserId, role: { in: ["OWNER", "EDITOR", "VIEWER"] } } } }] },
    select: { id: true },
  });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  const items = await prisma.$queryRaw<Array<{
    id: number; status: string; graphRevision64: bigint; state: unknown;
    startedAt: Date; updatedAt: Date; finishedAt: Date | null;
  }>>(Prisma.sql`
    SELECT "id", "status", "graphRevision64", "state", "startedAt", "updatedAt", "finishedAt"
    FROM "CanvasRun" WHERE "canvasId" = ${canvasId} AND "authUserId" = ${authUserId}
    ORDER BY "startedAt" DESC LIMIT 30
  `);
  return NextResponse.json({
    success: true,
    items: items.map((item) => ({ ...item, graphRevision64: item.graphRevision64.toString() })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const canvasId = parseId(params.id);
  if (!canvasId) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const canvas = await prisma.canvas.findFirst({
    where: { id: canvasId, deletedAt: null, OR: [{ authUserId }, { members: { some: { userId: authUserId, role: { in: ["OWNER", "EDITOR"] } } } }] },
    select: { id: true },
  });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim();
  if (!editorSessionId || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId, sessionId: editorSessionId })) {
    return NextResponse.json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") }, { status: 409 });
  }
  const body = (await req.json().catch(() => null)) as { scope?: string; nodeIds?: unknown; expectedRevision?: unknown; clientRequestId?: string } | null;
  const expectedRevision = parseRevision(body?.expectedRevision);
  if (!expectedRevision) {
    return NextResponse.json({ success: false, code: "CANVAS_REVISION_INVALID", error: apiMessage("md0141d8b0015") }, { status: 400 });
  }
  const scope = ["single", "downstream", "full"].includes(String(body?.scope)) ? String(body?.scope) : "full";
  const nodeIds = Array.isArray(body?.nodeIds) ? body.nodeIds.map(String).filter(Boolean).slice(0, 1000) : [];
  try {
    const run = await createQueuedCanvasRun(prisma, {
      authUserId,
      canvasId,
      scope: scope as "single" | "downstream" | "full",
      nodeIds,
      expectedRevision,
      clientRequestId: body?.clientRequestId,
    });
    return NextResponse.json({ success: true, executionMode: "server", run });
  } catch (error) {
    if (error instanceof CanvasRunQueueError) {
      return NextResponse.json({ success: false, code: error.code, error: apiErrorMessage(error.message) }, { status: error.status });
    }
    return NextResponse.json({ success: false, code: "RUN_CREATE_FAILED", error: apiMessage("m4c01864476cc") }, { status: 500 });
  }
}
