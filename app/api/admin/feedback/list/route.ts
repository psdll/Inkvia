import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

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

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ error: apiErrorMessage(auth.error) }, { status: 401 });

  const takeRaw = Number(new URL(req.url).searchParams.get("take") || "300");
  const take = Number.isFinite(takeRaw) ? Math.min(1000, Math.max(1, Math.floor(takeRaw))) : 300;

  const rows = await prisma.log.findMany({
    where: { action: "feedback_submit" },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      userId: true,
      level: true,
      createdAt: true,
      metadata: true,
      message: true,
    },
  });

  const userIds = Array.from(new Set(rows.map((x) => Number(x.userId)).filter((n) => Number.isFinite(n) && n > 0)));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      })
    : [];
  const userNameById = new Map<number, string>();
  for (const u of users) userNameById.set(u.id, u.username);

  const items = rows.map((r) => {
    const meta = parseMeta(r.metadata);
    const uid = Number(r.userId);
    const usernameFromDb = Number.isFinite(uid) ? userNameById.get(uid) : null;
    const usernameFromMeta = String(meta?.username || "").trim();
    return {
      id: r.id,
      createdAt: r.createdAt,
      userId: r.userId,
      username: usernameFromDb || usernameFromMeta || null,
      level: r.level,
      feedbackType: String(meta?.feedbackType || "").trim() || "bug",
      content: String(meta?.content || r.message || "").trim(),
      attachments: Array.isArray(meta?.attachments) ? meta.attachments.map((x: any) => String(x || "").trim()).filter(Boolean) : [],
      adminReply: String(meta?.adminReply || "").trim() || null,
      repliedAt: String(meta?.repliedAt || "").trim() || null,
      repliedBy: String(meta?.repliedBy || "").trim() || null,
      replyStatus: String(meta?.replyStatus || "").trim() || "pending",
    };
  });

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
