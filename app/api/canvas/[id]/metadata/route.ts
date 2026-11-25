import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";
import { normalizeCanvasTitle } from "@/lib/canvas/title";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req); if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id); if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });
  const canvas = await prisma.canvas.findFirst({ where: { id, authUserId, deletedAt: null }, select: { id: true } });
  if (!canvas) return NextResponse.json({ success: false, error: apiMessage("m7f806c0c420d") }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { projectId?: number | null; sortOrder?: number; title?: string; thumbnail?: string | null } | null;
  if (typeof body?.title === "string" || body?.thumbnail !== undefined) {
    const editorSessionId = req.headers.get("X-Canvas-Session-Id")?.trim() || "";
    if (!editorSessionId || !await canvasEditorSessionMatches(prisma, { authUserId, canvasId: id, sessionId: editorSessionId })) {
      return NextResponse.json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: apiMessage("m41fd87e42e8b") }, { status: 409 });
    }
  }
  let projectId: number | null | undefined;
  if (body?.projectId === null) projectId = null;
  else if (Number.isInteger(body?.projectId)) {
    const project = await prisma.canvasProject.findFirst({ where: { id: Number(body?.projectId), authUserId, deletedAt: null }, select: { id: true } });
    if (!project) return NextResponse.json({ success: false, error: apiMessage("m3bd91b795f16") }, { status: 404 });
    projectId = project.id;
  }
  const data = {
    ...(projectId !== undefined ? { projectId } : {}),
    ...(Number.isInteger(body?.sortOrder) ? { sortOrder: Number(body?.sortOrder) } : {}),
    ...(typeof body?.title === "string" ? { title: normalizeCanvasTitle(body.title) } : {}),
    ...(body?.thumbnail !== undefined ? { thumbnail: typeof body.thumbnail === "string" && body.thumbnail.trim() ? body.thumbnail.trim() : null } : {}),
  };
  const updated = await prisma.canvas.update({ where: { id }, data, select: { id: true, projectId: true, sortOrder: true, title: true, thumbnail: true } });
  return NextResponse.json({ success: true, canvas: updated });
}
