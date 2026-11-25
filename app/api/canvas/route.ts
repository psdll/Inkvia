import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { normalizeCanvasTitle } from "@/lib/canvas/title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  const trash = req.nextUrl.searchParams.get("trash") === "1";
  const projectParam = req.nextUrl.searchParams.get("projectId");
  const projectId = projectParam === "none" ? null : projectParam && Number.isInteger(Number(projectParam)) ? Number(projectParam) : undefined;
  const list = await prisma.canvas.findMany({
    where: {
      authUserId,
      deletedAt: trash ? { not: null } : null,
      data: { path: ["mode"], equals: "smart" },
      ...(projectId !== undefined ? { projectId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: { id: true, publicId: true, title: true, thumbnail: true, projectId: true, sortOrder: true, revision64: true, updatedAt: true, createdAt: true },
    take: 200,
  });
  return NextResponse.json({
    success: true,
    items: list.map(({ revision64, ...item }) => ({
      ...item,
      title: normalizeCanvasTitle(item.title),
      revision: revision64.toString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { title?: string; projectId?: number | null; sortOrder?: number } | null;
  let projectId: number | undefined;
  if (Number.isInteger(body?.projectId)) {
    const project = await prisma.canvasProject.findFirst({ where: { id: Number(body?.projectId), authUserId, deletedAt: null }, select: { id: true } });
    if (!project) return NextResponse.json({ success: false, error: apiMessage("m3bd91b795f16") }, { status: 404 });
    projectId = project.id;
  }
  const created = await prisma.canvas.create({
    data: {
      authUserId,
      title: normalizeCanvasTitle(body?.title),
      data: createEmptyCanvasDocumentV2(),
      ...(projectId ? { projectId } : {}),
      ...(Number.isInteger(body?.sortOrder) ? { sortOrder: Number(body?.sortOrder) } : {}),
    },
    select: { id: true, publicId: true, title: true, revision: true, updatedAt: true },
  });
  return NextResponse.json({ success: true, ...created });
}
