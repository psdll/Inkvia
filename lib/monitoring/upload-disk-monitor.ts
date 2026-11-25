import {
  readUploadDiskSnapshot,
  type UploadDiskSnapshot,
} from "@/lib/monitoring/upload-disk-snapshot";
import {
  pruneExpiredUploadDiskAlerts,
  reconcileUploadDiskAlert,
} from "@/lib/monitoring/upload-disk-alerts";

const UPLOAD_DISK_MONITOR_INTERVAL_MS = 15_000;
const UPLOAD_DISK_PRUNE_INTERVAL_MS = 60_000;

type UploadDiskMonitorDependencies = {
  readSnapshot: typeof readUploadDiskSnapshot;
  reconcile: typeof reconcileUploadDiskAlert;
  prune: typeof pruneExpiredUploadDiskAlerts;
  now: () => Date;
  setIntervalFn: typeof setInterval;
};

export type UploadDiskMonitorRuntimeState = {
  started: boolean;
  running: boolean;
  lastSuccessfulSnapshot: UploadDiskSnapshot | null;
  lastSuccessfulAt: string | null;
  lastPersistenceError: string | null;
  lastPrunedAt: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "告警记录保存失败";
}

export function createUploadDiskMonitorRuntime(
  input: Partial<UploadDiskMonitorDependencies> = {},
) {
  const dependencies: UploadDiskMonitorDependencies = {
    readSnapshot: readUploadDiskSnapshot,
    reconcile: reconcileUploadDiskAlert,
    prune: pruneExpiredUploadDiskAlerts,
    now: () => new Date(),
    setIntervalFn: setInterval,
    ...input,
  };
  const state: UploadDiskMonitorRuntimeState = {
    started: false,
    running: false,
    lastSuccessfulSnapshot: null,
    lastSuccessfulAt: null,
    lastPersistenceError: null,
    lastPrunedAt: null,
  };

  async function runTick() {
    if (state.running) return;
    state.running = true;
    try {
      const tickNow = dependencies.now();
      const snapshot = await dependencies.readSnapshot();
      if (snapshot.state !== "unavailable") {
        state.lastSuccessfulSnapshot = snapshot;
        state.lastSuccessfulAt = snapshot.observedAt;
        try {
          await dependencies.reconcile(snapshot, new Date(snapshot.observedAt));
          state.lastPersistenceError = null;
        } catch (error) {
          state.lastPersistenceError = errorMessage(error);
        }
      }

      const lastPrunedAt = state.lastPrunedAt ? Date.parse(state.lastPrunedAt) : 0;
      if (tickNow.getTime() - lastPrunedAt >= UPLOAD_DISK_PRUNE_INTERVAL_MS) {
        state.lastPrunedAt = tickNow.toISOString();
        try {
          await dependencies.prune(tickNow);
        } catch (error) {
          console.warn("[uploads] failed to prune expired monitoring alerts:", error);
        }
      }
    } finally {
      state.running = false;
    }
  }

  function start() {
    if (state.started) return;
    state.started = true;
    void runTick();
    const timer = dependencies.setIntervalFn(() => void runTick(), UPLOAD_DISK_MONITOR_INTERVAL_MS);
    timer.unref?.();
  }

  function getState(): UploadDiskMonitorRuntimeState {
    return { ...state };
  }

  return { getState, runTick, start };
}

const uploadDiskMonitorRuntime = createUploadDiskMonitorRuntime();

export function startUploadDiskMonitor() {
  uploadDiskMonitorRuntime.start();
}

export function runUploadDiskMonitorTick() {
  return uploadDiskMonitorRuntime.runTick();
}

export function getUploadDiskMonitorRuntimeState() {
  return uploadDiskMonitorRuntime.getState();
}
