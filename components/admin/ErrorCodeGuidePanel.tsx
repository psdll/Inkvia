"use client";
import { UiText } from "@/i18n/ui";


import { FRIENDLY_ERROR_GUIDE } from "@/lib/error-friendly";

export default function ErrorCodeGuidePanel() {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-[12px]">
          <thead className="bg-[var(--panel-bg)] text-[var(--app-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium"><UiText id="admin.m9c7ff3321e0a" /></th>
              <th className="px-3 py-2 font-medium"><UiText id="admin.mc48fc02e1464" /></th>
              <th className="px-3 py-2 font-medium"><UiText id="admin.m9129232b4d06" /></th>
              <th className="px-3 py-2 font-medium"><UiText id="admin.m3813e60c486b" /></th>
            </tr>
          </thead>
          <tbody>
            {FRIENDLY_ERROR_GUIDE.map((row) => (
              <tr key={row.code} className="border-t border-[var(--border)] text-[var(--app-fg)]">
                <td className="px-3 py-2 align-top">
                  <span className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[11px]">{row.code}</span>
                </td>
                <td className="px-3 py-2 align-top text-[var(--app-muted)]">{row.trigger}</td>
                <td className="px-3 py-2 align-top">{row.message}</td>
                <td className="px-3 py-2 align-top text-[var(--app-muted)]">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
