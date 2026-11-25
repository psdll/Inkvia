import { UiText } from "@/i18n/ui";
import * as React from "react";

export function InspirationGridSkeleton() {
  return (
    <div data-home-inspiration-loading="" aria-hidden="true" className="grid grid-cols-2 gap-0.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="aspect-[4/5] w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)]" />
      ))}
    </div>
  );
}

export function HomeLoading() {
  return (
    <div data-home-loading="" aria-busy="true" className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--workspace-page-bg)]">
      <span role="status" className="sr-only"><UiText id="home.m1d83a335be67" /></span>
      <div aria-hidden="true" data-home-hero-loading="" className="flex flex-col items-center px-10 pb-[62px] pt-[92px] motion-safe:animate-pulse">
        <div className="mb-5 flex h-28 w-full max-w-[500px] items-center justify-center">
          <div className="h-[90px] w-full max-w-[420px] rounded-2xl bg-[var(--panel-2)]" />
        </div>
        <div className="mb-[72px] flex h-[26px] w-full items-center justify-center">
          <div className="h-4 w-64 max-w-full rounded bg-[var(--panel-2)]" />
        </div>
        <div className="h-12 w-[165px] rounded-full bg-[var(--panel-2)]" />
        <div className="mt-24 flex flex-wrap justify-center gap-[9px]">
          {[137, 142, 164, 109, 175, 104].map((width, index) => (
            <div key={index} style={{ width }} className="h-[34px] rounded-full border border-[var(--border)] bg-[var(--panel-bg)]" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="px-12 pb-20">
        <div className="mb-3 flex h-[27px] items-center"><div className="h-5 w-24 rounded bg-[var(--panel-2)]" /></div>
        <div className="mb-4 flex flex-wrap gap-2">
          {[56, 80, 80, 80].map((width, index) => <div key={index} style={{ width }} className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]" />)}
        </div>
        <InspirationGridSkeleton />
      </div>
    </div>
  );
}
