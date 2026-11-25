import type {
  HealthState,
  MonitoringCapabilities,
  MonitoringMode,
  ServerEvent,
  ServiceStatus,
} from "@/lib/monitoring/contracts";

export type BusinessOverviewState = "healthy" | "warning" | "critical" | "unknown";

export type BusinessArea = {
  id: "web" | "generation" | "media" | "data";
  label: string;
  description: string;
  impact: string;
  serviceIds: ServiceStatus["id"][];
  state: HealthState;
  hasPartialEvidence: boolean;
};

export type MonitoringCoverageItem = {
  id: "metrics" | "logs" | "traces" | "dashboards";
  label: string;
  description: string;
  configured: boolean;
};

export type MonitoringStatusArea = Omit<BusinessArea, "state" | "hasPartialEvidence"> & {
  state: BusinessOverviewState;
  message: string;
};

export type MonitoringStatusIssue = {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "critical" | "unknown";
  target: "services" | "project-logs" | "server-events" | "resources";
};

type MonitoringStatusInput = {
  mode: MonitoringMode;
  services: ServiceStatus[];
  hostState: HealthState;
  serverEvents: ServerEvent[];
  coreError?: string | null;
  serverEventsError?: string | null;
  serverEventsHistoryMessage?: string | null;
  disk?: {
    state: "healthy" | "warning" | "critical" | "unavailable";
    usedPercent: number | null;
    error?: string;
  } | null;
};

export const BUSINESS_AREAS: Array<Omit<BusinessArea, "state" | "hasPartialEvidence">> = [
  {
    id: "web",
    label: "页面与 API",
    description: "用户能否打开页面和调用接口",
    impact: "页面或接口请求可能失败",
    serviceIds: ["web", "nginx"],
  },
  {
    id: "generation",
    label: "生成任务",
    description: "图片等生成任务能否继续处理",
    impact: "生成任务可能停止或持续等待",
    serviceIds: ["generation-worker"],
  },
  {
    id: "media",
    label: "媒体与视频任务",
    description: "媒体处理和视频任务能否继续处理",
    impact: "媒体处理或视频任务可能停止",
    serviceIds: ["media-worker", "live-video-prompt-worker", "live-video-video-worker"],
  },
  {
    id: "data",
    label: "数据保存",
    description: "项目数据能否正常读取和保存",
    impact: "数据读取或保存可能失败",
    serviceIds: ["postgresql"],
  },
];

export function businessAreaState(
  services: ServiceStatus[],
  serviceIds: ServiceStatus["id"][],
): HealthState {
  const matchedServices = services.filter((service) => serviceIds.includes(service.id));
  const states = matchedServices.map((service) => service.state);

  if (!states.length || states.every((state) => state === "unsupported")) return "unsupported";
  if (states.some((state) => state === "critical" || state === "unavailable")) return "critical";
  if (states.some((state) => state === "warning" || state === "stale")) return "warning";
  if (
    matchedServices.length === serviceIds.length
    && states.every((state) => state === "healthy")
  ) return "healthy";
  return "unsupported";
}

function buildCoverage(capabilities: MonitoringCapabilities): MonitoringCoverageItem[] {
  return [
    {
      id: "metrics",
      label: "历史指标",
      description: "查看 CPU、内存和磁盘是否持续升高",
      configured: capabilities.metricsHistory,
    },
    {
      id: "logs",
      label: "集中日志",
      description: "按时间和服务查找具体错误原因",
      configured: capabilities.centralLogs,
    },
    {
      id: "traces",
      label: "请求追踪",
      description: "还原一次请求经过的服务和耗时",
      configured: capabilities.distributedTracing,
    },
    {
      id: "dashboards",
      label: "监控看板",
      description: "集中查看长期趋势和监控图表",
      configured: capabilities.grafana,
    },
  ];
}

export function buildMonitoringOverviewModel(
  services: ServiceStatus[],
  capabilities: MonitoringCapabilities,
) {
  const areas: BusinessArea[] = BUSINESS_AREAS.map((area) => {
    const matchedServices = services.filter((service) => area.serviceIds.includes(service.id));
    const state = businessAreaState(services, area.serviceIds);
    return {
      ...area,
      state,
      hasPartialEvidence: state === "unsupported"
        && matchedServices.some((service) => service.state !== "unsupported"),
    };
  });
  const counts = {
    healthy: areas.filter((area) => area.state === "healthy").length,
    warning: areas.filter((area) => area.state === "warning").length,
    critical: areas.filter((area) => area.state === "critical").length,
    unknown: areas.filter((area) => area.state === "unsupported").length,
  };
  const overallState: BusinessOverviewState = counts.critical > 0
    ? "critical"
    : counts.warning > 0
      ? "warning"
      : counts.unknown > 0
        ? "unknown"
        : "healthy";
  const headline = overallState === "critical"
    ? "检测到严重异常"
    : overallState === "warning"
      ? "部分功能需要关注"
      : overallState === "unknown"
        ? "当前无法完整判断"
        : "核心功能运行正常";

  return {
    areas,
    counts,
    coverage: buildCoverage(capabilities),
    overallState,
    headline,
  };
}

function monitoringStatusArea(
  services: ServiceStatus[],
  area: Omit<BusinessArea, "state" | "hasPartialEvidence">,
): MonitoringStatusArea {
  const matched = area.serviceIds.map((id) => services.find((service) => service.id === id));
  const states = matched.map((service) => service?.state);
  if (states.some((state) => state === "critical")) {
    return { ...area, state: "critical", message: area.impact };
  }
  if (states.some((state) => state === "warning")) {
    return { ...area, state: "warning", message: "检测到需要关注的运行状态" };
  }
  if (matched.some((service) => !service)
    || states.some((state) => state === "unsupported"
      || state === "unavailable"
      || state === "stale")) {
    return { ...area, state: "unknown", message: "暂时没有足够的新鲜证据判断" };
  }
  if (states.every((state) => state === "healthy")) {
    return { ...area, state: "healthy", message: "当前所需服务均有正常运行证据" };
  }
  return { ...area, state: "unknown", message: "暂时没有足够证据判断" };
}

function areaIssue(area: MonitoringStatusArea): MonitoringStatusIssue | null {
  if (area.state === "healthy") return null;
  return {
    id: `area-${area.id}`,
    title: area.state === "critical"
      ? `${area.label}出现异常`
      : area.state === "warning"
        ? `${area.label}需要关注`
        : `${area.label}暂时无法判断`,
    description: area.message,
    severity: area.state,
    target: area.state === "unknown" ? "services" : "project-logs",
  };
}

function uploadDiskIssue(disk: MonitoringStatusInput["disk"]): MonitoringStatusIssue | null {
  if (!disk || disk.state === "healthy") return null;
  if (disk.state === "unavailable") {
    return {
      id: "upload-disk-read",
      title: "上传磁盘空间暂时无法判断",
      description: disk.error
        ? `磁盘使用率检测失败：${disk.error}`
        : "当前无法读取上传目录所在磁盘的使用率，不能显示为正常。",
      severity: "unknown",
      target: "resources",
    };
  }
  return {
    id: "upload-disk-watermark",
    title: disk.state === "critical" ? "上传磁盘空间严重不足" : "上传磁盘空间需要关注",
    description: `当前使用率 ${disk.usedPercent?.toFixed(1) ?? "—"}%；达到 85% 后大文件上传会被阻止。`,
    severity: disk.state,
    target: "resources",
  };
}

export function buildMonitoringStatusModel(input: MonitoringStatusInput) {
  if (input.mode === "local-light") {
    const detectedWeb = input.services.find((service) => service.id === "web");
    const localIssues: MonitoringStatusIssue[] = [];
    if (!input.coreError && detectedWeb?.state !== "healthy") {
      localIssues.push({
        id: "local-web",
        title: detectedWeb?.state === "critical" ? "管理后台进程出现异常" : "管理后台进程暂时无法判断",
        description: detectedWeb?.message || "没有读取到可确认当前 Web 进程正常的证据。",
        severity: detectedWeb?.state === "critical" ? "critical" : "unknown",
        target: "services",
      });
    }
    const diskIssue = !input.coreError ? uploadDiskIssue(input.disk) : null;
    if (diskIssue) localIssues.push(diskIssue);
    if (!input.coreError && !diskIssue && (input.hostState === "critical" || input.hostState === "warning")) {
      localIssues.push({
        id: "local-resources",
        title: input.hostState === "critical" ? "服务器资源达到严重阈值" : "服务器资源需要关注",
        description: "当前已检测的服务器负载或内存可能影响页面响应。",
        severity: input.hostState,
        target: "resources",
      });
    } else if (!input.coreError && !diskIssue && ["unsupported", "unavailable", "stale"].includes(input.hostState)) {
      localIssues.push({
        id: "local-resources-read",
        title: "服务器资源暂时无法判断",
        description: "当前没有足够的新鲜负载或内存证据，不能显示为正常。",
        severity: "unknown",
        target: "resources",
      });
    }
    if (input.coreError) {
      localIssues.push({
        id: "core-data-read",
        title: "监控核心数据暂时无法读取",
        description: input.coreError,
        severity: "unknown",
        target: "services",
      });
    }
    const localOverall: BusinessOverviewState = localIssues.some((issue) => issue.severity === "critical")
      ? "critical"
      : localIssues.some((issue) => issue.severity === "warning")
        ? "warning"
        : localIssues.length > 0
          ? "unknown"
          : "healthy";
    return {
      kind: "local-light" as const,
      overallState: localOverall,
      headline: localOverall === "critical"
        ? "管理后台进程出现异常"
        : localOverall === "warning"
          ? "当前资源需要关注"
          : localOverall === "unknown"
            ? "当前无法完整判断"
            : "管理后台进程正在运行",
      detected: "当前检测：Web 进程、服务器负载、服务器内存、上传磁盘空间、Web 服务内存",
      notEnabled: "未开启检测：Nginx、生成任务、媒体与视频任务、数据库、服务器事件",
      areas: [] as MonitoringStatusArea[],
      issues: localIssues,
    };
  }

  const areas = BUSINESS_AREAS.map((area) => monitoringStatusArea(input.services, area));
  const issues = input.coreError ? [] : areas.flatMap((area) => {
    const issue = areaIssue(area);
    return issue ? [issue] : [];
  });
  const diskIssue = !input.coreError ? uploadDiskIssue(input.disk) : null;
  if (diskIssue) issues.push(diskIssue);
  if (!input.coreError && !diskIssue && (input.hostState === "critical" || input.hostState === "warning")) {
    issues.push({
      id: "host-resources",
      title: input.hostState === "critical" ? "服务器资源达到严重阈值" : "服务器资源接近上限",
      description: "持续偏高可能导致页面、任务、上传或数据库写入变慢或失败。",
      severity: input.hostState,
      target: "resources",
    });
  } else if (!input.coreError && !diskIssue && ["unsupported", "unavailable", "stale"].includes(input.hostState)) {
    issues.push({
      id: "host-resources-read",
      title: "服务器资源暂时无法判断",
      description: "没有足够的新鲜资源数据，不能显示为正常。",
      severity: "unknown",
      target: "resources",
    });
  }
  for (const event of input.serverEvents) {
    if (event.state !== "active" || (event.severity !== "warning" && event.severity !== "critical")) {
      continue;
    }
    issues.push({
      id: `server-event-${event.id}`,
      title: event.title,
      description: event.impact,
      severity: event.severity,
      target: "server-events",
    });
  }
  if (input.coreError) {
    issues.push({
      id: "core-data-read",
      title: "监控核心数据暂时无法读取",
      description: input.coreError,
      severity: "unknown",
      target: "services",
    });
  }
  if (input.serverEventsError) {
    issues.push({
      id: "server-events-read",
      title: "服务器事件暂时无法读取",
      description: input.serverEventsError,
      severity: "unknown",
      target: "server-events",
    });
  }
  if (input.serverEventsHistoryMessage) {
    issues.push({
      id: "server-events-history",
      title: "服务器事件历史记录不完整",
      description: input.serverEventsHistoryMessage,
      severity: "unknown",
      target: "server-events",
    });
  }

  const overallState: BusinessOverviewState = issues.some((issue) => issue.severity === "critical")
    ? "critical"
    : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : issues.length > 0
        ? "unknown"
        : "healthy";
  return {
    kind: "full" as const,
    overallState,
    headline: overallState === "critical"
      ? "检测到影响项目使用的异常"
      : overallState === "warning"
        ? "部分功能需要关注"
        : overallState === "unknown"
          ? "当前无法完整判断"
          : "核心功能运行正常",
    detected: null,
    notEnabled: null,
    areas,
    issues,
  };
}
