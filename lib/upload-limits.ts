import { formatBytes } from "@/lib/admin/user-transfer-limits";
import {
  collectUploadDiskSnapshot,
  DISK_BLOCK_RATIO,
  DISK_WARN_RATIO,
  getUploadsRootDir,
} from "@/lib/monitoring/upload-disk-snapshot";

export {
  DISK_BLOCK_RATIO,
  DISK_WARN_RATIO,
  getUploadsRootDir,
} from "@/lib/monitoring/upload-disk-snapshot";

const MIB = 1024 * 1024;

export const MAX_UPLOAD_REQUEST_BYTES = 300 * MIB;
export const MAX_UPLOAD_FILE_COUNT = 20;
export const MAX_ZIP_ENTRY_COUNT = 30;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 300 * MIB;
export const LARGE_UPLOAD_BYTES = 50 * MIB;

export class UploadLimitError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadLimitError";
    this.status = status;
  }
}

export function getUploadFilesTotalBytes(files: Array<Pick<File, "size">>) {
  return files.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);
}

export function assertRequestContentLengthUnderLimit(request: Request, maxBytes = MAX_UPLOAD_REQUEST_BYTES) {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const bytes = Number(raw);
  if (Number.isFinite(bytes) && bytes > maxBytes) {
    throw new UploadLimitError(`Upload request exceeds ${formatBytes(maxBytes)}`, 413);
  }
}

export function assertUploadBatchWithinLimits(
  files: Array<Pick<File, "name" | "size" | "type">>,
  options: { maxFiles?: number; maxTotalBytes?: number; label?: string } = {},
) {
  const maxFiles = options.maxFiles ?? MAX_UPLOAD_FILE_COUNT;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_UPLOAD_REQUEST_BYTES;
  const label = options.label || "Upload";

  if (files.length > maxFiles) {
    throw new UploadLimitError(`${label} file count exceeds ${maxFiles}`, 400);
  }

  const totalBytes = getUploadFilesTotalBytes(files);
  if (totalBytes > maxTotalBytes) {
    throw new UploadLimitError(`${label} total size exceeds ${formatBytes(maxTotalBytes)}`, 413);
  }
}

export async function assertUploadDiskWatermark(
  files: Array<Pick<File, "size" | "type" | "name">>,
  options: { label?: string; uploadsRoot?: string } = {},
) {
  const uploadsRoot = options.uploadsRoot || getUploadsRootDir();
  const snapshot = await collectUploadDiskSnapshot({ uploadsRoot });
  const target = snapshot.inspectedPath;
  const total = snapshot.totalBytes;
  const free = snapshot.freeBytes;
  const usedRatio = snapshot.usedRatio;
  const totalBytes = getUploadFilesTotalBytes(files);
  const hasVideo = files.some((file) => {
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return mime.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v)$/.test(name);
  });

  if (usedRatio >= DISK_WARN_RATIO) {
    console.warn(
      `[upload] disk usage ${(usedRatio * 100).toFixed(1)}% at ${target}; free=${formatBytes(free)} total=${formatBytes(total)}`,
    );
  }

  if (usedRatio >= DISK_BLOCK_RATIO && (hasVideo || totalBytes >= LARGE_UPLOAD_BYTES)) {
    throw new UploadLimitError(
      `${options.label || "Upload"} is blocked because disk usage is ${(usedRatio * 100).toFixed(1)}%`,
      507,
    );
  }
}
