import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const body = (await req.json().catch(() => ({}))) as { jobId?: string };
  const jobId = String(body.jobId || "").trim();
  if (!jobId) return bad("jobId 无效");

  const job = await (prisma as any).userImportJob.findUnique({ where: { id: jobId } });
  if (!job) return bad("导入任务不存在或已被清理", 404);
  if (job.status === "done") return bad("导入已完成，不能取消", 409);

  if (job.filePath) await fs.remove(job.filePath).catch(() => {});
  await (prisma as any).userImportJob.update({
    where: { id: jobId },
    data: {
      status: "cancelled",
      error: "导入已取消",
      filePath: null,
      finishedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
