import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { requireAdminRequest } from "@/lib/admin-auth";
import { enqueueUserImportJob } from "@/lib/admin/user-import-runner";
import {
  attachImportUploadJob,
  beginImportUpload,
  finalizeImportUpload,
  IMPORT_UPLOAD_CHUNK_BYTES,
  writeImportUploadChunk,
} from "@/lib/admin/user-import-upload";
import { getMaxImportBytes } from "@/lib/admin/user-transfer-limits";
import { parseImportAccountOptions } from "@/lib/admin/user-migration-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "init") {
      const session = await beginImportUpload({
        fileName: String(body.fileName || ""),
        fileSize: Number(body.fileSize),
        uploadId: body.uploadId == null ? null : String(body.uploadId),
      });
      return NextResponse.json(session);
    }
    if (action === "complete") {
      const accountOptions = parseImportAccountOptions(body);
      const uploadId = String(body.uploadId || "");
      const uploaded = await finalizeImportUpload(uploadId);
      if (uploaded.jobId) return NextResponse.json({ jobId: uploaded.jobId });
      const jobId = await enqueueUserImportJob({
        filePath: uploaded.filePath,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        accountOptions,
      });
      await attachImportUploadJob(uploadId, jobId);
      return NextResponse.json({ jobId, fileSize: uploaded.fileSize, fileName: uploaded.fileName });
    }
    return bad("上传操作无效");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(message || "导入上传失败");
  }
}

export async function PUT(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  if (!req.body) return bad("上传分片为空");
  try {
    const uploadId = String(req.headers.get("x-upload-id") || "");
    const offset = Number(req.headers.get("x-upload-offset"));
    const contentLength = Number(req.headers.get("content-length"));
    const session = await writeImportUploadChunk({
      uploadId,
      offset,
      contentLength,
      body: Readable.fromWeb(req.body as any),
    });
    return NextResponse.json({ receivedBytes: session.receivedBytes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(message || "上传分片失败");
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  return NextResponse.json({
    maxImportBytes: getMaxImportBytes(),
    chunkBytes: IMPORT_UPLOAD_CHUNK_BYTES,
  });
}
