"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { CANVAS_TASK_POPOVER_DISMISS_EVENT } from "@/lib/canvas/task-popover-events";

export type FrostedSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string;
  buttonLabel?: string;
  depth?: number;
  separatorBefore?: boolean;
};

export type FrostedSelectLeadingContext = {
  placement: "button" | "option";
  selected: boolean;
  active: boolean;
};

export type FrostedSelectSide = "top" | "bottom" | "auto";
export type FrostedSelectVariant = "default" | "toolbar" | "canvas";

export type FrostedSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: FrostedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  triggerIcon?: React.ReactNode;
  menuClassName?: string;
  menuTitle?: string;
  ariaLabel?: string;
  showLeading?: boolean;
  showOptionLeading?: boolean;
  renderLeading?: (option: FrostedSelectOption, ctx: FrostedSelectLeadingContext) => React.ReactNode;
  side?: FrostedSelectSide;
  compact?: boolean;
  truncateLabel?: boolean;
  fitLabel?: boolean;
  variant?: FrostedSelectVariant;
  menuWidth?: number;
  menuMaxHeight?: number;
  optionHeight?: number;
};

export type FrostedSelectMenuWidthInput = {
  buttonWidth: number;
  widestLabelWidth: number;
  viewportWidth: number;
  showLeading: boolean;
  compact: boolean;
};

export function resolveFrostedSelectMenuWidth({
  buttonWidth,
  widestLabelWidth,
  viewportWidth,
  showLeading,
  compact,
}: FrostedSelectMenuWidthInput) {
  const viewportPadding = 12;
  const menuPadding = 16;
  const optionPadding = compact ? 16 : 20;
  const optionGap = compact ? 4 : 6;
  const leadingWidth = showLeading ? 14 + optionGap : 0;
  const trailingWidth = 16 + optionGap;
  const scrollbarAllowance = 12;
  const desiredWidth = Math.ceil(
    widestLabelWidth
      + menuPadding
      + optionPadding
      + leadingWidth
      + trailingWidth
      + scrollbarAllowance,
  );
  const viewportLimit = Math.max(0, viewportWidth - viewportPadding * 2);

  return Math.min(
    viewportLimit,
    Math.max(Math.min(buttonWidth, viewportLimit), desiredWidth),
  );
}

export function FrostedSelect({
  value,
  onChange,
  options,
  placeholder: placeholderProp,
  disabled = false,
  className = "",
  buttonClassName = "",
  triggerIcon,
  menuClassName = "",
  menuTitle,
  ariaLabel,
  showLeading = true,
  showOptionLeading = true,
  renderLeading,
  side,
  compact = false,
  truncateLabel = true,
  fitLabel = false,
  variant = "default",
  menuWidth,
  menuMaxHeight: preferredMenuMaxHeight,
  optionHeight,
}: FrostedSelectProps) {
  const { text } = useUiLocale();
  const placeholder = placeholderProp ?? text("createDynamic.mda590a8fe3ce");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const listId = React.useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const selected = options[selectedIndex];
  const selectedButtonLabel = selected?.buttonLabel || selected?.label || "";
  const selectedLabelLen = String(selectedButtonLabel).trim().length;
  const fittedButtonTextClass = fitLabel
    ? selectedLabelLen >= 8
      ? "text-[9px] tracking-tight"
      : selectedLabelLen >= 6
        ? "text-[10px] tracking-tight"
        : "text-[11px]"
    : "";

  const [adminScope, setAdminScope] = React.useState(false);
  React.useLayoutEffect(() => { setAdminScope(document.documentElement.dataset.adminDropdownScope === "true"); }, []);
  const effectiveLeading = showLeading && (!adminScope || !!renderLeading);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);
  const [activeSource, setActiveSource] = React.useState<"keyboard" | "pointer">("keyboard");
  const menuZIndex = variant === "canvas" ? "var(--canvas-layer-popover)" : 200;
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 320,
    zIndex: menuZIndex
  });

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      const menu = listRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (el.contains(target)) return;
      if (menu?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); buttonRef.current?.focus(); }
    };
    const handleCanvasViewportMove = () => setOpen(false);

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    if (variant === "canvas") window.addEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, handleCanvasViewportMove);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
      if (variant === "canvas") window.removeEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, handleCanvasViewportMove);
    };
  }, [open, variant]);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    setActiveSource("keyboard");
  }, [open, selectedIndex]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const viewportH = window.innerHeight || 0;
      const viewportW = window.innerWidth || 0;
      const viewportPadding = 12;
      const gap = adminScope ? 6 : 10;
      const nodeAnchored = variant === "canvas";
      const below = Math.max(0, viewportH - rect.bottom - viewportPadding - gap);
      const above = Math.max(0, rect.top - viewportPadding - gap);
      const preferredMenuHeight = Math.min(preferredMenuMaxHeight ?? 420, options.length * (optionHeight ?? 40) + 8 + (menuTitle ? 32 : 0));
      const measuredHeight = listRef.current?.firstElementChild?.getBoundingClientRect().height;
      const desiredHeight = Math.min(preferredMenuMaxHeight ?? 420, measuredHeight ? Math.ceil(measuredHeight) + 2 : preferredMenuHeight + 10);
      const preferredSide = side ?? (adminScope ? "auto" : "top");
      const nextSide = preferredSide === "auto"
        ? (nodeAnchored || below >= desiredHeight || below >= above ? "bottom" : "top")
        : preferredSide;
      const availableHeight = nextSide === "top" ? above : below;
      const nextMaxHeight = !nodeAnchored && availableHeight > 0
        ? Math.min(desiredHeight, availableHeight)
        : desiredHeight;
      const buttonStyle = window.getComputedStyle(button);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = buttonStyle.font || `${buttonStyle.fontSize} ${buttonStyle.fontFamily}`;
      }
      const letterSpacing = Number.parseFloat(buttonStyle.letterSpacing) || 0;
      const widestLabelWidth = options.reduce((widest, option) => {
        const label = String(option.label || "");
        const measured = context?.measureText(label).width ?? label.length * 8;
        return Math.max(widest, measured + Math.max(0, label.length - 1) * letterSpacing);
      }, 0);
      const measuredWidth = resolveFrostedSelectMenuWidth({
        buttonWidth: rect.width,
        widestLabelWidth,
        viewportWidth: nodeAnchored ? Number.POSITIVE_INFINITY : viewportW,
        showLeading: effectiveLeading,
        compact,
      });
      const viewportWidthLimit = Math.max(0, viewportW - viewportPadding * 2);
      const width = menuWidth == null
        ? measuredWidth
        : nodeAnchored ? menuWidth : Math.min(menuWidth, viewportWidthLimit);
      const left = nodeAnchored ? rect.left : Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, viewportW - width - viewportPadding)
      );

      setMenuStyle(
        nextSide === "top"
          ? {
              position: "fixed",
              left,
              bottom: nodeAnchored ? viewportH - rect.top + gap : Math.max(viewportPadding, viewportH - rect.top + gap),
              width,
              maxHeight: nextMaxHeight,
              zIndex: menuZIndex
            }
          : {
              position: "fixed",
              left,
              top: nodeAnchored ? rect.bottom + gap : Math.min(viewportH - viewportPadding, rect.bottom + gap),
              width,
              maxHeight: nextMaxHeight,
              zIndex: menuZIndex
            }
      );
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [adminScope, compact, effectiveLeading, menuTitle, menuWidth, menuZIndex, open, optionHeight, options, preferredMenuMaxHeight, side, variant]);

  React.useEffect(() => {
    if (!open || activeSource === "pointer") return;
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (list && item) {
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeIndex, activeSource, open]);

  const commit = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    queueMicrotask(() => buttonRef.current?.focus());
  };

  const onButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) {
        const next = options[activeIndex];
        if (next && !next.disabled) commit(next.value);
      } else {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSource("keyboard");
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSource("keyboard");
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((i) => Math.max(0, i - 1));
      }
      return;
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = options[activeIndex];
      if (next && !next.disabled) commit(next.value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSource("keyboard");
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSource("keyboard");
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
  };

  return (
    <div ref={rootRef} className={["relative", className].filter(Boolean).join(" ")}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={variant === "canvas" ? undefined : selected ? selected.label : placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        className={[
          variant === "toolbar"
            ? "w-full h-10 rounded-2xl border border-black/[0.07] bg-white/28 px-4 flex items-center gap-2 text-sm font-medium text-[var(--app-muted)] outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.42),_0_6px_14px_-14px_rgba(15,23,42,0.45)] backdrop-blur-lg hover:border-black/[0.12] hover:bg-white/45 hover:text-[var(--app-fg)] transition dark:border-white/[0.16] dark:bg-white/[0.075] dark:text-[var(--app-fg)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/[0.12]"
            : variant === "canvas"
              ? `canvas-task-select-trigger flex h-8 w-full items-center gap-1 rounded-lg border border-transparent bg-transparent px-2 text-[13px] font-medium leading-[18px] text-[var(--canvas-controls-text)] outline-none transition-colors focus:ring-1 focus:ring-[var(--canvas-controls-active)] ${open ? "bg-[var(--canvas-task-param-active)]" : "hover:bg-[var(--canvas-task-param-hover)]"}`
            : [
                "w-full h-10 rounded-xl border border-[var(--border)] bg-[var(--input-bg)]",
                "shadow-[var(--shadow-2)]",
                compact ? "px-2 flex items-center gap-1 text-[11px] text-[var(--app-fg)] outline-none" : "px-2.5 flex items-center gap-1.5 text-[12px] text-[var(--app-fg)] outline-none",
                "hover:bg-[var(--panel-2)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)] transition-colors"
              ].join(" "),
          disabled ? "opacity-50 cursor-not-allowed hover:bg-[var(--input-bg)]" : "",
          buttonClassName
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {effectiveLeading ? (
          renderLeading ? (
            renderLeading(selected || options[0]!, { placement: "button", selected: true, active: false })
          ) : variant !== "toolbar" ? (
            <span className="w-3.5 h-3.5 rounded-[3px] border border-[var(--border)] bg-transparent" />
          ) : null
        ) : null}
        <span
          className={[
            "flex-1 min-w-0 text-left whitespace-nowrap",
            truncateLabel ? "truncate" : "",
            selected ? "" : "text-[var(--app-muted)]",
            fittedButtonTextClass
          ].join(" ")}
        >
          {selected ? selectedButtonLabel : placeholder}
        </span>
        {triggerIcon ?? <ChevronDown className={[fitLabel ? "w-3 h-3" : "w-4 h-4", "shrink-0 opacity-80 transition-transform", open ? "rotate-180" : ""].join(" ")} />}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={listRef}
          id={listId}
          data-frosted-select-menu
          role="listbox"
          aria-label={menuTitle || ariaLabel}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          style={menuStyle}
          className={[
            "overflow-x-hidden overflow-y-auto",
            variant === "toolbar"
              ? "rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] app-dropdown-panel shadow-[0_18px_40px_-20px_rgba(15,23,42,0.55)] backdrop-blur-xl"
              : variant === "canvas"
                ? "canvas-task-select-menu rounded-2xl border border-[var(--canvas-task-param-border)] bg-[var(--canvas-task-param-bg)] shadow-[var(--canvas-shadow-dropdown)] backdrop-blur-[32px]"
              : "rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] select-dropdown-panel app-dropdown-panel shadow-[var(--shadow)]",
            menuClassName
          ].join(" ")}
        >
          <div className={variant === "toolbar" || variant === "canvas" ? "p-1" : "p-2"}>
            {menuTitle && <div data-frosted-select-title role="presentation" className="px-2 py-2 text-xs text-[var(--app-muted)]">{menuTitle}</div>}
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isActive = idx === activeIndex;
              const isDisabled = !!opt.disabled;
              return (
                <React.Fragment key={opt.value}>
                  {opt.separatorBefore ? (
                    <div role="presentation" className="mx-2 my-1 h-px bg-[var(--border)]" />
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    title={variant === "canvas" ? undefined : isDisabled ? opt.hint || opt.label : opt.label}
                    aria-selected={isSelected}
                    aria-disabled={isDisabled}
                    disabled={isDisabled}
                    data-index={idx}
                    style={optionHeight ? { minHeight: optionHeight } : undefined}
                    onMouseEnter={() => { setActiveSource("pointer"); setActiveIndex(idx); }}
                    onClick={() => !isDisabled && commit(opt.value)}
                    className={[
                      variant === "toolbar"
                        ? "w-full h-11 rounded-xl px-4 flex items-center gap-2 text-sm"
                        : variant === "canvas"
                          ? "flex min-h-8 w-full items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] leading-[18px]"
                        : compact
                          ? "w-full min-h-10 rounded-xl px-2 py-2 flex items-center gap-1 text-[11px]"
                          : "w-full min-h-10 rounded-xl px-2.5 py-2 flex items-center gap-1.5 text-[12px]",
                      opt.depth ? (variant === "toolbar" ? "pl-7" : "pl-5") : "",
                      "transition-colors outline-none",
                      adminScope ? "!rounded-lg cursor-pointer" : "",
                      isSelected
                        ? variant === "toolbar"
                          ? "bg-slate-50/70 text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-white/[0.09]"
                          : variant === "canvas"
                            ? "bg-[var(--canvas-task-param-active)] text-[var(--canvas-controls-text)]"
                            : adminScope ? "bg-[color-mix(in_srgb,var(--primary-bg)_14%,transparent)] text-[var(--app-fg)]" : "bg-[var(--primary-bg)] text-[var(--primary-fg)] shadow-[var(--shadow-2)]"
                        : isDisabled
                          ? "opacity-45 cursor-not-allowed text-[var(--app-muted)]"
                          : isActive
                            ? variant === "toolbar"
                              ? "bg-white/45 text-[var(--app-fg)] dark:bg-white/[0.08]"
                              : variant === "canvas"
                                ? "bg-[var(--canvas-task-param-hover)] text-[var(--canvas-controls-text)]"
                                : "bg-[var(--panel-2)] text-[var(--app-fg)]"
                            : variant === "toolbar"
                              ? "text-[var(--app-muted)] hover:bg-white/45 hover:text-[var(--app-fg)] dark:hover:bg-white/[0.08]"
                              : variant === "canvas"
                                ? "text-[var(--canvas-controls-text)] hover:bg-[var(--canvas-task-param-hover)]"
                                : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                    ].filter(Boolean).join(" ")}
                  >
                    {effectiveLeading && showOptionLeading ? (
                      renderLeading ? (
                        renderLeading(opt, { placement: "option", selected: isSelected, active: isActive })
                      ) : variant !== "toolbar" ? (
                        <span className="w-3.5 h-3.5 rounded-[3px] border border-[var(--border)] bg-transparent" />
                      ) : null
                    ) : null}
                    {variant === "toolbar" || (variant === "canvas" && opt.hint) ? (
                      <span className={`flex min-w-0 flex-1 flex-col text-left ${variant === "canvas" ? "leading-[18px]" : "leading-tight"}`}>
                        <span className="whitespace-nowrap">{opt.label}</span>
                        {opt.hint && !isDisabled ? <span className={`mt-0.5 truncate opacity-65 ${variant === "canvas" ? "text-[11px] leading-4" : "text-[10px]"}`}>{opt.hint}</span> : null}
                      </span>
                    ) : (
                      <>
                        <span className={["flex-1 min-w-0 break-words whitespace-normal text-left", fitLabel ? "text-[10px] tracking-tight" : ""].join(" ")}>{opt.label}</span>
                        {opt.hint && !isDisabled ? <span className="shrink-0 text-[10px] opacity-65">{opt.hint}</span> : null}
                      </>
                    )}
                    {variant !== "toolbar" && variant !== "canvas" ? (
                      isSelected ? <Check className="w-4 h-4 shrink-0 opacity-90" /> : <span className="w-4 h-4 shrink-0" />
                    ) : null}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        , buttonRef.current?.closest("[role=dialog]") || document.body)
        : null}
    </div>
  );
}
