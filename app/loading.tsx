import { UiText } from "@/i18n/ui";
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 bg-[var(--app-bg)] p-6 text-[var(--app-fg)]" aria-busy="true">
      <p role="status" className="text-sm text-[var(--app-muted)]"><UiText id="common.m6b5799d00a95" /></p>
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="h-10 w-48 rounded-xl bg-[var(--panel-2)]" />
        <div className="min-h-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]" />
      </div>
    </div>
  );
}
