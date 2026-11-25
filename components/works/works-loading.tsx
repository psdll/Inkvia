import { UiText } from "@/i18n/ui";
import * as React from "react";

export function WorksGridSkeleton({ tileSize = 144 }: { tileSize?: number }) {
  return (
    <div data-works-grid-loading="" aria-busy="true">
      <span role="status" className="sr-only"><UiText id="works.m1ac182d521ca" /></span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="flex h-8 items-start gap-2">
          <div className="h-5 w-24 rounded bg-[var(--panel-2)]" />
          <div className="h-4 w-8 rounded bg-[var(--panel-2)]" />
        </div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${tileSize}px),1fr))` }}>
          {Array.from({ length: 84 }, (_, index) => <div key={index} className="aspect-square rounded-lg bg-[var(--panel-2)]" />)}
        </div>
      </div>
    </div>
  );
}

export function WorksLoading({ tileSize = 144 }: { tileSize?: number }) {
  return (
    <div data-works-loading="" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--works-page-bg)]">
      <div aria-hidden="true" className="border-b border-[var(--border)] px-6 motion-safe:animate-pulse">
        <div className="flex min-h-16 items-center gap-3 py-3">
          <div className="h-7 w-12 rounded bg-[var(--panel-2)]" />
          <div className="h-4 w-10 rounded bg-[var(--panel-2)]" />
          <div className="ml-auto h-8 w-[174px] max-w-[40%] rounded-lg bg-[var(--panel-2)]" />
          <div className="h-8 w-8 shrink-0 rounded-lg bg-[var(--panel-2)]" />
        </div>
        <div className="flex min-h-16 flex-wrap items-center gap-4 py-3">
          <div className="h-8 w-24 rounded-lg bg-[var(--panel-2)]" />
          <div className="flex gap-3">
            {[0, 1, 2, 3].map(index => <div key={index} className="h-7 w-14 rounded-md bg-[var(--panel-2)]" />)}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="h-7 w-7 rounded-md bg-[var(--panel-2)]" />
            <div className="h-7 w-20 rounded-md bg-[var(--panel-2)]" />
            <div className="h-7 w-20 rounded-md bg-[var(--panel-2)]" />
          </div>
        </div>
      </div>
      <div className="min-h-0 overflow-hidden px-6 py-6"><WorksGridSkeleton tileSize={tileSize} /></div>
    </div>
  );
}
