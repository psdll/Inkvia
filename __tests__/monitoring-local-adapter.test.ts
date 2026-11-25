import { describe, expect, it } from "vitest";

import { readLocalMonitoringSnapshot } from "@/lib/monitoring/local-adapter";

describe("local monitoring adapter", () => {
  it("returns deterministic host and process resource snapshots", () => {
    const snapshot = readLocalMonitoringSnapshot(
      new Date("2026-07-28T04:00:00.000Z"),
      {
        hostname: () => "dev-box",
        platform: () => "win32",
        arch: () => "x64",
        cpuCount: () => 8,
        loadAverage: () => [1.25, 0.75, 0.5],
        totalMemory: () => 16_000,
        freeMemory: () => 4_000,
        processId: () => 321,
        processUptime: () => 42.5,
        processMemory: () => ({
          rss: 2_000,
          heapTotal: 1_200,
          heapUsed: 800,
          external: 100,
          arrayBuffers: 50,
        }),
        processHeapLimit: () => 4_000,
      },
    );

    expect(snapshot.collectedAt).toBe("2026-07-28T04:00:00.000Z");
    expect(snapshot.host).toEqual({
      state: "healthy",
      hostname: "dev-box",
      platform: "win32",
      arch: "x64",
      logicalCores: 8,
      loadAverage: [1.25, 0.75, 0.5],
      memory: {
        totalBytes: 16_000,
        freeBytes: 4_000,
        usedBytes: 12_000,
        usedPercent: 75,
      },
    });
    expect(snapshot.process).toMatchObject({
      state: "healthy",
      pid: 321,
      uptimeSeconds: 42.5,
      rssBytes: 2_000,
      heapTotalBytes: 1_200,
      heapUsedBytes: 800,
      heapLimitBytes: 4_000,
    });
  });

  it("marks Linux-only services unsupported without running commands", () => {
    const snapshot = readLocalMonitoringSnapshot(
      new Date("2026-07-28T04:00:00.000Z"),
      {
        hostname: () => "dev-box",
        platform: () => "win32",
        arch: () => "x64",
        cpuCount: () => 4,
        loadAverage: () => [0, 0, 0],
        totalMemory: () => 8_000,
        freeMemory: () => 2_000,
        processId: () => 111,
        processUptime: () => 10,
        processMemory: () => ({
          rss: 1_000,
          heapTotal: 500,
          heapUsed: 250,
          external: 0,
          arrayBuffers: 0,
        }),
        processHeapLimit: () => 2_000,
      },
    );

    expect(snapshot.services.find((service) => service.id === "web")).toMatchObject({
      state: "healthy",
      controllable: false,
    });
    expect(snapshot.services.filter((service) => service.id !== "web").every((service) =>
      service.state === "unsupported" && service.controllable === false,
    )).toBe(true);
  });

  it("clamps invalid operating-system values instead of returning NaN", () => {
    const snapshot = readLocalMonitoringSnapshot(
      new Date("2026-07-28T04:00:00.000Z"),
      {
        hostname: () => "",
        platform: () => "win32",
        arch: () => "x64",
        cpuCount: () => 0,
        loadAverage: () => [Number.NaN, -1, Number.POSITIVE_INFINITY],
        totalMemory: () => Number.NaN,
        freeMemory: () => -100,
        processId: () => -1,
        processUptime: () => Number.NaN,
        processMemory: () => ({
          rss: Number.NaN,
          heapTotal: -1,
          heapUsed: Number.POSITIVE_INFINITY,
          external: 0,
          arrayBuffers: 0,
        }),
        processHeapLimit: () => Number.NaN,
      },
    );

    expect(snapshot.host.logicalCores).toBe(1);
    expect(snapshot.host.loadAverage).toEqual([0, 0, 0]);
    expect(snapshot.host.memory.usedPercent).toBe(0);
    expect(snapshot.process).toMatchObject({
      pid: 0,
      uptimeSeconds: 0,
      rssBytes: 0,
      heapTotalBytes: 0,
      heapUsedBytes: 0,
      heapLimitBytes: 0,
    });
  });
});

it.each([4096, 16384])("does not count macOS file cache as exhausted RAM with %i-byte pages", pageSize => {
  const gib = 1024 ** 3;
  const output = `Mach Virtual Memory Statistics: (page size of ${pageSize} bytes)\nPages free: ${gib / 8 / pageSize}.\nPages inactive: ${12 * gib / pageSize}.\nPages speculative: ${gib / 4 / pageSize}.\nPages wired down: ${3 * gib / pageSize}.\nFile-backed pages: ${8 * gib / pageSize}.\nPages occupied by compressor: ${4 * gib / pageSize}.`;
  const snapshot = readLocalMonitoringSnapshot(new Date(), {
    hostname: () => "mac", platform: () => "darwin", arch: () => "arm64", cpuCount: () => 10,
    loadAverage: () => [0, 0, 0], totalMemory: () => 32 * gib, freeMemory: () => gib / 8,
    readVmStats: () => output,
    processId: () => 1, processUptime: () => 1,
    processMemory: () => ({ rss: gib, heapTotal: gib / 2, heapUsed: gib / 4, external: 0, arrayBuffers: 0 }),
    processHeapLimit: () => gib,
  });
  expect(snapshot.host.memory).toMatchObject({
    totalBytes: 32 * gib, freeBytes: gib / 8, availableBytes: 8.125 * gib,
    cachedBytes: 8 * gib, usedBytes: 23.875 * gib, usedPercent: 74.61,
  });
});

it("falls back to the existing OS reading if macOS VM statistics cannot be collected", () => {
  const snapshot = readLocalMonitoringSnapshot(new Date(), {
    hostname: () => "mac", platform: () => "darwin", arch: () => "arm64", cpuCount: () => 10,
    loadAverage: () => [0, 0, 0], totalMemory: () => 16000, freeMemory: () => 4000,
    readVmStats: () => { throw new Error("not available"); },
    processId: () => 1, processUptime: () => 1,
    processMemory: () => ({ rss: 1000, heapTotal: 500, heapUsed: 250, external: 0, arrayBuffers: 0 }),
    processHeapLimit: () => 1000,
  });
  expect(snapshot.host.memory).toEqual({ totalBytes: 16000, freeBytes: 4000, usedBytes: 12000, usedPercent: 75 });
});
