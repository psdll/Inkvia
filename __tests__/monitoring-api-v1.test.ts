import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  readOpsServerEvents: vi.fn(),
  readUploadDiskSnapshot: vi.fn(),
  reconcileUploadDiskAlert: vi.fn(),
  countActiveUploadDiskAlerts: vi.fn(),
  getUploadDiskMonitorRuntimeState: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("@/lib/monitoring/ops-client", () => ({
  readOpsServerEvents: mocks.readOpsServerEvents,
}));

vi.mock("@/lib/monitoring/upload-disk-snapshot", () => ({
  readUploadDiskSnapshot: mocks.readUploadDiskSnapshot,
}));

vi.mock("@/lib/monitoring/upload-disk-alerts", () => ({
  reconcileUploadDiskAlert: mocks.reconcileUploadDiskAlert,
  countActiveUploadDiskAlerts: mocks.countActiveUploadDiskAlerts,
}));

vi.mock("@/lib/monitoring/upload-disk-monitor", () => ({
  getUploadDiskMonitorRuntimeState: mocks.getUploadDiskMonitorRuntimeState,
}));

import { GET as getCapabilities } from "@/app/api/admin/monitoring/v1/capabilities/route";
import { GET as getOverview } from "@/app/api/admin/monitoring/v1/overview/route";
import { GET as getMetrics } from "@/app/api/admin/monitoring/v1/metrics/route";
import { GET as getLogs } from "@/app/api/admin/monitoring/v1/logs/route";
import { GET as getServerEvents } from "@/app/api/admin/monitoring/v1/server-events/route";
import { GET as getTrace } from "@/app/api/admin/monitoring/v1/traces/[traceId]/route";
import { requireMonitoringPermission } from "@/lib/monitoring/permissions";

function request(path: string) {
  return new Request(`http://localhost${path}`) as any;
}

describe("monitoring API v1", () => {
  beforeEach(() => {
    mocks.requireAdminRequest.mockReset();
    mocks.readOpsServerEvents.mockReset();
    mocks.readUploadDiskSnapshot.mockReset();
    mocks.reconcileUploadDiskAlert.mockReset();
    mocks.countActiveUploadDiskAlerts.mockReset();
    mocks.getUploadDiskMonitorRuntimeState.mockReset();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.readUploadDiskSnapshot.mockResolvedValue({
      state: "warning",
      uploadsRoot: "C:\\data\\uploads",
      inspectedPath: "C:\\data",
      totalBytes: 1_000,
      freeBytes: 214,
      usedBytes: 786,
      usedRatio: 0.786,
      usedPercent: 78.6,
      observedAt: "2026-08-18T10:00:00.000Z",
    });
    mocks.reconcileUploadDiskAlert.mockResolvedValue(undefined);
    mocks.countActiveUploadDiskAlerts.mockResolvedValue(1);
    mocks.getUploadDiskMonitorRuntimeState.mockReturnValue({
      lastSuccessfulSnapshot: null,
      lastSuccessfulAt: null,
      lastPersistenceError: null,
    });
    process.env.MONITORING_MODE = "local-light";
    delete process.env.MONITORING_OPERATOR_USERS;
    delete process.env.MONITORING_SERVER_EVENTS_ENABLED;
  });

  it("returns explicit unsupported server events in local-light mode", async () => {
    const response = await getServerEvents(request(
      "/api/admin/monitoring/v1/server-events?limit=20",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      supported: false,
      events: [],
    });
    expect(mocks.readOpsServerEvents).not.toHaveBeenCalled();
  });

  it("rejects invalid server event ranges before contacting Ops", async () => {
    const response = await getServerEvents(request(
      "/api/admin/monitoring/v1/server-events?limit=501",
    ));

    expect(response.status).toBe(400);
    expect(mocks.readOpsServerEvents).not.toHaveBeenCalled();
  });

  it("requires monitoring.view for server events", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "unauthorized" });

    const response = await getServerEvents(request(
      "/api/admin/monitoring/v1/server-events",
    ));

    expect(response.status).toBe(401);
    expect(mocks.readOpsServerEvents).not.toHaveBeenCalled();
  });

  it("forwards only canonical server event filters in production", async () => {
    const to = Date.now() - 60_000;
    const from = to - 60 * 60 * 1_000;
    process.env.MONITORING_MODE = "production";
    process.env.MONITORING_SERVER_EVENTS_ENABLED = "1";
    mocks.readOpsServerEvents.mockResolvedValue({
      observedAt: new Date(to).toISOString(),
      history: {
        state: "complete",
        availableFrom: new Date(from - 60_000).toISOString(),
        reason: "complete",
      },
      events: [],
    });

    const response = await getServerEvents(request(
      `/api/admin/monitoring/v1/server-events?from=${from}&to=${to}&category=power&severity=warning&state=historical&limit=20`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.readOpsServerEvents).toHaveBeenCalledWith({
      from,
      to,
      category: "power",
      severity: "warning",
      state: "historical",
      limit: 20,
    });
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      supported: true,
      history: { state: "complete" },
      events: [],
    });
  });

  it("requires an authenticated administrator and disables response caching", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "unauthorized" });

    const response = await getCapabilities(request("/api/admin/monitoring/v1/capabilities"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("reports local-light capabilities explicitly", async () => {
    const response = await getCapabilities(request("/api/admin/monitoring/v1/capabilities"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      apiVersion: "v1",
      mode: "local-light",
      capabilities: {
        metricsHistory: false,
        centralLogs: false,
        distributedTracing: false,
        serviceControl: false,
        logDeletion: false,
      },
    });
  });

  it("reserves operational permissions for explicitly configured operators", () => {
    expect(requireMonitoringPermission(
      request("/api/admin/monitoring/v1/services"),
      "monitoring.services.control",
      { NODE_ENV: "test" },
    )).toMatchObject({ ok: false, status: 403 });

    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "ops-admin" });
    expect(requireMonitoringPermission(
      request("/api/admin/monitoring/v1/services"),
      "monitoring.services.control",
      { NODE_ENV: "test", MONITORING_OPERATOR_USERS: "ops-admin" },
    )).toMatchObject({ ok: true, username: "ops-admin" });
  });

  it("returns a stable local overview with freshness metadata", async () => {
    const response = await getOverview(request("/api/admin/monitoring/v1/overview"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      apiVersion: "v1",
      mode: "local-light",
      host: expect.objectContaining({
        hostname: expect.any(String),
        memory: expect.objectContaining({ usedPercent: expect.any(Number) }),
        disk: expect.objectContaining({
          state: "warning",
          usedPercent: 78.6,
          uploadsRoot: "C:\\data\\uploads",
        }),
      }),
      process: expect.objectContaining({
        pid: expect.any(Number),
        rssBytes: expect.any(Number),
      }),
      freshness: expect.objectContaining({
        stale: false,
        ageMs: expect.any(Number),
      }),
      activeAlerts: 1,
      alertPersistenceError: null,
    });
  });

  it("returns live disk evidence when alert persistence is unavailable", async () => {
    mocks.reconcileUploadDiskAlert.mockRejectedValue(new Error("database unavailable"));
    mocks.countActiveUploadDiskAlerts.mockRejectedValue(new Error("database unavailable"));

    const response = await getOverview(request("/api/admin/monitoring/v1/overview"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.host.disk.usedPercent).toBe(78.6);
    expect(payload.activeAlerts).toBe(0);
    expect(payload.alertPersistenceError).toBe("database unavailable");
    expect(payload.warnings).toContain("告警记录保存失败");
  });

  it("rejects arbitrary or unsupported metric queries", async () => {
    const rawQueryResponse = await getMetrics(request(
      "/api/admin/monitoring/v1/metrics?query=up%20or%20vector(1)",
    ));
    const unknownKeyResponse = await getMetrics(request(
      "/api/admin/monitoring/v1/metrics?key=not.allowed",
    ));

    expect(rawQueryResponse.status).toBe(400);
    expect(unknownKeyResponse.status).toBe(400);
  });

  it("recognizes the fixed Web heap metric key without fabricating local history", async () => {
    const response = await getMetrics(request(
      "/api/admin/monitoring/v1/metrics?key=web.heap.percent&from=1722000000&to=1722000060&step=60",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      key: "web.heap.percent",
    });
  });

  it("validates bounded log filters before checking the data plane", async () => {
    const response = await getLogs(request(
      "/api/admin/monitoring/v1/logs?service=web&limit=100000",
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("validates trace IDs before returning unsupported in local-light mode", async () => {
    const invalid = await getTrace(
      request("/api/admin/monitoring/v1/traces/not-a-trace"),
      { params: { traceId: "not-a-trace" } },
    );
    const valid = await getTrace(
      request("/api/admin/monitoring/v1/traces/abcdef0123456789"),
      { params: { traceId: "abcdef0123456789" } },
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      traceId: "abcdef0123456789",
    });
  });
});
