import { describe, expect, it } from "vitest";

import type {
  MonitoringCapabilities,
  ServerEvent,
  ServiceStatus,
} from "@/lib/monitoring/contracts";
import {
  buildMonitoringOverviewModel,
  buildMonitoringStatusModel,
} from "@/lib/monitoring/overview-view-model";

const NO_CAPABILITIES: MonitoringCapabilities = {
  metricsHistory: false,
  centralLogs: false,
  distributedTracing: false,
  grafana: false,
  aiCost: false,
  capacityForecast: false,
  deploymentStatus: false,
  serviceControl: false,
  nginxReload: false,
  postgresSlowQueries: false,
  logRotation: false,
  logDeletion: false,
  recoveryConsole: false,
  serverEvents: false,
};

function service(id: ServiceStatus["id"], state: ServiceStatus["state"]): ServiceStatus {
  return {
    id,
    state,
    name: id,
    controllable: false,
    updatedAt: "2026-08-12T10:00:00.000Z",
  };
}

const HEALTHY_SERVICES: ServiceStatus[] = [
  service("web", "healthy"),
  service("nginx", "healthy"),
  service("generation-worker", "healthy"),
  service("media-worker", "healthy"),
  service("live-video-prompt-worker", "healthy"),
  service("live-video-video-worker", "healthy"),
  service("postgresql", "healthy"),
];

function serverEvent(
  state: ServerEvent["state"],
  severity: ServerEvent["severity"],
): ServerEvent {
  return {
    id: "a".repeat(64),
    occurredAt: "2026-08-12T09:00:00.000Z",
    category: "power",
    severity,
    state,
    title: "服务器疑似异常关机",
    summary: "缺少正常关机记录",
    impact: "服务曾短暂不可用",
    evidence: [],
  };
}

describe("monitoring overview view model", () => {
  it("creates a specific disk issue and removes it after recovery", () => {
    const baseInput = {
      mode: "local-light" as const,
      services: [service("web", "healthy")],
      hostState: "healthy" as const,
      serverEvents: [],
    };
    const warning = buildMonitoringStatusModel({
      ...baseInput,
      disk: { state: "warning" as const, usedPercent: 78.6 },
    });
    expect(warning.issues).toContainEqual(expect.objectContaining({
      id: "upload-disk-watermark",
      title: "上传磁盘空间需要关注",
      severity: "warning",
      target: "resources",
    }));

    const recovered = buildMonitoringStatusModel({
      ...baseInput,
      disk: { state: "healthy" as const, usedPercent: 69 },
    });
    expect(recovered.issues.some((issue) => issue.id === "upload-disk-watermark")).toBe(false);
  });

  it("does not call an unreadable upload disk healthy", () => {
    const model = buildMonitoringStatusModel({
      mode: "local-light",
      services: [service("web", "healthy")],
      hostState: "healthy",
      serverEvents: [],
      disk: { state: "unavailable", usedPercent: null, error: "EPERM" },
    });

    expect(model.overallState).toBe("unknown");
    expect(model.issues).toContainEqual(expect.objectContaining({
      id: "upload-disk-read",
      severity: "unknown",
    }));
  });

  it("keeps healthy business status separate from unconfigured diagnostics", () => {
    const model = buildMonitoringOverviewModel(HEALTHY_SERVICES, NO_CAPABILITIES);

    expect(model.overallState).toBe("healthy");
    expect(model.headline).toBe("核心功能运行正常");
    expect(model.areas).toHaveLength(4);
    expect(model.areas.every((area) => area.state === "healthy")).toBe(true);
    expect(model.coverage.every((item) => item.configured === false)).toBe(true);
  });

  it("returns unknown when no business evidence is available", () => {
    const model = buildMonitoringOverviewModel([], NO_CAPABILITIES);

    expect(model.overallState).toBe("unknown");
    expect(model.headline).toBe("当前无法完整判断");
    expect(model.areas.every((area) => area.state === "unsupported")).toBe(true);
  });

  it("does not call a business group healthy when only some required services have evidence", () => {
    const model = buildMonitoringOverviewModel([
      service("web", "healthy"),
      service("nginx", "unsupported"),
    ], NO_CAPABILITIES);

    expect(model.areas.find((area) => area.id === "web")?.state).toBe("unsupported");
    expect(model.areas.find((area) => area.id === "web")?.hasPartialEvidence).toBe(true);
    expect(model.overallState).toBe("unknown");
  });

  it("prioritizes critical business impact over warnings", () => {
    const model = buildMonitoringOverviewModel([
      ...HEALTHY_SERVICES.filter((item) => item.id !== "generation-worker" && item.id !== "postgresql"),
      service("generation-worker", "warning"),
      service("postgresql", "unavailable"),
    ], NO_CAPABILITIES);

    expect(model.overallState).toBe("critical");
    expect(model.headline).toBe("检测到严重异常");
    expect(model.counts.critical).toBe(1);
    expect(model.counts.warning).toBe(1);
  });

  it("reports warning when a business group is stale or warning", () => {
    const model = buildMonitoringOverviewModel([
      ...HEALTHY_SERVICES.filter((item) => item.id !== "media-worker"),
      service("media-worker", "stale"),
    ], NO_CAPABILITIES);

    expect(model.overallState).toBe("warning");
    expect(model.headline).toBe("部分功能需要关注");
  });

  it("requires every service in a business area to be fresh and healthy", () => {
    const services = HEALTHY_SERVICES.map((item) => (
      item.id === "nginx" ? { ...item, state: "stale" as const } : item
    ));
    const model = buildMonitoringStatusModel({
      mode: "production",
      services,
      hostState: "healthy",
      serverEvents: [],
    });

    expect(model.areas.find((area) => area.id === "web")?.state).toBe("unknown");
  });

  it("does not render four unknown areas in local-light mode", () => {
    const model = buildMonitoringStatusModel({
      mode: "local-light",
      services: [service("web", "healthy")],
      hostState: "healthy",
      serverEvents: [],
    });

    expect(model.kind).toBe("local-light");
    expect(model.areas).toEqual([]);
    expect(model.headline).toBe("管理后台进程正在运行");
  });

  it("does not call local-light healthy when the detected Web process is critical", () => {
    const model = buildMonitoringStatusModel({
      mode: "local-light",
      services: [service("web", "critical")],
      hostState: "healthy",
      serverEvents: [],
    });

    expect(model.overallState).toBe("critical");
    expect(model.headline).toBe("管理后台进程出现异常");
    expect(model.issues).toContainEqual(expect.objectContaining({ target: "services" }));
  });

  it("does not call local-light healthy when current host evidence is unavailable", () => {
    const model = buildMonitoringStatusModel({
      mode: "local-light",
      services: [service("web", "healthy")],
      hostState: "unavailable",
      serverEvents: [],
    });

    expect(model.overallState).toBe("unknown");
    expect(model.issues).toContainEqual(expect.objectContaining({ target: "resources" }));
  });

  it("does not duplicate every unknown area when the core data source failed", () => {
    const model = buildMonitoringStatusModel({
      mode: "production",
      services: [],
      hostState: "stale",
      serverEvents: [],
      coreError: "监控核心数据请求超时",
    });

    expect(model.issues).toEqual([expect.objectContaining({ id: "core-data-read" })]);
  });

  it("puts only active warning or critical server events in issues", () => {
    const model = buildMonitoringStatusModel({
      mode: "production",
      services: HEALTHY_SERVICES,
      hostState: "healthy",
      serverEvents: [
        serverEvent("active", "critical"),
        { ...serverEvent("recovered", "critical"), id: "b".repeat(64) },
        { ...serverEvent("historical", "warning"), id: "c".repeat(64) },
        { ...serverEvent("active", "info"), id: "d".repeat(64) },
      ],
    });

    expect(model.issues.filter((issue) => issue.target === "server-events")).toHaveLength(1);
  });

  it("keeps a server-event read error separate from proven service state", () => {
    const model = buildMonitoringStatusModel({
      mode: "production",
      services: HEALTHY_SERVICES,
      hostState: "healthy",
      serverEvents: [],
      serverEventsError: "服务器事件暂时无法读取",
    });

    expect(model.areas.every((area) => area.state === "healthy")).toBe(true);
    expect(model.issues).toContainEqual(expect.objectContaining({
      id: "server-events-read",
      target: "server-events",
    }));
  });

  it("labels incomplete server-event history without calling it a read failure", () => {
    const model = buildMonitoringStatusModel({
      mode: "production",
      services: HEALTHY_SERVICES,
      hostState: "healthy",
      serverEvents: [],
      serverEventsHistoryMessage: "服务器目前只有本次启动记录",
    });

    expect(model.issues).toContainEqual(expect.objectContaining({
      id: "server-events-history",
      title: "服务器事件历史记录不完整",
      target: "server-events",
    }));
    expect(model.issues).not.toContainEqual(expect.objectContaining({ id: "server-events-read" }));
  });
});
