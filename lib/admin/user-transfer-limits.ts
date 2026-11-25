import path from "path";
import { statfs } from "node:fs/promises";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export const DEFAULT_MAX_TRANSFER_BYTES = 20 * GIB;
export const DEFAULT_MAX_IMPORT_FILES = 250_000;
export const DEFAULT_MAX_JSON_BYTES = 128 * MIB;
export const DEFAULT_DISK_SAFETY_BYTES = 512 * MIB;

function parseBytesEnv(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getMaxImportBytes() {
  return parseBytesEnv("USER_IMPORT_MAX_BYTES", DEFAULT_MAX_TRANSFER_BYTES);
}

export function getMaxExportBytes() {
  return parseBytesEnv("USER_EXPORT_MAX_BYTES", DEFAULT_MAX_TRANSFER_BYTES);
}

export function getMaxImportFiles() {
  return parseBytesEnv("USER_IMPORT_MAX_FILES", DEFAULT_MAX_IMPORT_FILES);
}

export function getMaxJsonBytes() {
  return parseBytesEnv("USER_IMPORT_MAX_JSON_BYTES", DEFAULT_MAX_JSON_BYTES);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

export async function assertDiskSpace(dir: string, requiredBytes: number, label: string) {
  const target = path.resolve(dir);
  try {
    const stat = await statfs(target);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const needed = Math.ceil(requiredBytes + DEFAULT_DISK_SAFETY_BYTES);
    if (Number.isFinite(free) && free < needed) {
      throw new Error(
        `${label}磁盘空间不足：需要至少 ${formatBytes(needed)}，当前可用 ${formatBytes(free)}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("磁盘空间不足")) throw err;
  }
}
