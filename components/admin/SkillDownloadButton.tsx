"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Download } from "lucide-react";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";
import { downloadSkillWorkspace } from "@/lib/role-skills/workspace-download";

export function SkillDownloadButton({ getSkill, compact = false }: {
  getSkill(): RoleSkillDetail | Promise<RoleSkillDetail>;
  compact?: boolean;
}) {
  const { error: uiError } = useUiLocale();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  const download = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await downloadSkillWorkspace(await getSkill());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "技能打包失败，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <div className="flex min-w-0 flex-col items-end gap-1">
    <button type="button" disabled={busy} onClick={() => void download()} className={compact
      ? "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
      : "inline-flex h-8 items-center gap-1 rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent px-[11px] text-sm text-[var(--app-muted)] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)] disabled:opacity-50"}>
      <Download size={compact ? 12 : 14} strokeWidth={1.5} />{busy ? <UiText id="admin.m9bd3f3dbeb16" /> : <UiText id="admin.mec09f12c8eb1" />}
    </button>
    {error && <span role="alert" className="max-w-60 whitespace-normal break-words text-xs text-red-500">{uiError(error)}</span>}
  </div>;
}
