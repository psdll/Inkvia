"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";
import { formatUiDate } from "@/i18n/format";


import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { monthlySpendingOptions } from "@/lib/client/settings-queries";
import AdminActivityChart from "@/components/admin/AdminActivityChart";
import activityStyles from "@/components/admin/admin-activity.module.css";

const moneyOptions: Intl.NumberFormatOptions = {
  style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2,
};
const spendingSeries = [{ key: "amount", label: "消费金额", color: "#0090ff" }];

export function ModelUsagePanel() {
  const { locale, error: uiError } = useUiLocale();
  const formatAmount = new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", moneyOptions).format;
  const { user } = useAuth();
  const { data, error, isLoading, refetch } = useQuery(monthlySpendingOptions(user?.id));
  const card = activityStyles.card;
  if (isLoading) return <div className={card}><div className="flex items-center gap-2 text-sm text-[var(--app-muted)]"><RefreshCw size={16} className="animate-spin" /><UiText id="settings.m602dafc2f7a6" /></div></div>;
  if (!data) return <div className={card}><p className="text-sm text-[var(--app-muted)]">{error?.message ? uiError(error) : <UiText id="settings.m9503886094dc" />}</p><button type="button" onClick={() => void refetch()} className="mt-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--app-fg)]"><UiText id="settings.mb8784c8dd563" /></button></div>;
  const points = data.daily.map(day => ({ label: day.day, values: { amount: Number(day.amount) } }));
  return <UiProps ids={{"aria-label":["settings.md7d0fbc778f5"]}}><section className="space-y-4" aria-label="settings.md7d0fbc778f5">
    <div className={card}>
      <div className="flex items-center justify-between gap-3 text-sm text-[var(--app-muted)]"><span><UiText id="settings.m3957a26ac8ce" />{formatUiDate(locale, `${data.month}-01T00:00:00Z`, { year: "numeric", month: "long", timeZone: "UTC" }, () => data.month)}</span><UiProps ids={{"aria-label":["settings.m1836df6d2b7d"]}}><button type="button" onClick={() => void refetch()} aria-label="settings.m1836df6d2b7d" className="rounded-lg p-2 hover:bg-[var(--panel-2)]"><RefreshCw size={16} /></button></UiProps></div>
      <div className="mt-3 text-3xl font-semibold tabular-nums text-[var(--app-fg)]">{formatAmount(Number(data.totalAmount))}</div>
      <p className="mt-3 text-xs text-[var(--app-muted)]"><UiText id="settings.m050b1c14dd6e" /></p>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--app-muted)]"><UiText id="settings.m2a057a55acab" /></p>}
    </div>
    <div className={card}>
      <h3 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="settings.m786d46219ad0" /></h3>
      <p className="mt-1 text-xs text-[var(--app-muted)]"><UiText id="settings.mc0e49af20160" /></p>
      <div className="mt-3">
        <UiProps ids={{"title":["settings.m786d46219ad0"]}}><AdminActivityChart embedded title="settings.m786d46219ad0" points={points} series={spendingSeries}
          formatValue={formatAmount} showTotal={false} allowCumulative={false} /></UiProps>
      </div>
    </div>
  </section></UiProps>;
}
