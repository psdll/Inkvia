import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req); if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id); if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const project = await prisma.canvasProject.findFirst({ where: { id, authUserId, deletedAt: null }, select: { id: true } });
  if (!project) return NextResponse.json({ success: false, error: apiMessage("mb2667460b6a9") }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { name?: string; sortOrder?: number } | null;
  const updated = await prisma.canvasProject.update({ where: { id }, data: { ...(body?.name !== undefined ? { name: String(body.name).trim() || "未命名项目" } : {}), ...(Number.isInteger(body?.sortOrder) ? { sortOrder: Number(body?.sortOrder) } : {}) }, select: { id: true, name: true, sortOrder: true } });
  return NextResponse.json({ success: true, project: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req); if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id); if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const project = await prisma.canvasProject.findFirst({ where: { id, authUserId, deletedAt: null }, select: { id: true } });
  if (!project) return NextResponse.json({ success: false, error: apiMessage("mb2667460b6a9") }, { status: 404 });
  await prisma.$transaction([prisma.canvas.updateMany({ where: { authUserId, projectId: id, deletedAt: null }, data: { projectId: null } }), prisma.canvasProject.update({ where: { id }, data: { deletedAt: new Date() } })]);
  return NextResponse.json({ success: true });
}
