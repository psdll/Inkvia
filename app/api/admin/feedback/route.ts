import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";import { resolvePublicPath } from "@/lib/public-path";

export const runtime = "nodejs";

function normalizeFeedbackPath(raw: unknown) {
  const s = String(raw || "").trim();
  if (!s.startsWith("/uploads/feedback/")) return "";
  return s.split(/[?#]/)[0] || "";
}

function toDiskPath(uploadPath: string) {
  const rel = uploadPath.replace(/^\/+/, "");
  const abs = path.resolve(resolvePublicPath(rel));
  const root = path.resolve(resolvePublicPath("uploads", "feedback"));
  const relative = path.relative(root, abs);
  if (!relative || relative === ".") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return abs;
}

function parseMeta(text: string | null) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object") return null;
    return v as Record<string, any>;
  } catch {
    return null;
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ error: apiErrorMessage(auth.error) }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("m0c43fed40ebe") }, { status: 400 });
  }

  const id = Math.floor(Number(body?.id));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: apiMessage("m84fe40411195") }, { status: 400 });
  }

  const row = await prisma.log.findUnique({ where: { id } });
  if (!row || row.action !== "feedback_submit") {
    return NextResponse.json({ error: apiMessage("m4174e991ed81") }, { status: 404 });
  }

  const meta = parseMeta(row.metadata);
  const files: string[] = Array.isArray(meta?.attachments) ? meta!.attachments : [];
  let deletedFiles = 0;

  for (const f of files) {
    const p = normalizeFeedbackPath(f);
    if (!p) continue;
    const disk = toDiskPath(p);
    if (!disk) continue;
    const ok = await fs.remove(disk).then(() => true).catch(() => false);
    if (ok) deletedFiles += 1;
  }

  await prisma.log.delete({ where: { id } });
  return NextResponse.json({ success: true, deletedFiles });
}

export async function PATCH(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ error: apiErrorMessage(auth.error) }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("m0c43fed40ebe") }, { status: 400 });
  }

  const id = Math.floor(Number(body?.id));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: apiMessage("m84fe40411195") }, { status: 400 });
  }
  const reply = String(body?.reply || "").trim().slice(0, 1000);
  if (reply.length < 2) {
    return NextResponse.json({ error: apiMessage("m41eb7afbea06") }, { status: 400 });
  }

  const row = await prisma.log.findUnique({ where: { id } });
  if (!row || row.action !== "feedback_submit") {
    return NextResponse.json({ error: apiMessage("m4174e991ed81") }, { status: 404 });
  }

  const meta = parseMeta(row.metadata) || {};
  const now = new Date().toISOString();
  const nextMeta = {
    ...meta,
    adminReply: reply,
    repliedAt: now,
    repliedBy: auth.username,
    replyStatus: "replied",
  };

  const updated = await prisma.log.update({
    where: { id },
    data: {
      metadata: JSON.stringify(nextMeta),
      level: row.level === "error" ? row.level : "success",
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      metadata: true,
      level: true,
    },
  });

  await prisma.log
    .create({
      data: {
        userId: String(updated.userId),
        category: "user_action",
        action: "feedback_reply",
        level: "info",
        message: "管理员已回复你的反馈，可在反馈窗口查看",
        metadata: JSON.stringify({
          feedbackId: id,
          reply,
          repliedBy: auth.username,
          repliedAt: now,
        }),
      },
    })
    .catch(() => null);

  return NextResponse.json({ success: true });
}
