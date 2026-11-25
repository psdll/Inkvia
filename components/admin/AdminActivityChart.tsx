"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  ChartColumn,
  ChartLine,
  Circle,
  PanelRight,
  SlidersHorizontal,
} from "lucide-react";
import styles from "./admin-activity.module.css";
import { useChartTooltip } from "./useChartTooltip";

export const ACTIVITY_COLORS = [
  "#0090ff",
  "#00bfa5",
  "#9dce2c",
  "#d66bd3",
  "#8b5cf6",
  "#ffc226",
  "#f7787d",
  "#94a3b8",
];
export type ActivitySeries = { key: string; label: string; color: string };
export type ActivityPoint = {
  label: string;
  values: Record<string, number | null>;
  detail?: string;
};
export type ActivityChartType = "bar" | "line" | "dot";
const countFormatter = Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const compactCount = (value: number) => countFormatter.format(value);

function axisMaximum(value: number) {
  if (value <= 0) return 4;
  const rawStep = value / 4;
  const scale = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].find((candidate) => candidate * scale >= rawStep) || 10;
  return Math.max(1, step * scale) * 4;
}

export default function AdminActivityChart({
  title,
  points,
  series,
  initialType = "bar",
  formatValue = compactCount,
  showTotal = true,
  allowCumulative = true,
  emptyText = "暂无数据",
  embedded = false,
  height = 270,
  chartTypes = ["bar", "line", "dot"],
}: {
  title: string;
  points: ActivityPoint[];
  series: ActivitySeries[];
  initialType?: ActivityChartType;
  formatValue?: (value: number) => string;
  showTotal?: boolean;
  allowCumulative?: boolean;
  emptyText?: string;
  embedded?: boolean;
  height?: number;
  chartTypes?: ActivityChartType[];
}) {
  const { label: uiLabel, locale } = useUiLocale();
  const comma = locale === "en" ? ", " : "，";
  const hover = useChartTooltip();
  const container = hover.containerRef;
  const activeRef = React.useRef<number | null>(null);
  const [width, setWidth] = React.useState(600);
  const [hidden, setHidden] = React.useState<string[]>([]);
  const [hoveredSeries, setHoveredSeries] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<number | null>(null);
  const select = (index: number | null) => {
    if (activeRef.current === index) return;
    activeRef.current = index;
    setActive(index);
  };
  const clearHover = () => {
    hover.reset();
    select(null);
  };
  const [rightLegend, setRightLegend] = React.useState(false);
  const [type, setType] = React.useState(initialType);
  const [cumulative, setCumulative] = React.useState(false);
  const tooltipId = React.useId();
  const settingsRef = React.useRef<HTMLDetailsElement>(null);
  const closeSettings = () => {
    if (settingsRef.current) settingsRef.current.open = false;
  };
  React.useEffect(() => {
    const settings = settingsRef.current;
    if (!settings) return;
    const close = () => { settings.open = false; };
    const outside = (event: Event) => {
      if (!settings.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !settings.open) return;
      event.preventDefault();
      close();
      settings.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", close);
    };
  }, []);
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(Math.max(240, element.getBoundingClientRect().width));
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    activeRef.current = null;
    setActive(null);
  }, [points]);
  const visible = React.useMemo(
    () => series.filter((item) => !hidden.includes(item.key)),
    [series, hidden],
  );
  const rows = React.useMemo(() => {
    const sums: Record<string, number> = {};
    return points.map((point) => ({
      ...point,
      values: Object.fromEntries(
        series.map(({ key }) => {
          const value = point.values[key];
          sums[key] = (sums[key] || 0) + (value ?? 0);
          return [key, cumulative ? sums[key] : value];
        }),
      ),
    }));
  }, [points, series, cumulative]);
  const right = 14,
    top = 26,
    bottom = 30;
  const max = axisMaximum(
    Math.max(
      0,
      ...rows.map((point) =>
        type === "bar"
          ? visible.reduce(
              (sum, item) => sum + (point.values[item.key] ?? 0),
              0,
            )
          : Math.max(0, ...visible.map((item) => point.values[item.key] ?? 0)),
      ),
    ),
  );
  const left = Math.max(46, ...[0, 1, 2, 3, 4].map(tick => formatValue(max * tick / 4).length * 7 + 12));
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const step = plotWidth / Math.max(1, rows.length);
  const x = (index: number) => left + step * (index + 0.5);
  const y = (value: number) => top + plotHeight * (1 - value / max);
  const tickStep = Math.max(
    1,
    Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 65))),
  );
  const selected = active === null ? undefined : rows[active];
  const hasPositiveValue =
    selected && visible.some((item) => (selected.values[item.key] ?? 0) > 0);
  const tooltipRows = selected
    ? visible
        .map((item) => ({ ...item, value: selected.values[item.key] }))
        .filter(
          (item) => item.value != null && (!hasPositiveValue || item.value > 0),
        )
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : [];
  const hasData = rows.some((point) =>
    visible.some((item) => point.values[item.key] != null),
  );

  const marks = React.useMemo(
    () => (
      <>
        {[0, 1, 2, 3, 4].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y((max * tick) / 4)}
              y2={y((max * tick) / 4)}
              stroke="var(--activity-border)"
              strokeDasharray="2 4"
            />
            <text
              x={left - 8}
              y={y((max * tick) / 4) + 4}
              textAnchor="end"
              className={styles.axis}
            >
              {formatValue((max * tick) / 4)}
            </text>
          </g>
        ))}
        {rows.map((point, index) =>
          (index % tickStep === 0 &&
            rows.length - 1 - index >= tickStep * 0.7) ||
          index === rows.length - 1 ? (
            <g key={point.label}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={top}
                y2={height - bottom}
                stroke="var(--activity-border)"
                strokeDasharray="2 4"
              />
              <text
                x={x(index)}
                y={height - 10}
                textAnchor="middle"
                className={styles.axis}
              >
                {/^\d{4}-/.test(point.label)
                  ? point.label.slice(5).replace("-", "/")
                  : point.label}
              </text>
            </g>
          ) : null,
        )}
        {type === "bar"
          ? rows.map((point, index) => {
              let baseline = 0;
              return (
                <g key={point.label}>
                  {visible.map((item) => {
                    const value = point.values[item.key] ?? 0;
                    const start = baseline;
                    baseline += value;
                    return (
                      <rect
                        key={item.key}
                        x={x(index) - step * 0.39}
                        y={y(start + value)}
                        width={Math.max(1, step * 0.78)}
                        height={(value / max) * plotHeight}
                        fill={item.color}
                        opacity={
                          hoveredSeries && hoveredSeries !== item.key ? 0.18 : 1
                        }
                        rx="1"
                      />
                    );
                  })}
                </g>
              );
            })
          : visible.map((item) => {
              // Missing samples are omitted, preserving the existing reliability curve between observed points.
              const observed = rows.flatMap((point, index) =>
                point.values[item.key] == null
                  ? []
                  : [{ x: x(index), y: y(point.values[item.key]!) }],
              );
              const path = observed
                .map((point, index) =>
                  index
                    ? `C${(observed[index - 1].x + point.x) / 2},${observed[index - 1].y} ${(observed[index - 1].x + point.x) / 2},${point.y} ${point.x},${point.y}`
                    : `M${point.x},${point.y}`,
                )
                .join(" ");
              return (
                <g
                  key={item.key}
                  opacity={
                    hoveredSeries && hoveredSeries !== item.key ? 0.18 : 1
                  }
                >
                  {type === "line" && observed.length > 0 && (
                    <>
                      <path
                        d={`${path} L${observed[observed.length - 1].x},${y(0)} L${observed[0].x},${y(0)} Z`}
                        fill={item.color}
                        opacity=".18"
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={item.color}
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </>
                  )}
                  {(type === "dot" || observed.length === 1) &&
                    observed.map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r="3"
                        fill={item.color}
                      />
                    ))}
                </g>
              );
            })}
      </>
    ),
    [
      rows,
      visible,
      width,
      max,
      step,
      tickStep,
      type,
      hoveredSeries,
      height,
      formatValue,
    ],
  );

  return (
    <section
      className={`${styles.chartCard} ${embedded ? styles.embeddedChart : ""}`}
      aria-label={title}
    >
      {!embedded && (
        <div className={styles.cardHeading}>
          <h3>{title}</h3>
        </div>
      )}
      <div
        className={`${styles.chartLayout} ${rightLegend ? styles.legendAtRight : ""}`}
      >
        <div ref={container} className={styles.plot}>
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label={locale === "en" ? `${title} chart` : `${title}图表`}
            onPointerLeave={clearHover}
          >
            {marks}
            {active !== null &&
              (type === "bar" ? (
                <rect
                  x={left + active * step}
                  y={top}
                  width={step}
                  height={plotHeight}
                  fill="var(--activity-hover)"
                  pointerEvents="none"
                />
              ) : (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={top}
                  y2={height - bottom}
                  stroke="var(--activity-muted)"
                  strokeDasharray="3 3"
                  opacity=".45"
                  pointerEvents="none"
                />
              ))}
            <g onPointerLeave={clearHover}>
              {rows.map((point, index) => (
                <rect
                  key={`hit-${point.label}`}
                  className={styles.hitCell}
                  x={left + index * step}
                  y={top}
                  width={step}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={index === (active ?? 0) ? 0 : -1}
                  role="button"
                  aria-label={`${point.label}${comma}${visible.map((item) => `${uiLabel(item.label)} ${point.values[item.key] == null ? uiLabel("暂无数据") : formatValue(point.values[item.key]!)}`).join(comma)}`}
                  aria-describedby={active === index ? tooltipId : undefined}
                  onPointerEnter={(event) => {
                    hover.move(event);
                    select(index);
                  }}
                  onPointerMove={hover.move}
                  onPointerDown={(event) => {
                    hover.move(event);
                    select(index);
                  }}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(":focus-visible"))
                      hover.place(x(index) / width, top);
                    select(index);
                  }}
                  onBlur={clearHover}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") clearHover();
                    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                      event.preventDefault();
                      const next = Math.max(
                        0,
                        Math.min(
                          rows.length - 1,
                          index + (event.key === "ArrowRight" ? 1 : -1),
                        ),
                      );
                      event.currentTarget.parentElement
                        ?.querySelectorAll<SVGRectElement>('[role="button"]')
                        [next]?.focus();
                    }
                  }}
                />
              ))}
            </g>
          </svg>
          {!hasData && (
            <div className={styles.emptyChart}>
              {hidden.length ? <UiText id="admin.mf337cb9d2cc4" /> : uiLabel(emptyText)}
            </div>
          )}
          {selected && (
            <div
              id={tooltipId}
              role="tooltip"
              className={styles.tooltip}
              ref={hover.tooltipRef}
            >
              <div className={styles.tooltipDate}>
                {/^\d{4}-\d{2}-\d{2}$/.test(selected.label)
                  ? <UiText id="admin.m50d74d489149" values={{v0: String(selected.label.slice(0, 4)), v1: String(Number(selected.label.slice(5, 7))), v2: String(Number(selected.label.slice(8)))}} />
                  : selected.label}
              </div>
              <div className={styles.tooltipBody}>
                {tooltipRows.length ? (
                  tooltipRows.map((item) => (
                    <div className={styles.tooltipRow} key={item.key}>
                      <i style={{ background: item.color }} />
                      <span>{uiLabel(item.label)}</span>
                      <b>{formatValue(item.value!)}</b>
                    </div>
                  ))
                ) : (
                  <div><UiText id="admin.m497c85690c4c" /></div>
                )}
                {showTotal && tooltipRows.length > 0 && (
                  <div className={styles.tooltipTotal}>
                    <span><UiText id="admin.me009c148d189" /></span>
                    <b>
                      {formatValue(
                        tooltipRows.reduce((sum, item) => sum + item.value!, 0),
                      )}
                    </b>
                  </div>
                )}
                {selected.detail && (
                  <div className={styles.tooltipTotal}>{selected.detail}</div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className={styles.legend}>
          <div className={styles.legendItems}>
            {series.map((item) => (
              <div
                key={item.key}
                className={styles.legendItem}
                onPointerEnter={() => setHoveredSeries(item.key)}
                onPointerLeave={() => setHoveredSeries(null)}
              >
                <button
                  role="checkbox"
                  aria-checked={!hidden.includes(item.key)}
                  aria-label={`${uiLabel(hidden.includes(item.key) ? "显示" : "隐藏")} ${uiLabel(item.label)}`}
                  onClick={() =>
                    setHidden((values) =>
                      values.includes(item.key)
                        ? values.filter((key) => key !== item.key)
                        : [...values, item.key],
                    )
                  }
                  className={styles.legendDot}
                  style={{
                    background: hidden.includes(item.key)
                      ? "transparent"
                      : item.color,
                    borderColor: item.color,
                  }}
                />
                <button
                  className={styles.legendLabel}
                  style={{ opacity: hidden.includes(item.key) ? 0.4 : 1 }}
                  title={uiLabel(`仅显示 ${item.label}`)}
                  onClick={() =>
                    setHidden(
                      hidden.length === series.length - 1 &&
                        !hidden.includes(item.key)
                        ? []
                        : series
                            .filter((entry) => entry.key !== item.key)
                            .map((entry) => entry.key),
                    )
                  }
                >
                  {uiLabel(item.label)}
                </button>
              </div>
            ))}
          </div>
          <div className={styles.chartActions}>
            <details ref={settingsRef} className={styles.chartSettings}>
              <UiProps ids={{"title":["admin.me8ee8877b443"]}}><summary aria-label={locale === "en" ? `${title} chart settings` : `${title}图表设置`} title="admin.me8ee8877b443">
                <SlidersHorizontal size={14} />
              </summary></UiProps>
              <div className={styles.settingsPopover}>
                {allowCumulative && (
                  <label>
                    <input
                      type="checkbox"
                      checked={cumulative}
                      onChange={(event) => { setCumulative(event.target.checked); closeSettings(); }}
                    /><UiText id="admin.mf2c1ee703ddf" /></label>
                )}
                <span><UiText id="admin.m52fe98551232" /></span>
                <div>
                  {(
                    [
                      ["bar", ChartColumn, "柱状图"],
                      ["line", ChartLine, "折线图"],
                      ["dot", Circle, "点图"],
                    ] as const
                  )
                    .filter(([value]) => chartTypes.includes(value))
                    .map(([value, Icon, label]) => (
                      <button
                        key={value}
                        aria-label={uiLabel(label)}
                        aria-pressed={type === value}
                        onClick={() => { setType(value); closeSettings(); }}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                </div>
              </div>
            </details>
            <UiProps ids={{"title":["admin.mae497aceca4c","admin.m041cebcb05a9"],"aria-label":["admin.mae497aceca4c","admin.m041cebcb05a9"]}}><button
              title={rightLegend ? "admin.mae497aceca4c" : "admin.m041cebcb05a9"}
              aria-label={rightLegend ? "admin.mae497aceca4c" : "admin.m041cebcb05a9"}
              onClick={() => setRightLegend(!rightLegend)}
            >
              <PanelRight size={14} />
            </button></UiProps>
          </div>
        </div>
      </div>
    </section>
  );
}
