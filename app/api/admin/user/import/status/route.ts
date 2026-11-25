import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const { searchParams } = new URL(req.url);
  const jobId = (searchParams.get("jobId") || "").trim();
  if (!jobId) return bad("jobId 无效");

  const job = await (prisma as any).userImportJob.findUnique({ where: { id: jobId } });
  if (!job) return bad("导入任务不存在或已被清理", 404);

  let stats: unknown = null;
  if (job.stats) {
    try {
      stats = JSON.parse(job.stats);
    } catch {
      stats = null;
    }
  }
  const conflicts = stats && typeof stats === "object" && Array.isArray((stats as any).conflicts)
    ? (stats as any).conflicts.map((value: unknown) => String(value))
    : [];

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    fileName: job.fileName,
    fileSize: job.fileSize != null ? Number(job.fileSize) : null,
    error: apiErrorMessage(job.error),
    stats,
    conflicts,
    needsInput: stats && typeof stats === "object" ? (stats as any).needsInput : undefined,
    warnings: stats && typeof stats === "object" && Array.isArray((stats as any).warnings)
      ? (stats as any).warnings : [],
  });
}
