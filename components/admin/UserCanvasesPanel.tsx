"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import dynamic from "next/dynamic";
import { Frame, RefreshCw, Search } from "lucide-react";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates } from "@/lib/media-url";
import { loadAdminCanvas, loadAdminCanvasList, type AdminCanvasList } from "@/lib/admin-canvas-cache";

const loadViewer = () => import("./UserCanvasViewer");
const Viewer = dynamic(loadViewer, { ssr: false, loading: () => <div className="p-10 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m8bbf7f6c8d7a" /></div> });

export default function UserCanvasesPanel({ adminKey, userName }: { adminKey: string; userName: string }) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, locale: uiLocale } = useUiLocale();
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const page = React.useRef(0);
  const loadingRef = React.useRef(false);
  const loadMoreRef = React.useRef<HTMLDivElement>(null);
  const [data, setData] = React.useState<AdminCanvasList>();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState<number | null>(null);
  const sequence = React.useRef(0);
  const prefetchTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const prefetching = React.useRef(new Set<number>());
  const cancelPrefetch = () => { clearTimeout(prefetchTimer.current); };
  React.useEffect(() => cancelPrefetch, [adminKey]);
  const prefetch = (id: number) => {
    cancelPrefetch();
    void loadViewer().catch(() => undefined);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType || "") || prefetching.current.size >= 2 || prefetching.current.has(id)) return;
    prefetching.current.add(id);
    void loadAdminCanvas(adminKey, id).catch(() => undefined).finally(() => prefetching.current.delete(id));
  };
  React.useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const load = React.useCallback(async (force = false, append = false) => {
    if (append && loadingRef.current) return;
    const request = ++sequence.current;
    const nextPage = append ? page.current + 1 : 1;
    loadingRef.current = true;
    setLoading(true); setError("");
    try {
      const next = await loadAdminCanvasList(adminKey, nextPage, query, force);
      if (sequence.current === request) {
        page.current = nextPage;
        setData(previous => {
          if (!append || !previous) return next;
          const ids = new Set(previous.items.map(item => item.id));
          return { ...next, items: [...previous.items, ...next.items.filter(item => !ids.has(item.id))] };
        });
      }
    }
    catch (cause) { if (sequence.current === request) setError((cause as Error).message); }
    finally { if (sequence.current === request) { loadingRef.current = false; setLoading(false); } }
  }, [adminKey, query]);
  React.useEffect(() => { setData(undefined); void load(); return () => { sequence.current++; }; }, [load]);
  React.useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || selected !== null || !data?.hasMore || loading || error) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load(false, true);
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [data?.hasMore, loading, error, selected, load]);
  if (selected !== null) return <Viewer key={`${adminKey}:${selected}`} adminKey={adminKey} canvasId={selected} userName={userName} onBack={() => { setSelected(null); void load(); }} />;
  return <section className="flex min-h-full flex-col p-4 sm:p-5" data-admin-user-canvases>
    <header className="mb-5 flex flex-wrap items-center gap-3"><div className="flex-1"><h2 className="text-sm font-semibold"><UiText id="admin.md3cd5d44facb" /></h2><p className="mt-1 text-xs text-[var(--app-muted)]">{userName}<UiText id="admin.m324009b26cf4" /></p></div>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3"><Search size={14} /><UiProps ids={{"aria-label":["admin.m0918aec1f77c"],"placeholder":["admin.mf57c94a68e8d"]}}><input aria-label="admin.m0918aec1f77c" value={search} onChange={event => setSearch(event.target.value)} placeholder="admin.mf57c94a68e8d" className="w-40 bg-transparent text-xs outline-none" /></UiProps></label>
      <button disabled={loading} onClick={() => void load(true)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs disabled:opacity-40"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /><UiText id="admin.maee887434131" /></button>
    </header>
    {error ? <div role="alert" className="py-10 text-center text-sm">{uiError(error)}<button onClick={() => void load(true)} className="ml-3 underline"><UiText id="admin.mb8784c8dd563" /></button></div> : !data ? <div className="py-16 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m370f61e9e489" /></div> : !data.items.length ? <div className="py-16 text-center text-sm text-[var(--app-muted)]">{query ? <UiText id="admin.mf6e919bfe9cc" /> : <UiText id="admin.ma95b83861110" />}</div> : <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(0,240px))] gap-4">{data.items.map((canvas, index) => <button key={canvas.id}
        onPointerEnter={() => { cancelPrefetch(); prefetchTimer.current = setTimeout(() => prefetch(canvas.id), 120); }} onPointerLeave={cancelPrefetch}
        onFocus={() => prefetch(canvas.id)} onBlur={cancelPrefetch}
        onClick={() => { cancelPrefetch(); void loadAdminCanvas(adminKey, canvas.id).catch(() => undefined); setSelected(canvas.id); }} className="group min-w-0 rounded-xl text-left" aria-label={tLabel(`查看画布：${canvas.title}`)}>
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input-bg)] group-hover:border-[var(--primary-bg)]">{canvas.thumbnail ? <ResilientImage candidates={buildMediaPreviewCandidates(canvas.thumbnail, { width: 600, height: 375, mode: "cover" })} alt={canvas.title} className="h-full w-full object-cover" loading={index < 4 ? "eager" : "lazy"} decoding="async" cacheInMemory={false} /> : <Frame className="h-8 w-8 text-[var(--app-muted)]" />}</div>
        <p className="mt-3 truncate text-sm font-medium">{canvas.title}</p><p className="mt-1 text-xs text-[var(--app-muted)]">{new Date(canvas.updatedAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN")} · {canvas.nodeCount}<UiText id="admin.m77bf40283f1b" /></p>
      </button>)}</div>
      {data.hasMore && <div ref={loadMoreRef} className="h-8 shrink-0" role="status">{loading && <p className="pt-3 text-center text-xs text-[var(--app-muted)]"><UiText id="admin.m9844248b7808" /></p>}</div>}
    </>}
  </section>;
}
