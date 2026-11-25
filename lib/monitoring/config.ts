import type { MonitoringCapabilities, MonitoringMode } from "@/lib/monitoring/contracts";

type MonitoringEnvironment = Record<string, string | undefined>;

export type MonitoringConfig = {
  mode: MonitoringMode;
  requestTimeoutMs: number;
  capabilities: MonitoringCapabilities;
  endpoints: {
    prometheus: string;
    loki: string;
    tempo: string;
    alertmanager: string;
    grafana: string;
  };
};

function monitoringMode(env: MonitoringEnvironment): MonitoringMode {
  const configured = String(env.MONITORING_MODE || "").trim().toLowerCase();
  if (configured === "local-light" || configured === "local-full" || configured === "production") {
    return configured;
  }
  return env.NODE_ENV === "production" ? "production" : "local-light";
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function endpoint(raw: string | undefined, fallback: string) {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    if (parsed.username || parsed.password) return fallback;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function capabilities(mode: MonitoringMode, env: MonitoringEnvironment): MonitoringCapabilities {
  const hasDataPlane = mode !== "local-light";
  const production = mode === "production";
  return {
    metricsHistory: hasDataPlane,
    centralLogs: hasDataPlane,
    distributedTracing: hasDataPlane,
    grafana: hasDataPlane,
    aiCost: true,
    capacityForecast: hasDataPlane,
    deploymentStatus: true,
    serviceControl: production,
    nginxReload: production,
    postgresSlowQueries: true,
    logRotation: production,
    logDeletion: production && String(env.MONITORING_LOG_DELETE_ENABLED || "").trim() === "1",
    recoveryConsole: production,
    serverEvents: production
      && String(env.MONITORING_SERVER_EVENTS_ENABLED || "").trim() === "1",
  };
}

export function readMonitoringConfig(env: MonitoringEnvironment = process.env): MonitoringConfig {
  const mode = monitoringMode(env);
  return {
    mode,
    requestTimeoutMs: boundedInteger(env.MONITORING_REQUEST_TIMEOUT_MS, 3_000, 500, 10_000),
    capabilities: capabilities(mode, env),
    endpoints: {
      prometheus: endpoint(env.MONITORING_PROMETHEUS_URL, "http://127.0.0.1:9090"),
      loki: endpoint(env.MONITORING_LOKI_URL, "http://127.0.0.1:3101"),
      tempo: endpoint(env.MONITORING_TEMPO_URL, "http://127.0.0.1:3200"),
      alertmanager: endpoint(env.MONITORING_ALERTMANAGER_URL, "http://127.0.0.1:9093"),
      grafana: endpoint(env.MONITORING_GRAFANA_URL, "http://127.0.0.1:3001"),
    },
  };
}
