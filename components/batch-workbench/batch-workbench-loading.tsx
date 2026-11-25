import { UiProps, UiText } from "@/i18n/ui";
import * as React from "react";

export function BatchWorkbenchSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <UiProps ids={{"aria-label":["batch.mde10a665c790"]}}><div data-batch-loading-panel="" className={`h-full motion-safe:animate-pulse bg-[var(--panel-bg)] ${embedded ? "" : "rounded-[24px] border border-[var(--border)]"}`} aria-label="batch.mde10a665c790">
      <div className="m-5 h-5 w-1/3 rounded bg-[var(--panel-2)]" />
      <div className="m-5 h-32 rounded-2xl bg-[var(--panel-2)]" />
      <div className="m-5 h-20 rounded-2xl bg-[var(--panel-2)]" />
    </div></UiProps>
  );
}

export function BatchWorkbenchLoading() {
  return (
    <main data-batch-workbench-loading="" aria-busy="true" className="h-full min-h-0 flex-1 overflow-hidden bg-[var(--app-bg)] p-[clamp(12px,2dvh,20px)]">
      <span role="status" className="sr-only"><UiText id="batch.m542732b7d37d" /></span>
      <div aria-hidden="true" className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="relative min-h-0 overflow-hidden"><BatchWorkbenchSkeleton /></div>
        <div className="relative min-h-0 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]">
          <BatchWorkbenchSkeleton embedded />
          <div className="absolute left-1/2 top-1 h-6 w-36 -translate-x-1/2 rounded-full border border-[var(--border)]" />
        </div>
      </div>
    </main>
  );
}
