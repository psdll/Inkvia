import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const items = await prisma.canvasProject.findMany({ where: { authUserId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }], select: { id: true, name: true, sortOrder: true, updatedAt: true, _count: { select: { canvases: { where: { deletedAt: null } } } } } });
  return NextResponse.json({ success: true, items });
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { name?: string; sortOrder?: number } | null;
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ success: false, error: apiMessage("m8e93240d506d") }, { status: 400 });
  const project = await prisma.canvasProject.create({ data: { authUserId, name, sortOrder: Number.isInteger(body?.sortOrder) ? Number(body?.sortOrder) : 0 }, select: { id: true, name: true, sortOrder: true } });
  return NextResponse.json({ success: true, project });
}
