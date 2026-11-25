"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import activityStyles from "../admin-activity.module.css";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
} from "lucide-react";

import type {
  HealthState,
  MonitoringMode,
  ServerEvent,
  ServiceStatus,
} from "@/lib/monitoring/contracts";
import type { UploadDiskSnapshot } from "@/lib/monitoring/upload-disk-snapshot";
import {
  buildMonitoringStatusModel,
  type BusinessOverviewState,
  type MonitoringStatusIssue,
} from "@/lib/monitoring/overview-view-model";

const STATE_META: Record<BusinessOverviewState, {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
}> = {
  healthy: {
    label: "运行正常",
    icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-600",
  },
  warning: {
    label: "需要关注",
    icon: Clock3,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  critical: {
    label: "功能异常",
    icon: AlertTriangle,
    className: "bg-rose-500/10 text-rose-600",
  },
  unknown: {
    label: "暂时无法判断",
    icon: CircleHelp,
    className: "bg-[var(--panel-2)] text-[var(--app-muted)]",
  },
};

const TARGET_LABEL: Record<MonitoringStatusIssue["target"], string> = {
  services: "查看服务",
  "project-logs": "查看项目日志",
  "server-events": "查看服务器事件",
  resources: "查看服务器资源",
};

export function MonitoringStatusOverview({
  mode,
  services,
  hostState,
  serverEvents,
  coreError,
  serverEventsError,
  serverEventsHistoryMessage,
  disk,
  onNavigate,
  resourceTriggerRef,
  pending = false,
  activeAlertCount = 0,
  onOpenAlerts,
}: {
  mode: MonitoringMode;
  services: ServiceStatus[];
  hostState: HealthState;
  serverEvents: ServerEvent[];
  coreError?: string | null;
  serverEventsError?: string | null;
  serverEventsHistoryMessage?: string | null;
  disk?: UploadDiskSnapshot | null;
  onNavigate: (target: MonitoringStatusIssue["target"]) => void;
  resourceTriggerRef: React.RefObject<HTMLButtonElement>;
  pending?: boolean;
  activeAlertCount?: number;
  onOpenAlerts?: () => void;
}) {
  const { label: uiLabel } = useUiLocale();
  const model = buildMonitoringStatusModel({
    mode,
    services,
    hostState,
    serverEvents,
    coreError,
    serverEventsError,
    serverEventsHistoryMessage,
    disk,
  });
  const status = STATE_META[pending ? "unknown" : model.overallState];
  const StatusIcon = status.icon;
  const headline = pending
    ? "正在读取当前资源状态"
    : model.kind === "local-light" && model.overallState === "healthy"
    ? "管理后台进程正在运行"
    : model.kind === "local-light" && services.some((service) => service.id === "web" && service.state === "healthy") && model.overallState === "critical"
    ? "本机资源需要处理"
    : model.headline;

  const healthyAreas = model.areas.filter((area) => area.state === "healthy").length;
  const hasIssues = !pending && (model.issues.length > 0 || activeAlertCount > 0);

  return (
    <UiProps ids={{"aria-label":["admin.m82b7cf40b5e6"]}}><section aria-label="admin.m82b7cf40b5e6" className="space-y-3">
      <article className={activityStyles.card}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${status.className}`}>
              <StatusIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-[var(--app-fg)]">{headline}</h2>
              <p className="mt-1.5 text-[12px] leading-5 text-[var(--app-muted)]">
                {pending ? <UiText id="admin.m77ee1ae3451d" /> : model.kind === "local-light"
                  ? model.detected
                  : <UiText id="admin.m5416b66e8e64" />}
              </p>
            </div>
          </div>
          <div className="text-[12px] leading-6 text-[var(--app-muted)] sm:text-right">
            {!pending && model.kind !== "local-light" ? <p>{healthyAreas} / {model.areas.length}<UiText id="admin.m4c23a912b966" /></p> : null}
            <p>{pending ? <UiText id="admin.m0eec1151592d" /> : hasIssues ? <UiText id="admin.mc8efcfca5271" /> : <UiText id="admin.mfd5a4f4bef79" />}</p>
            {!pending && activeAlertCount > 0 && model.issues.length > 0 ? (
              <button type="button" onClick={onOpenAlerts} className="rounded text-[var(--primary-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.m9ae8f7e3040d" />{activeAlertCount}<UiText id="admin.m7a94f327548e" /></button>
            ) : null}
          </div>
        </div>
        {!pending && model.kind === "local-light" ? (
          <p className="mt-3 border-t border-[var(--border)] pt-3 text-[12px] leading-5 text-[var(--app-muted)]">
            <span className="font-medium"><UiText id="admin.m00fa5c2f2ad0" /></span>{model.notEnabled?.replace(/^未开启检测：/, "")}
          </p>
        ) : !pending ? (
          <div className="mt-3 grid gap-4 border-t border-[var(--border)] pt-3 sm:grid-cols-2 xl:grid-cols-4">
            {model.areas.map((area) => {
              const meta = STATE_META[area.state];
              const Icon = meta.icon;
              return (
                <div key={area.id} title={area.message} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--app-fg)]">{area.label}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] ${meta.className}`}>
                      <Icon className="h-3 w-3" aria-hidden="true" />{uiLabel(meta.label)}
                    </span>
                  </div>
                  {area.state !== "healthy" ? <p className="mt-2 text-[11px] leading-5 text-[var(--app-muted)]">{area.message}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </article>

      {!pending && activeAlertCount > 0 && model.issues.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--app-fg)]">{activeAlertCount}<UiText id="admin.m913951aa98e4" /></h3>
            <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m70ec8f1de8e6" /></p>
          </div>
          <button type="button" onClick={onOpenAlerts} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--primary-bg)] outline-none hover:bg-[var(--panel-2)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.me72ba28fa532" /><ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {!pending ? model.issues.map((issue, index) => (
        <div key={issue.id} className={`flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 ${issue.severity === "critical" ? "border-rose-500/25 bg-rose-500/5" : issue.severity === "warning" ? "border-amber-500/25 bg-amber-500/5" : "border-[var(--border)] bg-[var(--panel-bg)]"}`}>
          <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${issue.severity === "critical" ? "text-rose-500" : issue.severity === "warning" ? "text-amber-500" : "text-[var(--app-muted)]"}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--app-fg)]">{issue.title}</h3>
            <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]">{issue.description}</p>
          </div>
          <button
            ref={index === model.issues.findIndex((item) => item.target === "resources") ? resourceTriggerRef : undefined}
            type="button"
            onClick={() => onNavigate(issue.target)}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--primary-bg)] outline-none hover:bg-[var(--panel-2)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
          >
            {TARGET_LABEL[issue.target]} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )) : null}
    </section></UiProps>
  );
}
