import { readMonitoringConfig } from "@/lib/monitoring/config";
import type { HealthState, MonitoringOverview } from "@/lib/monitoring/contracts";
import { readLocalMonitoringSnapshot } from "@/lib/monitoring/local-adapter";
import {
  countActiveUploadDiskAlerts,
  reconcileUploadDiskAlert,
} from "@/lib/monitoring/upload-disk-alerts";
import { getUploadDiskMonitorRuntimeState } from "@/lib/monitoring/upload-disk-monitor";
import { readUploadDiskSnapshot } from "@/lib/monitoring/upload-disk-snapshot";

const STATE_PRIORITY: Record<HealthState, number> = {
  healthy: 0,
  unsupported: 0,
  warning: 1,
  stale: 2,
  unavailable: 3,
  critical: 4,
};

function worstState(states: HealthState[]) {
  return states.reduce<HealthState>(
    (worst, state) => STATE_PRIORITY[state] > STATE_PRIORITY[worst] ? state : worst,
    "healthy",
  );
}

export function getMonitoringCapabilities(env: NodeJS.ProcessEnv = process.env) {
  const config = readMonitoringConfig(env);
  return {
    apiVersion: "v1" as const,
    mode: config.mode,
    capabilities: config.capabilities,
  };
}

export type MonitoringOverviewDependencies = {
  readDisk: typeof readUploadDiskSnapshot;
  reconcileDiskAlert: typeof reconcileUploadDiskAlert;
  countActiveAlerts: typeof countActiveUploadDiskAlerts;
  getDiskMonitorState: typeof getUploadDiskMonitorRuntimeState;
};

const defaultDependencies: MonitoringOverviewDependencies = {
  readDisk: readUploadDiskSnapshot,
  reconcileDiskAlert: reconcileUploadDiskAlert,
  countActiveAlerts: countActiveUploadDiskAlerts,
  getDiskMonitorState: getUploadDiskMonitorRuntimeState,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "告警记录保存失败";
}

export async function getMonitoringOverview(
  checkedAt = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: MonitoringOverviewDependencies = defaultDependencies,
): Promise<MonitoringOverview> {
  const config = readMonitoringConfig(env);
  const snapshot = readLocalMonitoringSnapshot(checkedAt);
  const warnings: string[] = [];

  const loadRatio = snapshot.host.loadAverage[0] / snapshot.host.logicalCores;
  if (snapshot.host.memory.usedPercent >= 95 || loadRatio >= 2) {
    snapshot.host.state = "critical";
    warnings.push("服务器资源已达到严重阈值");
  } else if (snapshot.host.memory.usedPercent >= 85 || loadRatio >= 1) {
    snapshot.host.state = "warning";
    warnings.push("服务器资源接近容量阈值");
  }

  let disk = await dependencies.readDisk({ now: checkedAt });
  const diskMonitorState = dependencies.getDiskMonitorState();
  if (disk.state === "unavailable" && diskMonitorState.lastSuccessfulAt) {
    disk = { ...disk, lastSuccessfulAt: diskMonitorState.lastSuccessfulAt };
  }

  let alertPersistenceError = diskMonitorState.lastPersistenceError;
  if (disk.state !== "unavailable") {
    try {
      await dependencies.reconcileDiskAlert(disk, checkedAt);
      alertPersistenceError = null;
    } catch (error) {
      alertPersistenceError = errorMessage(error);
    }
  }

  let activeAlerts = 0;
  try {
    activeAlerts = await dependencies.countActiveAlerts(checkedAt);
  } catch (error) {
    alertPersistenceError ||= errorMessage(error);
  }

  if (disk.state === "warning") warnings.push("上传磁盘使用率已达到警告阈值（70%）");
  if (disk.state === "critical") warnings.push("上传磁盘使用率已达到阻止阈值（85%）");
  if (disk.state === "unavailable") warnings.push("无法读取上传磁盘使用率");
  if (alertPersistenceError) warnings.push("告警记录保存失败");

  const host = {
    ...snapshot.host,
    state: worstState([snapshot.host.state, disk.state]),
    disk,
  };

  const observedAt = new Date(snapshot.collectedAt);
  const ageMs = Math.max(0, checkedAt.getTime() - observedAt.getTime());
  const staleAfterMs = 30_000;
  const stale = ageMs > staleAfterMs;
  if (stale) warnings.push("监控数据已过期，请检查采集链路");

  return {
    apiVersion: "v1",
    mode: config.mode,
    state: stale
      ? "stale"
      : worstState([host.state, snapshot.process.state]),
    collectedAt: snapshot.collectedAt,
    freshness: {
      observedAt: snapshot.collectedAt,
      checkedAt: checkedAt.toISOString(),
      ageMs,
      staleAfterMs,
      stale,
    },
    host,
    process: snapshot.process,
    services: snapshot.services,
    activeAlerts,
    alertPersistenceError,
    warnings,
  };
}

export async function getMonitoringServices(now = new Date()) {
  const overview = await getMonitoringOverview(now);
  return {
    apiVersion: "v1" as const,
    mode: overview.mode,
    collectedAt: overview.collectedAt,
    freshness: overview.freshness,
    services: overview.services,
  };
}
