import { UiText } from "@/i18n/ui";
import * as React from "react";

export function MaterialSkeleton() {
  return (
    <div data-materials-grid-loading="" aria-hidden="true" className="grid w-full max-w-full grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-[3px] overflow-hidden motion-safe:animate-pulse">
      {Array.from({ length: 24 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]">
          <div className="aspect-square bg-[var(--panel-2)]" />
          <div className="h-[86px] space-y-2 border-t border-[var(--border)] p-3">
            <div className="h-3 w-14 rounded bg-[var(--panel-2)]" />
            <div className="h-3 w-4/5 rounded bg-[var(--panel-2)]" />
            <div className="h-3 w-3/5 rounded bg-[var(--panel-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MaterialsLoading() {
  return (
    <main data-materials-loading="" aria-busy="true" className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
      <span role="status" className="sr-only"><UiText id="materials.md1bdae05eb04" /></span>
      <div aria-hidden="true" className="border-b border-[var(--border)] px-6 pb-4 pt-5 sm:px-8 sm:pt-6 motion-safe:animate-pulse">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex h-8 items-center gap-3">
            <div className="h-5 w-[60px] rounded bg-[var(--panel-2)]" />
            <div className="h-8 w-24 rounded-lg bg-[var(--panel-2)]" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-8 w-full rounded-lg bg-[var(--panel-2)] sm:w-[300px]" />
            <div className="h-8 w-8 shrink-0 rounded-lg bg-[var(--panel-2)]" />
          </div>
        </div>
        <div className="mt-3 flex h-10 items-center gap-2 overflow-hidden pb-0.5">
          {[48, 72, 72, 64].map((width, index) => <div key={index} className="h-7 shrink-0 rounded-full bg-[var(--panel-2)]" style={{ width }} />)}
          <div className="ml-auto h-8 w-56 shrink-0 rounded-2xl bg-[var(--panel-2)]" />
        </div>
      </div>
      <div className="max-w-full px-6 py-5 sm:px-8"><MaterialSkeleton /></div>
    </main>
  );
}
