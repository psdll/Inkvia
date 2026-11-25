import path from "node:path";
import { statfs } from "node:fs/promises";

import fs from "fs-extra";

import { resolvePublicPath } from "@/lib/public-path";

export const DISK_WARN_RATIO = 0.7;
export const DISK_BLOCK_RATIO = 0.85;

export type UploadDiskHealthState = "healthy" | "warning" | "critical";

export type AvailableUploadDiskSnapshot = {
  state: UploadDiskHealthState;
  uploadsRoot: string;
  inspectedPath: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedRatio: number;
  usedPercent: number;
  observedAt: string;
  lastSuccessfulAt?: string;
};

export type UnavailableUploadDiskSnapshot = {
  state: "unavailable";
  uploadsRoot: string;
  inspectedPath: string;
  totalBytes: null;
  freeBytes: null;
  usedBytes: null;
  usedRatio: null;
  usedPercent: null;
  observedAt: string;
  lastSuccessfulAt?: string;
  error: string;
};

export type UploadDiskSnapshot =
  | AvailableUploadDiskSnapshot
  | UnavailableUploadDiskSnapshot;

export type UploadDiskSnapshotDependencies = {
  pathExists: (value: string) => Promise<boolean>;
  statfs: typeof statfs;
};

const dependencies: UploadDiskSnapshotDependencies = {
  pathExists: (value) => fs.pathExists(value),
  statfs,
};

export function getUploadsRootDir() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  return configured ? path.resolve(configured) : resolvePublicPath("uploads");
}

export function uploadDiskHealthState(usedRatio: number): UploadDiskHealthState {
  if (usedRatio >= DISK_BLOCK_RATIO) return "critical";
  if (usedRatio >= DISK_WARN_RATIO) return "warning";
  return "healthy";
}

async function nearestExistingPath(
  target: string,
  pathExists: UploadDiskSnapshotDependencies["pathExists"],
) {
  let current = path.resolve(target);
  for (let index = 0; index < 8; index += 1) {
    if (await pathExists(current).catch(() => false)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

type UploadDiskSnapshotInput = Partial<UploadDiskSnapshotDependencies> & {
  now?: Date;
  uploadsRoot?: string;
};

export async function collectUploadDiskSnapshot(
  input: UploadDiskSnapshotInput = {},
): Promise<AvailableUploadDiskSnapshot> {
  const source = { ...dependencies, ...input };
  const now = input.now || new Date();
  const uploadsRoot = path.resolve(input.uploadsRoot || getUploadsRootDir());
  const inspectedPath = await nearestExistingPath(uploadsRoot, source.pathExists);
  const value = await source.statfs(inspectedPath);
  const totalBytes = Number(value.blocks) * Number(value.bsize);
  const freeBytes = Number(value.bavail) * Number(value.bsize);

  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
    throw new Error("磁盘容量数据无效");
  }

  const usedRatio = Math.max(0, Math.min(1, 1 - freeBytes / totalBytes));
  return {
    state: uploadDiskHealthState(usedRatio),
    uploadsRoot,
    inspectedPath,
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    usedRatio,
    usedPercent: Number((usedRatio * 100).toFixed(2)),
    observedAt: now.toISOString(),
  };
}

export async function readUploadDiskSnapshot(
  input: UploadDiskSnapshotInput = {},
): Promise<UploadDiskSnapshot> {
  const now = input.now || new Date();
  const uploadsRoot = path.resolve(input.uploadsRoot || getUploadsRootDir());
  try {
    return await collectUploadDiskSnapshot({ ...input, now, uploadsRoot });
  } catch (error) {
    return {
      state: "unavailable",
      uploadsRoot,
      inspectedPath: uploadsRoot,
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
      usedRatio: null,
      usedPercent: null,
      observedAt: now.toISOString(),
      error: error instanceof Error ? error.message : "磁盘状态检测失败",
    };
  }
}
