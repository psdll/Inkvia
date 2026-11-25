import { describe, expect, it } from "vitest";

import { HEALTH_STATES } from "@/lib/monitoring/contracts";
import { readMonitoringConfig } from "@/lib/monitoring/config";

describe("monitoring contracts and configuration", () => {
  it("uses explicit unavailable, unsupported, and stale states", () => {
    expect(HEALTH_STATES).toEqual([
      "healthy",
      "warning",
      "critical",
      "unavailable",
      "unsupported",
      "stale",
    ]);
  });

  it("disables Linux and destructive capabilities in local-light mode", () => {
    const config = readMonitoringConfig({
      NODE_ENV: "development",
      MONITORING_MODE: "local-light",
      MONITORING_LOG_DELETE_ENABLED: "1",
    });

    expect(config.mode).toBe("local-light");
    expect(config.capabilities).toMatchObject({
      metricsHistory: false,
      centralLogs: false,
      distributedTracing: false,
      grafana: false,
      aiCost: true,
      capacityForecast: false,
      deploymentStatus: true,
      serviceControl: false,
      nginxReload: false,
      postgresSlowQueries: true,
      logRotation: false,
      logDeletion: false,
      recoveryConsole: false,
    });
  });

  it("enables log deletion only for an explicit production switch", () => {
    const disabled = readMonitoringConfig({
      NODE_ENV: "production",
      MONITORING_MODE: "production",
    });
    const enabled = readMonitoringConfig({
      NODE_ENV: "production",
      MONITORING_MODE: "production",
      MONITORING_LOG_DELETE_ENABLED: "1",
    });

    expect(disabled.capabilities.logDeletion).toBe(false);
    expect(enabled.capabilities.logDeletion).toBe(true);
  });

  it("enables server events only for an explicit production switch", () => {
    const disabled = readMonitoringConfig({
      NODE_ENV: "production",
      MONITORING_MODE: "production",
    });
    const enabled = readMonitoringConfig({
      NODE_ENV: "production",
      MONITORING_MODE: "production",
      MONITORING_SERVER_EVENTS_ENABLED: "1",
    });
    const local = readMonitoringConfig({
      NODE_ENV: "development",
      MONITORING_MODE: "local-light",
      MONITORING_SERVER_EVENTS_ENABLED: "1",
    });

    expect(disabled.capabilities.serverEvents).toBe(false);
    expect(enabled.capabilities.serverEvents).toBe(true);
    expect(local.capabilities.serverEvents).toBe(false);
  });

  it("uses loopback data-plane defaults and bounded request timeouts", () => {
    const config = readMonitoringConfig({
      NODE_ENV: "production",
      MONITORING_REQUEST_TIMEOUT_MS: "999999",
    });

    expect(config.endpoints).toEqual({
      prometheus: "http://127.0.0.1:9090",
      loki: "http://127.0.0.1:3101",
      tempo: "http://127.0.0.1:3200",
      alertmanager: "http://127.0.0.1:9093",
      grafana: "http://127.0.0.1:3001",
    });
    expect(config.requestTimeoutMs).toBe(10_000);
  });
});
