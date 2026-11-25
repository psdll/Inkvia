"use client";

import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { FileText, ServerCog } from "lucide-react";

import type { MonitoringCapabilities } from "@/lib/monitoring/contracts";

import { LogsExplorer } from "./LogsExplorer";
import { ServerEventsExplorer } from "./ServerEventsExplorer";

type LogsView = "project" | "server";

const LOG_VIEWS = [
  {
    id: "project" as const,
    label: "项目日志",
    description: "排查页面、接口和任务处理错误",
    icon: FileText,
  },
  {
    id: "server" as const,
    label: "服务器事件",
    description: "回看异常关机、内存和系统故障",
    icon: ServerCog,
  },
];

export function MonitoringLogsCenter({
  capabilities,
  initialView = "project",
}: {
  capabilities: MonitoringCapabilities | null;
  initialView?: LogsView;
}) {
  const { label: uiLabel } = useUiLocale();
  const [active, setActive] = React.useState<LogsView>(initialView);

  React.useEffect(() => setActive(initialView), [initialView]);

  return (
    <div className="space-y-4">
      <section className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 sm:grid-cols-2">
        {LOG_VIEWS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(item.id)}
              className={[
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left outline-none transition",
                "focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]",
                selected
                  ? "border-[color-mix(in_srgb,var(--primary-bg)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary-bg)_10%,var(--panel-bg))]"
                  : "border-transparent hover:border-[var(--border)] hover:bg-[var(--panel-2)]",
              ].join(" ")}
            >
              <span className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                selected
                  ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                  : "bg-[var(--panel-2)] text-[var(--app-muted)]",
              ].join(" ")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[var(--app-fg)]">{uiLabel(item.label)}</span>
                <span className="mt-0.5 block text-[12px] text-[var(--app-muted)]">{item.description}</span>
              </span>
            </button>
          );
        })}
      </section>

      {active === "project" ? (
        <LogsExplorer capabilities={capabilities} />
      ) : (
        <ServerEventsExplorer enabled={capabilities?.serverEvents === true} />
      )}
    </div>
  );
}
