import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import fs from "fs-extra";
import { ZipFile } from "yazl";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { selectLatestSuccessfulBatchOutputs } from "@/lib/image-batch/download-selection";
import {
  batchGroupArchiveName,
  batchGroupOutputName,
  validateBatchGroupDownloadName,
} from "@/lib/image-batch/group-download-name";

export const runtime = "nodejs";

function safePart(value: unknown, fallback: string) {
  const cleaned = String(value || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || fallback;
}

export async function GET(req: Request, { params }: { params: { batchId: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return Response.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  const requestUrl = new URL(req.url);
  const outputId = requestUrl.searchParams.get("outputId")?.trim() || "";
  const groupId = outputId
    ? ""
    : requestUrl.searchParams.get("groupId")?.trim() || "";

  const batch = await (prisma as any).imageBatch.findFirst({
    where: { id: params.batchId, authUserId, deletedAt: null },
    select: {
      name: true,
      groups: {
        where: groupId ? { id: groupId, hiddenAt: null } : { hiddenAt: null },
        orderBy: { position: "asc" },
        take: 1,
        select: { id: true, name: true },
      },
      items: {
        where: groupId ? { groupId } : undefined,
        orderBy: { position: "asc" },
        select: {
          position: true,
          name: true,
          outputs: {
            orderBy: [{ slotIndex: "asc" }, { attempt: "desc" }],
            select: {
              id: true,
              slotIndex: true,
              attempt: true,
              status: true,
              generation: { select: { localPath: true } },
            },
          },
        },
      },
    },
  });
  if (!batch) return Response.json({ success: false, error: apiMessage("mbbe70bf4d365") }, { status: 404 });

  const selectedGroup = (
    batch.groups as Array<{ id: string; name: string }>
  )[0] || null;
  if (groupId && selectedGroup?.id !== groupId) {
    return Response.json({ success: false, error: apiMessage("m21d03e2a9af7") }, { status: 404 });
  }

  const uploadsRoot = path.resolve(resolveUploadsRootDirectory());

  if (outputId) {
    const selected = (batch.items as Array<any>)
      .flatMap((item) => item.outputs.map((output: any) => ({ item, output })))
      .find(({ output }) => output.id === outputId);
    const localPath = String(selected?.output?.generation?.localPath || "").replaceAll("\\", "/");
    if (!selected || selected.output.status !== "success" || !localPath.startsWith("/uploads/")) {
      return Response.json({ success: false, error: "Downloadable output not found" }, { status: 404 });
    }

    const diskPath = path.resolve(uploadsRoot, localPath.slice("/uploads/".length));
    if (diskPath === uploadsRoot || !diskPath.startsWith(`${uploadsRoot}${path.sep}`)) {
      return Response.json({ success: false, error: "Invalid output path" }, { status: 400 });
    }
    const stat = await fs.stat(diskPath).catch(() => null);
    if (!stat?.isFile()) {
      return Response.json({ success: false, error: "Output file not found" }, { status: 404 });
    }

    const extension = path.extname(localPath.split("?")[0] || "") || ".png";
    const order = String(Number(selected.item.position) + 1).padStart(3, "0");
    const filename = `${order}-${safePart(selected.item.name, `task-${order}`)}-${Number(selected.output.slotIndex) + 1}${extension}`;
    const contentType = ({
      ".avif": "image/avif",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    } as Record<string, string>)[extension.toLowerCase()] || "application/octet-stream";
    const body = Readable.toWeb(createReadStream(diskPath) as Readable) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const groupName = String(selectedGroup?.name || batch.name || "");
  const groupNameError = validateBatchGroupDownloadName(groupName);
  if (groupNameError) {
    return Response.json(
      { success: false, error: apiErrorMessage(groupNameError) },
      { status: 400 },
    );
  }

  const files: Array<{ diskPath: string; zipName: string; size: number }> = [];
  for (const { output } of selectLatestSuccessfulBatchOutputs(batch.items as Array<any>)) {
    const localPath = String(output.generation?.localPath || "").replaceAll("\\", "/");
    if (!localPath.startsWith("/uploads/")) continue;
    const diskPath = path.resolve(uploadsRoot, localPath.slice("/uploads/".length));
    if (diskPath === uploadsRoot || !diskPath.startsWith(`${uploadsRoot}${path.sep}`)) continue;
    const stat = await fs.stat(diskPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const extension = path.extname(localPath.split("?")[0] || "") || ".png";
    files.push({
      diskPath,
      size: Number(stat.size || 0),
      zipName: batchGroupOutputName(groupName, files.length + 1, extension),
    });
  }
  if (!files.length) return Response.json({ success: false, error: apiMessage("m2450a6b48bb8") }, { status: 404 });

  const zip = new ZipFile();
  for (const file of files) {
    zip.addReadStreamLazy(
      file.zipName,
      { size: file.size, compress: false, forceZip64Format: file.size > 0xffffffff },
      (callback) => callback(null, createReadStream(file.diskPath)),
    );
  }
  zip.end(files.length > 65534 ? { forceZip64Format: true, comment: "" } : undefined);

  const filename = batchGroupArchiveName(groupName);
  const body = Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
