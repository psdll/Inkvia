import {
  isOssReady,
  uploadBufferToOssWithObjectKey,
  uploadLocalUploadPathToOssWithObjectKey,
} from "@/lib/oss";
import path from "node:path";
import { isDesktopMode } from "@/lib/desktop-mode";

export class MissingExternalAssetStorageError extends Error {
  constructor() {
    super(isDesktopMode()
      ? "该平台没有可用的自带图床，请在系统设置里配置阿里云 OSS（用于中转参考素材）。"
      : "本地素材无法提供给外部模型 API：请配置可公网访问的 APP_PUBLIC_BASE_URL，或保留 OSS 配置作为临时中转。");
    this.name = "MissingExternalAssetStorageError";
  }
}

function trimSlash(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeUploadPath(raw: unknown) {
  const text = String(raw || "").trim().replaceAll("\\", "/");
  if (!text) return "";
  if (text.startsWith("/uploads/")) return text;
  if (text.startsWith("uploads/")) return `/${text}`;
  return "";
}

function isPrivateHostname(hostname: string) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function getAppPublicBaseUrl() {
  const raw =
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "";
  const s = trimSlash(raw);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (isPrivateHostname(u.hostname)) return "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function buildAppPublicUploadUrl(uploadPath: string) {
  const localPath = normalizeUploadPath(uploadPath);
  const base = getAppPublicBaseUrl();
  if (!localPath || !base) return "";
  return `${base}${localPath}`;
}

function allowOssFallback() {
  const raw = String(process.env.EXTERNAL_ASSET_URL_STRATEGY || "public-first-oss-fallback").trim().toLowerCase();
  return raw !== "public-only" && raw !== "app-public-only" && raw !== "no-oss";
}

export async function resolveAssetUrlForExternalApi(raw: string, fallbackOssFolder: string): Promise<string> {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^data:/i.test(value)) return value;

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/") && isPrivateHostname(parsed.hostname)) {
        return resolveLocalUploadPathForExternalApi(parsed.pathname, fallbackOssFolder);
      }
      return value;
    } catch {
      return value;
    }
  }

  const localPath = normalizeUploadPath(value);
  if (localPath) return resolveLocalUploadPathForExternalApi(localPath, fallbackOssFolder);
  throw new Error(`不支持的素材路径形式: ${value.slice(0, 100)}`);
}

export async function resolveLocalUploadPathForExternalApi(uploadPath: string, fallbackOssFolder: string): Promise<string> {
  const result = await resolveLocalUploadPathForExternalApiWithRelay(uploadPath, fallbackOssFolder);
  return result.url;
}

export async function resolveLocalUploadPathForExternalApiWithRelay(
  uploadPath: string,
  fallbackOssFolder: string,
): Promise<{ url: string; objectKey: string | null }> {
  const localPath = normalizeUploadPath(uploadPath);
  if (!localPath) throw new Error("仅支持 /uploads/ 素材路径");

  const publicUrl = buildAppPublicUploadUrl(localPath);
  if (publicUrl) return { url: publicUrl, objectKey: null };

  if (allowOssFallback() && await isOssReady()) {
    return uploadLocalUploadPathToOssWithObjectKey(localPath, fallbackOssFolder);
  }

  throw new MissingExternalAssetStorageError();
}

export async function resolveLocalUploadPathForExternalApiWithRelayBuffer(
  uploadPath: string,
  fallbackOssFolder: string,
  buffer: Buffer,
  contentType?: string,
): Promise<{ url: string; objectKey: string | null }> {
  const localPath = normalizeUploadPath(uploadPath);
  if (!localPath) throw new Error("仅支持 /uploads/ 素材路径");

  const publicUrl = buildAppPublicUploadUrl(localPath);
  if (publicUrl) return { url: publicUrl, objectKey: null };

  if (allowOssFallback() && await isOssReady()) {
    const ext = path.extname(localPath) || ".bin";
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    return uploadBufferToOssWithObjectKey(
      buffer,
      fallbackOssFolder,
      fileName,
      contentType,
    );
  }

  throw new MissingExternalAssetStorageError();
}
