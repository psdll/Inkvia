import { UiText } from "@/i18n/ui";
import * as React from "react";

export function StudioToolBodyLoading() {
  return (
    <div data-studio-tool-body-loading="" aria-hidden="true" className="absolute inset-0 flex min-h-0 flex-col gap-3 p-[clamp(14px,2.2dvh,20px)] motion-safe:animate-pulse">
      <div className="flex h-7 shrink-0 items-center justify-between">
        <div className="h-3 w-16 rounded bg-[var(--panel-2)]" />
        <div className="h-7 w-20 rounded-full border border-[var(--border)]" />
      </div>
      <div className="h-[clamp(180px,28dvh,260px)] shrink-0 rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-2)]" />
      <div className="h-3 w-20 shrink-0 rounded bg-[var(--panel-2)]" />
      <div className="min-h-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]" />
      <div className="h-10 shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]" />
      <div className="h-12 shrink-0 rounded-xl bg-[var(--panel-2)]" />
    </div>
  );
}

export function StudioLoading() {
  return (
    <div data-studio-loading="" aria-busy="true" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-[var(--app-bg)] p-[clamp(12px,2dvh,20px)]">
      <span role="status" className="sr-only"><UiText id="studio.m926854b4fcee" /></span>
      <div aria-hidden="true" className="grid h-12 shrink-0 grid-cols-2 gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 min-[980px]:hidden">
        <div className="rounded-lg bg-[var(--panel-2)]" />
        <div className="rounded-lg bg-[var(--panel-2)]" />
      </div>
      <div aria-hidden="true" className="grid min-h-0 flex-1 grid-cols-1 gap-[clamp(12px,2dvh,24px)] min-[980px]:grid-cols-[clamp(400px,40vw,480px)_minmax(420px,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
          <div className="flex h-[64px] shrink-0 items-center border-b border-[var(--border)] p-[clamp(12px,1.8dvh,16px)]">
            <div className="grid w-full grid-cols-2 gap-2 motion-safe:animate-pulse">
              <div className="h-10 rounded-2xl bg-[var(--panel-2)]" />
              <div className="h-10 rounded-2xl bg-[var(--panel-2)]" />
            </div>
          </div>
          <div className="relative min-h-0 flex-1"><StudioToolBodyLoading /></div>
        </div>
        <div data-studio-history-loading="" className="relative hidden min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] min-[980px]:flex">
          <div className="relative flex h-12 shrink-0 items-center justify-end gap-2 px-3 motion-safe:animate-pulse">
            <div className="absolute left-1/2 top-2 h-6 w-36 -translate-x-1/2 rounded-full border border-[var(--border)]" />
            <div className="h-7 w-24 rounded-full bg-[var(--panel-2)]" />
            <div className="h-7 w-24 rounded-full bg-[var(--panel-2)]" />
            <div className="h-7 w-24 rounded-full bg-[var(--panel-2)]" />
          </div>
          <div className="min-h-0 flex-1" />
          <div className="flex shrink-0 gap-2 p-2 motion-safe:animate-pulse">
            <div className="h-8 w-24 rounded-lg bg-[var(--panel-2)]" />
            <div className="h-8 w-16 rounded-lg bg-[var(--panel-2)]" />
            <div className="h-8 w-20 rounded-lg bg-[var(--panel-2)]" />
          </div>
          <div className="mt-4 shrink-0 border-t border-[var(--border)] p-2">
            <div className="h-20 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
