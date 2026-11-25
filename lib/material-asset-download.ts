import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { getMediaUrlExtension, normalizeMediaUrl } from "@/lib/media-url";
import type { MaterialAssetMediaItem } from "@/lib/material-asset-media";
import { resolvePublicPath } from "@/lib/public-path";
import { safeFetch } from "@/lib/ssrf-guard";

function safeFilePart(raw: string, fallback: string) {
  const value = String(raw || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return value || fallback;
}

function extensionFor(media: MaterialAssetMediaItem) {
  const extension = getMediaUrlExtension(media.originalUrl, "");
  return /^[a-z0-9]{1,12}$/i.test(extension) ? extension.toLowerCase() : "bin";
}

function materialFileName(title: string, media: MaterialAssetMediaItem, index: number, total: number) {
  const suffix = total > 1 ? `_${String(index + 1).padStart(2, "0")}` : "";
  return `${safeFilePart(title, "material")}${suffix}.${extensionFor(media)}`;
}

function contentDisposition(fileName: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function localUploadPath(rawUrl: string) {
  const url = normalizeMediaUrl(rawUrl);
  if (!url.startsWith("/uploads/")) return null;
  const pathname = url.split("?")[0]?.split("#")[0] || "";
  const uploadsRoot = path.resolve(resolvePublicPath("uploads"));
  const relative = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  const filePath = path.resolve(uploadsRoot, relative);
  return filePath.startsWith(`${uploadsRoot}${path.sep}`) ? filePath : null;
}

async function openMediaSource(rawUrl: string) {
  const localPath = localUploadPath(rawUrl);
  if (localPath) {
    const stat = await fs.stat(localPath);
    if (!stat.isFile()) throw new Error("素材文件不存在");
    return { stream: createReadStream(localPath), size: stat.size, contentType: "" };
  }

  const url = normalizeMediaUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) throw new Error("素材下载地址无效");
  const response = await safeFetch(url, { method: "GET", headers: { accept: "*/*" }, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error(`素材文件获取失败 (${response.status})`);
  const size = Number(response.headers.get("content-length") || "");
  return {
    stream: Readable.fromWeb(response.body as any),
    size: Number.isFinite(size) && size >= 0 ? size : undefined,
    contentType: String(response.headers.get("content-type") || ""),
  };
}

export async function singleMaterialFileResponse(
  assetTitle: string,
  media: MaterialAssetMediaItem,
): Promise<Response> {
  const source = await openMediaSource(media.originalUrl);
  return new Response(Readable.toWeb(source.stream as Readable) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": source.contentType || media.mime || "application/octet-stream",
      "content-disposition": contentDisposition(materialFileName(assetTitle, media, 0, 1)),
      ...(source.size != null ? { "content-length": String(source.size) } : {}),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function materialSeriesZipResponse(
  assetTitle: string,
  mediaItems: MaterialAssetMediaItem[],
): Response {
  if (mediaItems.length < 2) throw new Error("系列素材至少需要两张图片");

  const zip = new ZipFile();
  mediaItems.forEach((media, index) => {
    zip.addReadStreamLazy(
      materialFileName(assetTitle, media, index, mediaItems.length),
      { compress: false },
      (callback) => {
        void openMediaSource(media.originalUrl)
          .then((source) => callback(null, source.stream))
          .catch((error) => callback(error, null as unknown as NodeJS.ReadableStream));
      },
    );
  });
  zip.end();

  return new Response(Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": contentDisposition(`${safeFilePart(assetTitle, "material_series")}.zip`),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
