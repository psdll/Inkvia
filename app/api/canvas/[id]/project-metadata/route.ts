import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { normalizeCanvasTitle } from "@/lib/canvas/title";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req); if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id); if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const canvas = await prisma.canvas.findFirst({ where: { id, authUserId, deletedAt: null }, select: { id: true } });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { title?: string; thumbnail?: string | null } | null;
  const data = {
    ...(typeof body?.title === "string" ? { title: normalizeCanvasTitle(body.title) } : {}),
    ...(body?.thumbnail !== undefined ? { thumbnail: typeof body.thumbnail === "string" && body.thumbnail.trim() ? body.thumbnail.trim() : null } : {}),
  };
  const updated = await prisma.canvas.update({ where: { id }, data, select: { id: true, title: true, thumbnail: true } });
  return NextResponse.json({ success: true, canvas: updated });
}
