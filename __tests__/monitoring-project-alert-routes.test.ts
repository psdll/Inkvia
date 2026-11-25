import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  logAdminAction: vi.fn(),
  readMonitoringConfig: vi.fn(),
  listProjectAlerts: vi.fn(),
  findProjectAlert: vi.fn(),
  acknowledgeProjectAlert: vi.fn(),
  silenceProjectAlert: vi.fn(),
  listAlertmanagerAlerts: vi.fn(),
  createAlertmanagerSilence: vi.fn(),
  readAlertAcknowledgements: vi.fn(),
  acknowledgeAlert: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/admin-audit", () => ({ logAdminAction: mocks.logAdminAction }));
vi.mock("@/lib/monitoring/config", () => ({ readMonitoringConfig: mocks.readMonitoringConfig }));
vi.mock("@/lib/monitoring/upload-disk-alerts", () => ({
  listUploadDiskAlerts: mocks.listProjectAlerts,
  findUploadDiskAlertByFingerprint: mocks.findProjectAlert,
  acknowledgeUploadDiskAlert: mocks.acknowledgeProjectAlert,
  silenceUploadDiskAlert: mocks.silenceProjectAlert,
}));
vi.mock("@/lib/monitoring/alertmanager-client", () => ({
  listAlertmanagerAlerts: mocks.listAlertmanagerAlerts,
  createAlertmanagerSilence: mocks.createAlertmanagerSilence,
}));
vi.mock("@/lib/monitoring/alert-state", async () => {
  const actual = await vi.importActual<any>("@/lib/monitoring/alert-state");
  return {
    ...actual,
    readAlertAcknowledgements: mocks.readAlertAcknowledgements,
    acknowledgeAlert: mocks.acknowledgeAlert,
  };
});

import { GET as getAlerts } from "@/app/api/admin/monitoring/v1/alerts/route";
import { POST as acknowledgeAlertRoute } from "@/app/api/admin/monitoring/v1/alerts/acknowledge/route";
import { POST as silenceAlertRoute } from "@/app/api/admin/monitoring/v1/alerts/silence/route";

const fingerprint = "b".repeat(64);
const projectRecord = {
  fingerprint,
  state: "firing",
  acknowledgedAt: null,
  silencedUntil: null,
};
const normalizedProjectAlert = {
  fingerprint,
  source: "project",
  state: "firing",
  summary: "上传磁盘空间需要关注",
};

function config(mode: "local-light" | "production") {
  return {
    mode,
    requestTimeoutMs: 2_000,
    endpoints: { alertmanager: "http://127.0.0.1:9093" },
  };
}

function getRequest(path: string) {
  return new Request(`http://localhost${path}`) as any;
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

describe("project monitoring alert routes", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONITORING_OPERATOR_USERS = "admin";
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.readMonitoringConfig.mockReturnValue(config("local-light"));
    mocks.listProjectAlerts.mockResolvedValue([normalizedProjectAlert]);
    mocks.findProjectAlert.mockResolvedValue(null);
    mocks.readAlertAcknowledgements.mockResolvedValue({});
    mocks.logAdminAction.mockResolvedValue(undefined);
  });

  it("returns project alerts in local-light mode", async () => {
    const response = await getAlerts(getRequest("/api/admin/monitoring/v1/alerts"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      supported: true,
      externalState: "unsupported",
      alerts: [normalizedProjectAlert],
    });
    expect(mocks.listAlertmanagerAlerts).not.toHaveBeenCalled();
  });

  it("keeps project alerts when Alertmanager is unavailable", async () => {
    mocks.readMonitoringConfig.mockReturnValue(config("production"));
    mocks.listAlertmanagerAlerts.mockRejectedValue(new Error("Alertmanager offline"));

    const response = await getAlerts(getRequest("/api/admin/monitoring/v1/alerts"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      supported: true,
      externalState: "unavailable",
      externalError: "Alertmanager offline",
      alerts: [normalizedProjectAlert],
    });
  });

  it("acknowledges an active project alert and preserves the audit event", async () => {
    mocks.findProjectAlert.mockResolvedValue(projectRecord);
    mocks.acknowledgeProjectAlert.mockResolvedValue({
      ...projectRecord,
      acknowledgedBy: "admin",
      acknowledgedAt: new Date("2026-08-18T12:00:00.000Z"),
      acknowledgementNote: "正在清理",
    });

    const response = await acknowledgeAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/acknowledge",
      { fingerprint, note: "正在清理" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.acknowledgeProjectAlert).toHaveBeenCalledWith(
      fingerprint,
      "admin",
      "正在清理",
    );
    expect(mocks.acknowledgeAlert).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).toHaveBeenCalledOnce();
  });

  it("rejects project silence windows longer than 24 hours", async () => {
    mocks.findProjectAlert.mockResolvedValue(projectRecord);
    const response = await silenceAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/silence",
      { fingerprint, endsAt: new Date(Date.now() + 25 * 60 * 60 * 1_000).toISOString() },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("24 小时") });
    expect(mocks.silenceProjectAlert).not.toHaveBeenCalled();
  });

  it("falls back to existing acknowledgement storage for a non-project alert", async () => {
    mocks.acknowledgeAlert.mockResolvedValue({
      by: "admin",
      at: "2026-08-18T12:00:00.000Z",
    });

    const response = await acknowledgeAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/acknowledge",
      { fingerprint: "abcdef0123456789" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.acknowledgeAlert).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeProjectAlert).not.toHaveBeenCalled();
  });

  it("rejects actions on recovered project alerts", async () => {
    mocks.findProjectAlert.mockResolvedValue({ ...projectRecord, state: "recovered" });

    const response = await acknowledgeAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/acknowledge",
      { fingerprint },
    ));

    expect(response.status).toBe(409);
    expect(mocks.acknowledgeProjectAlert).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
    { host: "app.example.test", origin: "https://app.example.test", "x-forwarded-proto": "https" },
  ])("accepts browser-origin alert actions behind the application host: $origin", async (headers) => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.readMonitoringConfig.mockReturnValue(config("production"));
    mocks.acknowledgeAlert.mockResolvedValue({ by: "admin", at: new Date().toISOString() });
    mocks.listAlertmanagerAlerts.mockResolvedValue([{ fingerprint, labels: { alertname: "CanvasProjectionMismatch" } }]);
    mocks.createAlertmanagerSilence.mockResolvedValue({ silenceId: "test-silence-id" });

    const acknowledgement = await acknowledgeAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/acknowledge", { fingerprint }, headers,
    ));
    const silence = await silenceAlertRoute(postRequest(
      "/api/admin/monitoring/v1/alerts/silence",
      { fingerprint, endsAt: new Date(Date.now() + 60 * 60_000).toISOString() }, headers,
    ));

    expect(acknowledgement.status).toBe(200);
    expect(silence.status).toBe(200);
    expect(mocks.acknowledgeAlert).toHaveBeenCalledOnce();
    expect(mocks.createAlertmanagerSilence).toHaveBeenCalledOnce();
    expect(mocks.logAdminAction).toHaveBeenCalledTimes(2);
  });

  it.each<Record<string, string>>([
    { host: "app.example.test", origin: "https://attacker.test", "x-forwarded-host": "attacker.test" },
    { host: "localhost", origin: "http://localhost", "sec-fetch-site": "cross-site" },
    { host: "localhost:3100", origin: "http://localhost:3101" },
  ])("rejects unsafe origins before performing either alert action: $origin", async (headers) => {
    for (const [action, route] of [["acknowledge", acknowledgeAlertRoute], ["silence", silenceAlertRoute]] as const) {
      const response = await route(postRequest(`/api/admin/monitoring/v1/alerts/${action}`, { fingerprint }, headers));
      expect(response.status).toBe(403);
    }
    expect(mocks.findProjectAlert).not.toHaveBeenCalled();
    expect(mocks.acknowledgeAlert).not.toHaveBeenCalled();
    expect(mocks.createAlertmanagerSilence).not.toHaveBeenCalled();
  });

  it("still rejects missing origins in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const route of [acknowledgeAlertRoute, silenceAlertRoute]) {
      const response = await route(postRequest("/api/admin/monitoring/v1/alerts/action", { fingerprint }));
      expect(response.status).toBe(403);
    }
    expect(mocks.findProjectAlert).not.toHaveBeenCalled();
  });
});
