import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

/**
 * 轮询导出任务状态。前端据此驱动真实进度条，并在 done 后触发下载。
 */
export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const { searchParams } = new URL(req.url);
  const jobId = (searchParams.get("jobId") || "").trim();
  if (!jobId) return bad("jobId 无效");

  const job = await prisma.userExportJob.findUnique({ where: { id: jobId } });
  if (!job) return bad("任务不存在或已被清理", 404);

  let stats: unknown = null;
  if (job.manifest) {
    try {
      stats = (JSON.parse(job.manifest) as { stats?: unknown }).stats ?? null;
    } catch {
      stats = null;
    }
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    fileName: job.fileName,
    fileSize: job.fileSize != null ? Number(job.fileSize) : null,
    error: apiErrorMessage(job.error),
    // 下载地址（仅 done 且有 token 时下发）
    downloadUrl:
      job.status === "done" && job.token
        ? `/api/admin/user/export/download?jobId=${encodeURIComponent(job.id)}&token=${encodeURIComponent(job.token)}`
        : null,
    stats,
  });
}
