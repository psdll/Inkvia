import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { parseSingleByteRange } from "@/lib/http-byte-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

/**
 * 流式回传已生成的导出 ZIP。从磁盘 createReadStream 直出，
 * 服务端与浏览器均不全量缓冲，可稳传大包。
 */
export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const { searchParams } = new URL(req.url);
  const jobId = (searchParams.get("jobId") || "").trim();
  const token = (searchParams.get("token") || "").trim();
  if (!jobId || !token) return bad("参数无效");

  const job = await prisma.userExportJob.findUnique({ where: { id: jobId } });
  if (!job) return bad("任务不存在或已被清理", 404);
  if (job.status !== "done" || !job.filePath || !job.token) {
    return bad("导出尚未完成或已失效", 409);
  }
  const a = Buffer.from(job.token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return bad("下载凭证无效", 403);
  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    return bad("下载链接已过期，请重新导出", 410);
  }
  if (!(await fs.pathExists(job.filePath))) {
    return bad("导出文件已被清理，请重新导出", 410);
  }

  const stat = await fs.stat(job.filePath);
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader ? parseSingleByteRange(rangeHeader, stat.size) : null;
  if (rangeHeader && !range) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  const nodeStream = range
    ? fs.createReadStream(job.filePath, { start: range.start, end: range.end })
    : fs.createReadStream(job.filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  const fileName = job.fileName || `user_export_${jobId}.zip`;
  const contentLength = range ? range.end - range.start + 1 : stat.size;
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Last-Modified": stat.mtime.toUTCString(),
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;

  return new Response(webStream, {
    status: range ? 206 : 200,
    headers,
  });
}
