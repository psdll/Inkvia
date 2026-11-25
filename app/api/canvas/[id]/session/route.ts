import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import {
  CANVAS_EDITOR_SESSION_LEASE_MS,
  canvasEditorSessionKey,
  parseCanvasEditorSessionRecord,
} from "@/lib/canvas/editor-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCanvasId(value: string) {
  const canvasId = Number(value);
  return Number.isSafeInteger(canvasId) && canvasId > 0 ? canvasId : null;
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
    select: { id: true },
  });
}

async function requestContext(req: NextRequest, id: string) {
  const authUserId = await getUserId(req);
  if (!authUserId) return { response: NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Please sign in" }, { status: 401 }) } as const;
  const canvasId = parseCanvasId(id);
  if (!canvasId) return { response: NextResponse.json({ success: false, code: "CANVAS_ID_INVALID", error: "Invalid canvas ID" }, { status: 400 }) } as const;
  if (!await editableCanvas(canvasId, authUserId)) {
    return { response: NextResponse.json({ success: false, code: "CANVAS_NOT_FOUND", error: "Canvas not found" }, { status: 404 }) } as const;
  }
  const input = await req.json().catch(() => null) as { sessionId?: unknown } | null;
  const sessionId = typeof input?.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId || sessionId.length > 200) {
    return { response: NextResponse.json({ success: false, code: "CANVAS_SESSION_INVALID", error: "Invalid canvas session" }, { status: 400 }) } as const;
  }
  return { authUserId, canvasId, sessionId } as const;
}

function nextValue(sessionId: string) {
  return JSON.stringify({ sessionId, expiresAt: new Date(Date.now() + CANVAS_EDITOR_SESSION_LEASE_MS).toISOString() });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requestContext(req, params.id);
  if ("response" in context) return context.response;
  const key = canvasEditorSessionKey(context.authUserId, context.canvasId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: nextValue(context.sessionId) },
    update: { value: nextValue(context.sessionId) },
  });
  return NextResponse.json({ success: true, sessionId: context.sessionId });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requestContext(req, params.id);
  if ("response" in context) return context.response;
  const key = canvasEditorSessionKey(context.authUserId, context.canvasId);
  const existing = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  const record = parseCanvasEditorSessionRecord(existing?.value);
  if (!existing || record?.sessionId !== context.sessionId || Date.parse(record.expiresAt) <= Date.now()) {
    return NextResponse.json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: "Canvas editor session expired" }, { status: 409 });
  }
  const renewed = await prisma.appSetting.updateMany({
    where: { key, value: existing.value },
    data: { value: nextValue(context.sessionId) },
  });
  if (renewed.count !== 1) {
    return NextResponse.json({ success: false, code: "CANVAS_SESSION_EXPIRED", error: "Canvas editor session expired" }, { status: 409 });
  }
  return NextResponse.json({ success: true, sessionId: context.sessionId });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requestContext(req, params.id);
  if ("response" in context) return context.response;
  const key = canvasEditorSessionKey(context.authUserId, context.canvasId);
  const existing = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  const record = parseCanvasEditorSessionRecord(existing?.value);
  if (existing && record?.sessionId === context.sessionId) {
    await prisma.appSetting.deleteMany({ where: { key, value: existing.value } });
  }
  return NextResponse.json({ success: true });
}
