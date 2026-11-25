import { describe, expect, it } from "vitest";

import {
  buildDiagnosticReport,
  buildIssueCard,
  normalizeAlertmanagerAlerts,
  normalizeProjectUploadDiskAlert,
  redactMonitoringText,
  validateSilenceEnd,
} from "@/lib/monitoring/fault-guidance";
import {
  createLogExportToken,
  verifyLogExportToken,
} from "@/lib/monitoring/log-export";

describe("monitoring logs, alerts, and guidance", () => {
  it("redacts credentials, tokens, cookies, SQL literals, and private paths", () => {
    const redacted = redactMonitoringText(
      "authorization=Bearer secret-token apiKey=sk-secret password=hunter2 "
      + "cookie=session-secret path=/home/ops/private/a.log "
      + "sql=select * from users where email='private@example.com'",
    );

    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("sk-secret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("session-secret");
    expect(redacted).not.toContain("/home/ops/private");
    expect(redacted).not.toContain("private@example.com");
    expect(redacted).toContain("[REDACTED]");
  });

  it("creates short-lived signed log export tokens and rejects expiry or tampering", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    const token = createLogExportToken({
      filter: { service: "web", level: "error", limit: 500, direction: "backward" },
      fromMs: now.getTime() - 60_000,
      toMs: now.getTime(),
    }, "test-secret-that-is-long-enough", now);

    expect(verifyLogExportToken(token, "test-secret-that-is-long-enough", new Date(now.getTime() + 4 * 60_000)))
      .toMatchObject({ filter: { service: "web", level: "error" } });
    expect(() => verifyLogExportToken(
      token,
      "test-secret-that-is-long-enough",
      new Date(now.getTime() + 6 * 60_000),
    )).toThrow("已过期");
    expect(() => verifyLogExportToken(
      `${token.slice(0, -1)}x`,
      "test-secret-that-is-long-enough",
      now,
    )).toThrow("无效");
  });

  it("normalizes Alertmanager output and merges acknowledgement audit fields", () => {
    const alerts = normalizeAlertmanagerAlerts([{
      fingerprint: "abcdef0123456789",
      labels: {
        alertname: "WebHighErrorRate",
        severity: "critical",
        service: "web",
        secret: "must-not-leak",
      },
      annotations: {
        summary: "Web 5xx 比例过高",
        description: "authorization=Bearer secret-token",
      },
      startsAt: "2026-07-28T00:00:00.000Z",
      endsAt: "2026-07-28T02:00:00.000Z",
      updatedAt: "2026-07-28T01:00:00.000Z",
      status: { state: "active", silencedBy: [], inhibitedBy: [], mutedBy: [] },
    }], {
      abcdef0123456789: {
        by: "ops-admin",
        at: "2026-07-28T01:05:00.000Z",
        note: "正在处理",
      },
    }, new Date("2026-07-28T01:10:00.000Z"));

    expect(alerts).toEqual([expect.objectContaining({
      fingerprint: "abcdef0123456789",
      name: "WebHighErrorRate",
      severity: "critical",
      state: "acknowledged",
      acknowledgedBy: "ops-admin",
      acknowledgedAt: "2026-07-28T01:05:00.000Z",
      labels: {
        alertname: "WebHighErrorRate",
        severity: "critical",
        service: "web",
      },
    })]);
    expect(JSON.stringify(alerts)).not.toContain("must-not-leak");
    expect(JSON.stringify(alerts)).not.toContain("secret-token");
  });

  it("shows a new firing episode even when the same fingerprint was previously acknowledged", () => {
    const alert = {
      fingerprint: "abcdef0123456789",
      labels: { alertname: "CanvasProjectionMismatch" },
      startsAt: "2026-10-13T09:00:00.000Z",
      endsAt: "2026-10-13T11:00:00.000Z",
      status: { state: "active", silencedBy: [] },
    };
    const [normalized] = normalizeAlertmanagerAlerts([alert], {
      abcdef0123456789: { by: "admin", at: "2026-10-12T10:00:00.000Z" },
    }, new Date("2026-10-13T10:00:00.000Z"));
    expect(normalized.state).toBe("firing");
    expect(normalized.acknowledgedAt).toBeUndefined();
  });

  it("normalizes recovered project disk alerts with retention evidence", () => {
    const alert = normalizeProjectUploadDiskAlert({
      fingerprint: "b".repeat(64),
      state: "recovered",
      severity: "critical",
      component: "upload-storage",
      summary: "上传磁盘空间严重不足",
      description: "磁盘使用率曾达到 86%",
      currentPercent: 69,
      peakPercent: 86,
      warningPercent: 70,
      criticalPercent: 85,
      resourcePath: "C:/uploads",
      startsAt: new Date("2026-08-18T10:00:00.000Z"),
      lastObservedAt: new Date("2026-08-18T11:00:00.000Z"),
      recoveredAt: new Date("2026-08-18T11:00:00.000Z"),
      expiresAt: new Date("2026-09-17T11:00:00.000Z"),
      acknowledgedBy: null,
      acknowledgedAt: null,
      acknowledgementNote: null,
      silencedUntil: null,
      updatedAt: new Date("2026-08-18T11:00:00.000Z"),
    }, new Date("2026-08-18T12:00:00.000Z"));

    expect(alert).toMatchObject({
      source: "project",
      state: "recovered",
      startsAt: "2026-08-18T10:00:00.000Z",
      recoveredAt: "2026-08-18T11:00:00.000Z",
      expiresAt: "2026-09-17T11:00:00.000Z",
      observedPercent: 69,
      peakPercent: 86,
      warningPercent: 70,
      criticalPercent: 85,
      supportsAcknowledge: false,
      supportsSilence: false,
    });
  });

  it("accepts only future silence windows no longer than 24 hours", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    expect(validateSilenceEnd("2026-07-28T02:00:00.000Z", now))
      .toBe("2026-07-28T02:00:00.000Z");
    expect(() => validateSilenceEnd("2026-07-28T00:59:00.000Z", now)).toThrow("晚于当前时间");
    expect(() => validateSilenceEnd("2026-07-30T02:00:00.000Z", now)).toThrow("24 小时");
  });

  it("builds closed, static fault guidance with allowlisted safe actions", () => {
    const issue = buildIssueCard({
      kind: "worker.queue",
      severity: "critical",
      summary: "生成队列持续堆积",
      traceId: "abcdef0123456789",
    });

    expect(issue).toMatchObject({
      domain: "项目",
      component: "Canvas Generation Worker",
      logFilter: { service: "generation-worker", level: "error" },
      traceId: "abcdef0123456789",
    });
    expect(issue.guidance.length).toBeGreaterThan(1);
    expect(issue.safeActions).toEqual(["open_logs", "open_trace", "restart_generation_worker"]);
    const serialized = JSON.stringify(issue);
    expect(serialized).not.toMatch(/\bsudo\b|\bsystemctl\b|\bSELECT\b|\bDELETE\b/i);
    expect(serialized).not.toContain("AI 生成");
  });

  it("bounds and redacts diagnostic report evidence", () => {
    const report = buildDiagnosticReport({
      createdAt: new Date("2026-07-28T01:00:00.000Z"),
      overview: { state: "warning", warnings: ["password=hunter2"] },
      alerts: Array.from({ length: 250 }, (_, index) => ({
        fingerprint: String(index),
        summary: `alert ${index} apiKey=secret-${index}`,
      })),
      logs: Array.from({ length: 2_000 }, (_, index) => ({
        timestamp: index,
        line: `line ${index} Bearer token-${index}`,
      })),
    });

    expect(report.alerts).toHaveLength(100);
    expect(report.logs).toHaveLength(1_000);
    expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(JSON.stringify(report)).not.toContain("hunter2");
    expect(JSON.stringify(report)).not.toContain("secret-");
    expect(JSON.stringify(report)).not.toContain("token-");
  });
});
