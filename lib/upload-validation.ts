// 上传文件安全校验：MIME 白名单 + 大小上限 + 文件头魔数校验。
//
// 仅靠扩展名 / Content-Type 不可信，攻击者可伪造。这里额外校验文件头字节。
// 注意：SVG 不在白名单内 —— SVG 可内嵌脚本，是存储型 XSS 向量。

export type UploadKind = "image" | "video" | "audio";

const DEFAULT_MAX_BYTES: Record<UploadKind, number> = {
  image: 20 * 1024 * 1024, // 20MB
  video: 200 * 1024 * 1024, // 200MB
  audio: 50 * 1024 * 1024, // 50MB
};

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

const EXTENDED_IMAGE_MIME = new Set([
  ...IMAGE_MIME,
  "image/tiff",
  "image/heic",
  "image/heif",
]);

const VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

const AUDIO_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/x-m4a",
]);

export function classifyUploadMime(mime: string): UploadKind | null {
  const normalized = String(mime || "").toLowerCase().split(";", 1)[0].trim();
  if (EXTENDED_IMAGE_MIME.has(normalized)) return "image";
  if (VIDEO_MIME.has(normalized)) return "video";
  if (AUDIO_MIME.has(normalized)) return "audio";
  return null;
}

export function uploadByteLimit(kind: UploadKind): number {
  return DEFAULT_MAX_BYTES[kind];
}

/**
 * Canvas uploads stream straight to disk, so they accept film-length sources
 * (a 4K short film, a lossless soundtrack) like other canvas tools do.
 */
const CANVAS_MAX_BYTES: Record<UploadKind, number> = {
  image: 50 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
};

export function canvasUploadByteLimit(kind: UploadKind): number {
  return CANVAS_MAX_BYTES[kind];
}

export function canvasUploadTooLargeMessage(kind: UploadKind): string {
  const limit = CANVAS_MAX_BYTES[kind];
  const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
  const size = limit >= 1024 * 1024 * 1024 ? `${limit / 1024 / 1024 / 1024}GB` : `${Math.round(limit / 1024 / 1024)}MB`;
  return `${label}超过 ${size}，请压缩后再上传`;
}

function hasPrefix(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

type SniffedUpload = { kind: UploadKind; mime: string };

/** 按文件头魔数判断真实类型，无法识别返回 null */
function sniffUpload(bytes: Uint8Array, declaredKind: UploadKind): SniffedUpload | null {
  // —— 图片 ——
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" }; // JPEG
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" }; // PNG
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif" }; // GIF
  if (hasPrefix(bytes, [0x42, 0x4d])) return { kind: "image", mime: "image/bmp" }; // BMP
  if (hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: "image", mime: "image/tiff" }; // TIFF
  }
  if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: "image", mime: "image/webp" }; // WEBP (RIFF....WEBP)
  }
  // HEIC / HEIF：ISO BMFF 的 ftyp 主品牌位于偏移 8。
  if (hasPrefix(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) {
      return { kind: "image", mime: "image/heic" };
    }
    if (["heif", "mif1", "msf1"].includes(brand)) {
      return { kind: "image", mime: "image/heif" };
    }
  }
  // —— 视频 ——
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return declaredKind === "audio"
      ? { kind: "audio", mime: "audio/webm" }
      : { kind: "video", mime: "video/webm" }; // WEBM / MKV
  }
  // MP4 / MOV: 偏移 4 处为 'ftyp'
  if (hasPrefix(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    if (declaredKind === "audio") return { kind: "audio", mime: "audio/mp4" };
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    return { kind: "video", mime: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  // —— 音频 ——
  if (hasPrefix(bytes, [0x49, 0x44, 0x33])) return { kind: "audio", mime: "audio/mpeg" }; // MP3 (ID3)
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return { kind: "audio", mime: declaredKind === "audio" ? "audio/mpeg" : "application/octet-stream" };
  }
  if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes, [0x57, 0x41, 0x56, 0x45], 8)) {
    return { kind: "audio", mime: "audio/wav" }; // WAV
  }
  if (hasPrefix(bytes, [0x4f, 0x67, 0x67, 0x53])) return { kind: "audio", mime: "audio/ogg" }; // OGG
  if (hasPrefix(bytes, [0x66, 0x4c, 0x61, 0x43])) return { kind: "audio", mime: "audio/flac" }; // FLAC
  return null;
}

export function validateUploadMagic(bytes: Uint8Array, declaredKind: UploadKind): UploadValidationResult {
  const sniffed = sniffUpload(bytes, declaredKind);
  if (!sniffed) return { ok: false, error: "文件内容无法识别，疑似伪造类型" };
  if (sniffed.kind !== declaredKind) return { ok: false, error: "文件实际内容与声明类型不一致" };
  return { ok: true, kind: sniffed.kind };
}

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
  /** 校验通过时，按魔数嗅探出的真实大类 */
  kind?: UploadKind;
}

export function validateUploadDeclaration(
  input: { size: number; mime: string },
  allowed: UploadKind[] = ["image", "video"],
  maxBytes?: Partial<Record<UploadKind, number>>,
  allowedMimeTypes?: readonly string[],
): UploadValidationResult {
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return { ok: false, error: "请选择有效的文件" };
  const mime = String(input.mime || "").toLowerCase();
  const kind = classifyUploadMime(mime);
  if (!kind || !allowed.includes(kind)) return { ok: false, error: `不支持的文件类型：${mime || "未知"}` };
  const mimeAllowlist = allowedMimeTypes
    ? new Set(allowedMimeTypes.map((value) => value.toLowerCase()))
    : kind === "image"
      ? IMAGE_MIME
      : kind === "video"
        ? VIDEO_MIME
        : AUDIO_MIME;
  if (!mimeAllowlist.has(mime)) return { ok: false, error: `不支持的文件类型：${mime || "未知"}` };
  const limit = maxBytes?.[kind] || DEFAULT_MAX_BYTES[kind];
  if (input.size > limit) return { ok: false, error: `文件过大，上限 ${Math.round(limit / 1024 / 1024)}MB` };
  return { ok: true, kind };
}

/**
 * 校验上传文件。
 * @param file 浏览器 File 对象
 * @param allowed 允许的大类，默认 image + video
 * @param maxBytes 可选的大小上限覆盖（按大类）
 */
export async function validateUploadFile(
  file: File,
  allowed: UploadKind[] = ["image", "video"],
  maxBytes?: Partial<Record<UploadKind, number>>,
  allowedMimeTypes?: readonly string[],
): Promise<UploadValidationResult> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size <= 0) {
    return { ok: false, error: "请选择有效的文件" };
  }

  const mime = String(file.type || "").toLowerCase();
  const allowedSet = new Set(allowed);

  // 1) MIME 白名单
  const declaredKind = classifyUploadMime(mime);
  if (!declaredKind || !allowedSet.has(declaredKind)) {
    return { ok: false, error: `不支持的文件类型：${mime || "未知"}` };
  }
  const mimeAllowlist = allowedMimeTypes
    ? new Set(allowedMimeTypes.map((value) => value.toLowerCase()))
    : declaredKind === "image"
      ? IMAGE_MIME
      : declaredKind === "video"
        ? VIDEO_MIME
        : AUDIO_MIME;
  if (!mimeAllowlist.has(mime)) {
    return { ok: false, error: `不支持的文件类型：${mime || "未知"}` };
  }

  // 2) 大小上限
  const limit = (maxBytes && maxBytes[declaredKind]) || DEFAULT_MAX_BYTES[declaredKind];
  if (file.size > limit) {
    return {
      ok: false,
      error: `文件过大，${declaredKind === "image" ? "图片" : declaredKind === "video" ? "视频" : "音频"}上限 ${Math.round(limit / 1024 / 1024)}MB`,
    };
  }

  // 3) 文件头魔数校验（防伪造 Content-Type）
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffUpload(head, declaredKind);
  if (!sniffed) {
    return { ok: false, error: "文件内容无法识别，疑似伪造类型" };
  }
  if (sniffed.kind !== declaredKind) {
    return { ok: false, error: "文件实际内容与声明类型不一致" };
  }
  if (!allowedSet.has(sniffed.kind) || !mimeAllowlist.has(sniffed.mime)) {
    return { ok: false, error: "不支持该类型文件" };
  }

  return { ok: true, kind: sniffed.kind };
}
