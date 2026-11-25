"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type FrostedStepperProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  trimTrailingZeros?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseNumber(raw: string) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(n: number, decimals?: number, trimTrailingZeros?: boolean) {
  if (decimals == null) return String(Math.trunc(n));
  const fixed = n.toFixed(decimals);
  if (!trimTrailingZeros) return fixed;
  return String(Number(fixed));
}

export function FrostedStepper({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  trimTrailingZeros,
  ariaLabel,
  disabled = false
}: FrostedStepperProps) {
  const { text } = useUiLocale();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const onValueChange = (raw: string) => {
    if (disabled) return;
    if (raw === "") {
      onChange("");
      return;
    }
    const n = parseNumber(raw);
    if (n == null) return;
    const clamped = clamp(n, min, max);
    onChange(raw === String(clamped) ? raw : String(clamped));
  };

  const onBlur = () => {
    if (disabled) return;
    if (value === "") {
      onChange(formatNumber(min, decimals, trimTrailingZeros));
      return;
    }
    const n = parseNumber(value);
    if (n == null) {
      onChange(formatNumber(min, decimals, trimTrailingZeros));
      return;
    }
    const clamped = clamp(n, min, max);
    onChange(formatNumber(clamped, decimals, trimTrailingZeros));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "Enter") {
      onBlur();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = parseNumber(value);
      const next = clamp((n == null ? min : n) + step, min, max);
      onChange(formatNumber(next, decimals, trimTrailingZeros));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = parseNumber(value);
      const next = clamp((n == null ? min : n) - step, min, max);
      onChange(formatNumber(next, decimals, trimTrailingZeros));
      return;
    }
  };

  const bump = (dir: 1 | -1) => {
    if (disabled) return;
    const n = parseNumber(value);
    const base = n == null ? min : n;
    const next = clamp(base + dir * step, min, max);
    onChange(formatNumber(next, decimals, trimTrailingZeros));
    queueMicrotask(() => inputRef.current?.focus());
  };

  return (
    <div className="space-y-2">
      <label className="text-[var(--app-muted)] text-xs">{label}</label>
      <div className="relative group">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel || label}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="w-full h-10 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] shadow-[var(--shadow-2)] px-3 pr-10 text-sm text-[var(--app-fg)] outline-none hover:bg-[var(--panel-2)] focus:ring-2 focus:ring-blue-500/20 transition-colors disabled:bg-[var(--panel-2)] disabled:text-[var(--app-muted)] disabled:hover:bg-[var(--panel-2)]"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label={text("createDynamic.ma51137f19572", { label: label })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => bump(1)}
            disabled={disabled}
            className="w-6 h-[14px] rounded-md border-0 bg-transparent text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors flex items-center justify-center disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronUp className="w-4 h-4 -mt-[1px]" />
          </button>
          <button
            type="button"
            aria-label={text("createDynamic.m86c72b949a5b", { label: label })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => bump(-1)}
            disabled={disabled}
            className="w-6 h-[14px] rounded-md border-0 bg-transparent text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors flex items-center justify-center disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronDown className="w-4 h-4 -mb-[1px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
