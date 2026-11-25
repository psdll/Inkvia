"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import { formatUiNumber } from "@/i18n/format";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { profileStatsOptions } from "@/lib/client/settings-queries";
import activityStyles from "@/components/admin/admin-activity.module.css";

export function ProfileCard() {
  const { locale: uiLocale, label: uiLabel } = useUiLocale();
  const number = (value: number) => formatUiNumber(uiLocale, value, undefined, () => String(value));
  const { user } = useAuth();
  const { data: stats, isLoading, error, refetch } = useQuery(profileStatsOptions(user?.id));
  if (!user) return null;
  const metrics = [
    { label: "累计成功生成", value: stats?.totalGenerations, unit: "条", description: "使用以来生成成功的记录总数" },
    { label: "近 7 天成功生成", value: stats?.recent7Count, unit: "条", description: "过去 7 天生成成功的记录数" },
    { label: "生成成功率", value: stats ? (stats.totalAttempts ? `${stats.successRate}%` : "—") : undefined, unit: "", description: "成功记录数 ÷ 成功与失败记录总数" },
  ];
  return <UiProps ids={{"aria-label":["settings.md148f0d6da51"]}}><section aria-label="settings.md148f0d6da51">
    <div className={activityStyles.card}>
      <h3 className="mb-5 text-sm font-semibold text-[var(--app-fg)]"><UiText id="settings.md148f0d6da51" /></h3>
      {error && <div role="status" className="mb-4 text-sm text-[var(--app-muted)]">{stats ? <UiText id="settings.m3de7551f6346" /> : <UiText id="settings.m0c05d493962c" />}<button onClick={() => void refetch()} className="ml-3 underline"><UiText id="settings.mb8784c8dd563" /></button></div>}
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">{metrics.map(({ label, value, unit, description }) => <div key={label} className="sm:border-l sm:border-[var(--border)] sm:pl-6 first:border-0 first:pl-0"><dt className="text-xs text-[var(--app-muted)]">{uiLabel(label)}</dt><dd className="mt-3 text-[28px] font-semibold tabular-nums">{isLoading ? "…" : typeof value === "number" ? number(value) : value ?? "—"}{!isLoading && value !== undefined && unit && uiLocale === "zh-CN" && <span className="ml-2 text-sm font-normal text-[var(--app-muted)]">{unit}</span>}</dd><p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">{uiLabel(description)}</p></div>)}</dl>
      <p className="mt-4 border-t border-[var(--border)] pt-4 text-xs leading-6 text-[var(--app-muted)]"><UiText id="settings.m5c1e6ed2d54b" />{stats && <><UiText id="settings.m307d59726358" />{number(stats.totalAttempts ?? 0)}<UiText id="settings.m9857313bc171" />{number(stats.totalGenerations)}<UiText id="settings.m459fb676a019" />{number(Math.max(0, stats.totalAttempts - stats.totalGenerations))}<UiText id="settings.mc8bf29372979" /></>}{stats?.lastCreatedAt && <><UiText id="settings.m336975a6e218" />{new Date(stats.lastCreatedAt).toLocaleDateString(uiLocale === "en" ? "en-US" : "zh-CN")}{uiLocale === "en" ? "." : "。"}</>}</p>
    </div>
  </section></UiProps>;
}
