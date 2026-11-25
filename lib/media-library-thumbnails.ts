import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import sharp from "sharp";
import { promisify } from "util";
import { resolvePublicPath } from "@/lib/public-path";
import { safeFetch } from "@/lib/ssrf-guard";
import { saveBufferFile } from "@/lib/storage";
import { PRODUCT_LIBRARY_PREVIEWS_FOLDER } from "@/lib/upload-buckets";

const execFileAsync = promisify(execFile);

type ThumbnailOptions = {
  contentType?: string;
  folder: string;
  kind: string;
  sourceName?: string;
};

type PreviewOptions = ThumbnailOptions;

function isImageMaterial(kind: string, contentType?: string) {
  if (kind === "image") return true;
  return String(contentType || "").toLowerCase().startsWith("image/");
}

function isVideoMaterial(kind: string, contentType?: string) {
  if (kind === "video") return true;
  return String(contentType || "").toLowerCase().startsWith("video/");
}

function videoExtFromContentType(contentType?: string) {
  const mime = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  if (mime === "video/x-matroska") return "mkv";
  return "mp4";
}

function buildContentHash(input: Buffer) {
  return crypto
    .createHash("sha1")
    .update(input.subarray(0, Math.min(input.length, 1024 * 1024)))
    .update(String(input.length))
    .digest("hex")
    .slice(0, 24);
}

// Material masonry cards preserve aspect ratio and persist dimensions at upload.
export async function createMaterialCardThumbnail(input: Buffer, options: ThumbnailOptions) {
  if (!input.length || !isImageMaterial(options.kind, options.contentType)) return null;
  try {
    const { data, info } = await sharp(input, { animated: false }).rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
    const url = await saveBufferFile(data, options.folder, {
      fileName: `${buildContentHash(input)}-card-1200.webp`, contentType: "image/webp", fallbackExt: "webp",
    });
    return { url, width: info.width, height: info.height };
  } catch { return null; }
}

export async function createMediaLibraryImageThumbnail(
  input: Buffer,
  options: ThumbnailOptions
) {
  if (!input.length || !isImageMaterial(options.kind, options.contentType)) return null;

  try {
    const hash = buildContentHash(input);
    const thumbnail = await sharp(input, { animated: false })
      .rotate()
      .resize({
        width: 360,
        height: 270,
        fit: "contain",
        withoutEnlargement: true,
        background: { r: 246, g: 247, b: 251, alpha: 1 },
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    return saveBufferFile(thumbnail, options.folder, {
      fileName: `${hash}.webp`,
      contentType: "image/webp",
      fallbackExt: "webp",
    });
  } catch {
    return null;
  }
}

/**
 * 中等预览图（Phase 1 新增）。
 * - 1024 长边、webp q=80，目标 ~200KB
 * - 与缩略图同一份 sha1 内容寻址，文件天然 immutable
 * - 与 nginx-cache.conf.example 里的 /uploads/material_library/previews/ 路径对应（7 天强缓存）
 * - 当前阶段先生成、不强制接入消费侧；Phase 2 时再让中等尺寸的展示面（详情预览、Lightbox）走它
 */
export async function createMediaLibraryImagePreview(
  input: Buffer,
  options: PreviewOptions
) {
  if (!input.length || !isImageMaterial(options.kind, options.contentType)) return null;

  try {
    const hash = buildContentHash(input);
    const preview = await sharp(input, { animated: false })
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();

    return saveBufferFile(preview, options.folder, {
      fileName: `${hash}.webp`,
      contentType: "image/webp",
      fallbackExt: "webp",
    });
  } catch {
    return null;
  }
}

// 网格缩略图：600px 长边、webp q78。专给"图墙小卡片"用，文件名带 -grid 后缀避免与 1280 预览同名覆盖。
// 生成结果在收尾(finalizeGeneration)时顺手生成它，资产网格优先用它 → 首次打开就是小图、秒开。
export async function createMediaLibraryGridThumbnail(
  input: Buffer,
  options: ThumbnailOptions
) {
  if (!input.length || !isImageMaterial(options.kind, options.contentType)) return null;
  try {
    const hash = buildContentHash(input);
    const thumb = await sharp(input, { animated: false })
      .rotate()
      .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    return saveBufferFile(thumb, options.folder, {
      fileName: `${hash}-grid.webp`,
      contentType: "image/webp",
      fallbackExt: "webp",
    });
  } catch {
    return null;
  }
}

export async function createMediaLibraryVideoPoster(
  input: Buffer,
  options: ThumbnailOptions
) {
  if (!input.length || !isVideoMaterial(options.kind, options.contentType)) return null;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-poster-"));
  const inputPath = path.join(tempDir, `source.${videoExtFromContentType(options.contentType)}`);
  const framePath = path.join(tempDir, "frame.jpg");

  try {
    await fs.writeFile(inputPath, input);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "0.25",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        "-update",
        "1",
        framePath,
      ],
      { timeout: 15000, windowsHide: true }
    );
    const frame = await fs.readFile(framePath);
    const poster = await sharp(frame, { failOn: "none" })
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
    const hash = buildContentHash(input);
    return saveBufferFile(poster, options.folder, {
      fileName: `${hash}.webp`,
      contentType: "image/webp",
      fallbackExt: "webp",
    });
  } catch {
    return null;
  } finally {
    await fs.remove(tempDir).catch(() => undefined);
  }
}

function isLocalThumbnail(url: string | null | undefined) {
  const value = String(url || "");
  return value.startsWith("/uploads/products/previews/") ||
    value.startsWith("/uploads/products/thumbs/") ||
    value.startsWith("/uploads/materials/thumbs/");
}

async function readMediaBuffer(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.startsWith("/uploads/")) {
    const localPath = resolvePublicPath(value.replace(/^\/+/, ""));
    if (!(await fs.pathExists(localPath))) return null;
    return fs.readFile(localPath);
  }

  if (!/^https?:\/\//i.test(value)) return null;
  const res = await safeFetch(value, {
    method: "GET",
    headers: {
      accept: "image/*,*/*;q=0.8",
      "user-agent": "Mozilla/5.0",
    },
    cache: "force-cache",
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function ensureMediaLibraryImageThumbnail(item: {
  id: number;
  kind: string;
  mimeType?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
}) {
  if (!isImageMaterial(item.kind, item.mimeType || undefined)) return null;
  if (isLocalThumbnail(item.thumbnailUrl)) return item.thumbnailUrl || null;

  const source = String(item.thumbnailUrl || item.fileUrl || "").trim();
  if (!source) return null;

  try {
    const buffer = await readMediaBuffer(source);
    if (!buffer?.length) return null;
    return createMediaLibraryImagePreview(buffer, {
      contentType: item.mimeType || undefined,
      folder: PRODUCT_LIBRARY_PREVIEWS_FOLDER,
      kind: item.kind,
      sourceName: `media-${item.id}.webp`,
    });
  } catch {
    return null;
  }
}
