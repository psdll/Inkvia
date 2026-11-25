"use client";

import * as React from "react";

// Group-card parameter layout shared by the canvas popovers, the studio tools and the batch
// workbench. Styling lives in globals.css under `.canvas-param-card-sections`.

export type ParamCardKind = "ratio" | "quality" | "resolution" | "count";

export function ParamCardSections({ pairQualityResolution, pairCountFormat, className = "", children, ...rest }: {
  pairQualityResolution?: boolean;
  pairCountFormat?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      {...rest}
      className={`canvas-task-parameter-sections canvas-param-card-sections ${className}`.trim()}
      data-pair-quality-resolution={pairQualityResolution || undefined}
      data-pair-count-format={pairCountFormat || undefined}
    >
      {children}
    </div>
  );
}

export function ParamCard({ title, card, children, ariaLabel, className = "" }: {
  title: React.ReactNode;
  card?: ParamCardKind;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <section className={`canvas-task-parameter-section ${className}`.trim()} data-param-card={card} aria-label={ariaLabel}>
      <div className="canvas-task-parameter-label">{title}</div>
      {children}
    </section>
  );
}

export type ParamOption = { value: string; label: string; disabled?: boolean; hint?: string };

export function ParamOptionGrid<T extends ParamOption>({ options, value, onChange, columns, disabled, renderAspect, ariaLabel }: {
  options: readonly T[];
  value: string;
  onChange(value: string): void;
  columns?: number;
  disabled?: boolean;
  /** When given, options render as ratio tiles with this leading shape. */
  renderAspect?(option: T, selected: boolean): React.ReactNode;
  ariaLabel?: string;
}) {
  const aspect = Boolean(renderAspect);
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={aspect ? "canvas-image-parameter-ratio-grid" : "grid gap-2"}
      data-single-option={(aspect && options.length === 1) || undefined}
      style={aspect ? undefined : { gridTemplateColumns: `repeat(${columns || Math.min(3, Math.max(1, options.length))}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const unavailable = disabled || Boolean(option.disabled);
        return (
          <button
            key={option.value}
            type="button"
            title={option.hint || option.label}
            data-selected={selected}
            disabled={unavailable}
            onClick={() => !unavailable && onChange(option.value)}
            className={aspect ? "canvas-task-parameter-option canvas-task-aspect-option" : "canvas-task-parameter-option"}
          >
            {aspect ? <>{renderAspect!(option, selected)}<span>{option.label}</span></> : <span className="min-w-0 truncate">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
