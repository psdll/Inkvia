import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import type { MonitoringServiceId } from "@/lib/monitoring/contracts";

const LOCAL_LOG_FILES: Partial<Record<MonitoringServiceId, string>> = {
  web: "web.log",
  "generation-worker": "generation-worker.log",
  "media-worker": "media-worker.log",
  "live-video-prompt-worker": "live-video-prompt-worker.log",
  "live-video-video-worker": "live-video-video-worker.log",
  ops: "ops.log",
};

export type LocalLogReadResult = {
  supported: boolean;
  entries: Array<{ timestamp: null; line: string; labels: { service: string } }>;
};

function withinRoot(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readLocalLogs(input: {
  root?: string;
  service: MonitoringServiceId;
  limit: number;
  query?: string;
  maximumBytes?: number;
}): Promise<LocalLogReadResult> {
  const configuredRoot = String(input.root || "").trim();
  const filename = LOCAL_LOG_FILES[input.service];
  if (!configuredRoot || !filename) return { supported: false, entries: [] };

  const rootPath = path.resolve(configuredRoot);
  const rootInfo = await lstat(rootPath);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("本地日志目录无效");
  }
  const canonicalRoot = await realpath(rootPath);
  const filePath = path.resolve(rootPath, filename);
  if (!withinRoot(rootPath, filePath)) throw new Error("本地日志路径无效");

  const fileInfo = await lstat(filePath);
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("本地日志文件无效");
  const canonicalFile = await realpath(filePath);
  if (!withinRoot(canonicalRoot, canonicalFile)) throw new Error("本地日志路径无效");

  const maximumBytes = Math.min(2 * 1024 * 1024, Math.max(4_096, input.maximumBytes || 512 * 1024));
  const bytesToRead = Math.min(fileInfo.size, maximumBytes);
  const offset = Math.max(0, fileInfo.size - bytesToRead);
  const handle = await open(canonicalFile, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, offset);
    let lines = buffer.toString("utf8").split(/\r?\n/);
    if (offset > 0) lines = lines.slice(1);
    if (input.query) lines = lines.filter((line) => line.includes(input.query!));
    return {
      supported: true,
      entries: lines
        .filter(Boolean)
        .slice(-Math.min(1_000, Math.max(1, input.limit)))
        .map((line) => ({
          timestamp: null,
          line: line.slice(0, 16_384),
          labels: { service: input.service },
        })),
    };
  } finally {
    await handle.close();
  }
}
