import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/server-auth";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";

export const runtime = "nodejs";

const FEEDBACK_TYPES = new Set(["bug", "complaint", "idea"]);
const ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const MAX_FILE_COUNT = 10;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function safeText(v: unknown, max: number) {
  const s = String(v ?? "").trim();
  return s.slice(0, max);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: apiMessage("mb4353440a023") }, { status: 401 });
  }

  let body: FormData = new FormData();
  try {
    body = await req.formData();
  } catch {
    return NextResponse.json({ error: apiMessage("m0c43fed40ebe") }, { status: 400 });
  }

  const feedbackType = safeText(body?.get?.("feedbackType"), 24).toLowerCase();
  if (!FEEDBACK_TYPES.has(feedbackType)) {
    return NextResponse.json({ error: apiMessage("mcfe3e7bf4f85") }, { status: 400 });
  }

  const content = safeText(body?.get?.("content"), 1000);
  if (content.length < 5) {
    return NextResponse.json({ error: apiMessage("ma8749b3c97e9") }, { status: 400 });
  }

  const files = body.getAll("attachments").filter((x): x is File => x instanceof File);
  if (files.length > MAX_FILE_COUNT) {
    return NextResponse.json({ error: apiMessage("m0ab3d1a3f235") }, { status: 400 });
  }

  const attachments: string[] = [];
  if (files.length) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dir = resolvePublicPath("uploads", "feedback", `${yyyy}${mm}${dd}`);
    await fs.ensureDir(dir);
    for (const file of files) {
      const mime = String(file.type || "").toLowerCase();
      const isAllowed = ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
      if (!isAllowed) {
        return NextResponse.json({ error: apiMessage("m0c6b29e0448d") }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: apiMessage("m4b8065c9393a") }, { status: 400 });
      }
      const extFromName = path.extname(String(file.name || "")).toLowerCase();
      const extFromMime = mime.startsWith("image/") ? `.${mime.split("/")[1] || "png"}` : `.${mime.split("/")[1] || "mp4"}`;
      const ext = (extFromName || extFromMime).slice(0, 12);
      const filename = `${Date.now()}-${randomUUID()}${ext}`;
      const absPath = path.join(dir, filename);
      const buf = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(absPath, buf);
      attachments.push(`/uploads/feedback/${yyyy}${mm}${dd}/${filename}`);
    }
  }

  await prisma.log.create({
    data: {
      userId: String(user.id),
      category: "user_action",
      action: "feedback_submit",
      level: "info",
      message: `用户反馈[${feedbackType}]`,
      metadata: JSON.stringify({
        feedbackType,
        content,
        username: user.username,
        attachments,
      }),
    },
  });

  return NextResponse.json({ success: true });
}
