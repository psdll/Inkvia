import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
// 画布本地上传（拖拽 / 粘贴 / 上传）→ 校验后直接落 UPLOADS_DIR/canvas_imports/{merchant}_{YYYYMMDD}/，返回站内 URL。
//   POST /api/canvas/upload  formData: { file }
//   返回 { success, url, kind, name }
//
// multipart 文件流直接写入正式目录的原子临时文件，避免把大视频整体读入 Web 进程内存。
// 刻意【不】写 media-library —— 画布上传的临时图与素材库零耦合（产物归档走画布产物库）。

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { prisma } from "@/lib/prisma";
import { CanvasMediaUploadError, streamCanvasMediaUpload } from "@/lib/canvas/media-upload-service";
import { canvasMetrics } from "@/lib/canvas/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  try {
    const stored = await streamCanvasMediaUpload(prisma, {
      ownerUserId: authUserId,
      request: req,
    });
    canvasMetrics.increment("canvas_upload_bytes", stored.size);
    return NextResponse.json({ success: true, ...stored });
  } catch (error) {
    canvasMetrics.increment("canvas_upload_failure_total");
    canvasMetrics.increment("canvas_media_rejected_total");
    const uploadError = error instanceof CanvasMediaUploadError ? error : null;
    return NextResponse.json({
      success: false,
      error: apiErrorMessage(uploadError?.message || apiMessage("mb7de9a619a82")),
      code: uploadError?.code || "MEDIA_PROCESSING_FAILED",
      mediaId: uploadError?.assetId,
    }, { status: uploadError?.code === "MEDIA_FILE_TOO_LARGE" ? 413 : 422 });
  }
}
