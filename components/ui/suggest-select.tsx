"use client";
import { UiText, useUiLocale } from "@/i18n/ui";

import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

type SuggestSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  createLabel?: (value: string) => string;
  emptyHint?: string;
  optionIcon?: React.ReactNode;
  maxLength?: number;
  onDeleteOption?: (value: string) => void;
};

export function SuggestSelect({
  value,
  onChange,
  options,
  placeholder: placeholderProp,
  createLabel,
  emptyHint: emptyHintProp,
  optionIcon,
  maxLength,
  onDeleteOption,
}: SuggestSelectProps) {
  const { text } = useUiLocale();
  const placeholder = placeholderProp ?? text("createDynamic.mcc85937f6640");
  const emptyHint = emptyHintProp ?? text("createDynamic.m9d7361dac648");
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);

  const filtered = React.useMemo(() => {
    const keyword = inputValue.trim().toLowerCase();
    if (!keyword || options.some((option) => option.toLowerCase() === keyword)) return options;
    return options.filter((option) => option.toLowerCase().includes(keyword));
  }, [inputValue, options]);
  const showCreate = inputValue.trim().length > 0 && !options.some((option) => option.toLowerCase() === inputValue.trim().toLowerCase());

  React.useEffect(() => setInputValue(value), [value]);

  const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
  useIsoLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({ position: "fixed", top: rect.bottom + 6, left: rect.left, right: Math.max(0, window.innerWidth - rect.right), zIndex: 300 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const commit = (nextValue: string) => {
    onChange(nextValue);
    setInputValue(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--input-bg)] transition focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
        <input
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={(event) => {
            setOpen(true);
            if (inputValue && options.includes(inputValue)) event.currentTarget.select();
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]"
        />
        {inputValue ? (
          <UiProps ids={{"title":["common.m1ef3de06b32e"]}}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setInputValue(""); onChange(""); setOpen(true); }} title="common.m1ef3de06b32e" className="flex h-10 w-8 shrink-0 items-center justify-center text-[var(--app-muted)] transition hover:text-[var(--app-fg)]">
            <X className="h-3.5 w-3.5" />
          </button></UiProps>
        ) : null}
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-10 w-9 shrink-0 items-center justify-center border-l border-[var(--border)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]">
          <ChevronDown className={["h-4 w-4 transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button>
      </div>
      {open && menuStyle && typeof document !== "undefined" ? createPortal(
        <div ref={listRef} style={menuStyle} className="app-dropdown-panel overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_14px_40px_-10px_rgba(15,15,25,0.22)]">
          <div className="max-h-[240px] overflow-y-auto p-1.5">
            {showCreate ? (
              <button type="button" onClick={() => commit(inputValue.trim())} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[12px] text-blue-500 transition hover:bg-blue-500/10">
                <Plus className="h-3.5 w-3.5 shrink-0" />
                {createLabel ? createLabel(inputValue.trim()) : <UiText id="common.mf548ec522212" values={{v0: String(inputValue.trim())}} />}
              </button>
            ) : null}
            {filtered.length === 0 && !showCreate ? <div className="px-3 py-3 text-center text-[12px] text-[var(--app-muted)]">{emptyHint}</div> : filtered.map((option) => (
              <div key={option} className={["flex items-center rounded-lg transition", value === option ? "bg-blue-500/10 text-blue-500" : "text-[var(--app-fg)] hover:bg-[var(--panel-2)]"].join(" ")}>
                <button type="button" onClick={() => commit(option)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-[13px]">
                  {optionIcon ? <span className="shrink-0 text-[var(--app-muted)]">{optionIcon}</span> : null}
                  <span className="truncate">{option}</span>
                </button>
                {onDeleteOption ? (
                  <button type="button" onClick={() => onDeleteOption(option)} className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-red-500/10 hover:text-red-500" title={text("createDynamic.m038b6f46c7a7", { name: option })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
