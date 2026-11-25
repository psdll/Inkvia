"use client";
import { UiText } from "@/i18n/ui";


import { Construction, ExternalLink } from "lucide-react";

export function MonitoringEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--primary-bg)]">
          <Construction className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-[15px] font-semibold text-[var(--app-fg)]">{title}</h2>
        <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]">{description}</p>
        <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-[var(--app-muted)]">
          <ExternalLink className="h-3.5 w-3.5" /><UiText id="admin.m8b1005f86686" /></div>
      </div>
    </section>
  );
}
