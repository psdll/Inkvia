import { apiMessage } from "@/i18n/api-message";
import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import fs from "fs-extra";
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

export async function GET(
  req: Request,
  { params }: { params: { batchId: string; itemId: string } },
) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return Response.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  }

  const batch = await (prisma as any).liveVideoBatch.findFirst({
    where: { id: params.batchId, authUserId, deletedAt: null },
    select: {
      items: {
        where: { id: params.itemId },
        take: 1,
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
  const item = batch?.items?.[0];
  if (!item) {
    return Response.json({ success: false, error: apiMessage("me967007b7c42") }, { status: 404 });
  }

  const selected = selectLatestSuccessfulLiveVideoOutputs([item])[0];
  const localPath = String(selected?.output?.generation?.localPath || "");
  const diskPath = resolveOutputFile(localPath);
  if (!diskPath) {
    return Response.json({ success: false, error: apiMessage("m37665eb6ee71") }, { status: 404 });
  }
  const stat = await fs.stat(diskPath).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json({ success: false, error: apiMessage("m6833d43f6e34") }, { status: 404 });
  }

  const order = String(Number(item.position) + 1).padStart(3, "0");
  const filename = `${order}-${safePart(item.name, `video-${order}`)}.mp4`;
  const body = Readable.toWeb(createReadStream(diskPath) as Readable) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
