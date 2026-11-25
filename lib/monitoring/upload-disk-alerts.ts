import { createHash } from "node:crypto";
import os from "node:os";

import prisma from "@/lib/prisma";
import type {
  AvailableUploadDiskSnapshot,
  UploadDiskSnapshot,
} from "@/lib/monitoring/upload-disk-snapshot";

export const UPLOAD_DISK_ALERT_KIND = "upload-disk-watermark";
export const RECOVERED_ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type ActiveUploadDiskAlert = {
  fingerprint: string;
  peakPercent: number;
  startsAt: Date;
};

export type UploadDiskAlertTransition =
  | { type: "none" }
  | { type: "create"; severity: "warning" | "critical" }
  | { type: "update"; severity: "warning" | "critical"; peakPercent: number }
  | { type: "recover"; recoveredAt: Date; expiresAt: Date };

export function uploadDiskResourceKey(snapshot: UploadDiskSnapshot) {
  return createHash("sha256")
    .update(`${os.hostname()}\0${snapshot.inspectedPath}\0${snapshot.uploadsRoot}`)
    .digest("hex");
}

function alertFingerprint(resourceKey: string, startsAt: Date) {
  return createHash("sha256")
    .update(`${UPLOAD_DISK_ALERT_KIND}\0${resourceKey}\0${startsAt.toISOString()}`)
    .digest("hex");
}

function severityFor(snapshot: AvailableUploadDiskSnapshot) {
  return snapshot.state === "critical" ? "critical" as const : "warning" as const;
}

function alertCopy(snapshot: AvailableUploadDiskSnapshot) {
  if (snapshot.state === "critical") {
    return {
      summary: "上传磁盘空间严重不足",
      description: `磁盘使用率为 ${snapshot.usedPercent.toFixed(1)}%，大文件上传可能被阻止。`,
    };
  }
  return {
    summary: "上传磁盘空间需要关注",
    description: `磁盘使用率为 ${snapshot.usedPercent.toFixed(1)}%，正在接近大文件上传限制。`,
  };
}

export function decideUploadDiskAlertTransition(input: {
  snapshot: UploadDiskSnapshot;
  active: ActiveUploadDiskAlert | null;
  now: Date;
}): UploadDiskAlertTransition {
  if (input.snapshot.state === "unavailable") return { type: "none" };
  if (input.snapshot.state === "healthy") {
    if (!input.active) return { type: "none" };
    return {
      type: "recover",
      recoveredAt: input.now,
      expiresAt: new Date(input.now.getTime() + RECOVERED_ALERT_RETENTION_MS),
    };
  }

  const severity = severityFor(input.snapshot);
  if (!input.active) return { type: "create", severity };
  return {
    type: "update",
    severity,
    peakPercent: Math.max(input.active.peakPercent, input.snapshot.usedPercent),
  };
}

async function updateActiveAlert(
  active: ActiveUploadDiskAlert,
  snapshot: AvailableUploadDiskSnapshot,
  now: Date,
) {
  const transition = decideUploadDiskAlertTransition({ snapshot, active, now });
  if (transition.type === "recover" || transition.type === "none" || transition.type === "create") {
    return null;
  }
  const copy = alertCopy(snapshot);
  return prisma.monitoringAlertRecord.update({
    where: { fingerprint: active.fingerprint },
    data: {
      state: "firing",
      severity: transition.severity,
      summary: copy.summary,
      description: copy.description,
      currentPercent: snapshot.usedPercent,
      peakPercent: transition.peakPercent,
      resourcePath: snapshot.uploadsRoot,
      totalBytes: BigInt(snapshot.totalBytes),
      freeBytes: BigInt(snapshot.freeBytes),
      lastObservedAt: now,
    },
  });
}

export async function reconcileUploadDiskAlert(
  snapshot: UploadDiskSnapshot,
  now = new Date(),
) {
  if (snapshot.state === "unavailable") return null;

  const resourceKey = uploadDiskResourceKey(snapshot);
  const active = await prisma.monitoringAlertRecord.findUnique({
    where: { activeKey: resourceKey },
  });
  const transition = decideUploadDiskAlertTransition({ snapshot, active, now });

  if (transition.type === "none") return active;
  if (transition.type === "recover") {
    return prisma.monitoringAlertRecord.update({
      where: { fingerprint: active!.fingerprint },
      data: {
        activeKey: null,
        state: "recovered",
        currentPercent: snapshot.usedPercent,
        resourcePath: snapshot.uploadsRoot,
        totalBytes: BigInt(snapshot.totalBytes),
        freeBytes: BigInt(snapshot.freeBytes),
        lastObservedAt: now,
        recoveredAt: transition.recoveredAt,
        expiresAt: transition.expiresAt,
      },
    });
  }
  if (transition.type === "update") {
    return updateActiveAlert(active!, snapshot, now);
  }

  const copy = alertCopy(snapshot);
  const fingerprint = alertFingerprint(resourceKey, now);
  try {
    return await prisma.monitoringAlertRecord.create({
      data: {
        fingerprint,
        activeKey: resourceKey,
        source: "project",
        kind: UPLOAD_DISK_ALERT_KIND,
        resourceKey,
        component: "upload-storage",
        state: "firing",
        severity: transition.severity,
        summary: copy.summary,
        description: copy.description,
        currentPercent: snapshot.usedPercent,
        peakPercent: snapshot.usedPercent,
        warningPercent: 70,
        criticalPercent: 85,
        resourcePath: snapshot.uploadsRoot,
        totalBytes: BigInt(snapshot.totalBytes),
        freeBytes: BigInt(snapshot.freeBytes),
        startsAt: now,
        lastObservedAt: now,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const concurrent = await prisma.monitoringAlertRecord.findUnique({
      where: { activeKey: resourceKey },
    });
    if (!concurrent) throw error;
    return updateActiveAlert(concurrent, snapshot, now);
  }
}

export async function countActiveUploadDiskAlerts(_now = new Date()) {
  return prisma.monitoringAlertRecord.count({
    where: { state: "firing", activeKey: { not: null } },
  });
}

export async function listUploadDiskAlerts(now = new Date()) {
  return prisma.monitoringAlertRecord.findMany({
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
}

export async function findUploadDiskAlertByFingerprint(fingerprint: string) {
  return prisma.monitoringAlertRecord.findUnique({ where: { fingerprint } });
}

async function requireActiveUploadDiskAlert(fingerprint: string) {
  const alert = await findUploadDiskAlertByFingerprint(fingerprint);
  if (!alert) throw new Error("项目告警不存在");
  if (alert.state === "recovered") throw new Error("项目告警已恢复，不能再执行此操作");
  return alert;
}

export async function acknowledgeUploadDiskAlert(
  fingerprint: string,
  by: string,
  note?: string,
  at = new Date(),
) {
  await requireActiveUploadDiskAlert(fingerprint);
  return prisma.monitoringAlertRecord.update({
    where: { fingerprint },
    data: {
      acknowledgedBy: String(by || "admin").slice(0, 120),
      acknowledgedAt: at,
      acknowledgementNote: String(note || "").trim().slice(0, 500) || null,
    },
  });
}

export async function silenceUploadDiskAlert(fingerprint: string, endsAt: Date) {
  await requireActiveUploadDiskAlert(fingerprint);
  return prisma.monitoringAlertRecord.update({
    where: { fingerprint },
    data: { silencedUntil: endsAt },
  });
}

export async function pruneExpiredUploadDiskAlerts(now = new Date()) {
  const result = await prisma.monitoringAlertRecord.deleteMany({
    where: { state: "recovered", expiresAt: { lte: now } },
  });
  return result.count;
}
