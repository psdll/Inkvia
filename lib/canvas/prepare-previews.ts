import "server-only";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { resolveUploadsRootDirectory } from "@/lib/storage";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { thumbnailCache } from "@/lib/thumbnail-cache";
import { createCanvasVideoThumbnail } from "./video-thumbnail";

/** The same keys and sizes used by /api/thumb, prepared outside canvas entry. */
export async function prepareCanvasPreviews(url: string) {
  if (!url.startsWith("/uploads/") || url.includes("..") || url.includes("\0")) return 0;
  const relative = url.slice("/uploads/".length);
  if (isPrivateUploadPath(relative)) return 0;
  const root = resolveUploadsRootDirectory(), source = path.resolve(root, relative);
  if (!source.startsWith(root + path.sep)) return 0;
  const video = /\.(mp4|mov|webm|mkv)$/i.test(source);
  if (!video && !/\.(png|jpg|jpeg|webp|gif|bmp|tiff|avif)$/i.test(source)) return 0;
  const stat = await fs.stat(source);
  let prepared = 0;
  for (const width of [100, 200, 400]) {
    await thumbnailCache.ensureThumbnail({ sourcePath: source, sourceMtimeMs: stat.mtimeMs, width, cacheDir: path.join(root, "_thumbs"),
      convert: () => video ? createCanvasVideoThumbnail(source, width) : sharp(source, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 88, effort: 4 }).toBuffer(),
    });
    prepared++;
  }
  return prepared;
}
