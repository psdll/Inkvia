"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import type { BillingTrendPeriod } from "@/lib/admin/billing-trend";
import styles from "./user-analysis.module.css";
import activityStyles from "./admin-activity.module.css";
import { useChartTooltip } from "./useChartTooltip";

export type BillingDateRange = { dateFrom: string; dateTo: string };
const money = (value: string) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: Number(value) !== 0 && Math.abs(Number(value)) < .01 ? 8 : 2 });
const exactMoney = (value: string) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export default function UserBillingTrend({ periods, periodKey, loading, onViewBill }: {
  periods?: BillingTrendPeriod[] | null;
  periodKey: BillingTrendPeriod["key"];
  loading?: boolean;
  onViewBill?: (range: BillingDateRange) => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { locale: uiLocale } = useUiLocale();
  const period = periods?.find(p => p.key === periodKey);
  const hover = useChartTooltip();
  const selectedKey = React.useRef<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const select = (key: string | null) => {
    if (selectedKey.current === key) return;
    if (key === null) hover.reset();
    selectedKey.current = key;
    setHovered(key);
  };
  React.useEffect(() => { selectedKey.current = null; setHovered(null); }, [periodKey, period?.dateTo]);
  const active = period?.points.find(p => p.key === hovered);
  const tooltipId = React.useId();
  const max = Math.max(.01, ...period?.points.map(p => Number(p.amount)) || []);
  const top = 12, bottom = 177, left = 53, width = 430;
  const step = (width - left - 10) / (period?.points.length || 1);
  const selectCell = (key: string, x: number, svg: SVGSVGElement | null) => {
    const rect = svg?.getBoundingClientRect();
    const renderedWidth = rect?.width || width;
    const scale = Math.min(renderedWidth / width, (rect?.height || 212) / 212);
    hover.place(((renderedWidth - width * scale) / 2 + x * scale) / renderedWidth);
    select(key);
  };
  return <UiProps ids={{"aria-label":["admin.m3852ff776288"]}}><section className={styles.panel} aria-label="admin.m3852ff776288">
    <div className={styles.panelTitle}><h3><UiText id="admin.m3852ff776288" /></h3>
      {period && onViewBill && <button className={styles.billingLink} onClick={() => onViewBill(period)}><UiText id="admin.m82c15006591f" /></button>}
    </div>
    {loading ? <div className={styles.empty} role="status"><UiText id="admin.med8888aaf711" /></div> : !period ? <div className={styles.empty} role="status"><UiText id="admin.m6508f4c1c4f5" /></div> : <>
      <div className={styles.billingSummary}>
        <div><span className={styles.subtle}>{period.label}<UiText id="admin.m7b916b4452d9" /></span><strong title={`¥${exactMoney(period.amount)}`}>¥{money(period.amount)}</strong></div>
        <div><span className={styles.subtle}><UiText id="admin.mdba45f363944" /></span><b title={`¥${exactMoney(period.dailyAverage)}`}>¥{money(period.dailyAverage)}</b></div>
        <div><span className={styles.subtle}><UiText id="admin.m6d4c0c6eae2b" /></span><b className={period.pendingCount ? styles.failure : undefined}>{period.pendingCount}<UiText id="admin.m31562b8c60d1" /></b></div>
      </div>
      <div className={styles.billingRange}>{period.dateFrom} — {period.dateTo}<UiText id="admin.mcf8172fb105c" /></div>
      <div ref={hover.containerRef} className={styles.chartFrame}>
      <svg className={styles.billingChart} viewBox={`0 0 ${width} 212`} role="group" aria-label={tLabel(`${period.label}费用柱状图`)} onPointerLeave={() => select(null)}>
        {[0, 1, 2, 3].map(i => {
          const y = bottom - (bottom - top) * i / 3;
          return <g key={i}><line x1={left} x2={width - 8} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={left - 7} y={y + 4} textAnchor="end" fill="var(--app-muted)" fontSize="10">{(max * i / 3).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: max < 1 ? 3 : 0, notation: max >= 10000 ? "compact" : "standard" })}</text></g>;
        })}
        {period.points.map((point, i) => {
          const h = Number(point.amount) / max * (bottom - top);
          const x = left + i * step;
          const description = `${point.key}${periodKey === "today" ? ":00" : ""}，已计价 ¥${exactMoney(point.amount)}，已计价 ${point.pricedCount} 笔，待核算 ${point.pendingCount} 笔`;
          return <g key={point.key} tabIndex={0} role="img" aria-label={description}
            aria-describedby={active?.key === point.key ? tooltipId : undefined}
            onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) selectCell(point.key, x + step / 2, event.currentTarget.ownerSVGElement); }} onBlur={() => select(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") select(null);
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = Math.max(0, Math.min(period.points.length - 1, i + (event.key === "ArrowRight" ? 1 : -1)));
              (event.currentTarget.parentElement?.querySelectorAll<SVGElement>('g[tabindex="0"]')[next])?.focus();
            }}
            >
            <rect x={x + step * .2} y={bottom - h} width={step * .6} height={h} rx="3" fill="#0090ff" />
            {point.pendingCount > 0 && <circle cx={x + step / 2} cy={bottom + 5} r="2" fill="var(--color-warning, #eab308)" />}
            <rect x={x} y={top} width={step} height={bottom - top + 8}
              fill={active?.key === point.key ? "var(--activity-hover)" : "transparent"}
              onPointerEnter={(event) => { hover.move(event); select(point.key); }}
              onPointerMove={hover.move}
              onPointerDown={(event) => { hover.move(event); select(point.key); }} />
            {(periodKey !== "today" || i % 4 === 0 || i === period.points.length - 1) && <text x={x + step / 2} y="201" textAnchor="middle" fill="var(--app-muted)" fontSize="10">{periodKey === "today" ? point.key.slice(11) + "时" : point.key.slice(5).replace("-", "/")}</text>}
          </g>;
        })}
      </svg>
      {active && <UiProps ids={{"aria-label":["admin.m4203f020d87c"]}}><div id={tooltipId} role="tooltip" className={activityStyles.tooltip} aria-label="admin.m4203f020d87c" ref={hover.tooltipRef}>
        <div className={activityStyles.tooltipDate}>{<UiText id="admin.m50d74d489149" values={{v0: String(active.key.slice(0, 4)), v1: String(Number(active.key.slice(5, 7))), v2: String(Number(active.key.slice(8, 10)))}} />}{periodKey === "today" ? ` ${active.key.slice(11)}:00` : ""}</div>
        <div className={activityStyles.tooltipBody}>
          <div className={activityStyles.tooltipRow}><i style={{ background: "#0090ff" }} /><span><UiText id="admin.m28a39e5809be" /></span><b>¥{exactMoney(active.amount)}</b></div>
          <div className={activityStyles.tooltipTotal}><span><UiText id="admin.m7b916b4452d9" /></span><b>{active.pricedCount}<UiText id="admin.m31562b8c60d1" /></b></div>
          <div className={activityStyles.tooltipTotal}><span><UiText id="admin.m6d4c0c6eae2b" /></span><b>{active.pendingCount}<UiText id="admin.m31562b8c60d1" /></b></div>
        </div>
      </div></UiProps>}
      </div>
      <div className={styles.panelFooter}><span>{period.count === 0 ? <UiText id="admin.m5a5135509ae4" /> : period.pendingCount ? <UiText id="admin.m14ca098ffa33" /> : <UiText id="admin.mffb10585dc3d" />}</span><span><UiText id="admin.maee27e86ffa0" /></span></div>
    </>}
  </section></UiProps>;
}
