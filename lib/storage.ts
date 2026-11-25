import { assertWritablePath } from "@/lib/runtime-isolation";
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolvePublicPath } from "@/lib/public-path";
import { directAxios, providerAxios } from "@/lib/providers/transport";

export type RemoteFileDownloadOptions = {
  /** Server-selected provider id for model result/CDN downloads. Omit for direct user/import URLs. */
  providerId?: string;
  /** Deterministic file name used by regenerable caches. */
  stableKey?: string;
  /** Stable caches can opt out of the normal date partition. */
  dateSubdirectory?: boolean;
  /** Extension to use when the provider URL has no useful suffix. */
  fallbackExt?: string;
};

function normalizeStableKey(value: unknown) {
  const stableKey = String(value || "").trim().toLowerCase();
  if (stableKey && !/^[a-z0-9_-]{16,128}$/.test(stableKey)) {
    throw new Error("invalid stable local media key");
  }
  return stableKey;
}

function normalizeFallbackExtension(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

function getExtensionFromFilename(filename: string) {
  const ext = path.extname(filename || "").replace(".", "").toLowerCase();
  if (!ext) return "";
  if (ext.length > 8) return "";
  return ext;
}

function getExtensionFromMime(mime: string) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (!m) return "";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "image/avif") return "avif";
  if (m === "image/bmp") return "bmp";
  if (m === "image/tiff") return "tiff";
  if (m === "video/mp4") return "mp4";
  if (m === "video/webm") return "webm";
  if (m === "video/quicktime") return "mov";
  if (m === "video/x-matroska") return "mkv";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m === "audio/aac") return "aac";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/flac") return "flac";
  if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
  return "";
}

export function resolveUploadsRootDirectory() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return resolvePublicPath("uploads");
}

export function resolveLocalUploadDirectory(folder: string) {
  const root = resolveUploadsRootDirectory();
  const target = path.resolve(root, String(folder || ""));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("invalid local upload directory");
  }
  return target;
}

function resolveUploadDir(folder: string, dateStr: string) {
  return path.join(resolveUploadsRootDirectory(), folder, dateStr);
}

async function saveBufferToUploads(
  buffer: Buffer,
  folder: string,
  fileName: string
) {
  const dateStr = new Date().toISOString().split('T')[0];
  const uploadDir = resolveUploadDir(folder, dateStr);
  assertWritablePath(uploadDir);
  await fs.ensureDir(uploadDir);
  const filePath = path.join(uploadDir, fileName);
  assertWritablePath(filePath);
  await fs.writeFile(filePath, buffer);
  return `/uploads/${folder}/${dateStr}/${fileName}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerResultDownloadError(error: any) {
  const status = Number(error?.response?.status || 0);
  const rawCode = typeof error?.code === "string" ? error.code.trim().toUpperCase() : "";
  const code = /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "";
  const detail = status || code;
  return new Error(`远程结果已返回，但下载保存失败${detail ? `（${detail}）` : ""}`);
}

async function downloadRemoteStream(url: string, providerId?: string) {
  const config = {
    url,
    method: 'GET' as const,
    responseType: 'stream' as const,
    timeout: 30000,
    headers: {
      Accept: '*/*',
      'User-Agent': 'Mozilla/5.0'
    }
  };
  if (providerId) {
    return providerAxios<Readable>(providerId, config, { purpose: "media" });
  }
  return directAxios<Readable>({ ...config, maxRedirects: 3 }, { purpose: "media" });
}

export async function saveUploadedFile(file: File, folder: string): Promise<string> {
  const originalExt = getExtensionFromFilename(file.name);
  const mimeExt = getExtensionFromMime(file.type || "");
  const extension = originalExt || mimeExt || (file.type?.includes("video") ? "mp4" : "png");
  const fileName = `${uuidv4()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  return saveBufferToUploads(buffer, folder, fileName);
}

export async function saveBufferFile(
  buffer: Buffer,
  folder: string,
  options?: { fileName?: string; contentType?: string; fallbackExt?: string }
): Promise<string> {
  const rawFileName = String(options?.fileName || "").trim();
  const extFromName = getExtensionFromFilename(rawFileName);
  const extFromMime = getExtensionFromMime(String(options?.contentType || ""));
  const extension = extFromName || extFromMime || String(options?.fallbackExt || "bin").replace(/^\./, "") || "bin";
  const baseName = rawFileName
    ? path.basename(rawFileName).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 90)
    : "";
  const fileName = baseName && getExtensionFromFilename(baseName)
    ? `${uuidv4()}-${baseName}`
    : `${uuidv4()}.${extension}`;
  return saveBufferToUploads(buffer, folder, fileName);
}

export async function saveLocalFile(
  sourcePath: string,
  folder: string,
  options?: {
    fileName?: string;
    contentType?: string;
    fallbackExt?: string;
    stableKey?: string;
    dateSubdirectory?: boolean;
    consumeSource?: boolean;
    publicReadable?: boolean;
  }
): Promise<string> {
  const source = path.resolve(sourcePath);
  const stats = await fs.stat(source);
  if (!stats.isFile()) throw new Error("本地媒体源不是普通文件");
  const rawFileName = String(options?.fileName || "").trim();
  const extFromName = getExtensionFromFilename(rawFileName);
  const extFromMime = getExtensionFromMime(String(options?.contentType || ""));
  const extension = extFromName || extFromMime || String(options?.fallbackExt || "bin").replace(/^\./, "") || "bin";
  const baseName = rawFileName
    ? path.basename(rawFileName).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 90)
    : "";
  const stableKey = normalizeStableKey(options?.stableKey);
  const fileName = stableKey
    ? `${stableKey}.${extension}`
    : baseName && getExtensionFromFilename(baseName)
      ? `${uuidv4()}-${baseName}`
      : `${uuidv4()}.${extension}`;
  const dateStr = new Date().toISOString().split("T")[0];
  const hasDateSubdirectory = options?.dateSubdirectory !== false;
  const relativeDir = hasDateSubdirectory ? `${folder}/${dateStr}` : folder;
  const uploadDir = hasDateSubdirectory
    ? resolveUploadDir(folder, dateStr)
    : path.join(resolveUploadsRootDirectory(), folder);
  const target = path.join(uploadDir, fileName);
  const temporary = `${target}.${uuidv4()}.part`;
  assertWritablePath(uploadDir);
  await fs.ensureDir(uploadDir);
  const publishedUrl = async () => {
    if (options?.publicReadable) {
      // The web server reads public uploads as a different OS user. Keep staging
      // private, but grant read access after validation and publication, including
      // content-addressed files left by an earlier upload.
      const published = await fs.lstat(assertWritablePath(target));
      if (!published.isFile()) throw new Error("已发布媒体不是普通文件");
      await fs.chmod(target, 0o644);
    }
    return `/uploads/${relativeDir}/${fileName}`;
  };
  if (stableKey && await fs.pathExists(target)) return publishedUrl();
  if (options?.consumeSource) {
    // Upload staging and final files share a volume. Publish without copying the bytes;
    // link() is atomic and never overwrites a concurrently published destination.
    assertWritablePath(source); assertWritablePath(target);
    try {
      await fs.link(source, target);
      await fs.unlink(source).catch(() => undefined);
      return publishedUrl();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" && stableKey) return publishedUrl();
      if (!["EXDEV", "EPERM", "ENOTSUP"].includes(code || "")) throw error;
      // Filesystems without hard links retain the existing copy path.
    }
  }
  try {
    await pipeline(fs.createReadStream(source), fs.createWriteStream(assertWritablePath(temporary), { flags: "wx", mode: 0o600 }));
    assertWritablePath(temporary); assertWritablePath(target);
    await fs.move(temporary, target, { overwrite: false });
  } catch (error) {
    assertWritablePath(temporary);
    await fs.remove(temporary).catch(() => undefined);
    throw error;
  }
  return publishedUrl();
}

export async function saveRemoteFile(
  urlOrBase64: string,
  folder: string,
  isBase64 = false,
  options: RemoteFileDownloadOptions = {},
): Promise<string> {
  const dateStr = new Date().toISOString().split('T')[0];
  const stableKey = normalizeStableKey(options.stableKey);
  const fallbackExt = normalizeFallbackExtension(options.fallbackExt);
  const hasDateSubdirectory = options.dateSubdirectory !== false;
  const relativeDir = hasDateSubdirectory ? `${folder}/${dateStr}` : folder;
  const uploadDir = hasDateSubdirectory
    ? resolveUploadDir(folder, dateStr)
    : path.join(resolveUploadsRootDirectory(), folder);
  assertWritablePath(uploadDir);
  await fs.ensureDir(uploadDir);

  if (isBase64) {
    const mimeMatch = /^data:([^;]+);base64,/i.exec(urlOrBase64 || "");
    const mimeExt = getExtensionFromMime(mimeMatch?.[1] || "");
    const extension = mimeExt || fallbackExt || (folder.toLowerCase().includes("video") ? "mp4" : "png");
    const fileName = `${stableKey || uuidv4()}.${extension}`;
    const base64Data = String(urlOrBase64 || "").replace(/^data:[^;]+;base64,/i, "");
    const filePath = path.join(uploadDir, fileName);
    if (stableKey && await fs.pathExists(filePath)) {
      return `/uploads/${relativeDir}/${fileName}`;
    }
    assertWritablePath(filePath);
    await fs.writeFile(filePath, base64Data, 'base64');
    return `/uploads/${relativeDir}/${fileName}`;
  } else {
    let extFromUrl = "";
    try {
      extFromUrl = getExtensionFromFilename(new URL(urlOrBase64).pathname);
    } catch {
      extFromUrl = getExtensionFromFilename(urlOrBase64);
    }
    const extension = stableKey && fallbackExt
      ? fallbackExt
      : extFromUrl || fallbackExt || (folder.toLowerCase().includes("video") ? "mp4" : "png");
    const fileName = `${stableKey || uuidv4()}.${extension}`;
    const filePath = path.join(uploadDir, fileName);
    const publicPath = `/uploads/${relativeDir}/${fileName}`;
    if (stableKey && await fs.pathExists(filePath)) return publicPath;
    const maxAttempts = 5;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tempPath = stableKey
        ? `${filePath}.${uuidv4()}.part`
        : `${filePath}.part`;
      try {
        const response = await downloadRemoteStream(urlOrBase64, options.providerId);
        const extFromMime = getExtensionFromMime(String((response.headers || {})["content-type"] || ""));
        const finalExtension = stableKey && fallbackExt
          ? fallbackExt
          : extFromUrl || extFromMime || fallbackExt || (folder.toLowerCase().includes("video") ? "mp4" : "png");
        const finalPath = stableKey
          ? filePath
          : finalExtension === extension
            ? filePath
            : path.join(uploadDir, `${uuidv4()}.${finalExtension}`);
        await pipeline(response.data, fs.createWriteStream(assertWritablePath(tempPath)));

        if (stableKey && await fs.pathExists(finalPath)) {
          assertWritablePath(tempPath);
          await fs.remove(tempPath).catch(() => undefined);
          return publicPath;
        }
        assertWritablePath(tempPath); assertWritablePath(finalPath);
        await fs.move(tempPath, finalPath, { overwrite: !stableKey });
        return stableKey
          ? publicPath
          : `/uploads/${relativeDir}/${path.basename(finalPath)}`;
      } catch (error: any) {
        lastError = error;
        assertWritablePath(tempPath);
        await fs.remove(tempPath).catch(() => undefined);
        const status = Number(error?.response?.status || 0);
        const retryable =
          !status || [404, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
        if (!retryable || attempt >= maxAttempts) {
          if (options.providerId) throw providerResultDownloadError(error);
          if (status && [500, 502, 503, 504].includes(status)) {
            throw new Error(`远程结果已返回，但下载保存失败（${status}）`);
          }
          throw error;
        }
        await sleep(attempt * 1500);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("远程文件下载失败");
  }
}

export type SavedRemoteFileWithHash = {
  localPath: string;
  hash: string;
  bytes: number;
};

// 与 saveRemoteFile 的区别：边下载边算 sha256，输出文件以内容 hash 命名。
// 同一内容重复保存会落到同一文件名（直接复用），文件层天然幂等——
// finalize 重试或 crash 后重做最多覆盖同一文件，不会产生重复结果文件。
export async function saveRemoteFileWithHash(
  urlOrBase64: string,
  folder: string,
  isBase64 = false,
  options: RemoteFileDownloadOptions = {},
): Promise<SavedRemoteFileWithHash> {
  const dateStr = new Date().toISOString().split('T')[0];
  const uploadDir = resolveUploadDir(folder, dateStr);
  assertWritablePath(uploadDir);
  await fs.ensureDir(uploadDir);

  if (isBase64) {
    const mimeMatch = /^data:([^;]+);base64,/i.exec(urlOrBase64 || "");
    const mimeExt = getExtensionFromMime(mimeMatch?.[1] || "");
    const extension = mimeExt || (folder.toLowerCase().includes("video") ? "mp4" : "png");
    const base64Data = String(urlOrBase64 || "").replace(/^data:[^;]+;base64,/i, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const fileName = `${hash}.${extension}`;
    const filePath = path.join(uploadDir, fileName);
    if (!(await fs.pathExists(filePath))) {
      assertWritablePath(filePath);
      await fs.writeFile(filePath, buffer);
    }
    return { localPath: `/uploads/${folder}/${dateStr}/${fileName}`, hash, bytes: buffer.length };
  }

  let extFromUrl = "";
  try {
    extFromUrl = getExtensionFromFilename(new URL(urlOrBase64).pathname);
  } catch {
    extFromUrl = getExtensionFromFilename(urlOrBase64);
  }
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tempPath = path.join(uploadDir, `${uuidv4()}.part`);
    try {
      const response = await downloadRemoteStream(urlOrBase64, options.providerId);
      const extFromMime = getExtensionFromMime(String((response.headers || {})["content-type"] || ""));
      const extension = extFromUrl || extFromMime || (folder.toLowerCase().includes("video") ? "mp4" : "png");

      const hasher = createHash('sha256');
      let bytes = 0;
      response.data.on('data', (chunk: Buffer) => {
        hasher.update(chunk);
        bytes += chunk.length;
      });
      await pipeline(response.data, fs.createWriteStream(assertWritablePath(tempPath)));

      const hash = hasher.digest('hex');
      const fileName = `${hash}.${extension}`;
      const finalPath = path.join(uploadDir, fileName);
      if (await fs.pathExists(finalPath)) {
        assertWritablePath(tempPath);
        await fs.remove(tempPath).catch(() => undefined);
      } else {
        assertWritablePath(tempPath); assertWritablePath(finalPath);
        await fs.move(tempPath, finalPath, { overwrite: true });
      }
      return { localPath: `/uploads/${folder}/${dateStr}/${fileName}`, hash, bytes };
    } catch (error: any) {
      lastError = error;
      assertWritablePath(tempPath);
      await fs.remove(tempPath).catch(() => undefined);
      const status = Number(error?.response?.status || 0);
      const retryable =
        !status || [404, 408, 409, 425, 429, 500, 502, 503, 504].includes(status);
      if (!retryable || attempt >= maxAttempts) {
        if (options.providerId) throw providerResultDownloadError(error);
        if (status && [500, 502, 503, 504].includes(status)) {
          throw new Error(`远程结果已返回，但下载保存失败（${status}）`);
        }
        throw error;
      }
      await sleep(attempt * 1500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("远程文件下载失败");
}
