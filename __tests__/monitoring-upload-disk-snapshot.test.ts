import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  collectUploadDiskSnapshot,
  readUploadDiskSnapshot,
  uploadDiskHealthState,
} from "@/lib/monitoring/upload-disk-snapshot";

describe("upload disk snapshot", () => {
  it.each([
    [0.699, "healthy"],
    [0.7, "warning"],
    [0.849, "warning"],
    [0.85, "critical"],
  ] as const)("maps used ratio %s to %s", (ratio, state) => {
    expect(uploadDiskHealthState(ratio)).toBe(state);
  });

  it("calculates the filesystem containing the nearest existing upload path", async () => {
    const uploadsRoot = path.resolve("tmp", "uploads", "missing");
    const existingRoot = path.dirname(uploadsRoot);
    const pathExists = vi.fn(async (value: string) => value === existingRoot);
    const statfs = vi.fn(async () => ({
      blocks: 100,
      bsize: 10,
      bavail: 20,
    } as any));

    const snapshot = await collectUploadDiskSnapshot({
      now: new Date("2026-08-18T10:00:00.000Z"),
      uploadsRoot,
      pathExists,
      statfs,
    });

    expect(statfs).toHaveBeenCalledWith(existingRoot);
    expect(snapshot).toEqual({
      state: "warning",
      uploadsRoot,
      inspectedPath: existingRoot,
      totalBytes: 1_000,
      freeBytes: 200,
      usedBytes: 800,
      usedRatio: 0.8,
      usedPercent: 80,
      observedAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("returns unavailable instead of a healthy zero when statfs fails", async () => {
    const uploadsRoot = path.resolve("tmp", "uploads");
    const snapshot = await readUploadDiskSnapshot({
      now: new Date("2026-08-18T10:00:00.000Z"),
      uploadsRoot,
      pathExists: vi.fn(async () => true),
      statfs: vi.fn(async () => {
        throw new Error("EPERM");
      }),
    });

    expect(snapshot).toMatchObject({
      state: "unavailable",
      uploadsRoot,
      inspectedPath: uploadsRoot,
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
      usedRatio: null,
      usedPercent: null,
      observedAt: "2026-08-18T10:00:00.000Z",
      error: "EPERM",
    });
  });

  it("rejects invalid capacity evidence instead of fabricating a normal reading", async () => {
    await expect(collectUploadDiskSnapshot({
      pathExists: vi.fn(async () => true),
      statfs: vi.fn(async () => ({ blocks: 0, bsize: 4_096, bavail: 0 } as any)),
    })).rejects.toThrow("磁盘容量数据无效");
  });
});
