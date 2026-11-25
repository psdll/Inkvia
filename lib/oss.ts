import fs from "fs/promises";
import path from "path";
import type OSS from "ali-oss";
import {
  createOssClient,
  resolveEffectiveOssConfig,
  type OssConfig,
} from "@/lib/oss-config";
import { resolvePublicPath } from "@/lib/public-path";

function safeDecodeUriComponent(value: string) {
  const text = String(value || "");
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export async function isOssReady() {
  try {
    const { config } = await resolveEffectiveOssConfig();
    return Boolean(
      config.endpoint &&
        config.bucket &&
        config.accessKeyId &&
        config.accessKeySecret &&
        config.region,
    );
  } catch {
    return false;
  }
}

export function isStorageForceOssEnabled() {
  const raw = String(process.env.STORAGE_FORCE_OSS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export async function assertOssReadyWhenForceEnabled() {
  if (!isStorageForceOssEnabled()) return;
  if (await isOssReady()) return;
  throw new Error(
    "已启用 STORAGE_FORCE_OSS=true，但 OSS 配置不完整。请检查 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION。"
  );
}

async function getClient() {
  const { config } = await resolveEffectiveOssConfig();
  if (
    !config.endpoint ||
    !config.bucket ||
    !config.accessKeyId ||
    !config.accessKeySecret ||
    !config.region
  ) {
    throw new Error("OSS 配置不完整，请检查 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION");
  }
  return { client: createOssClient(config), config };
}

function buildObjectKey(folder: string, filename: string) {
  const dateStr = new Date().toISOString().split("T")[0];
  const safeFolder = String(folder || "uploads").replace(/^\/+|\/+$/g, "");
  return `uploads/${safeFolder}/${dateStr}/${filename}`;
}

function getPublicUrl(
  config: OssConfig,
  objectKey: string,
  fallback: string,
) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${objectKey}`;
  return fallback;
}

const MODEL_RELAY_URL_EXPIRES_SECONDS = 60 * 60;

export async function isOssPublicUrlConfigured() {
  return Boolean((await resolveEffectiveOssConfig()).config.publicBaseUrl);
}

function getOssObjectModelUrl(
  client: OSS,
  config: OssConfig,
  objectKey: string,
) {
  const publicUrl = getPublicUrl(config, objectKey, "");
  if (config.publicBaseUrl && publicUrl) return publicUrl;
  return client.signatureUrl(objectKey, {
    expires: MODEL_RELAY_URL_EXPIRES_SECONDS,
    method: "GET",
  });
}

export async function buildOssObjectPublicUrl(objectKey: string) {
  const key = String(objectKey || "").trim().replace(/^\/+/, "");
  if (!key) return "";
  const { config } = await resolveEffectiveOssConfig();
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${key}`;
  if (!config.bucket || !config.endpoint) return "";
  const host = config.endpoint.startsWith(`${config.bucket}.`)
    ? config.endpoint
    : `${config.bucket}.${config.endpoint}`;
  return `https://${host}/${key}`;
}

export async function resolveOssObjectUrlForExternalApi(objectKey: string) {
  const key = String(objectKey || "").trim().replace(/^\/+/, "");
  if (!key) return "";
  const { client, config } = await getClient();
  return getOssObjectModelUrl(client, config, key);
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".m4a") return "audio/mp4";
  return undefined;
}

export async function uploadFileToOss(file: File, folder: string, fileName: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadBufferToOss(buffer, folder, fileName, file.type || undefined);
}

export async function uploadBufferToOss(
  buffer: Buffer,
  folder: string,
  fileName: string,
  contentType?: string
) {
  const { client, config } = await getClient();
  const objectKey = buildObjectKey(folder, fileName);
  const res = await client.put(objectKey, buffer, {
    headers: contentType ? { "Content-Type": contentType } : undefined
  });
  const fallback = String((res as any)?.url || "");
  return getPublicUrl(config, objectKey, fallback);
}

export async function uploadBufferToOssWithObjectKey(
  buffer: Buffer,
  folder: string,
  fileName: string,
  contentType?: string,
) {
  const { client, config } = await getClient();
  const objectKey = buildObjectKey(folder, fileName);
  await client.put(objectKey, buffer, {
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  return {
    objectKey,
    url: getOssObjectModelUrl(client, config, objectKey),
  };
}

export async function uploadLocalUploadPathToOssWithObjectKey(localPath: string, folder: string) {
  const { client, config } = await getClient();
  const safe = String(localPath || "").replaceAll("\\", "/");
  if (!safe.startsWith("/uploads/")) throw new Error("仅支持上传 /uploads/ 路径到 OSS");
  const ext = path.extname(safe) || ".png";
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const objectKey = buildObjectKey(folder, fileName);
  const full = resolvePublicPath(safe.replace(/^\/+/, ""));
  const buf = await fs.readFile(full);
  const contentType = mimeFromPath(fileName);
  await client.put(objectKey, buf, {
    headers: contentType ? { "Content-Type": contentType } : undefined
  });
  return {
    objectKey,
    url: getOssObjectModelUrl(client, config, objectKey),
  };
}

export async function uploadLocalUploadPathToOss(localPath: string, folder: string) {
  const result = await uploadLocalUploadPathToOssWithObjectKey(localPath, folder);
  return result.url;
}

export async function copyOssObjectToFolder(sourceObjectKey: string, folder: string) {
  const src = String(sourceObjectKey || "").trim().replace(/^\/+/, "");
  if (!src) throw new Error("源 OSS 对象为空");
  const ext = path.extname(src) || ".bin";
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const targetObjectKey = buildObjectKey(folder, fileName);
  const { client, config } = await getClient();
  const res: any = await client.copy(targetObjectKey, src);
  const fallback = String(res?.url || "");
  return getPublicUrl(config, targetObjectKey, fallback);
}

export function extractOssObjectKeyFromUrl(raw: unknown) {
  const input = String(raw || "").trim();
  if (!input) return "";

  const normalizeKey = (value: string) => {
    const next = safeDecodeUriComponent(String(value || "").trim())
      .replaceAll("\\", "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+/, "");
    if (!next) return "";

    const uploadsIndex = next.indexOf("uploads/");
    return uploadsIndex >= 0 ? next.slice(uploadsIndex) : "";
  };

  if (input.startsWith("/uploads/")) {
    return normalizeKey(input);
  }

  try {
    const parsed = new URL(input);
    return normalizeKey(parsed.pathname || "");
  } catch {
    return normalizeKey(input);
  }
}

export async function deleteOssObjects(objectKeys: string[]) {
  const uniqueKeys = Array.from(new Set(objectKeys.map((key) => String(key || "").trim()).filter(Boolean)));
  if (!uniqueKeys.length) {
    return { count: 0 };
  }

  const { client } = await getClient();
  const deletedKeys: string[] = [];
  const failed: string[] = [];

  // OSS 单次批量删除最多支持 1000 个 key。正常路径每批只有 1 次网络往返；
  // 只在整批失败时回退到单 key 删除，用于定位具体失败对象并继续清理其余 key。
  for (let start = 0; start < uniqueKeys.length; start += 1000) {
    const batch = uniqueKeys.slice(start, start + 1000);
    try {
      await client.deleteMulti(batch, { quiet: true });
      deletedKeys.push(...batch);
      continue;
    } catch {
      for (const key of batch) {
        try {
          await client.delete(key);
          deletedKeys.push(key);
        } catch (error: any) {
          const code = String(error?.code || error?.name || "");
          const status = Number(error?.status || error?.statusCode || 0);
          if (code === "NoSuchKey" || status === 404) {
            deletedKeys.push(key);
            continue;
          }
          failed.push(`${key}: ${error?.message || "删除失败"}`);
        }
      }
    }
  }

  if (failed.length) {
    const error = new Error(`删除 OSS 文件失败：${failed[0]}`) as Error & {
      deletedKeys?: string[];
      failedKeys?: string[];
    };
    error.deletedKeys = deletedKeys;
    error.failedKeys = failed;
    throw error;
  }

  return { count: deletedKeys.length };
}

export async function deleteOssObjectsByUrls(urls: Array<unknown>) {
  const objectKeys = Array.from(
    new Set(
      urls
        .map((url) => extractOssObjectKeyFromUrl(url))
        .filter(Boolean)
    )
  );
  await deleteOssObjects(objectKeys);
  return {
    count: objectKeys.length,
    objectKeys,
  };
}

export async function getOssObjectSizeByKey(objectKey: string) {
  const key = String(objectKey || "").trim();
  if (!key) return null;
  const { client } = await getClient();
  try {
    const res: any = await client.head(key);
    const headers = res?.res?.headers || res?.headers || {};
    const raw = headers["content-length"] || headers["Content-Length"];
    const size = Number(raw);
    if (Number.isFinite(size) && size >= 0) return size;
    return null;
  } catch (error: any) {
    const code = String(error?.code || error?.name || "");
    const status = Number(error?.status || error?.statusCode || 0);
    if (code === "NoSuchKey" || status === 404) return null;
    throw error;
  }
}

export async function getOssObjectSizeByUrl(raw: unknown) {
  const key = extractOssObjectKeyFromUrl(raw);
  if (!key) return null;
  return getOssObjectSizeByKey(key);
}

export async function getOssPrefixStats(prefixRaw: string) {
  const prefix = String(prefixRaw || "").trim().replace(/^\/+/, "");
  if (!prefix) {
    return { bytes: 0, files: 0 };
  }

  const { client } = await getClient();
  let marker = "";
  let bytes = 0;
  let files = 0;

  while (true) {
    const res: any = await client.list({
      prefix,
      marker: marker || undefined,
      "max-keys": 1000,
    }, {});
    const objects = Array.isArray(res?.objects) ? res.objects : [];
    for (const object of objects) {
      const name = String(object?.name || "").trim();
      if (!name || name.endsWith("/")) continue;
      const size = Number(object?.size || 0);
      files += 1;
      if (Number.isFinite(size) && size >= 0) bytes += size;
    }
    if (!res?.isTruncated || !res?.nextMarker) break;
    marker = String(res.nextMarker || "");
    if (!marker) break;
  }

  return { bytes, files };
}

export async function getOssObjectBufferByKey(objectKey: string) {
  const key = String(objectKey || "").trim();
  if (!key) return null;
  const { client } = await getClient();
  try {
    const res: any = await client.get(key);
    const content = res?.content;
    if (!content) return null;
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof Uint8Array) return Buffer.from(content);
    return Buffer.from(content);
  } catch (error: any) {
    const code = String(error?.code || error?.name || "");
    const status = Number(error?.status || error?.statusCode || 0);
    if (code === "NoSuchKey" || status === 404) return null;
    throw error;
  }
}

export async function getOssObjectBufferByUrl(raw: unknown) {
  const key = extractOssObjectKeyFromUrl(raw);
  if (!key) return null;
  return getOssObjectBufferByKey(key);
}
