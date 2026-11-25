import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { isCanvasDocumentV2 } from "@/lib/canvas/document";
import { normalizeCanvasTitle } from "@/lib/canvas/title";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const smartCanvasWhere = (id: number, authUserId: number) => ({
  id,
  authUserId,
  deletedAt: null,
  data: { path: ["mode"], equals: "smart" as const },
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const canvas = await prisma.canvas.findFirst({ where: smartCanvasWhere(id, authUserId) });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  return NextResponse.json({
    success: true,
    canvas: {
      ...canvas,
      title: normalizeCanvasTitle(canvas.title),
      revision64: canvas.revision64.toString(),
      projectionRevision: canvas.projectionRevision.toString(),
      snapshotRevision: canvas.snapshotRevision.toString(),
      currentSnapshotId: canvas.currentSnapshotId?.toString() ?? null,
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { baseRevision?: number; title?: string; data?: unknown; thumbnail?: string | null } | null;
  if (!body) return NextResponse.json({ success: false, error: apiMessage("mcc55840ee422") }, { status: 400 });
  if (body.data !== undefined && !isCanvasDocumentV2(body.data)) {
    return NextResponse.json({ success: false, error: apiMessage("m814f53fbaec1") }, { status: 400 });
  }
  if (!Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 1) {
    return NextResponse.json({ success: false, error: apiMessage("mbf5f7c94e58f") }, { status: 400 });
  }

  const update: Prisma.CanvasUpdateManyMutationInput = { revision: { increment: 1 } };
  if (typeof body.title === "string") update.title = normalizeCanvasTitle(body.title);
  if (body.data !== undefined) update.data = body.data as Prisma.InputJsonValue;
  if (body.thumbnail !== undefined) update.thumbnail = body.thumbnail;
  const result = await prisma.canvas.updateMany({
    where: { id, authUserId, revision: body.baseRevision, deletedAt: null },
    data: update,
  });
  if (result.count === 0) {
    const latest = await prisma.canvas.findFirst({
      where: smartCanvasWhere(id, authUserId),
      select: { id: true, revision: true, data: true, updatedAt: true },
    });
    if (!latest) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
    return NextResponse.json({
      success: false,
      code: "CANVAS_CONFLICT",
      serverRevision: latest.revision,
      serverData: latest.data,
      updatedAt: latest.updatedAt,
    }, { status: 409 });
  }

  const updated = await prisma.canvas.findFirst({
    where: smartCanvasWhere(id, authUserId),
    select: { id: true, title: true, revision: true, updatedAt: true },
  });
  if (!updated) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  return NextResponse.json({ success: true, ...updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const now = new Date();
  const movedToTrash = await prisma.$transaction(async (tx) => {
    const updated = await tx.canvas.updateMany({
      where: smartCanvasWhere(id, authUserId),
      data: { deletedAt: now },
    });
    if (updated.count === 0) return false;
    await tx.canvasRunStep.updateMany({
      where: {
        run: { is: { canvasId: id } },
        status: { notIn: ["success", "failed", "cancelled"] },
      },
      data: { status: "cancelled", leaseOwner: null, leaseUntil: null },
    });
    await tx.canvasRun.updateMany({
      where: {
        canvasId: id,
        status: { in: ["queued", "running", "cancel_requested", "submission_unknown"] },
      },
      data: { status: "cancelled", finishedAt: now },
    });
    return true;
  });
  if (!movedToTrash) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  return NextResponse.json({ success: true });
}
