export function normalizeMediaUrl(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  const s = text.replaceAll("\\", "/");
  if (s.startsWith("/uploads/")) return s;
  if (s.startsWith("uploads/")) return `/${s}`;
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  try {
    const u = new URL(s);
    // localhost / 127.0.0.1 的 /uploads/ 路径截取为相对路径
    // 外部域名（OSS、CDN 等）保持完整 URL，直接请求外部地址
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === ''
    if (u.pathname.startsWith("/uploads/") && isLocal) return `${u.pathname}${u.search}${u.hash}`;
    return u.toString();
  } catch {
    return s;
  }
}

// 把任意 width 吸附到本地缩略图服务支持的档位,减少 sharp 缓存碎片。
function snapLocalThumbWidth(rawWidth: number | undefined): number {
  const w = Math.max(80, Math.floor(Number(rawWidth) || 360));
  if (w <= 180) return 120;
  if (w <= 450) return 300;
  if (w <= 900) return 600;
  return 1200;
}

// 本地 /uploads/* 走 /api/thumb 跑 sharp 缩略图(落盘缓存)。
function buildLocalThumbUrl(localPath: string, rawWidth: number | undefined): string {
  const w = snapLocalThumbWidth(rawWidth);
  return `/api/thumb?src=${encodeURIComponent(localPath)}&w=${w}`;
}

export function buildMediaPreviewUrl(raw: unknown, options?: { width?: number; height?: number; mode?: "cover" | "contain" }) {
  const url = normalizeMediaUrl(raw);
  if (!url) return "";
  if (/^(data|blob):/i.test(url)) return url;
  if (isVideoMediaUrl(url)) return url;
  if (url.startsWith("/uploads/")) {
    return buildLocalThumbUrl(url, Number(options?.width) || 360);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const width = Math.max(80, Math.floor(Number(options?.width) || 360));
  const height = Math.max(80, Math.floor(Number(options?.height) || 270));
  const mode = options?.mode === "contain" ? "m_pad" : "m_fill";
  parsed.searchParams.set("x-oss-process", `image/resize,${mode},w_${width},h_${height}/format,webp/quality,q_80`);
  return parsed.toString();
}

export function buildMediaPreviewCandidates(
  raw: unknown,
  options?: { width?: number; height?: number; mode?: "cover" | "contain" }
) {
  const url = normalizeMediaUrl(raw);
  if (!url) return [];
  if (/^(data|blob):/i.test(url)) return [url];
  if (isVideoMediaUrl(url)) return [url];
  if (url.startsWith("/uploads/")) {
    // 本地图片: sharp 缩略图优先,失败回退到原图(由 ResilientImage 负责降级)
    return [buildLocalThumbUrl(url, Number(options?.width) || 360), url];
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }

  const width = Math.max(80, Math.floor(Number(options?.width) || 360));
  const height = Math.max(80, Math.floor(Number(options?.height) || 270));
  const mode = options?.mode === "contain" ? "m_pad" : "m_fill";

  const strong = new URL(parsed.toString());
  strong.searchParams.set("x-oss-process", `image/resize,${mode},w_${width},h_${height}/format,webp/quality,q_80`);

  const basic = new URL(parsed.toString());
  basic.searchParams.set("x-oss-process", `image/resize,${mode},w_${width},h_${height}`);

  const original = new URL(parsed.toString());
  original.searchParams.delete("x-oss-process");

  return Array.from(new Set([strong.toString(), basic.toString(), original.toString()]));
}

export function buildMediaOriginalUrl(raw: unknown) {
  const url = normalizeMediaUrl(raw);
  if (!url) return "";
  if (/^(data|blob):/i.test(url)) return url;
  if (isVideoMediaUrl(url) || url.startsWith("/uploads/")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.searchParams.delete("x-oss-process");
  return parsed.toString();
}

export function buildMediaOriginalCandidates(raw: unknown) {
  const original = buildMediaOriginalUrl(raw);
  if (!original) return [];
  if (isVideoMediaUrl(original)) return [original];
  if (original.startsWith("/uploads/")) {
    return [buildLocalThumbUrl(original, 1200), original];
  }
  const proxy = buildMediaProxyUrl(original);
  return Array.from(new Set([proxy, original].filter(Boolean)));
}

export function buildMediaProxyUrl(raw: unknown) {
  const url = normalizeMediaUrl(raw);
  if (!url) return "";
  if (url.startsWith("/") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}

export function isVideoMediaUrl(raw: unknown): boolean {
  const s = normalizeMediaUrl(raw).toLowerCase();
  if (!s) return false;
  const base = s.split("?")[0]?.split("#")[0] || "";
  return (
    base.endsWith(".mp4") ||
    base.endsWith(".webm") ||
    base.endsWith(".mov") ||
    base.endsWith(".m4v") ||
    base.endsWith(".mkv") ||
    base.endsWith(".avi")
  );
}

export function isAudioMediaUrl(raw: unknown): boolean {
  const s = normalizeMediaUrl(raw).toLowerCase();
  if (!s) return false;
  const base = s.split("?")[0]?.split("#")[0] || "";
  return (
    base.endsWith(".mp3") ||
    base.endsWith(".wav") ||
    base.endsWith(".m4a") ||
    base.endsWith(".aac") ||
    base.endsWith(".ogg") ||
    base.endsWith(".flac")
  );
}

export function inferMediaUrlKind(raw: unknown): "image" | "video" | "audio" | "file" {
  const s = normalizeMediaUrl(raw).toLowerCase();
  if (!s) return "file";
  if (isVideoMediaUrl(s)) return "video";
  if (isAudioMediaUrl(s)) return "audio";
  const base = s.split("?")[0]?.split("#")[0] || "";
  if (
    base.endsWith(".png") ||
    base.endsWith(".jpg") ||
    base.endsWith(".jpeg") ||
    base.endsWith(".webp") ||
    base.endsWith(".gif") ||
    base.endsWith(".avif")
  ) {
    return "image";
  }
  if (s.startsWith("data:image/")) return "image";
  if (s.startsWith("data:video/")) return "video";
  if (s.startsWith("data:audio/")) return "audio";
  return "file";
}

export function getMediaUrlExtension(raw: unknown, fallback = "bin"): string {
  const url = normalizeMediaUrl(raw);
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return fallback;
  const path = url.split("?")[0]?.split("#")[0] || "";
  const name = path.split("/").pop() || "";
  const match = /\.([a-z0-9]{1,12})$/i.exec(name);
  return match?.[1]?.toLowerCase() || fallback;
}
