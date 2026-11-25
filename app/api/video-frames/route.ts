import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import sharp, { type OutputInfo } from "sharp";
import { unlink } from "node:fs/promises";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { saveBufferFile } from "@/lib/storage";
import { resolvePublicPath } from "@/lib/public-path";
import { createGenerationDisplayAssetPatch, getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { isVideoFrameMode, VIDEO_FRAME_LABELS } from "@/lib/video-frame";

export const runtime = "nodejs";
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

function result(record: { templateData: string | null; [key: string]: unknown }) {
  return NextResponse.json({ success: true, item: {
    ...record,
    ...getGenerationDisplayFields(record),
    params: record.templateData ? JSON.parse(record.templateData) : null,
  } });
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1986431234d") }, { status: 401 });
  if (Number(req.headers.get("content-length")) > MAX_FRAME_BYTES + 64 * 1024) {
    return NextResponse.json({ error: apiMessage("m3ffa9127591e") }, { status: 413 });
  }
  const generatedPaths: string[] = [];
  try {
    const form = await req.formData();
    const generationId = Number(form.get("generationId"));
    const mode = String(form.get("mode") || "");
    const time = Number(form.get("time"));
    const requestKey = String(form.get("requestKey") || "");
    const file = form.get("file");
    if (!Number.isSafeInteger(generationId) || generationId <= 0 || !isVideoFrameMode(mode)
      || !form.has("time") || !Number.isFinite(time) || time < 0
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)
      || !file || typeof file === "string" || file.type !== "image/png" || !file.size || file.size > MAX_FRAME_BYTES) {
      return NextResponse.json({ error: apiMessage("m926db5fb505c") }, { status: 400 });
    }
    const source = await prisma.generation.findFirst({ where: {
      id: generationId, authUserId, source: "tool", status: "success",
      type: { in: ["video_gen", "video_generate"] }, localPath: { not: null },
    }, select: { id: true } });
    if (!source) return NextResponse.json({ error: apiMessage("ma9d58ddd4bf0") }, { status: 404 });
    const existing = await prisma.generation.findUnique({ where: { requestKey } });
    if (existing) {
      if (existing.authUserId !== authUserId || existing.model !== "video-frame") {
        return NextResponse.json({ error: apiMessage("mea327cfe63c0") }, { status: 409 });
      }
      return result(existing);
    }
    const input = Buffer.from(await file.arrayBuffer());
    let image: { data: Buffer; info: OutputInfo };
    try {
      // Decode and re-encode, rather than trusting the uploaded MIME type or file name.
      image = await sharp(input, { limitInputPixels: 4096 * 4096, animated: false }).png().toBuffer({ resolveWithObject: true });
    } catch {
      return NextResponse.json({ error: apiMessage("m8895693c4cbd") }, { status: 400 });
    }
    const localPath = await saveBufferFile(image.data, "image_results", { contentType: "image/png" });
    generatedPaths.push(localPath);
    const display = await createGenerationDisplayAssetPatch({ type: "image_edit", localPath });
    for (const value of Object.values(display)) {
      if (typeof value === "string" && value.startsWith("/uploads/") && value !== localPath) generatedPaths.push(value);
    }
    const templateData = JSON.stringify({
      ...display, phase: "ready", sourceGenerationId: source.id,
      videoFrame: { mode, time, width: image.info.width, height: image.info.height },
    });
    const record = await prisma.generation.upsert({
      where: { requestKey }, update: {},
      create: {
        authUserId, userId: String(authUserId), source: "tool", type: "image_edit",
        status: "success", model: "video-frame", prompt: `视频${VIDEO_FRAME_LABELS[mode]} · ${time.toFixed(3)}s`,
        localPath, templateData, requestKey, finishedAt: new Date(), sizeBytes: image.data.length,
      },
    });
    if (record.localPath === localPath) generatedPaths.length = 0;
    if (record.authUserId !== authUserId || record.model !== "video-frame") {
      return NextResponse.json({ error: apiMessage("mea327cfe63c0") }, { status: 409 });
    }
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
    return result(record);
  } catch (error) {
    console.error("[video-frames] save failed", error);
    return NextResponse.json({ error: apiMessage("m0cb4a2de821f") }, { status: 500 });
  } finally {
    await Promise.allSettled([...new Set(generatedPaths)].map((url) => unlink(resolvePublicPath(url.replace(/^\/+/, "")))));
  }
}
