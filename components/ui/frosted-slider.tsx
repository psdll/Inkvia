"use client";

import * as React from "react";
import { CircleHelp } from "lucide-react";

type FrostedSliderProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  ariaLabel?: string;
  hint?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function roundToStep(value: number, min: number, step: number) {
  const snapped = Math.round((value - min) / step) * step + min;
  const p = step.toString();
  const idx = p.indexOf(".");
  const precision = idx >= 0 ? p.length - idx - 1 : 0;
  return Number(snapped.toFixed(Math.min(6, precision)));
}

function parseNumber(raw: string, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function FrostedSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  ariaLabel,
  hint
}: FrostedSliderProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const current = clamp(roundToStep(parseNumber(value, min), min, step), min, max);
  const display = decimals != null ? current.toFixed(decimals) : String(current);

  const setFromValue = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max);
      const snapped = roundToStep(clamped, min, step);
      const out = decimals != null ? snapped.toFixed(decimals) : String(snapped);
      onChange(out);
    },
    [decimals, max, min, onChange, step]
  );

  const percent = max === min ? 0 : ((current - min) / (max - min)) * 100;

  const setFromClientX = React.useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const ratio = rect.width <= 0 ? 0 : x / rect.width;
      setFromValue(min + ratio * (max - min));
    },
    [max, min, setFromValue]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setFromClientX(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setFromValue(current + step);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setFromValue(current - step);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setFromValue(min);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setFromValue(max);
      return;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[var(--app-muted)] text-xs inline-flex items-center gap-1.5">
          <span>{label}</span>
          {hint ? (
            <span className="relative inline-flex items-center group">
              <CircleHelp className="w-3.5 h-3.5 opacity-70" />
              <span
                className={[
                  "absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] z-20",
                  "hidden group-hover:block group-focus-within:block whitespace-normal w-56",
                  "rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5",
                  "text-[11px] leading-relaxed text-[var(--app-fg)] shadow-[var(--shadow)]"
                ].join(" ")}
              >
                {hint}
              </span>
            </span>
          ) : null}
        </label>
        <span className="text-xs text-[var(--app-fg)] tabular-nums">{display}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel || label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={[
          "w-full h-10 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] shadow-[var(--shadow-2)] px-3",
          "flex items-center outline-none hover:bg-[var(--panel-2)] focus:ring-2 focus:ring-blue-500/20 transition-colors",
          dragging ? "cursor-grabbing" : "cursor-pointer"
        ].join(" ")}
      >
        <div className="relative w-full h-2 rounded-full bg-[var(--border)]">
          <div
            className="absolute left-0 top-0 h-2 rounded-full bg-[var(--primary-bg)]"
            style={{ width: `${percent}%` }}
          />
          <div
            className={[
              "absolute top-1/2 -translate-y-1/2",
              "w-4 h-4 rounded-full border border-[var(--border-2)] bg-[var(--panel-bg)]",
              "shadow-[var(--shadow-2)]"
            ].join(" ")}
            style={{ left: `calc(${percent}% - 8px)` }}
          />
        </div>
      </div>
    </div>
  );
}
