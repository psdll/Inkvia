import { UiProps } from "@/i18n/ui";
import * as React from "react";

function Placeholder({ className }: { className: string }) {
  return <div className={`rounded-md bg-[var(--panel-2)] ${className}`} />;
}

const panel = "rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4";

export function AdminOverviewLoading() {
  return (
    <UiProps ids={{"aria-label":["admin.m3b1bcf6d164e"]}}><div role="status" aria-label="admin.m3b1bcf6d164e" aria-busy="true">
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <Placeholder className="h-4 w-52" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={panel}>
              <Placeholder className="h-[19.5px] w-24" />
              <Placeholder className="mt-1.5 h-[33px] w-28" />
              <Placeholder className="mt-1 h-[18px] w-40 max-w-full" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className={panel}>
            <Placeholder className="mb-3 h-[22.5px] w-40" />
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => <Placeholder key={index} className="h-[71px]" />)}
            </div>
          </div>
          <div className={panel}>
            <Placeholder className="mb-3 h-[22.5px] w-32" />
            <Placeholder className="h-[18px] w-24" />
          </div>
        </div>
        <div className={panel}>
          <Placeholder className="h-[22.5px] w-44" />
          <Placeholder className="mt-2 h-[18px] w-96 max-w-full" />
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <Placeholder key={index} className="h-24" />)}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[2.2fr_1fr]">
            <Placeholder className="h-[360px]" />
            <Placeholder className="h-[360px]" />
          </div>
        </div>
      </div>
    </div></UiProps>
  );
}

function LoadingRegion({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div role="status" aria-label={label} aria-busy="true" className={className}><div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">{children}</div></div>;
}

export function AdminFormLoading() {
  return <UiProps ids={{"label":["admin.m0029060256ae"]}}><LoadingRegion label="admin.m0029060256ae" className="p-5">
    <Placeholder className="h-6 w-44" /><Placeholder className="h-4 w-72 max-w-full" />
    {Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-3 py-3"><Placeholder className="h-4 w-28" /><Placeholder className="h-11 w-full" /><Placeholder className="h-3 w-64 max-w-full" /></div>)}
    <Placeholder className="h-10 w-28" />
  </LoadingRegion></UiProps>;
}

export function AdminUserDetailLoading() {
  return <UiProps ids={{"label":["admin.mee4ad16e5a55"]}}><LoadingRegion label="admin.mee4ad16e5a55">
    <Placeholder className="h-20 w-full" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Placeholder key={i} className="h-28" />)}</div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Placeholder className="h-72" /><Placeholder className="h-72" /></div>
  </LoadingRegion></UiProps>;
}

export function AdminUserListLoading() {
  return <UiProps ids={{"label":["admin.ma0864f7e683f"]}}><LoadingRegion label="admin.ma0864f7e683f" className="py-3">
    {Array.from({ length: 7 }, (_, i) => <Placeholder key={i} className="h-20 w-full" />)}
  </LoadingRegion></UiProps>;
}

export function AdminUsersLoading() {
  return <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)]">
    <div className={`${panel} hidden xl:block`}><Placeholder className="h-10 w-full" /><AdminUserListLoading /></div>
    <div className="min-w-0 space-y-3"><Placeholder className="h-[42px] w-full" /><div className={panel}><AdminUserDetailLoading /></div></div>
  </div>;
}

export function AdminMonitoringLoading() {
  return <UiProps ids={{"label":["admin.m7706929d4bd2"]}}><LoadingRegion label="admin.m7706929d4bd2" className="w-full pb-8">
    <div className={panel}><Placeholder className="h-[27px] w-40" /><Placeholder className="mt-1 h-[18px] w-96 max-w-full" /></div>
    <div className={`${panel} !p-2`}><Placeholder className="h-7 w-96 max-w-full" /></div>
    <div className={`${panel} grid gap-6 lg:grid-cols-[1.5fr_1fr] !p-5`}>
      <div className="space-y-4"><Placeholder className="h-4 w-24" /><Placeholder className="h-7 w-64 max-w-full" /><Placeholder className="h-12 w-full" /><Placeholder className="h-4 w-3/4" /><Placeholder className="h-4 w-full" /></div>
      <div className="space-y-4"><Placeholder className="h-5 w-32" /><Placeholder className="h-24 w-full" /></div>
    </div>
    <div className="pt-1"><Placeholder className="h-5 w-28" /><Placeholder className="mt-2 h-4 w-80 max-w-full" /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className={`${panel} h-[266px] space-y-5`}><Placeholder className="h-4 w-32" /><Placeholder className="h-9 w-28" /><Placeholder className="h-4 w-24" /><Placeholder className="h-4 w-full" /><Placeholder className="h-4 w-3/4" /></div>)}</div>
  </LoadingRegion></UiProps>;
}

function SettingsLoading() {
  return <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
    <UiProps ids={{"label":["admin.m7421a83cfcd5"]}}><LoadingRegion label="admin.m7421a83cfcd5" className={`${panel} hidden lg:block`}>
      {Array.from({ length: 8 }, (_, i) => <Placeholder key={i} className="h-16 w-full" />)}
    </LoadingRegion></UiProps>
    <div className={`${panel} min-w-0 min-h-[calc(100vh-9.5rem)] !p-0`}><AdminFormLoading /></div>
  </div>;
}
export function AdminSystemLoading() { return <SettingsLoading />; }

export function AdminFeedbackLoading() {
  return <UiProps ids={{"label":["admin.me1fab11e1219"]}}><LoadingRegion label="admin.me1fab11e1219" className="w-full">
    <div className={`${panel} !rounded-3xl !p-5 space-y-4`}><div><Placeholder className="h-[22.5px] w-32" /><Placeholder className="h-[18px] w-80 max-w-full" /></div><div className="flex gap-3"><Placeholder className="h-[42px] w-[420px] max-w-full" /><Placeholder className="h-[42px] w-60" /></div></div>
    <div className={`${panel} !mt-6 !rounded-3xl !p-5 min-h-[420px] space-y-3`}>{Array.from({ length: 4 }, (_, i) => <Placeholder key={i} className="h-20 w-full" />)}</div>
  </LoadingRegion></UiProps>;
}

export function AdminLogsLoading() {
  return <UiProps ids={{"label":["admin.mcd816ed248ee"]}}><LoadingRegion label="admin.mcd816ed248ee">
    <div className="flex gap-2"><Placeholder className="h-10 w-[140px]" /><Placeholder className="h-10 w-32" /><Placeholder className="h-10 flex-1" /><Placeholder className="h-10 w-20" /></div>
    <Placeholder className="h-5 w-3/4" />
    <div className={`${panel} space-y-3`}><Placeholder className="h-7 w-full" />{Array.from({ length: 8 }, (_, i) => <div key={i} className="grid grid-cols-[150px_70px_96px_1fr_110px] gap-2"><Placeholder className="h-7" /><Placeholder className="h-7" /><Placeholder className="h-7" /><Placeholder className="h-7" /><Placeholder className="h-7" /></div>)}</div>
  </LoadingRegion></UiProps>;
}

export function AdminLoading({ tab = "overview" }: { tab?: string | null }) {
  const content = tab === "monitoring" ? <AdminMonitoringLoading /> : tab === "users" ? <AdminUsersLoading /> : tab === "system" ? <AdminSystemLoading /> : tab === "feedback_center" ? <AdminFeedbackLoading /> : tab === "audit_logs" ? <AdminLogsLoading /> : <AdminOverviewLoading />;
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--workspace-page-bg)] px-3 py-5 lg:px-[clamp(16px,2.4vw,40px)] lg:py-6">
      <div aria-hidden="true" className="pointer-events-none fixed left-0 right-0 z-40 px-3 lg:px-6 2xl:px-10" style={{ top: "calc(var(--global-notice-height, 0px) + 12px)" }}>
        <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)] p-3.5 xl:flex-row xl:items-center">
          <div className="flex h-[38px] items-center gap-3">
            <Placeholder className="h-[38px] w-[38px]" />
            <div><Placeholder className="h-4 w-28" /><Placeholder className="mt-2 h-3 w-40" /></div>
          </div>
          <div className="flex h-11 min-w-0 items-center justify-end gap-2.5 overflow-hidden">
            <Placeholder className="h-11 w-[790px] max-w-full" />
            <Placeholder className="h-[34px] w-20 shrink-0" />
            <Placeholder className="h-[34px] w-20 shrink-0" />
          </div>
        </div>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${tab === "users" ? "pt-[96px] md:pt-[76px]" : tab === "system" ? "pt-[116px] md:pt-[96px] xl:pt-[76px]" : "pt-[116px] md:pt-[96px]"}`}>
        {content}
      </div>
    </main>
  );
}
