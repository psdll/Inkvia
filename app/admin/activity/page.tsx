"use client";
import { UiText } from "@/i18n/ui";


import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { SettingsLogsPanel } from "@/components/settings/logs-panel";

export default function ActivityPage() {
  const { user, loading } = useAuth();
  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 text-[var(--app-fg)]"><div className="mx-auto max-w-6xl">
    <Link href="/admin" className="text-sm text-[var(--app-muted)]"><UiText id="admin.me62bb1e5cd5c" /></Link>
    <h1 className="mb-6 mt-6 text-2xl font-semibold"><UiText id="admin.m5c9aa2a5f48c" /></h1>
    {loading ? <p><UiText id="admin.m390be37bf9cf" /></p> : user?.isAdmin ? <SettingsLogsPanel /> : <p><UiText id="admin.mbd2961bc92e8" /></p>}
  </div></main>;
}
