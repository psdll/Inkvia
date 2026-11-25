"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Lightbulb, Loader2, RotateCw, UserCheck } from "lucide-react";

type CreatorPermissionRow = {
  name: string;
  assetCount: number;
  inspirationCount: number;
  hasAccount: boolean;
  enabled: boolean;
};

type CreatorPermissionResponse = {
  success?: boolean;
  creators?: CreatorPermissionRow[];
  configured?: boolean;
  error?: string;
};

function enabledKey(rows: CreatorPermissionRow[]) {
  return rows
    .filter((row) => row.enabled && row.hasAccount)
    .map((row) => row.name)
    .sort()
    .join("\n");
}

export default function MaterialCreatorInspirationPermissions() {
  const { error: uiError } = useUiLocale();
  const [rows, setRows] = React.useState<CreatorPermissionRow[]>([]);
  const [savedKey, setSavedKey] = React.useState("");
  const [configured, setConfigured] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settings/material-creator-inspiration", { cache: "no-store" }).catch(() => null);
      if (!res) {
        setErr("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as CreatorPermissionResponse | null;
      if (!res.ok) {
        setErr(String(json?.error || "读取失败"));
        return;
      }
      const nextRows = Array.isArray(json?.creators) ? json.creators : [];
      setRows(nextRows);
      setSavedKey(enabledKey(nextRows));
      setConfigured(Boolean(json?.configured));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggle = React.useCallback((name: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.name === name && row.hasAccount ? { ...row, enabled: !row.enabled } : row
      )
    );
  }, []);

  const setAll = React.useCallback((enabled: boolean) => {
    setRows((prev) => prev.map((row) => (row.hasAccount ? { ...row, enabled } : row)));
  }, []);

  const save = React.useCallback(async () => {
    setErr(null);
    setSaving(true);
    try {
      const enabledCreators = rows.filter((row) => row.enabled && row.hasAccount).map((row) => row.name);
      const res = await fetch("/api/admin/settings/material-creator-inspiration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledCreators }),
      }).catch(() => null);
      if (!res) {
        setErr("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as CreatorPermissionResponse | null;
      if (!res.ok) {
        setErr(String(json?.error || "保存失败"));
        return;
      }
      const nextRows = Array.isArray(json?.creators) ? json.creators : [];
      setRows(nextRows);
      setSavedKey(enabledKey(nextRows));
      setConfigured(Boolean(json?.configured));
    } finally {
      setSaving(false);
    }
  }, [rows]);

  const currentKey = enabledKey(rows);
  const dirty = currentKey !== savedKey;
  const eligibleCount = rows.filter((row) => row.hasAccount).length;
  const enabledCount = rows.filter((row) => row.hasAccount && row.enabled).length;
  const assetCount = rows.reduce((sum, row) => sum + row.assetCount, 0);

  return (
    <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--app-fg)]">
            <UserCheck className="h-4 w-4 text-indigo-500" /><UiText id="admin.m49aba80df5e8" /></div>
          <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mf234c5db0eb0" /></p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}<UiText id="admin.m7bdd5ce1e298" /></button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--app-muted)]">
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1"><UiText id="admin.m8b95c6bdfc12" />{rows.length}</span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1"><UiText id="admin.m50b18f04a2ad" />{eligibleCount}</span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1"><UiText id="admin.mc639f611603e" />{enabledCount}</span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1"><UiText id="admin.m83fa5594ac0f" />{assetCount}</span>
        {!configured ? <span className="text-[11px] text-amber-500"><UiText id="admin.m996779b8a952" /></span> : null}
      </div>

      {loading && !rows.length ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] py-8 text-[13px] text-[var(--app-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /><UiText id="admin.m9dc0825fba54" /></div>
        ) : rows.length ? (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]">
            {rows.map((row) => (
              <div
                key={row.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_86px_86px_92px_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--app-fg)]">{row.name}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">
                    {row.hasAccount ? <UiText id="admin.m25fcb2263d98" /> : <UiText id="admin.m1831dc1f17e6" />}
                  </div>
                </div>
                <div className="hidden text-[12px] text-[var(--app-muted)] sm:block"><UiText id="admin.m83fa5594ac0f" />{row.assetCount}</div>
                <div className="hidden text-[12px] text-[var(--app-muted)] sm:block"><UiText id="admin.m914fd8799d80" />{row.inspirationCount}</div>
                <div className="hidden text-[12px] sm:block">
                  <span className={row.hasAccount ? "text-emerald-500" : "text-amber-500"}>{row.hasAccount ? <UiText id="admin.m0f1a47f1e377" /> : <UiText id="admin.m8c213040757b" />}</span>
                </div>
                <UiProps ids={{"title":["admin.m88b4443e30db","admin.m6ca0dde4eb08"]}}><button
                  type="button"
                  onClick={() => toggle(row.name)}
                  disabled={!row.hasAccount || loading || saving}
                  aria-pressed={row.enabled}
                  className={[
                    "inline-flex h-7 w-[58px] items-center rounded-full border px-1 transition disabled:cursor-not-allowed disabled:opacity-45",
                    row.enabled
                      ? "justify-end border-indigo-500/30 bg-indigo-500/20"
                      : "justify-start border-[var(--border)] bg-[var(--panel-2)]",
                  ].join(" ")}
                  title={row.enabled ? "admin.m88b4443e30db" : "admin.m6ca0dde4eb08"}
                >
                  <span className={["h-5 w-5 rounded-full shadow-sm", row.enabled ? "bg-indigo-500" : "bg-[var(--app-muted)]"].join(" ")} />
                </button></UiProps>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-8 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.mb22551b66bb3" /></div>
        )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAll(true)}
              disabled={!eligibleCount || loading || saving}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
            ><UiText id="admin.mec9886e657bf" /></button>
            <button
              type="button"
              onClick={() => setAll(false)}
              disabled={!eligibleCount || loading || saving}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
            ><UiText id="admin.m34f7336d3983" /></button>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !dirty}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500 px-4 text-[13px] font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}<UiText id="admin.m6fb73fce60fc" /></button>
      </div>
      {err ? <div className="mt-3 text-[12px] text-rose-500">{uiError(err)}</div> : null}
    </div>
  );
}
