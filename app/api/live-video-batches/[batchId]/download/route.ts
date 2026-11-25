import { apiMessage } from "@/i18n/api-message";
import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import fs from "fs-extra";
import { ZipFile } from "yazl";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { selectLatestSuccessfulLiveVideoOutputs } from "@/lib/live-video-batch/download-selection";

export const runtime = "nodejs";

function safePart(value: unknown, fallback: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || fallback;
}

function resolveOutputFile(localPath: string) {
  const normalized = localPath.replaceAll("\\", "/").split("?")[0].split("#")[0];
  if (!normalized.startsWith("/uploads/") || !normalized.toLowerCase().endsWith(".mp4")) {
    return null;
  }
  const root = path.resolve(resolveUploadsRootDirectory());
  const diskPath = path.resolve(root, normalized.slice("/uploads/".length));
  if (diskPath === root || !diskPath.startsWith(`${root}${path.sep}`)) return null;
  return diskPath;
}

export async function GET(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return Response.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }

  const batch = await (prisma as any).liveVideoBatch.findFirst({
    where: { id: params.batchId, authUserId, deletedAt: null },
    select: {
      name: true,
      items: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          name: true,
          outputs: {
            orderBy: { attempt: "desc" },
            select: {
              id: true,
              attempt: true,
              status: true,
              generation: { select: { localPath: true } },
            },
          },
        },
      },
    },
  });
  if (!batch) {
    return Response.json({ success: false, error: apiMessage("m098f63e16909") }, { status: 404 });
  }

  const files: Array<{ diskPath: string; zipName: string; size: number }> = [];
  const items = batch.items as Array<{
    id: string;
    position: number;
    name: string;
    outputs: Array<{
      id: string;
      attempt: number;
      status: string;
      generation: { localPath: string | null } | null;
    }>;
  }>;
  for (const { item, output } of selectLatestSuccessfulLiveVideoOutputs(items)) {
    const diskPath = resolveOutputFile(String(output.generation?.localPath || ""));
    if (!diskPath) continue;
    const stat = await fs.stat(diskPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const order = String(Number(item.position) + 1).padStart(3, "0");
    files.push({
      diskPath,
      size: Number(stat.size || 0),
      zipName: `${order}-${safePart(item.name, `video-${order}`)}.mp4`,
    });
  }
  if (!files.length) {
    return Response.json({ success: false, error: apiMessage("m5d9acbfc9777") }, { status: 404 });
  }

  const zip = new ZipFile();
  for (const file of files) {
    zip.addReadStreamLazy(
      file.zipName,
      { size: file.size, compress: false, forceZip64Format: file.size > 0xffffffff },
      (callback) => callback(null, createReadStream(file.diskPath)),
    );
  }
  zip.end(files.length > 65534 ? { forceZip64Format: true, comment: "" } : undefined);

  const filename = `${safePart(batch.name, "live-video-batch")}-MP4.zip`;
  const body = Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
