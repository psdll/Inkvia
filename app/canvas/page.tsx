"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ExternalLink, Folder, Frame, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { DEFAULT_CANVAS_TITLE } from "@/lib/canvas/title";
import { CANVAS_TRASH_RETENTION_DAYS } from "@/lib/canvas/trash-retention-config";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates } from "@/lib/media-url";
import { cacheCanvasProjects, loadCanvasProjects, readCanvasProjects, warmCanvasBoard, warmCanvasProject, type CanvasListItem } from "@/lib/client/canvas-entry";
import { AutoHideScrollbar } from "@/components/ui/auto-hide-scrollbar";
import { readLastDesktopWorkspacePath } from "@/components/layout/desktop-workspace-path";

function CanvasProjectsBackButton({ trash, loading, onReturnToProjects }: {
  trash: boolean;
  loading: boolean;
  onReturnToProjects: () => void;
}) {
  const { text } = useUiLocale();
  const router = useRouter();
  const label = trash ? text("workspaceFollowup.m94abed65b1bc") : text("workspaceFollowup.m572cf45ba436");
  return <button
    type="button"
    title={label}
    aria-label={label}
    disabled={trash && loading}
    onClick={trash ? onReturnToProjects : () => router.push(readLastDesktopWorkspacePath())}
    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-muted)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-wait"
  ><ChevronLeft className="h-4 w-4" /></button>;
}

export default function CanvasPage() {
  const { text, locale, error } = useUiLocale();
  const projectScrollRef = React.useRef<HTMLElement>(null);
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const [items, setItems] = React.useState<CanvasListItem[]>(() => user ? readCanvasProjects(user.id) ?? [] : []);
  const [trash, setTrash] = React.useState(false);
  const viewRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [hasSettledInitialLoad, setHasSettledInitialLoad] = React.useState(() => Boolean(user && readCanvasProjects(user.id)));
  const [menuId, setMenuId] = React.useState<number | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (menuId === null) return;
    const close = () => setMenuId(null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = projectScrollRef.current;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    scroll?.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      scroll?.removeEventListener("scroll", close);
    };
  }, [menuId]);
  const [createError, setCreateError] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<CanvasListItem | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renameError, setRenameError] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<CanvasListItem | null>(null);
  const [deleteError, setDeleteError] = React.useState("");

  const refresh = React.useCallback(async (targetTrash = viewRef.current) => {
    if (!user) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const nextItems = await loadCanvasProjects(user.id, targetTrash);
      if (requestId !== requestIdRef.current) return;
      setItems(nextItems);
      viewRef.current = targetTrash;
      setTrash(targetTrash);
      setMenuId(null);
    } catch {
      if (requestId === requestIdRef.current) setLoadError(text("workspaceFollowup.m87d513ab6235"));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setHasSettledInitialLoad(true);
      }
    }
  }, [user?.id]);

  React.useEffect(() => {
    const cached = user ? readCanvasProjects(user.id) : undefined;
    setItems(cached ?? []);
    setHasSettledInitialLoad(Boolean(cached));
    if (user) void refresh();
    return () => { requestIdRef.current += 1; };
  }, [refresh, user?.id]);
  React.useEffect(() => {
    if (!user || !hasSettledInitialLoad) return;
    const timer = setTimeout(() => { void warmCanvasBoard(); }, 800);
    return () => clearTimeout(timer);
  }, [user?.id, hasSettledInitialLoad]);
  React.useEffect(() => {
    if (!authLoading && !user) setHasSettledInitialLoad(true);
  }, [authLoading, user]);

  const createCanvas = async () => {
    const pendingTab = window.open("", "_blank");
    if (!pendingTab) {
      setCreateError(text("workspaceFollowup.m719c316a968a"));
      return;
    }
    pendingTab.document.title = text("workspaceFollowup.m2b8fb046758d");
    pendingTab.opener = null;
    setCreateError("");
    try {
      const response = await fetch("/api/canvas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: DEFAULT_CANVAS_TITLE }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "创建画布失败");
      if (!pendingTab.closed) pendingTab.location.replace(`/canvas/${payload.publicId}`);
      void refresh();
    } catch (reason) {
      if (!pendingTab.closed) pendingTab.close();
      setCreateError(String((reason as Error)?.message || reason));
    }
  };

  const openRenameDialog = (canvas: CanvasListItem) => {
    setRenameTarget(canvas);
    setRenameValue(canvas.title);
    setRenameError("");
    setMenuId(null);
  };

  const renameCanvas = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      setRenameError(text("workspaceFollowup.m8e93240d506d"));
      return false;
    }
    if (title === renameTarget.title) return;
    const response = await fetch(`/api/canvas/${renameTarget.id}/project-metadata`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setRenameError(payload?.error || text("workspaceFollowup.m5a5e21a44245"));
      return false;
    }
    await refresh();
  };

  const openDeleteDialog = (canvas: CanvasListItem) => {
    setDeleteTarget(canvas);
    setDeleteError("");
    setMenuId(null);
  };

  const deleteCanvas = async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    setDeleteError("");
    try {
      const response = await fetch(`/api/canvas/${deletedId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setDeleteError(payload?.error || text("workspaceFollowup.m1726694dfa6f"));
        return false;
      }
      // A list reload must not hold the dialog open after deletion succeeds.
      // Invalidate older list reads so they cannot put the deleted card back.
      requestIdRef.current += 1;
      setLoading(false);
      setItems((current) => {
        const next = current.filter((item) => item.id !== deletedId);
        if (user) cacheCanvasProjects(user.id, next, trash);
        return next;
      });
    } catch {
      setDeleteError(text("workspaceFollowup.mf11e9b9033cd"));
      return false;
    }
  };

  const restoreCanvas = async (canvasId: number) => {
    await fetch(`/api/canvas/${canvasId}/restore`, { method: "POST" });
    await refresh();
  };

  const reorder = async (draggedId: number, targetId: number) => {
    if (draggedId === targetId) return;
    const visible = items;
    const from = visible.findIndex((item) => item.id === draggedId);
    const to = visible.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...visible];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setItems((current) => current.map((item) => { const index = reordered.findIndex((candidate) => candidate.id === item.id); return index >= 0 ? { ...item, sortOrder: index } : item; }));
    await Promise.all(reordered.map((item, index) => fetch(`/api/canvas/${item.id}/metadata`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: index }) })));
  };

  const visibleItems = items.filter((item) => !search.trim() || item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pagePending = authLoading;

  if (!pagePending && !user) return <AtomicPageReveal ready={hasSettledInitialLoad}><div className="flex flex-1 flex-col items-center justify-center gap-4"><Frame className="h-8 w-8 text-[var(--app-muted)]" /><p className="text-sm text-[var(--app-muted)]"><UiText id="canvas.mf5634d122803" /></p><button type="button" onClick={() => openLoginModal()} className="rounded-xl bg-[var(--primary-bg)] px-5 py-2 text-sm text-[var(--primary-fg)]">{desktopMode ? <UiText id="canvas.medd4000049f2" /> : <UiText id="canvas.me5533fd28356" />}</button></div></AtomicPageReveal>;

  return (
    <AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>
    <div className="relative flex min-h-0 flex-1 bg-[var(--workspace-page-bg)]">
      <main ref={projectScrollRef} id="canvas-project-list" className="auto-hide-scroll-area min-w-0 flex-1 overflow-auto px-6 pb-6 lg:px-10">
        <div className="sticky top-0 z-40 mx-auto flex w-full max-w-[1400px] flex-wrap items-end justify-between gap-5 bg-[var(--workspace-page-bg)] pb-7 pt-6">
          <div>
            <div className={desktopMode ? "flex items-center gap-2" : undefined}>
              {desktopMode && <CanvasProjectsBackButton trash={trash} loading={loading} onReturnToProjects={() => { void refresh(false); }} />}
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--app-fg)]">{trash ? <UiText id="canvas.mba35dc23b245" /> : <UiText id="canvas.me3040dfd6b30" />}</h1>
            </div>
            <p className="mt-2 text-sm text-[var(--app-muted)]">{trash ? <UiText id="canvas.m9ac86398b5d9" values={{v0: String(CANVAS_TRASH_RETENTION_DAYS)}} /> : <UiText id="canvas.m4e1b4ddaef2f" />}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex h-10 w-60 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[var(--app-muted)] focus-within:border-[var(--primary-bg)]"><Search className="h-4 w-4" /><UiProps ids={{"placeholder":["canvas.mdfb59ea2b7a2"]}}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="canvas.mdfb59ea2b7a2" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]" /></UiProps></label>
            <button type="button" onClick={() => { void refresh(!trash); }} disabled={loading} aria-busy={loading} className="flex h-10 w-28 shrink-0 justify-center disabled:cursor-wait items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-muted)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : trash ? <Folder className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}{trash ? <UiText id="canvas.m514a2a273f9f" /> : <UiText id="canvas.mba35dc23b245" />}</button>
          </div>
          {loadError && <p role="alert" className="w-full text-right text-xs text-red-500">{error(loadError)}</p>}
          {createError && <p role="alert" className="w-full text-right text-xs text-red-500">{error(createError)}</p>}
        </div>
        <div data-canvas-project-grid className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {!trash ? <button type="button" onClick={() => { void createCanvas(); }} className="group overflow-hidden rounded-xl text-left">
            <span className="flex aspect-video items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] transition-colors duration-200 group-hover:border-[var(--primary-bg)]"><span className="flex flex-col items-center gap-2 text-[var(--app-fg)]"><Plus className="h-7 w-7 text-[var(--app-muted)]" /><span className="text-sm font-medium"><UiText id="canvas.mcfbdab86969c" /></span></span></span>
            <span className="mt-3 block text-sm text-[var(--app-muted)]"><UiText id="canvas.me0affe1a8e6e" /></span>
          </button> : null}
          {visibleItems.map((canvas, index) => (
            <div key={canvas.id} draggable={!trash} onDragStart={(event) => { event.dataTransfer.setData("application/x-canvas-id", String(canvas.id)); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { if (!trash) event.preventDefault(); }} onDrop={(event) => { if (!trash) { event.preventDefault(); const draggedId = Number(event.dataTransfer.getData("application/x-canvas-id")); if (draggedId) void reorder(draggedId, canvas.id); } }} className="group/card relative min-w-0">
              <Link href={trash ? "#" : `/canvas/${canvas.publicId}`} onPointerEnter={() => { if (!trash && user) warmCanvasProject(user.id, canvas.id); }} onFocus={() => { if (!trash && user) warmCanvasProject(user.id, canvas.id); }} target={trash ? undefined : "_blank"} rel={trash ? undefined : "noopener noreferrer"} className="block">
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input-bg)] transition-[border-color,transform] duration-200 group-hover/card:border-[var(--canvas-node-border-selected)]">{canvas.thumbnail ? <ResilientImage candidates={buildMediaPreviewCandidates(canvas.thumbnail, { width: 600, height: 375, mode: "cover" })} alt="" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/card:scale-[1.015]" loading={index < 4 ? "eager" : "lazy"} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} cacheInMemory={false} /> : <Frame className="h-7 w-7 text-[var(--app-muted)] opacity-45" />}</div>
                <div className="mt-3 pr-8"><p className="truncate text-sm font-semibold text-[var(--app-fg)]">{canvas.title}</p><p className="mt-1 text-xs text-[var(--app-muted)]">revision {locale === "en" && /^\d+$/.test(canvas.revision) ? BigInt(canvas.revision).toLocaleString("en-US") : canvas.revision} · {new Date(canvas.updatedAt).toLocaleDateString(locale === "en" ? "en-US" : undefined)}</p></div>
              </Link>
              {trash ? <button type="button" onClick={() => { void restoreCanvas(canvas.id); }} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--app-fg)]"><RotateCcw className="h-3.5 w-3.5" /><UiText id="canvas.me0534b8a4e46" /></button> : <div ref={menuId === canvas.id ? menuRef : undefined} className="absolute bottom-5 right-0 z-20">
                <UiProps ids={{"aria-label":["canvas.madf049f03279"]}}><button type="button" aria-label="canvas.madf049f03279" aria-expanded={menuId === canvas.id} onClick={() => setMenuId((id) => id === canvas.id ? null : canvas.id)} className="rounded-lg p-1.5 text-[var(--app-muted)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"><MoreHorizontal className="h-4 w-4" /></button></UiProps>
                {menuId === canvas.id ? <div className="absolute top-8 right-0 z-30 w-44 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-[var(--shadow)]">
                  <a href={`/canvas/${canvas.publicId}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><ExternalLink className="h-3.5 w-3.5" /><UiText id="canvas.mc771248e511f" /></a>
                  <button type="button" onClick={() => openRenameDialog(canvas)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><Pencil className="h-3.5 w-3.5" /><UiText id="canvas.m0d0cbac2eee5" /></button>
                  <div className="my-1 h-px bg-[var(--border)]" />
                  <button type="button" onClick={() => openDeleteDialog(canvas)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--error-fg,#ef4444)] hover:bg-[var(--panel-2)]"><Trash2 className="h-3.5 w-3.5" /><UiText id="canvas.mf6dc6a110d09" /></button>
                </div> : null}
              </div>}
            </div>
          ))}
        </div>
        {trash && !pagePending && hasSettledInitialLoad && !loadError && visibleItems.length === 0 && <div className="mx-auto mt-20 flex w-fit flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] px-16 py-12 text-sm text-[var(--app-muted)]"><Trash2 className="h-6 w-6" /><UiText id="canvas.m351cbe0862c6" /></div>}
        {(pagePending || (!hasSettledInitialLoad && loading)) && <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-[var(--app-muted)]" />}
      </main>
      <AutoHideScrollbar scrollRef={projectScrollRef} />
      <UiProps ids={{"title":["canvas.m84ba75cf3f85"],"description":["canvas.m7b5ddf41fea4"],"confirmText":["canvas.ma3030bf8f16d"]}}><ConfirmDialog
        open={Boolean(renameTarget)}
        title="canvas.m84ba75cf3f85"
        description="canvas.m7b5ddf41fea4"
        confirmText="canvas.ma3030bf8f16d"
        onClose={() => { setRenameTarget(null); setRenameError(""); }}
        onConfirm={renameCanvas}
      >
        <UiProps ids={{"placeholder":["canvas.m867698fb7b0c"]}}><input
          autoFocus
          value={renameValue}
          onChange={(event) => { setRenameValue(event.target.value); setRenameError(""); }}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-fg)] outline-none transition-colors focus:border-[var(--primary-bg)]"
          placeholder="canvas.m867698fb7b0c"
        /></UiProps>
        {renameError ? <p role="alert" className="mt-2 text-xs text-[var(--error-fg,#ef4444)]">{error(renameError)}</p> : null}
      </ConfirmDialog></UiProps>
      <UiProps ids={{"title":["canvas.mf6dc6a110d09"],"confirmText":["canvas.m361bdf3f36e3"]}}><ConfirmDialog
        open={Boolean(deleteTarget)}
        title="canvas.mf6dc6a110d09"
        description={deleteTarget ? text("workspaceFollowup.m9b4bd0266e29", { v0: deleteTarget.title }) : ""}
        confirmText="canvas.m361bdf3f36e3"
        danger
        onClose={() => { setDeleteTarget(null); setDeleteError(""); }}
        onConfirm={deleteCanvas}
      >
        {deleteError ? <p role="alert" className="text-xs text-[var(--error-fg,#ef4444)]">{error(deleteError)}</p> : null}
      </ConfirmDialog></UiProps>
    </div>
    </AtomicPageReveal>
  );
}
