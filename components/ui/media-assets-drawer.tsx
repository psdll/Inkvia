"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Music2, Search, Trash2, Upload, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaImage } from "@/components/ui/media-image";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { isKnownDeletedGenerationId, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { isAudioMediaUrl } from "@/lib/media-url";

type AssetTab = "generated" | "import";

type AssetItem = {
  id: number;
  type: string;
  prompt: string;
  model: string | null;
  status: string;
  localPath: string | null;
  createdAt: string;
};

function inferKind(localPath: string | null): "image" | "video" | "audio" {
  if (isAudioMediaUrl(localPath)) return "audio";
  if (!localPath) return "image";
  const p = localPath.toLowerCase();
  if (p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov") || p.endsWith(".m4v")) return "video";
  return "image";
}

function typeGroup(t: string) {
  if (t === "face_swap") return "face_swap";
  if (t === "image_edit") return "image_edit";
  if (t === "video_gen" || t === "video_generate") return "video";
  if (t === "audio_gen") return "audio";
  if (t === "import") return "import";
  return "other";
}

function typeLabel(t: string, text: ReturnType<typeof useUiLocale>["text"]) {
  if (t === "face_swap") return text("createDynamic.m5235f7494aaa");
  if (t === "image_edit") return text("createDynamic.md24c10d37db0");
  if (t === "video_gen" || t === "video_generate") return text("createDynamic.mc20f7618d330");
  if (t === "audio_gen") return text("createDynamic.m296c632ec857");
  if (t === "import") return text("createDynamic.m576d81bb0631");
  return t || text("createDynamic.m4d8c1c5b4283");
}

function formatName(item: AssetItem) {
  if (item.prompt && item.prompt.trim()) return item.prompt.trim();
  if (item.localPath) {
    const parts = item.localPath.split("/");
    return parts[parts.length - 1] || item.localPath;
  }
  return String(item.id);
}

export function MediaAssetsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { text, error: localizeError } = useUiLocale();
  const { user, openLoginModal } = useAuth();
  const [render, setRender] = React.useState(open);
  const minWidthPx = 420;
  const [maxWidthPx, setMaxWidthPx] = React.useState(900);
  const [widthPx, setWidthPx] = React.useState(minWidthPx);
  const [resizing, setResizing] = React.useState(false);
  const resizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const [tab, setTab] = React.useState<AssetTab>("generated");
  const [q, setQ] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "face_swap" | "image_edit" | "video" | "audio" | "other">("all");
  const [items, setItems] = React.useState<AssetItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AssetItem | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);
  const [clearPlan, setClearPlan] = React.useState<{ items: AssetItem[]; tabLabel: string; suffix: string } | null>(null);
  const [lightbox, setLightbox] = React.useState<{ open: boolean; src: string | null; kind: "image" | "video" | "audio"; title?: string }>(
    { open: false, src: null, kind: "image" }
  );
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const userId = user?.id ? String(user.id) : "";

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    const deleted = new Set(ids);
    setItems((current) => current.filter((item) => !deleted.has(Number(item.id))));
    setDeleteTarget((current) => current && deleted.has(Number(current.id)) ? null : current);
  }), []);

  React.useEffect(() => {
    if (!open) return;
    const key = "media_assets_drawer_width_v1";
    try {
      const raw = localStorage.getItem(key);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) setWidthPx(Math.max(minWidthPx, Math.round(n)));
    } catch {}
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const compute = () => {
      const px = Math.floor(window.innerWidth * 0.92);
      setMaxWidthPx(Math.min(900, px));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setWidthPx((prev) => Math.min(Math.max(prev, minWidthPx), maxWidthPx));
  }, [open, maxWidthPx]);

  React.useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    const t = window.setTimeout(() => setRender(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (clearConfirmOpen) {
        setClearConfirmOpen(false);
        setClearPlan(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, clearConfirmOpen]);

  React.useEffect(() => {
    if (!open) return;
    setTypeFilter("all");
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (!userId) {
          setItems([]);
          return;
        }
        const url = new URL("/api/assets", window.location.origin);
        url.searchParams.set("userId", userId);
        url.searchParams.set("tab", tab);
        if (q.trim()) url.searchParams.set("q", q.trim());
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `加载失败: ${res.status}`);
        }
        const data = (await res.json()) as { items: AssetItem[] };
        setItems(Array.isArray(data.items) ? data.items.filter((item) => !isKnownDeletedGenerationId(item.id)) : []);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "加载失败");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [open, tab, q]);

  const displayItems = React.useMemo(() => {
    if (tab !== "generated") return items;
    if (typeFilter === "all") return items;
    if (typeFilter === "video") return items.filter((x) => typeGroup(x.type) === "video");
    if (typeFilter === "audio") return items.filter((x) => typeGroup(x.type) === "audio");
    if (typeFilter === "face_swap" || typeFilter === "image_edit") return items.filter((x) => x.type === typeFilter);
    return items.filter((x) => typeGroup(x.type) === "other");
  }, [items, tab, typeFilter]);

  React.useEffect(() => {
    if (!open) return;
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const cur = resizeRef.current;
      if (!cur) return;
      const dx = cur.startX - e.clientX;
      const next = Math.min(Math.max(cur.startWidth + dx, minWidthPx), maxWidthPx);
      setWidthPx(next);
    };
    const onUp = () => {
      setResizing(false);
      resizeRef.current = null;
      try {
        localStorage.setItem("media_assets_drawer_width_v1", String(widthPx));
      } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [open, resizing, widthPx, maxWidthPx]);

  const deleteAsset = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      if (!userId) {
        openLoginModal();
        return;
      }
      const res = await fetch(`/api/assets/${id}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "删除失败");
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e?.message || "删除失败");
    } finally {
      setLoading(false);
    }
  };

  const clearCurrentList = async () => {
    if (!displayItems.length) return;
    const tabLabel = tab === "import" ? text("createDynamic.mf62f58be54a1") : text("createDynamic.m11448fff91a4");
    const suffix = q.trim() ? text("createDynamic.m96fd12296d76") : "";
    setClearPlan({ items: [...displayItems], tabLabel, suffix });
    setClearConfirmOpen(true);
  };

  const doClearCurrentList = async (plan: { items: AssetItem[]; tabLabel: string; suffix: string }) => {
    setClearConfirmOpen(false);
    setClearPlan(null);
    setLoading(true);
    setError(null);
    if (!userId) {
      openLoginModal();
      return;
    }
    let failed = 0;
    for (const it of plan.items) {
      try {
        const res = await fetch(`/api/assets/${it.id}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "删除失败");
        setItems((prev) => prev.filter((x) => x.id !== it.id));
      } catch {
        failed += 1;
      }
    }
    if (failed) setError(`删除完成，但有 ${failed} 条删除失败。`);
    setLoading(false);
  };

  const doImport = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    if (!userId) {
      openLoginModal();
      return;
    }
    form.set("userId", userId);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assets/import", { method: "POST", body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `导入失败: ${res.status}`);
      }
      setTab("import");
      setQ("");
      const refreshUrl = new URL("/api/assets", window.location.origin);
      refreshUrl.searchParams.set("userId", userId);
      refreshUrl.searchParams.set("tab", "import");
      const listRes = await fetch(refreshUrl.toString());
      const data = (await listRes.json()) as { items: AssetItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message || "导入失败");
    } finally {
      setLoading(false);
    }
  };

  if (!render) return null;

  const cols = widthPx >= 840 ? 3 : widthPx >= 620 ? 2 : 1;

  return (
    <>
      {clearConfirmOpen && clearPlan ? (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4 lg:p-6">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={() => {
              if (loading) return;
              setClearConfirmOpen(false);
              setClearPlan(null);
            }}
          />
          <div className="relative z-10 w-full max-w-[560px] rounded-[28px] border border-white/12 bg-white/[0.06] backdrop-blur-2xl ring-1 ring-white/8 shadow-[0_40px_120px_rgba(0,0,0,0.65)] overflow-hidden">
            <div className="h-[56px] px-5 flex items-center justify-between border-b border-white/10 bg-white/[0.04]">
              <div className="text-white/90 font-semibold"><UiText id="common.ma3ea3c17b401" /></div>
              <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                type="button"
                disabled={loading}
                onClick={() => {
                  setClearConfirmOpen(false);
                  setClearPlan(null);
                }}
                className="h-10 w-10 rounded-2xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.10] hover:text-white disabled:opacity-50 disabled:pointer-events-none transition flex items-center justify-center"
                aria-label="common.m3fd47edce45b"
              >
                <X className="h-5 w-5" />
              </button></UiProps>
            </div>
            <div className="p-5 space-y-2">
              <div className="text-sm text-white/85"><UiText id="common.m5a86a63eff2a" />{clearPlan.tabLabel}<UiText id="common.m97c213915cc9" />{clearPlan.items.length}<UiText id="common.m893b1b4ced5d" />{clearPlan.suffix}<UiText id="common.m9d45d8943988" /></div>
              <div className="text-xs text-rose-200/85"><UiText id="common.m0e31f4514beb" /></div>
            </div>
            <div className="px-5 pb-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setClearConfirmOpen(false);
                  setClearPlan(null);
                }}
                className="h-11 px-4 rounded-2xl border border-white/10 bg-white/[0.04] text-sm text-white/80 hover:bg-white/[0.10] hover:text-white disabled:opacity-50 disabled:pointer-events-none transition"
              ><UiText id="common.m2cd0f3be8738" /></button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void doClearCurrentList(clearPlan)}
                className="h-11 px-5 rounded-2xl bg-rose-500/20 border border-rose-400/25 text-sm font-medium text-rose-50 hover:bg-rose-500/30 disabled:opacity-50 disabled:pointer-events-none transition shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
              ><UiText id="common.ma3ea3c17b401" /></button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="fixed inset-0 z-[55] pointer-events-none">
        <div
          className={[
            "absolute right-0 top-0 h-full border-l border-white/10 bg-black/30 backdrop-blur-2xl flex flex-col transition-transform duration-300 ease-out pointer-events-auto",
            open ? "translate-x-0" : "translate-x-full"
          ].join(" ")}
          style={{ width: `${widthPx}px`, maxWidth: "92vw" }}
        >
          <UiProps ids={{"aria-label":["common.m1d5d7a9a73bd"]}}><div
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setResizing(true);
              resizeRef.current = { startX: e.clientX, startWidth: widthPx };
              try {
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              } catch {}
              e.preventDefault();
            }}
            className="absolute left-0 top-0 h-full w-2 cursor-col-resize select-none"
            aria-label="common.m1d5d7a9a73bd"
          /></UiProps>
          <div className="h-[64px] px-5 flex items-center justify-between border-b border-white/10 bg-white/[0.04]">
            <div className="text-white/90 font-semibold"><UiText id="common.mb349e93aa070" /></div>
            <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
              type="button"
              onClick={onClose}
              className="h-10 w-10 rounded-2xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.10] hover:text-white transition flex items-center justify-center"
              aria-label="common.m3fd47edce45b"
            >
              <X className="h-5 w-5" />
            </button></UiProps>
          </div>

          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] p-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTab("generated")}
                  className={[
                    "flex-1 h-9 rounded-xl text-sm font-medium transition-colors",
                    tab === "generated"
                      ? "bg-white/[0.18] text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/15"
                      : "text-zinc-200/80 hover:bg-white/[0.08] hover:text-white"
                  ].join(" ")}
                ><UiText id="common.m11448fff91a4" /></button>
                <button
                  type="button"
                  onClick={() => setTab("import")}
                  className={[
                    "flex-1 h-9 rounded-xl text-sm font-medium transition-colors",
                    tab === "import"
                      ? "bg-white/[0.18] text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/15"
                      : "text-zinc-200/80 hover:bg-white/[0.08] hover:text-white"
                  ].join(" ")}
                ><UiText id="common.mf62f58be54a1" /></button>
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="h-10 px-3 rounded-2xl border border-white/10 bg-white/[0.06] text-sm text-white/85 hover:bg-white/[0.10] transition flex items-center gap-2"
              >
                <Upload className="h-4 w-4" /><UiText id="common.m576d81bb0631" /></button>
              <button
                type="button"
                onClick={() => void clearCurrentList()}
                disabled={loading || items.length === 0}
                className="h-10 px-3 rounded-2xl border border-white/10 bg-white/[0.06] text-sm text-white/85 hover:bg-white/[0.10] disabled:opacity-40 disabled:hover:bg-white/[0.06] transition flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" /><UiText id="common.m749f46073eec" /></button>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void doImport(file);
                }}
              />
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 h-11 flex items-center gap-2">
              <Search className="h-4 w-4 text-white/45" />
              <UiProps ids={{"placeholder":["common.mc56be64850d9"]}}><input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="common.mc56be64850d9"
                className="flex-1 bg-transparent outline-none text-sm text-white/85 placeholder:text-white/35"
              /></UiProps>
            </div>
            {tab === "generated" ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.06] p-1 flex items-center gap-1">
                {[
                  { key: "all", label: text("createDynamic.m5c55a67935af") },
                  { key: "face_swap", label: text("createDynamic.m5235f7494aaa") },
                  { key: "image_edit", label: text("createDynamic.md24c10d37db0") },
                  { key: "video", label: text("createDynamic.mc20f7618d330") },
                  { key: "audio", label: text("createDynamic.m296c632ec857") }
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setTypeFilter(f.key as any)}
                    className={[
                      "flex-1 h-9 rounded-xl text-sm font-medium transition-colors",
                      typeFilter === (f.key as any)
                        ? "bg-white/[0.18] text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/15"
                        : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                    ].join(" ")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {error ? <div className="text-sm text-rose-300 mb-3">{localizeError(error)}</div> : null}
            {loading ? <div className="text-sm text-white/50"><UiText id="common.m4927a53bcc88" /></div> : null}
            {!loading && !displayItems.length ? (
              <div className="h-[220px] rounded-2xl border border-white/10 bg-white/[0.04] flex flex-col items-center justify-center text-white/50 text-sm">
                <div><UiText id="common.m3c687e1603a1" /></div>
                <div className="text-xs text-white/35 mt-2">{tab === "import" ? <UiText id="common.m174474680d83" /> : <UiText id="common.m6a6017199efe" />}</div>
              </div>
            ) : (
              <div className={["grid gap-4", cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1"].join(" ")}>
                {displayItems.map((it) => {
                  const src = it.localPath || "";
                  const kind = inferKind(it.localPath);
                  const title = formatName(it);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => {
                        if (!it.localPath) return;
                        setLightbox({ open: true, src: it.localPath, kind, title });
                      }}
                      className="text-left rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:bg-white/[0.06] transition"
                      disabled={!it.localPath}
                    >
                      <div className="relative">
                        <div className="absolute top-2 left-2 h-7 px-2 rounded-full border border-white/10 bg-black/40 text-white/90 text-xs flex items-center backdrop-blur">
                          {typeLabel(it.type, text)}
                        </div>
                        <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteTarget(it);
                          }}
                          className="absolute top-2 right-2 h-8 w-8 rounded-xl border border-white/10 bg-black/40 text-white/90 hover:bg-black/55 transition flex items-center justify-center backdrop-blur"
                          aria-label="common.m2f9daa828907"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button></UiProps>
                      <div className="bg-black/30 p-3 flex items-center justify-center">
                        {kind === "audio" ? (
                          <div className="flex h-40 w-full flex-col items-center justify-center gap-2 bg-[var(--panel-bg)] text-[var(--app-muted)]">
                            <Music2 className="h-8 w-8" />
                            <span className="text-sm"><UiText id="common.m296c632ec857" /></span>
                          </div>
                        ) : kind === "video" ? (
                          <video src={src} className="max-w-full max-h-[240px] object-contain" muted playsInline />
                        ) : (
                          <MediaImage src={src} alt="" className="w-auto h-auto max-w-full max-h-[240px] object-contain" />
                        )}
                      </div>
                      </div>
                      <div className="p-3">
                        <div className="text-sm text-white/90 truncate">{title}</div>
                        <div className="mt-1 text-xs text-white/45 truncate">{src}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <MediaLightbox
        open={lightbox.open}
        src={lightbox.src}
        kind={lightbox.kind}
        title={lightbox.title}
        onClose={() => setLightbox({ open: false, src: null, kind: "image" })}
      />
      <UiProps ids={{"title":["common.mf42f9bdb21af"],"description":["common.mf876d0c49d1d"],"confirmText":["common.ma3ea3c17b401"],"cancelText":["common.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!deleteTarget}
        title="common.mf42f9bdb21af"
        description={deleteTarget ? "common.mf876d0c49d1d" : ""}
        confirmText="common.ma3ea3c17b401"
        cancelText="common.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteAsset(deleteTarget.id);
        }}
      /></UiProps>
    </>
  );
}
