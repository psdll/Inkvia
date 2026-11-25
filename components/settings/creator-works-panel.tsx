"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Lightbulb, Loader2, PencilLine } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates, buildMediaProxyUrl } from "@/lib/media-url";

type CreatorWork = {
  id: number;
  title: string;
  category?: string | null;
  mediaCount?: number;
  inspiration?: string | null;
  imageUrl?: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
};

const MAX_INSPIRATION_LEN = 500;

function thumbCandidates(item: CreatorWork) {
  const raw = [item.previewUrl, item.thumbnailUrl, item.imageUrl].filter(Boolean) as string[];
  return Array.from(
    new Set(
      raw
        .flatMap((url) => buildMediaPreviewCandidates(url, { width: 240, height: 240, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

export function CreatorWorksPanel() {
  const { error: uiError } = useUiLocale();
  const { user, openLoginModal } = useAuth();
  const [items, setItems] = React.useState<CreatorWork[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");
  const [savingId, setSavingId] = React.useState<number | null>(null);

  const hideCreatorWorksEntry = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent("material-creator-inspiration:disabled"));
  }, []);

  const load = React.useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/material-assets?mine=1&pageSize=120", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { items?: CreatorWork[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "加载失败");
      const nextItems = Array.isArray(json?.items) ? json!.items! : [];
      setItems(nextItems);
      if (!nextItems.length) {
        setEditingId(null);
        setDraft("");
        hideCreatorWorksEntry();
      }
    } catch (err: any) {
      setError(String(err?.message || "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [hideCreatorWorksEntry, user]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (item: CreatorWork) => {
    setEditingId(item.id);
    setDraft(item.inspiration || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveInspiration = async (id: number) => {
    setSavingId(id);
    setError("");
    try {
      const res = await fetch(`/api/material-assets/${id}/inspiration`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspiration: draft }),
      });
      const json = (await res.json().catch(() => null)) as { item?: { inspiration?: string | null }; error?: string } | null;
      if (!res.ok) {
        if (res.status === 403) {
          setItems([]);
          setEditingId(null);
          setDraft("");
          hideCreatorWorksEntry();
        }
        throw new Error(json?.error || "保存失败");
      }
      const saved = json?.item?.inspiration ?? (draft.trim() || null);
      setItems((prev) => prev.map((row) => (row.id === id ? { ...row, inspiration: saved } : row)));
      setEditingId(null);
      setDraft("");
    } catch (err: any) {
      setError(String(err?.message || "保存失败"));
    } finally {
      setSavingId(null);
    }
  };

  if (!user) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center">
        <div className="text-[14px] text-[var(--app-fg)]"><UiText id="settings.mc488d38a649f" /></div>
        <button
          type="button"
          onClick={() => openLoginModal()}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-indigo-500 px-4 text-[13px] font-medium text-white transition hover:bg-indigo-400"
        ><UiText id="settings.mdd388142a51c" /></button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] text-[var(--app-muted)]"><UiText id="settings.mf522cb15681e" />{user.username}<UiText id="settings.m4b8e794bfb63" /></div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1.5 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
        ><UiText id="settings.maee887434131" /></button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-500">{uiError(error)}</div>
      ) : null}

      {loading && !items.length ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--app-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /><UiText id="settings.m8e3d9ca23853" /></div>
      ) : !items.length ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] py-16 text-center text-[13px] text-[var(--app-muted)]"><UiText id="settings.m5c616f7a1180" /><br /><UiText id="settings.mef115639e1f6" />{user.username}<UiText id="settings.m8819329f2046" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const editing = editingId === item.id;
            const saving = savingId === item.id;
            return (
              <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                    <ResilientImage candidates={thumbCandidates(item)} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-[var(--app-fg)]">{item.title}</div>
                    <div className="mt-0.5 text-[12px] text-[var(--app-muted)]">
                      {item.category || <UiText id="settings.m54b89f901274" />}
                      {(item.mediaCount || 1) > 1 ? <UiText id="settings.mf775173651de" values={{v0: String(item.mediaCount)}} /> : ""}
                    </div>
                    <div className="mt-1.5 inline-flex items-center gap-1 text-[11px]">
                      <Lightbulb className={`h-3.5 w-3.5 ${item.inspiration ? "text-indigo-500" : "text-[var(--app-muted)]"}`} />
                      <span className={item.inspiration ? "text-indigo-500" : "text-[var(--app-muted)]"}>
                        {item.inspiration ? <UiText id="settings.ma462ee2cceec" /> : <UiText id="settings.m8a0e6bbd69f9" />}
                      </span>
                    </div>
                  </div>
                  {!editing ? (
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]"
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      {item.inspiration ? <UiText id="settings.m051836569928" /> : <UiText id="settings.mfa02fc38b2e1" />}
                    </button>
                  ) : null}
                </div>

                {editing ? (
                  <div className="mt-3">
                    <UiProps ids={{"placeholder":["settings.m26d52480666e"]}}><textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.slice(0, MAX_INSPIRATION_LEN))}
                      rows={4}
                      autoFocus
                      placeholder="settings.m26d52480666e"
                      className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] leading-[1.6] text-[var(--app-fg)] outline-none focus:border-indigo-500/50"
                    /></UiProps>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--app-muted)]">{draft.length}/{MAX_INSPIRATION_LEN}<UiText id="settings.m91e17ab743a2" /></span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
                        ><UiText id="settings.m2cd0f3be8738" /></button>
                        <button
                          type="button"
                          onClick={() => void saveInspiration(item.id)}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
                        >
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}<UiText id="settings.ma3030bf8f16d" /></button>
                      </div>
                    </div>
                  </div>
                ) : item.inspiration ? (
                  <p className="mt-2.5 line-clamp-3 border-l-2 border-indigo-500/40 pl-2.5 font-serif text-[12.5px] italic leading-[1.6] text-[var(--app-fg)]">
                    {item.inspiration}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
