"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import {
  Activity,
  BellRing,
  ChartNoAxesCombined,
  ListChecks,
  ScrollText,
} from "lucide-react";

import activityStyles from "../admin-activity.module.css";

export type MonitoringView = "overview" | "services" | "logs" | "reliability" | "alerts";

const ITEMS: Array<{
  id: MonitoringView;
  label: string;
  icon: typeof Activity;
}> = [
  { id: "overview", label: "总览", icon: Activity },
  { id: "services", label: "服务", icon: ListChecks },
  { id: "logs", label: "日志", icon: ScrollText },
  { id: "reliability", label: "可靠性", icon: ChartNoAxesCombined },
  { id: "alerts", label: "告警", icon: BellRing },
];

export function MonitoringSubnav({
  active,
  onSelect,
  alertCount = 0,
}: {
  active: MonitoringView;
  onSelect: (view: MonitoringView) => void;
  alertCount?: number;
}) {
  const { label: uiLabel } = useUiLocale();
  return (
    <UiProps ids={{"aria-label":["admin.m2d9d1877426f"]}}><nav
      aria-label="admin.m2d9d1877426f"
      className={`no-scrollbar flex max-w-full gap-6 overflow-x-auto border-b border-[var(--border)] ${activityStyles.monitoringNav}`}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(item.id)}
            className={[
              "flex h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]",
              selected
                ? "border-[var(--primary-bg)] text-[var(--app-fg)]"
                : "border-transparent text-[var(--app-muted)] hover:text-[var(--app-fg)]",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {uiLabel(item.label)}
            {item.id === "alerts" && alertCount > 0 ? (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav></UiProps>
  );
}
