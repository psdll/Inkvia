"use client";

import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { CircleHelp } from "lucide-react";
import activityStyles from "../admin-activity.module.css";
import { useChartTooltip } from "../useChartTooltip";

import { buildResourceTrend } from "@/lib/monitoring/resource-trend";

import type { HealthState } from "@/lib/monitoring/contracts";

type TrendPoint = { timestamp: number; value: number };

const STATE_DOT: Record<HealthState, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
  unavailable: "bg-[var(--app-muted)]",
  unsupported: "bg-[var(--app-muted)]",
  stale: "bg-amber-500",
};

export function ResourceMetricCard({
  label,
  value,
  unit,
  detail,
  statusLabel,
  impact,
  helpText,
  emptyLabel,
  state = "healthy",
  progress,
  trend = [],
  historySupported,
  summary,
  footer,
  trendStepMs,
  warningThreshold = 85,
  criticalThreshold = 95,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  statusLabel: string;
  impact: string;
  helpText: string;
  emptyLabel?: string;
  state?: HealthState;
  progress?: number;
  trend?: TrendPoint[];
  historySupported: boolean;
  summary?: string;
  footer?: string;
  trendStepMs?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
}) {
  const { label: tLabel } = useUiLocale();
  const { locale: uiLocale, label: uiLabel } = useUiLocale();
  const hover = useChartTooltip();
  const activeSampleRef = React.useRef<number | null>(null);
  const [activeSample, setActiveSample] = React.useState<number | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const helpButtonRef = React.useRef<HTMLButtonElement>(null);
  const helpPopoverRef = React.useRef<HTMLParagraphElement>(null);
  const chart = React.useMemo(() => buildResourceTrend(trend, trendStepMs), [trend, trendStepMs]);
  const gradientId = React.useId().replace(/:/g, "");
  const validSamples = React.useMemo(() => [...trend].filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value >= 0 && point.value <= 100).sort((a, b) => a.timestamp - b.timestamp), [trend]);
  const selectSample = (index: number | null, keyboard = false) => {
    if (activeSampleRef.current === index) return;
    if (index === null) hover.reset();
    activeSampleRef.current = index;
    if (keyboard && index !== null && validSamples[index]) hover.place((validSamples[index].timestamp - chart.start) / Math.max(1, chart.end - chart.start));
    setActiveSample(index);
  };
  React.useEffect(() => { activeSampleRef.current = null; setActiveSample(null); }, [trend]);
  const hoveredSample = activeSample === null ? null : validSamples[activeSample];
  const hasTrend = historySupported && chart.segments.length > 0;
  const current = state === "healthy" || state === "warning" || state === "critical";
  const hasProgress = current && typeof progress === "number" && Number.isFinite(progress);
  const caption = summary || (current && typeof progress === "number"
    ? `剩余 ${(100 - Math.max(0, Math.min(100, progress))).toFixed(1)}%`
    : detail);
  const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", {
    ...(chart.end - chart.start >= 86_400_000 ? { month: "2-digit" as const, day: "2-digit" as const } : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  React.useEffect(() => {
    if (!helpOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (helpButtonRef.current?.contains(target) || helpPopoverRef.current?.contains(target))) return;
      setHelpOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [helpOpen]);

  return (
    <article className={`relative min-w-0 ${activityStyles.card} ${helpOpen || activeSample !== null ? "z-30" : "z-0"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--app-muted)]">
          <span className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} aria-hidden="true" />
          {label}
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={helpButtonRef}
            type="button"
            aria-label={tLabel(`了解${label}`)}
            aria-expanded={helpOpen}
            title={helpText}
            onClick={() => setHelpOpen((open) => !open)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] outline-none hover:bg-[var(--panel-2)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {helpOpen ? (
        <p
          ref={helpPopoverRef}
          role="note"
          className="absolute right-3 top-12 z-30 w-[min(260px,calc(100%-24px))] rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel-bg)_96%,transparent)] p-3 text-[12px] leading-5 text-[var(--app-muted)] shadow-[var(--shadow)] backdrop-blur-lg"
        >
          {helpText}<br />{impact}<br />{detail}<br /><UiText id="admin.m5e747379cfe7" />{warningThreshold}<UiText id="admin.m37360f99eb92" />{criticalThreshold}%。
        </p>
      ) : null}
      <div className="mt-3 flex items-end gap-1.5">
        <span className="text-[26px] font-semibold leading-none tracking-tight text-[var(--app-fg)]">{value}</span>
        {unit ? <span className="pb-0.5 text-[11px] text-[var(--app-muted)]">{unit}</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        <span className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} aria-hidden="true" />
        <span className="font-semibold text-[var(--app-fg)]">{statusLabel}</span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]">{impact}</p>
      <p className="mt-2 text-[11px] leading-4 text-[var(--app-muted)]">{caption}</p>
      <div className={`mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)] ${hasProgress ? "" : "invisible"}`} aria-hidden="true">
        {hasProgress ? (
          <div className={`h-full rounded-full ${STATE_DOT[state]}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        ) : null}
      </div>
      <div className="mt-4">
        {hasTrend ? (
          <div ref={hover.containerRef} className="relative" onPointerLeave={() => selectSample(null)}>
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-[72px] w-full overflow-visible" role="img" aria-label={tLabel(`${label}趋势，纵轴 0–100%`)}
              tabIndex={0}
              aria-describedby={hoveredSample ? `resource-tooltip-${gradientId}` : undefined}
              onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) selectSample(0, true); }}
              onBlur={() => selectSample(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") selectSample(null);
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                selectSample(Math.max(0, Math.min(validSamples.length - 1, (activeSampleRef.current ?? 0) + (event.key === "ArrowRight" ? 1 : -1))), true);
              }}
              onPointerMove={(event) => {
                hover.move(event);
                const bounds = event.currentTarget.getBoundingClientRect();
                const timestamp = chart.start + ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * (chart.end - chart.start);
                const index = validSamples.reduce((nearest, sample, candidate) => Math.abs(sample.timestamp - timestamp) < Math.abs(validSamples[nearest].timestamp - timestamp) ? candidate : nearest, 0);
                selectSample(validSamples[index] && Math.abs(validSamples[index].timestamp - timestamp) <= (trendStepMs ?? 60_000) * 0.75 ? index : null);
              }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="var(--primary-bg)" stopOpacity="0.18" />
                  <stop offset="1" stopColor="var(--primary-bg)" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              <path d="M 0 0 H 300 M 0 50 H 300 M 0 100 H 300" stroke="var(--border)" strokeDasharray="3 5" fill="none" vectorEffect="non-scaling-stroke" />
              <path d={`M 0 ${100 - criticalThreshold} H 300`} stroke="var(--app-muted)" strokeOpacity="0.4" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              {chart.segments.map(({ path, area }, index) => (
                <React.Fragment key={index}>
                  <path d={area} fill={`url(#${gradientId})`} />
                  <path d={path} fill="none" stroke={current ? "var(--primary-bg)" : "var(--app-muted)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </React.Fragment>
              ))}
              {hoveredSample ? <line x1={((hoveredSample.timestamp - chart.start) / Math.max(1, chart.end - chart.start)) * 300} x2={((hoveredSample.timestamp - chart.start) / Math.max(1, chart.end - chart.start)) * 300} y1="0" y2="100" stroke="var(--app-muted)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
            </svg>
            {hoveredSample ? <div role="tooltip" id={`resource-tooltip-${gradientId}`} className={activityStyles.tooltip} ref={hover.tooltipRef}>
              <div className={activityStyles.tooltipDate}>{uiLabel(timeLabel(hoveredSample.timestamp))}</div>
              <div className={activityStyles.tooltipBody}><div className={activityStyles.tooltipRow}><i style={{ background: "var(--primary-bg)" }} /><span>{label}</span><b>{hoveredSample.value.toFixed(1)}%</b></div></div>
            </div> : null}
            <div className="mt-2 flex justify-between font-mono text-[10px] text-[var(--app-muted)]">
              <span>{uiLabel(timeLabel(chart.start))}</span><span>{uiLabel(timeLabel((chart.start + chart.end) / 2))}</span><span>{uiLabel(timeLabel(chart.end))}</span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] leading-5 text-[var(--app-muted)]">
            {emptyLabel || (historySupported ? <UiText id="admin.mb538569ed6e4" /> : <UiText id="admin.m86412b812ebb" />)}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--app-muted)]">
        <span>{footer || <UiText id="admin.m41438304b17a" values={{v0: String(criticalThreshold)}} />}</span>
        {hasTrend ? <span><UiText id="admin.mf47cd0d21257" /></span> : <span>{current ? <UiText id="admin.mfc36f665d136" /> : statusLabel}</span>}
      </div>
    </article>
  );
}
