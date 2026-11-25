import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { normalizeCanvasTitle } from "@/lib/canvas/title";
import { materializeCanvasTransferRecord } from "@/lib/canvas/transfer-record";
import { syncCanvasCurrentMediaReferences } from "@/lib/canvas/prisma-mutation-store";
import type { CanvasNode } from "@/lib/canvas/document";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const duplicate = await prisma.$transaction(async tx => {
  const original = await tx.canvas.findFirst({
    where: { id, authUserId, deletedAt: null },
  });
  if (!original) return null;
  const source = await materializeCanvasTransferRecord(tx, original);

  const created = await tx.canvas.create({
    data: {
      authUserId,
      title: normalizeCanvasTitle(`${source.title} - 副本`),
      data: source.data as Prisma.InputJsonValue,
      thumbnail: source.thumbnail,
      projectId: source.projectId,
      sortOrder: source.sortOrder + 1,
      settings: source.settings as Prisma.InputJsonValue,
      nodeCount: source.nodeCount,
      edgeCount: source.edgeCount,
    },
    select: { id: true, publicId: true, title: true },
  });
  const nodes = (source.data as { nodes?: CanvasNode[] }).nodes ?? [];
  // Ownership of the source was checked above; preserve references to its shared media.
  await syncCanvasCurrentMediaReferences(tx, created.id, nodes, []);
  return created;
  }, { isolationLevel: "RepeatableRead" });
  if (!duplicate) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  return NextResponse.json({ success: true, canvas: duplicate });
}
