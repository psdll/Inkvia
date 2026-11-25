"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


export type ProviderSidebarItem = {
  id: string;
  name: string;
  count: number;
  enabled?: boolean;
  dirty?: boolean;
};

export function ProviderSidebar({ items, selectedId, onSelect, label }: {
  items: ProviderSidebarItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const { text, locale } = useUiLocale();
  return <nav aria-label={label} className="flex min-h-0 gap-1 overflow-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 lg:flex-col">
      {items.map(item => <button key={item.id} type="button"
        aria-current={selectedId === item.id ? "true" : undefined}
        aria-pressed={selectedId === item.id}
        onClick={() => onSelect(item.id)}
        title={`${item.name}${item.enabled === undefined ? "" : item.enabled ? text("providersDynamic.me701046a2d42") : text("providersDynamic.m55c21d34de25")}${item.dirty ? text("providersDynamic.mb9c47d16cedf") : ""}`}
        className={`flex h-9 shrink-0 items-center justify-between gap-2 rounded-lg px-2 text-left text-[12px] font-normal leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] ${selectedId === item.id ? "bg-blue-500/10 text-blue-400" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]"}`}>
        <span className="min-w-0 truncate">{item.name}</span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
          {item.dirty && <UiProps ids={{"aria-label":["admin.m6a1be012c99c"]}}><span aria-label="admin.m6a1be012c99c" className="h-1 w-1 rounded-full bg-amber-500" /></UiProps>}{locale === "en" ? item.count.toLocaleString("en") : item.count}
        </span>
      </button>)}
  </nav>;
}
