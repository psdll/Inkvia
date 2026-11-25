"use client";
import { UiText, UiProps } from "@/i18n/ui";


import { useDesktopMode } from "@/components/system/desktop-mode";

import * as React from "react";
import { Activity, BookOpen, HardDrive, LayoutDashboard, LogOut, RefreshCw, ScrollText, Settings, Users } from "lucide-react";

export type MainTab = "overview" | "monitoring" | "users" | "feedback_center" | "system" | "audit_logs";

type AdminTopHeaderProps = {
  active: MainTab;
  onSelect: (tab: MainTab) => void;
  onPrefetch?: (tab: MainTab) => void;
  onRefresh: () => void;
  refreshing?: boolean;
};

function TabBtn({ active, onClick, onPrefetch, icon, label }: { active: boolean; onClick: () => void; onPrefetch?: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={[
        "h-[34px] shrink-0 px-3.5 rounded-lg border transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold backdrop-blur-sm",
        active
          ? "border-white/15 bg-[var(--panel-2)] text-[var(--app-fg)] shadow-[0_6px_18px_rgba(0,0,0,0.16)]"
          : "border-transparent bg-[var(--panel-bg)] text-[var(--app-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

export default function AdminTopHeader({ active, onSelect, onPrefetch, onRefresh, refreshing }: AdminTopHeaderProps) {
  const desktopMode = useDesktopMode();
  // 软刷新：让管理员能"重拉当前 tab 数据"，而不是浏览器整页刷新
  // —— 整页刷新会丢失筛选/分页/滚动位置，而且会让上次缓存窗口期里的旧数据被再次显示。
  // 拦截 F5 / Ctrl+R / Cmd+R，触发软刷新；如果当前正在刷新中，直接忽略。
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const isRefreshKey =
        e.key === "F5" ||
        ((isMac ? e.metaKey : e.ctrlKey) && (e.key === "r" || e.key === "R"));
      if (!isRefreshKey) return;
      if (e.shiftKey) return; // Shift+刷新 = 硬刷新，保留浏览器原生行为
      e.preventDefault();
      if (!refreshing) onRefresh();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onRefresh, refreshing]);


  return (
    <div
      className={desktopMode ? "relative z-40 mb-4 min-w-0 shrink-0" : "pointer-events-none fixed left-0 right-0 z-40 px-3 lg:px-6 2xl:px-10"}
      style={desktopMode ? undefined : { top: "calc(var(--global-notice-height, 0px) + 12px)" }}
    >
      <div className="w-full min-w-0 pointer-events-auto">
        <div className="flex min-w-0 flex-col xl:flex-row xl:items-center justify-between gap-3 rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)]/92 backdrop-blur-xl p-3.5 shadow-[0_16px_44px_rgba(0,0,0,0.22)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-[38px] w-[38px] rounded-lg border border-blue-200 bg-blue-50 flex items-center justify-center text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">
              <HardDrive className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[var(--app-fg)]">{desktopMode ? <UiText id="admin.mdf3d58c7d84b" /> : <UiText id="admin.mf4855d2b33ae" />}</div>
              {!desktopMode && <div className="text-[11.5px] text-[var(--app-muted)]"><UiText id="admin.m57ae408563f4" /></div>}
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2.5">
            <div className="no-scrollbar flex max-w-full gap-1.5 overflow-x-auto bg-[var(--panel-2)]/50 p-1 rounded-lg border border-[var(--border)]">
              <UiProps ids={{"label":["admin.m0a5e1d557918"]}}><TabBtn icon={<LayoutDashboard className="h-4 w-4" />} label="admin.m0a5e1d557918" active={active === "overview"} onClick={() => onSelect("overview")} onPrefetch={() => onPrefetch?.("overview")} /></UiProps>
              {!desktopMode && <UiProps ids={{"label":["admin.m1c88f096249a"]}}><TabBtn icon={<Activity className="h-4 w-4" />} label="admin.m1c88f096249a" active={active === "monitoring"} onClick={() => onSelect("monitoring")} /></UiProps>}
              <UiProps ids={{"label":["admin.m426c4548f68a","admin.mfbf413d429bd"]}}><TabBtn icon={<Users className="h-4 w-4" />} label={desktopMode ? "admin.m426c4548f68a" : "admin.mfbf413d429bd"} active={active === "users"} onClick={() => onSelect("users")} onPrefetch={() => onPrefetch?.("users")} /></UiProps>
              <UiProps ids={{"label":["admin.m68ea5dd4d7af"]}}><TabBtn icon={<Settings className="h-4 w-4" />} label="admin.m68ea5dd4d7af" active={active === "system"} onClick={() => onSelect("system")} onPrefetch={() => onPrefetch?.("system")} /></UiProps>
              {!desktopMode && <UiProps ids={{"label":["admin.m2f2fee6399a4"]}}><TabBtn icon={<BookOpen className="h-4 w-4" />} label="admin.m2f2fee6399a4" active={active === "feedback_center"} onClick={() => onSelect("feedback_center")} /></UiProps>}
              <UiProps ids={{"label":["admin.m7dbac1c20f23","admin.m7913b7fc3df8"]}}><TabBtn icon={<ScrollText className="h-4 w-4" />} label={desktopMode ? "admin.m7dbac1c20f23" : "admin.m7913b7fc3df8"} active={active === "audit_logs"} onClick={() => onSelect("audit_logs")} /></UiProps>
            </div>
            <div className="w-px h-5 bg-[var(--border)] hidden xl:block" />
            <UiProps ids={{"title":["admin.m8160e849677b"]}}><button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title="admin.m8160e849677b"
              className="h-[34px] px-3.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[12px] text-[var(--app-muted)] hover:bg-blue-600/10 hover:text-blue-500 hover:border-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center gap-1.5"
            >
              <RefreshCw className={["h-4 w-4", refreshing ? "animate-spin" : ""].join(" ")} />
              {refreshing ? <UiText id="admin.m7f3c8312816f" /> : <UiText id="admin.maee887434131" />}
            </button></UiProps>
            {!desktopMode && <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" }).catch(() => null);
                window.dispatchEvent(new Event("inkvia:admin-session-ended"));
                window.location.href = "/settings?admin=1";
              }}
              className="h-[34px] px-3.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[12px] text-[var(--app-muted)] hover:bg-rose-600/10 hover:text-rose-500 hover:border-rose-500/20 transition flex items-center gap-1.5"
            >
              <LogOut className="h-4 w-4" /><UiText id="admin.m5831f9c39cc4" /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}
