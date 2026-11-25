"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react";

type DateRangePickerProps = {
  single?: boolean;
  ariaLabel?: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
};

function localYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parseLocalYmd(raw?: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthTitle(date: Date): string {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function buildMonthCells(month: Date): Array<{ ymd: string; day: number; inMonth: boolean }> {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      ymd: localYmd(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
    };
  });
}

const DATE_RANGE_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const ENGLISH_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DateRangePicker({ from, to, onFromChange, onToChange, single = false, ariaLabel }: DateRangePickerProps) {
  const { locale } = useUiLocale();
  const displayDate = (ymd: string) => {
    const date = parseLocalYmd(ymd);
    return locale === "en" && date ? date.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : ymd;
  };
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [popupStyle, setPopupStyle] = React.useState<React.CSSProperties | null>(null);
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(parseLocalYmd(from) || new Date()));
  const hasValue = Boolean(from || to);
  const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

  React.useEffect(() => {
    if (open) setViewMonth(startOfMonth(parseLocalYmd(from) || new Date()));
  }, [from, open]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); setOpen(false); }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useIsoLayoutEffect(() => {
    if (!open) {
      setPopupStyle(null);
      return;
    }

    const updatePopupPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 6;
      const horizontalOffset = 32;
      const popupWidth = Math.min(single ? 280 : 480, Math.max(0, viewportWidth - viewportPadding * 2));
      const popupHeight = popupRef.current?.offsetHeight || 312;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - popupWidth + horizontalOffset),
        Math.max(viewportPadding, viewportWidth - popupWidth - viewportPadding)
      );
      const below = viewportHeight - rect.bottom - gap - viewportPadding;
      const above = rect.top - gap - viewportPadding;
      const top = below >= popupHeight || below >= above
        ? Math.min(rect.bottom + gap, Math.max(viewportPadding, viewportHeight - popupHeight - viewportPadding))
        : Math.max(viewportPadding, rect.top - gap - popupHeight);

      setPopupStyle({ position: "fixed", left, top, width: popupWidth, zIndex: 200 });
    };

    updatePopupPosition();
    const animationFrame = window.requestAnimationFrame(updatePopupPosition);
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [open, single, useIsoLayoutEffect]);

  const selectDate = React.useCallback(
    (ymd: string) => {
      if (single) { onFromChange(ymd); setOpen(false); return; }
      if (!from || to) {
        onFromChange(ymd);
        onToChange("");
        return;
      }
      if (ymd < from) {
        onFromChange(ymd);
        onToChange(from);
      } else {
        onToChange(ymd);
      }
      setOpen(false);
    },
    [from, to, onFromChange, onToChange, single]
  );

  const clearRange = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onFromChange("");
      onToChange("");
    },
    [onFromChange, onToChange]
  );

  const renderMonth = (month: Date) => (
    <div className="min-w-0">
      <div className="mb-3 text-center text-[13px] font-semibold text-[var(--app-fg)]">{locale === "en" ? month.toLocaleDateString("en", { month: "long", year: "numeric" }) : monthTitle(month)}</div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {(locale === "en" ? ENGLISH_WEEKDAYS : DATE_RANGE_WEEKDAYS).map((label) => (
          <div key={label} className="h-6 text-[12px] leading-6 text-[var(--app-muted)]">
            {label}
          </div>
        ))}
        {buildMonthCells(month).map((cell) => {
          const isEndpoint = cell.ymd === from || cell.ymd === to;
          const inRange = Boolean(from && to && cell.ymd > from && cell.ymd < to);
          const isToday = cell.ymd === localYmd(new Date());
          return (
            <button
              key={cell.ymd}
              type="button"
              aria-label={displayDate(cell.ymd)}
              aria-pressed={isEndpoint}
              onClick={() => selectDate(cell.ymd)}
              className={[
                "mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[12px] transition",
                cell.inMonth ? "text-[var(--app-fg)]" : "text-[var(--app-muted)] opacity-45",
                inRange ? "bg-[color-mix(in_srgb,var(--primary-bg)_12%,transparent)] text-[var(--primary-bg)]" : "",
                isEndpoint ? "bg-[var(--primary-bg)] text-[var(--primary-fg)] shadow-sm opacity-100" : "hover:bg-[color-mix(in_srgb,var(--primary-bg)_12%,transparent)] hover:text-[var(--primary-bg)]",
                isToday && !isEndpoint ? "ring-1 ring-[color-mix(in_srgb,var(--primary-bg)_35%,transparent)]" : "",
              ].join(" ")}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <div
        className={[
          "flex items-center rounded-lg border bg-[var(--input-bg)] px-3 text-left text-[12px] outline-none transition",
          single ? "h-10 w-full" : "h-8 w-[290px]",
          open ? "border-[var(--primary-bg)] ring-1 ring-[color-mix(in_srgb,var(--primary-bg)_25%,transparent)]" : "border-[var(--border)] hover:border-[color-mix(in_srgb,var(--primary-bg)_35%,var(--border))]",
        ].join(" ")}
      >
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
        >
          <span className={from ? "text-[var(--app-fg)]" : "text-[var(--app-muted)]"}>{from ? displayDate(from) : (single ? <UiText id="common.mf173390b402e" /> : <UiText id="common.m760506491eef" />)}</span>
          {!single && <>
          <span className="mx-3 text-[var(--app-muted)]">→</span>
          <span className={to ? "text-[var(--app-fg)]" : "text-[var(--app-muted)]"}>{to ? displayDate(to) : <UiText id="common.m895cd52fbbb6" />}</span>
          </>}
        </button>
        <span className="ml-auto flex items-center gap-1 pl-2 text-[var(--app-muted)]">
          {hasValue ? (
            <UiProps ids={{"title":["common.m941e41b88b3b"]}}><button
              type="button"
              onClick={clearRange}
              title="common.m941e41b88b3b"
              className="flex h-5 w-5 items-center justify-center rounded-md transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            >
              <X className="h-3.5 w-3.5" />
            </button></UiProps>
          ) : null}
          <UiProps ids={{"title":["common.m680c78ec60f4"]}}><button
            type="button"
            onClick={() => setOpen((value) => !value)}
            title="common.m680c78ec60f4"
            className="flex h-5 w-5 items-center justify-center rounded-md transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
          >
            <Calendar className="h-3.5 w-3.5" />
          </button></UiProps>
        </span>
      </div>

      {open && popupStyle && typeof document !== "undefined" ? createPortal(
        <div
          ref={popupRef}
          style={popupStyle}
          className="app-dropdown-panel rounded-xl border border-[var(--border)] bg-[var(--date-range-panel-bg,var(--panel-bg))] p-3 shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
        >
          <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center">
            <div className="flex items-center gap-1">
              <UiProps ids={{"title":["common.m43cecd06c54d"]}}><button
                type="button"
                onClick={() => setViewMonth((value) => addMonths(value, -12))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                title="common.m43cecd06c54d"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button></UiProps>
              <UiProps ids={{"title":["common.mf9e727223456"]}}><button
                type="button"
                onClick={() => setViewMonth((value) => addMonths(value, -1))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                title="common.mf9e727223456"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button></UiProps>
            </div>
            <div />
            <div className="flex items-center justify-end gap-1">
              <UiProps ids={{"title":["common.m3e0b634699d4"]}}><button
                type="button"
                onClick={() => setViewMonth((value) => addMonths(value, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                title="common.m3e0b634699d4"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button></UiProps>
              <UiProps ids={{"title":["common.m30fd49298c03"]}}><button
                type="button"
                onClick={() => setViewMonth((value) => addMonths(value, 12))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                title="common.m30fd49298c03"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button></UiProps>
            </div>
          </div>
          <div className={single ? "" : "grid grid-cols-2 gap-4"}>
            {renderMonth(viewMonth)}
            {!single && renderMonth(addMonths(viewMonth, 1))}
          </div>
        </div>,
        single ? (rootRef.current || document.body) : document.body
      ) : null}
    </div>
  );
}
