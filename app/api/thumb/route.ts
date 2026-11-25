// 本地缩略图服务。
//
// 用法:  GET /api/thumb?src=/uploads/foo.png&w=300
//
// 工作流:
//   1. 校验 src,只接受 /uploads/* 下的本地路径(不允许 .. 跨目录)。
//   2. 宽度限定白名单 [120, 300, 600, 1200];超出的回退到最近一档。
//   3. 用 sha1(原文件绝对路径 + 修改时间 + 宽度) 作为缓存键,落盘到
//      uploads/_thumbs/<sha>.webp。
//   4. 第一次请求时 sharp 生成 + 写盘,后续直接 sendFile。
//
// 与 next.config.js 配合: /api/thumb/* 已设 immutable + 1 年 max-age。
//
// 为什么不用 Next 内置 <Image>:
//   - 项目 next.config.js 把 images.unoptimized 设为 true(低内存机器关掉了内置优化器)
//   - 我们也想要落盘持久缓存,而不是每次冷启都重生成

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { createCanvasVideoThumbnail } from "@/lib/canvas/video-thumbnail";
import { isPrivateUploadPath } from "@/lib/private-upload-path";
import { legacyLibraryFile } from "@/lib/canvas/legacy-library-path";
import { resolvePublicPath } from "@/lib/public-path";
import {
  THUMBNAIL_CACHE_WIDTHS,
  ThumbnailQueueFullError,
  thumbnailCache,
} from "@/lib/thumbnail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_WIDTHS: readonly number[] = THUMBNAIL_CACHE_WIDTHS;
const DEFAULT_WIDTH = 300;
const SUPPORTED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".avif"]);

// ── 防滥用基线 ───────────────────────────────────────────────────────────────
//
// /api/thumb 公开访问(home 灵感发现需要让游客也能看图),所以不能用 cookie 校验。
// 我们用两层防御:
//   1) 每 IP 每分钟最多 600 次新转换；已生成的缩略图直接读取，不消耗转换额度。
//   2) sharp 并发上限: 同时最多 4 个 sharp 任务在跑,排队等。防一次性 OOM。

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_WINDOW = 600;

type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();
class ThumbnailRateLimitError extends Error {}

function rateLimitResponse() {
  return new NextResponse("rate limited", {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store" },
  });
}

function getClientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const direct = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return direct.toLowerCase();
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    // 定期清理: bucket map 不能无限增长
    if (rateBuckets.size > 2000) {
      const cutoff = now - 2 * RATE_LIMIT_WINDOW_MS;
      for (const [k, v] of rateBuckets) {
        if (v.windowStart < cutoff) rateBuckets.delete(k);
      }
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_WINDOW;
}

// 简易信号量: sharp 并发占用 RAM/CPU,得卡上限。
function snapToAllowedWidth(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WIDTH;
  let best: number = ALLOWED_WIDTHS[0];
  let bestDist = Math.abs(n - best);
  for (const w of ALLOWED_WIDTHS) {
    const d = Math.abs(n - w);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

function getUploadsRoot() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return resolvePublicPath("uploads");
}

function sanitizeUploadPath(raw: string, uploadsRoot: string): string | null {
  let normalized = String(raw || "").trim();
  if (!normalized) return null;
  // 接受 /uploads/xxx 和 uploads/xxx 两种形式
  if (normalized.startsWith("/uploads/")) normalized = normalized.slice("/uploads/".length);
  else if (normalized.startsWith("uploads/")) normalized = normalized.slice("uploads/".length);
  else return null;
  // 拒绝任何路径穿越
  if (normalized.includes("..") || normalized.includes("\0")) return null;
  const archived = legacyLibraryFile(uploadsRoot, normalized);
  if (archived) return archived;
  if (isPrivateUploadPath(normalized)) return null;
  const abs = path.resolve(uploadsRoot, normalized);
  const rootResolved = path.resolve(uploadsRoot);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) return null;
  return abs;
}

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);

  const url = new URL(req.url);
  const src = url.searchParams.get("src") || "";
  const w = snapToAllowedWidth(url.searchParams.get("w"));

  const uploadsRoot = getUploadsRoot();
  const sourceAbs = sanitizeUploadPath(src, uploadsRoot);
  if (!sourceAbs) return new NextResponse("invalid src", { status: 400 });

  const ext = path.extname(sourceAbs).toLowerCase();
  const videoPoster = url.searchParams.get("poster") === "1" && [".mp4", ".mov", ".webm", ".mkv"].includes(ext);
  if (!SUPPORTED_IMAGE_EXTS.has(ext) && !videoPoster) {
    // 视频或其他类型直接 302 到原文件,让浏览器走原路径(它会被 next.config 的 immutable 头缓存)
    const sanitizedSrc = src.startsWith("/") ? src : `/${src}`;
    return NextResponse.redirect(new URL(sanitizedSrc, req.url), 302);
  }

  const st = await fs.stat(sourceAbs).catch(() => null);
  if (!st || !st.isFile()) return new NextResponse("source not found", { status: 404 });

  // Read the source header without resizing or sending the full image to the canvas.
  if (url.searchParams.get("metadata") === "1" && !videoPoster) {
    if (!checkRateLimit(clientKey)) return rateLimitResponse();
    try {
      const metadata = await sharp(sourceAbs, { failOn: "none" }).metadata();
      const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
      const sourceHeight = metadata.pageHeight || metadata.height;
      const width = rotated ? sourceHeight : metadata.width;
      const height = rotated ? metadata.width : sourceHeight;
      if (!width || !height) return new NextResponse("dimensions unavailable", { status: 422 });
      return NextResponse.json({ width, height }, { headers: { "Cache-Control": "public, max-age=3600" } });
    } catch {
      return new NextResponse("dimensions unavailable", { status: 422 });
    }
  }

  // 缓存键:绝对路径 + mtime + 宽度。源文件被替换(mtime 变化)时会自动失效。
  const cacheDir = path.join(uploadsRoot, "_thumbs");
  let result;
  try {
    result = await thumbnailCache.ensureThumbnail({
      sourcePath: sourceAbs,
      sourceMtimeMs: st.mtimeMs,
      width: w,
      cacheDir,
      convert: () => {
        // Cache hits and identical in-flight requests do not run convert.
        // Keep CPU-heavy generation protected without throttling normal browsing.
        if (!checkRateLimit(clientKey)) throw new ThumbnailRateLimitError();
        return videoPoster ? createCanvasVideoThumbnail(sourceAbs, w) : sharp(sourceAbs, { failOn: "none" })
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 })
        .toBuffer();
      },
    });
  } catch (error) {
    if (error instanceof ThumbnailRateLimitError) return rateLimitResponse();
    if (error instanceof ThumbnailQueueFullError) {
      return new NextResponse("thumbnail queue is full", {
        status: 503,
        headers: { "Retry-After": "2", "Cache-Control": "no-store" },
      });
    }
    if (videoPoster) return new NextResponse("video poster unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3" } });
    // Sharp 失败时回退原图；ensureThumbnail 不会留下半文件或坏缓存。
    const fallback = await fs.readFile(sourceAbs).catch(() => null);
    if (!fallback) return new NextResponse("thumbnail failed", { status: 500 });
    return new NextResponse(fallback as any, {
      status: 200,
      headers: {
        "Content-Type": guessMime(ext),
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return new NextResponse(result.buffer as any, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Thumbnail-Cache": result.status,
    },
  });
}

function guessMime(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".tiff":
      return "image/tiff";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}
