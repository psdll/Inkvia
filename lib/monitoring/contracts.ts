import type { UploadDiskSnapshot } from "@/lib/monitoring/upload-disk-snapshot";

export const HEALTH_STATES = [
  "healthy",
  "warning",
  "critical",
  "unavailable",
  "unsupported",
  "stale",
] as const;

export type HealthState = (typeof HEALTH_STATES)[number];
export type MonitoringMode = "local-light" | "local-full" | "production";

export type Freshness = {
  observedAt: string;
  checkedAt: string;
  ageMs: number;
  staleAfterMs: number;
  stale: boolean;
};

export type MonitoringCapabilities = {
  metricsHistory: boolean;
  centralLogs: boolean;
  distributedTracing: boolean;
  grafana: boolean;
  aiCost: boolean;
  capacityForecast: boolean;
  deploymentStatus: boolean;
  serviceControl: boolean;
  nginxReload: boolean;
  postgresSlowQueries: boolean;
  logRotation: boolean;
  logDeletion: boolean;
  recoveryConsole: boolean;
  serverEvents: boolean;
};

export type MonitoringServiceId =
  | "web"
  | "generation-worker"
  | "media-worker"
  | "live-video-prompt-worker"
  | "live-video-video-worker"
  | "nginx"
  | "postgresql"
  | "prometheus"
  | "loki"
  | "tempo"
  | "grafana"
  | "alloy"
  | "alertmanager"
  | "postgres-exporter"
  | "ops";

export type ServiceStatus = {
  id: MonitoringServiceId;
  name: string;
  state: HealthState;
  controllable: boolean;
  updatedAt: string;
  message?: string;
  uptimeSeconds?: number | null;
  pid?: number | null;
};

export type ServerEventCategory = "power" | "filesystem" | "kernel" | "memory" | "service";
export type ServerEventSeverity = "info" | "warning" | "critical";
export type ServerEventState = "active" | "recovered" | "historical";

export type ServerEvent = {
  id: string;
  occurredAt: string;
  category: ServerEventCategory;
  severity: ServerEventSeverity;
  state: ServerEventState;
  title: string;
  summary: string;
  impact: string;
  affectedService?: MonitoringServiceId;
  recoveryObservedAt?: string;
  evidence: Array<{ label: string; value: string }>;
};

export type HostMemorySnapshot = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  availableBytes?: number;
  cachedBytes?: number;
};

export type LocalMonitoringSnapshot = {
  collectedAt: string;
  host: {
    state: HealthState;
    hostname: string;
    platform: NodeJS.Platform;
    arch: string;
    logicalCores: number;
    loadAverage: [number, number, number];
    memory: HostMemorySnapshot;
  };
  process: {
    state: HealthState;
    pid: number;
    uptimeSeconds: number;
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    heapLimitBytes: number;
  };
  services: ServiceStatus[];
};

export type MonitoringHostSnapshot = LocalMonitoringSnapshot["host"] & {
  disk: UploadDiskSnapshot;
};

export type MonitoringOverview = {
  apiVersion: "v1";
  mode: MonitoringMode;
  state: HealthState;
  collectedAt: string;
  freshness: Freshness;
  host: MonitoringHostSnapshot | null;
  process: LocalMonitoringSnapshot["process"] | null;
  services: ServiceStatus[];
  activeAlerts: number;
  alertPersistenceError: string | null;
  warnings: string[];
};
