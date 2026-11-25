import { describe, expect, it, vi } from "vitest";

import { createUploadDiskMonitorRuntime } from "@/lib/monitoring/upload-disk-monitor";
import type { UploadDiskSnapshot } from "@/lib/monitoring/upload-disk-snapshot";

const warning: UploadDiskSnapshot = {
  state: "warning",
  uploadsRoot: "C:\\data\\uploads",
  inspectedPath: "C:\\data",
  totalBytes: 1_000,
  freeBytes: 214,
  usedBytes: 786,
  usedRatio: 0.786,
  usedPercent: 78.6,
  observedAt: "2026-08-18T10:00:00.000Z",
};

describe("upload disk monitor runtime", () => {
  it("keeps the last successful snapshot and records persistence failures", async () => {
    const readSnapshot = vi.fn<() => Promise<UploadDiskSnapshot>>()
      .mockResolvedValueOnce(warning)
      .mockResolvedValueOnce({
        state: "unavailable",
        uploadsRoot: warning.uploadsRoot,
        inspectedPath: warning.inspectedPath,
        totalBytes: null,
        freeBytes: null,
        usedBytes: null,
        usedRatio: null,
        usedPercent: null,
        observedAt: "2026-08-18T10:00:15.000Z",
        error: "EPERM",
      });
    const reconcile = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const runtime = createUploadDiskMonitorRuntime({
      readSnapshot,
      reconcile,
      prune: vi.fn().mockResolvedValue(0),
    });

    await runtime.runTick();
    await runtime.runTick();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(runtime.getState()).toMatchObject({
      lastSuccessfulSnapshot: warning,
      lastSuccessfulAt: "2026-08-18T10:00:00.000Z",
      lastPersistenceError: "database unavailable",
    });
  });

  it("does not overlap ticks and starts only one interval", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const readSnapshot = vi.fn(async () => {
      await blocked;
      return warning;
    });
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const interval = { unref: vi.fn() };
    const setIntervalFn = vi.fn(() => interval as any);
    const runtime = createUploadDiskMonitorRuntime({
      readSnapshot,
      reconcile,
      prune: vi.fn().mockResolvedValue(0),
      setIntervalFn,
    });

    runtime.start();
    runtime.start();
    const overlapping = runtime.runTick();
    release();
    await overlapping;

    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15_000);
    expect(interval.unref).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("prunes expired recovered alerts at most once per minute", async () => {
    const times = [
      new Date("2026-08-18T10:00:00.000Z"),
      new Date("2026-08-18T10:00:15.000Z"),
      new Date("2026-08-18T10:01:00.000Z"),
    ];
    const prune = vi.fn().mockResolvedValue(1);
    const runtime = createUploadDiskMonitorRuntime({
      readSnapshot: vi.fn().mockResolvedValue({
        ...warning,
        state: "healthy",
        freeBytes: 400,
        usedBytes: 600,
        usedRatio: 0.6,
        usedPercent: 60,
      }),
      reconcile: vi.fn().mockResolvedValue(undefined),
      prune,
      now: () => times.shift()!,
    });

    await runtime.runTick();
    await runtime.runTick();
    await runtime.runTick();

    expect(prune).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenNthCalledWith(1, new Date("2026-08-18T10:00:00.000Z"));
    expect(prune).toHaveBeenNthCalledWith(2, new Date("2026-08-18T10:01:00.000Z"));
  });
});
