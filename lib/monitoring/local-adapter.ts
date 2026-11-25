import os from "node:os";
import { execFileSync } from "node:child_process";
import { getHeapStatistics } from "node:v8";

import type {
  LocalMonitoringSnapshot,
  MonitoringServiceId,
  ServiceStatus,
} from "@/lib/monitoring/contracts";

export type LocalMonitoringDependencies = {
  hostname: () => string;
  platform: () => NodeJS.Platform;
  arch: () => string;
  cpuCount: () => number;
  loadAverage: () => number[];
  totalMemory: () => number;
  freeMemory: () => number;
  readVmStats?: () => string;
  processId: () => number;
  processUptime: () => number;
  processMemory: () => NodeJS.MemoryUsage;
  processHeapLimit: () => number;
};

const dependencies: LocalMonitoringDependencies = {
  hostname: () => os.hostname(),
  platform: () => os.platform(),
  arch: () => os.arch(),
  cpuCount: () => os.cpus().length,
  loadAverage: () => os.loadavg(),
  totalMemory: () => os.totalmem(),
  freeMemory: () => os.freemem(),
  readVmStats: readDarwinVmStats,
  processId: () => process.pid,
  processUptime: () => process.uptime(),
  processMemory: () => process.memoryUsage(),
  processHeapLimit: () => getHeapStatistics().heap_size_limit,
};

let vmStatsCache: { output: string; collectedAt: number } | null = null;
function readDarwinVmStats() {
  const now = Date.now();
  if (vmStatsCache && now - vmStatsCache.collectedAt < 5000) return vmStatsCache.output;
  const output = execFileSync("/usr/bin/vm_stat", [], { encoding: "utf8", timeout: 1000, maxBuffer: 64 * 1024 });
  vmStatsCache = { output, collectedAt: now };
  return output;
}

function nonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function nonNegativeInteger(value: unknown) {
  return Math.floor(nonNegative(value));
}

function unsupportedService(id: MonitoringServiceId, name: string, updatedAt: string): ServiceStatus {
  return {
    id,
    name,
    state: "unsupported",
    controllable: false,
    updatedAt,
    message: "本地轻量模式不执行Linux服务操作",
  };
}

export function readLocalMonitoringSnapshot(
  now = new Date(),
  source: LocalMonitoringDependencies = dependencies,
): LocalMonitoringSnapshot {
  const collectedAt = now.toISOString();
  const totalBytes = nonNegative(source.totalMemory());
  let freeBytes = Math.min(totalBytes, nonNegative(source.freeMemory()));
  let cacheAdjustedMemory: { availableBytes: number; cachedBytes: number } | undefined;
  const platform = source.platform();
  if (platform === "darwin" && source.readVmStats) {
    try {
      const output = source.readVmStats();
      const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
      const freePages = /^Pages free:\s+(\d+)\./m.exec(output);
      const filePages = /^File-backed pages:\s+(\d+)\./m.exec(output);
      if (pageSize > 0 && freePages && filePages) {
        freeBytes = Math.min(totalBytes, Number(freePages[1]) * pageSize);
        const cachedBytes = Math.min(totalBytes - freeBytes, Number(filePages[1]) * pageSize);
        // File-backed pages can be reclaimed. Do not also add inactive/purgeable/
        // speculative counters: they overlap and would understate actual usage.
        cacheAdjustedMemory = { availableBytes: freeBytes + cachedBytes, cachedBytes };
      }
    } catch { /* Retain the existing OS reading if vm_stat is unavailable. */ }
  }
  const usedBytes = Math.max(0, totalBytes - (cacheAdjustedMemory?.availableBytes ?? freeBytes));
  const load = source.loadAverage();
  const processMemory = source.processMemory();

  const serviceDefinitions: Array<[MonitoringServiceId, string]> = [
    ["generation-worker", "Canvas Generation Worker"],
    ["media-worker", "Canvas Media Worker"],
    ["live-video-prompt-worker", "Live 视频提示词 Worker"],
    ["live-video-video-worker", "Live 视频生成 Worker"],
    ["nginx", "Nginx"],
    ["postgresql", "PostgreSQL"],
    ["prometheus", "Prometheus"],
    ["loki", "Loki"],
    ["tempo", "Tempo"],
    ["grafana", "Grafana"],
    ["alloy", "Grafana Alloy"],
    ["alertmanager", "Alertmanager"],
    ["postgres-exporter", "PostgreSQL Exporter"],
    ["ops", "Inkvia Ops"],
  ];

  return {
    collectedAt,
    host: {
      state: "healthy",
      hostname: String(source.hostname() || "").trim() || "localhost",
      platform,
      arch: String(source.arch() || "unknown"),
      logicalCores: Math.max(1, nonNegativeInteger(source.cpuCount())),
      loadAverage: [
        nonNegative(load[0]),
        nonNegative(load[1]),
        nonNegative(load[2]),
      ],
      memory: {
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(2)) : 0,
        ...cacheAdjustedMemory,
      },
    },
    process: {
      state: "healthy",
      pid: nonNegativeInteger(source.processId()),
      uptimeSeconds: nonNegative(source.processUptime()),
      rssBytes: nonNegativeInteger(processMemory.rss),
      heapTotalBytes: nonNegativeInteger(processMemory.heapTotal),
      heapUsedBytes: nonNegativeInteger(processMemory.heapUsed),
      heapLimitBytes: nonNegativeInteger(source.processHeapLimit()),
    },
    services: [
      {
        id: "web",
        name: "Inkvia Web",
        state: "healthy",
        controllable: false,
        updatedAt: collectedAt,
        message: "当前开发进程",
        uptimeSeconds: nonNegative(source.processUptime()),
        pid: nonNegativeInteger(source.processId()),
      },
      ...serviceDefinitions.map(([id, name]) => unsupportedService(id, name, collectedAt)),
    ],
  };
}
