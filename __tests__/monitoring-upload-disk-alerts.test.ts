import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    monitoringAlertRecord: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
      findMany: mocks.findMany,
      count: mocks.count,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  acknowledgeUploadDiskAlert,
  countActiveUploadDiskAlerts,
  decideUploadDiskAlertTransition,
  findUploadDiskAlertByFingerprint,
  listUploadDiskAlerts,
  pruneExpiredUploadDiskAlerts,
  reconcileUploadDiskAlert,
  RECOVERED_ALERT_RETENTION_MS,
  silenceUploadDiskAlert,
} from "@/lib/monitoring/upload-disk-alerts";
import type { AvailableUploadDiskSnapshot } from "@/lib/monitoring/upload-disk-snapshot";

const warning: AvailableUploadDiskSnapshot = {
  state: "warning",
  uploadsRoot: "C:\\data\\uploads",
  inspectedPath: "C:\\data",
  totalBytes: 1_000,
  freeBytes: 200,
  usedBytes: 800,
  usedRatio: 0.8,
  usedPercent: 80,
  observedAt: "2026-08-18T10:00:00.000Z",
};

const active = {
  id: "record-1",
  fingerprint: "a".repeat(64),
  activeKey: "resource-key",
  resourceKey: "resource-key",
  peakPercent: 80,
  startsAt: new Date("2026-08-18T10:00:00.000Z"),
};

describe("upload disk alert lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(async ({ data }) => ({ id: "record-1", ...data }));
    mocks.update.mockImplementation(async ({ data }) => ({ ...active, ...data }));
    mocks.findMany.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("creates, upgrades, and recovers one alert episode for 30 days", () => {
    expect(decideUploadDiskAlertTransition({
      snapshot: warning,
      active: null,
      now: new Date(warning.observedAt),
    })).toEqual({ type: "create", severity: "warning" });

    expect(decideUploadDiskAlertTransition({
      snapshot: { ...warning, state: "critical", usedRatio: 0.86, usedPercent: 86 },
      active,
      now: new Date("2026-08-18T10:00:15.000Z"),
    })).toEqual({ type: "update", severity: "critical", peakPercent: 86 });

    const recoveredAt = new Date("2026-08-18T11:00:00.000Z");
    expect(decideUploadDiskAlertTransition({
      snapshot: { ...warning, state: "healthy", usedRatio: 0.69, usedPercent: 69 },
      active: { ...active, peakPercent: 86 },
      now: recoveredAt,
    })).toEqual({
      type: "recover",
      recoveredAt,
      expiresAt: new Date(recoveredAt.getTime() + RECOVERED_ALERT_RETENTION_MS),
    });
  });

  it("does not recover an active alert when disk evidence is unavailable", () => {
    expect(decideUploadDiskAlertTransition({
      snapshot: {
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
      },
      active,
      now: new Date("2026-08-18T10:00:15.000Z"),
    })).toEqual({ type: "none" });
  });

  it("creates one active database record and updates it on later readings", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(active);

    await reconcileUploadDiskAlert(warning, new Date(warning.observedAt));
    await reconcileUploadDiskAlert(
      { ...warning, state: "critical", usedRatio: 0.86, usedPercent: 86 },
      new Date("2026-08-18T10:00:15.000Z"),
    );

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      activeKey: expect.any(String),
      state: "firing",
      severity: "warning",
      currentPercent: 80,
      peakPercent: 80,
      warningPercent: 70,
      criticalPercent: 85,
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { fingerprint: active.fingerprint },
      data: expect.objectContaining({
        state: "firing",
        severity: "critical",
        currentPercent: 86,
        peakPercent: 86,
      }),
    }));
  });

  it("marks an active record recovered and assigns its exact deletion time", async () => {
    mocks.findUnique.mockResolvedValue(active);
    const recoveredAt = new Date("2026-08-18T11:00:00.000Z");

    await reconcileUploadDiskAlert(
      { ...warning, state: "healthy", usedRatio: 0.69, usedPercent: 69 },
      recoveredAt,
    );

    expect(mocks.update).toHaveBeenCalledWith({
      where: { fingerprint: active.fingerprint },
      data: expect.objectContaining({
        activeKey: null,
        state: "recovered",
        currentPercent: 69,
        recoveredAt,
        expiresAt: new Date("2026-09-17T11:00:00.000Z"),
      }),
    });
  });

  it("counts only active records and prunes only expired recovered records", async () => {
    const now = new Date("2026-09-18T11:00:00.000Z");
    mocks.count.mockResolvedValue(2);
    mocks.deleteMany.mockResolvedValue({ count: 3 });

    await expect(countActiveUploadDiskAlerts(now)).resolves.toBe(2);
    await expect(pruneExpiredUploadDiskAlerts(now)).resolves.toBe(3);

    expect(mocks.count).toHaveBeenCalledWith({
      where: { state: "firing", activeKey: { not: null } },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { state: "recovered", expiresAt: { lte: now } },
    });
  });

  it("lists unexpired history and looks up an exact fingerprint", async () => {
    const now = new Date("2026-09-01T11:00:00.000Z");
    mocks.findMany.mockResolvedValue([active]);
    mocks.findUnique.mockResolvedValue(active);

    await expect(listUploadDiskAlerts(now)).resolves.toEqual([active]);
    await expect(findUploadDiskAlertByFingerprint(active.fingerprint)).resolves.toEqual(active);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { state: { not: "recovered" } },
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { startsAt: "desc" },
      take: 200,
    });
  });

  it("acknowledges and silences only active project alerts", async () => {
    mocks.findUnique.mockResolvedValue(active);
    const acknowledgedAt = new Date("2026-08-18T12:00:00.000Z");
    const silencedUntil = new Date("2026-08-18T13:00:00.000Z");

    await acknowledgeUploadDiskAlert(active.fingerprint, "admin", "正在处理", acknowledgedAt);
    await silenceUploadDiskAlert(active.fingerprint, silencedUntil);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { fingerprint: active.fingerprint },
      data: {
        acknowledgedBy: "admin",
        acknowledgedAt,
        acknowledgementNote: "正在处理",
      },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { fingerprint: active.fingerprint },
      data: { silencedUntil },
    });

    mocks.findUnique.mockResolvedValue({ ...active, state: "recovered" });
    await expect(acknowledgeUploadDiskAlert(active.fingerprint, "admin"))
      .rejects.toThrow("已恢复");
    await expect(silenceUploadDiskAlert(active.fingerprint, silencedUntil))
      .rejects.toThrow("已恢复");
  });
});
