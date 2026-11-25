"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import CanvasPersonalLibrary from "./CanvasPersonalLibrary";
import { ChevronDown, ChevronRight, Folder, ImageIcon, Video, X } from "lucide-react";
import CanvasLibraryToolbar, { type LibraryLayout, type LibraryMediaFilter } from "./CanvasLibraryToolbar";
import type { CanvasNode } from "@/lib/canvas/document";
import { listCanvasCurrentMaterials, listCanvasMaterialRows, type CanvasCurrentMaterial } from "@/lib/canvas/current-materials";
import { MediaImage } from "@/components/ui/media-image";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import { readCanvasVideoPoster } from "@/lib/canvas/video-poster-cache";
import { Virtuoso } from "react-virtuoso";

import { libraryPositionKey, readLibraryPosition, writeLibraryPosition, useLibraryScroll } from "./use-library-position";

const LIBRARY_PREVIEW_SIZE = { width: 120, height: 120 };
const LIBRARY_FIRST_SCREEN = 12;

function MaterialVideoThumbnail({ item, eager, ownerId }: { item: CanvasCurrentMaterial; eager: boolean; ownerId: number }) {
  const [failedPoster, setFailedPoster] = React.useState<string | null>(null);
  const [cached, setCached] = React.useState<{ owner: number; source: string; poster: string | null } | null>(null);
  const fallback = item.thumbnailUrl === item.url || item.thumbnailUrl === failedPoster;
  React.useEffect(() => {
    if (!fallback) return;
    let cancelled = false;
    void readCanvasVideoPoster(ownerId, item.url).then(poster => {
      if (!cancelled) setCached({ owner: ownerId, source: item.url, poster: poster?.url ?? null });
    });
    return () => { cancelled = true; };
  }, [fallback, item.url, ownerId]);
  if (!fallback) {
    return <MediaImage src={item.thumbnailUrl} alt="" className="h-full w-full object-cover"
      previewSize={LIBRARY_PREVIEW_SIZE} loading={eager ? "eager" : "lazy"}
      onError={() => setFailedPoster(item.thumbnailUrl)} />;
  }
  if (cached?.owner !== ownerId || cached.source !== item.url) {
    return <span className="flex h-full w-full items-center justify-center"><Video className="h-5 w-5 text-[var(--app-muted)]" /></span>;
  }
  if (cached.poster) return <MediaImage src={cached.poster} alt="" className="h-full w-full object-cover" original cacheInMemory={false}
    onError={() => setCached({ owner: ownerId, source: item.url, poster: null })} />;
  return <VideoPosterPreview videoSrc={item.url} alt="" className="h-full w-full" />;
}

export { useCanvasLibraryPreviewWarmup } from "./use-canvas-library-preview-warmup";

type Props = {
  ownerId: number;
  canvasId: number;
  nodes: CanvasNode[];
  onLocateNode: (nodeId: string) => void;
  onClose: () => void;
};

export default function CanvasLibraryPanel({ ownerId, canvasId, nodes, onLocateNode, onClose }: Props) {
  const { text } = useUiLocale();
  const positionKey = libraryPositionKey(ownerId, canvasId, "panel");
  const [saved] = React.useState(() => readLibraryPosition(positionKey, { query: "", view: "media", mediaFilter: "all", layout: "list" }));
  const [layout, setLayout] = React.useState<LibraryLayout>(saved.layout === "grid" ? "grid" : "list");
  const [query, setQuery] = React.useState(saved.view === "workflow" ? "" : saved.query);
  const [view, setView] = React.useState<"media" | "personal">(saved.view === "personal" ? "personal" : "media");
  const [mediaFilter, setMediaFilter] = React.useState<LibraryMediaFilter>(saved.mediaFilter === "image" || saved.mediaFilter === "video" || saved.mediaFilter === "audio" || saved.mediaFilter === "text" ? saved.mediaFilter : "all");
  const mediaScroll = useLibraryScroll(`${positionKey}_media_scroll`, true);
  React.useEffect(() => {
    writeLibraryPosition(positionKey, { query, view, mediaFilter, layout });
  }, [positionKey, query, view, mediaFilter, layout]);
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const materials = React.useMemo(() => listCanvasCurrentMaterials(nodes), [nodes]);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const rows = React.useMemo(() => listCanvasMaterialRows(nodes, materials, {
    query: normalizedQuery, kind: mediaFilter, collapsed: collapsedGroups,
  }), [nodes, materials, normalizedQuery, mediaFilter, collapsedGroups]);
  const filtering = Boolean(normalizedQuery) || mediaFilter !== "all";
  const displayRows = React.useMemo(() => {
    const result: (typeof rows)[] = [];
    for (const row of rows) {
      const previous = result.at(-1);
      if (layout === "grid" && row.type === "material" && previous?.length === 1
        && previous[0].type === "material" && previous[0].depth === row.depth) previous.push(row);
      else result.push([row]);
    }
    return result;
  }, [rows, layout]);
  return (
    <aside className="relative z-10 flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-l border-[var(--canvas-controls-border)] bg-[var(--panel-bg)] shadow-[var(--canvas-shadow-menu)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-medium text-[var(--app-fg)]"><UiText id="canvas.m66e8a0315571" /></span>
        <UiProps ids={{"title":["canvas.m3fd47edce45b"],"aria-label":["canvas.m3cb0a89a55c3"]}}><button type="button" onClick={onClose} title="canvas.m3fd47edce45b" aria-label="canvas.m3cb0a89a55c3" className="ml-auto rounded-lg p-1.5 text-[var(--app-muted)] hover:bg-[var(--panel-2)]"><X className="h-4 w-4" /></button></UiProps>
      </div>

      <div className="grid grid-cols-2 gap-1 border-b border-[var(--border)] p-2">
        <button type="button" onClick={() => setView("media")} className={`rounded-lg px-2 py-2 text-sm ${view === "media" ? "bg-[var(--panel-2)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]"}`}><UiText id="canvas.m78ae173c7f14" /></button>
        <button type="button" onClick={() => setView("personal")} className={`rounded-lg px-2 py-2 text-sm ${view === "personal" ? "bg-[var(--panel-2)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]"}`}><UiText id="canvas.m89e906481e9f" /></button>
      </div>

      {view === "personal" ? <CanvasPersonalLibrary key={`${ownerId}:${canvasId}`} ownerId={ownerId} canvasId={canvasId} /> : (
        <>
          <UiProps ids={{"placeholder":["canvas.mdd52e1115751"]}}><CanvasLibraryToolbar query={query} onQueryChange={setQuery} placeholder="canvas.mdd52e1115751" layout={layout} onLayoutChange={setLayout} mediaFilter={mediaFilter} onMediaFilterChange={setMediaFilter} includeText
            onExpandAll={() => setCollapsedGroups(new Set())}
            onCollapseAll={() => { setQuery(""); setMediaFilter("all"); setCollapsedGroups(new Set(nodes.filter(node => node.data.kind === "group").map(node => node.id))); }} /></UiProps>
          <div data-canvas-node-count className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 text-xs tabular-nums text-[var(--app-muted)]">
            <UiProps ids={{"title":["canvas.mc2c2ee48ef2d"]}}><span title="canvas.mc2c2ee48ef2d"><UiText id="canvas.m2428420e407f" />{nodes.length}<UiText id="canvas.m77bf40283f1b" /></span></UiProps>
            {filtering && <span><UiText id="canvas.m2b0dba4e5ce7" />{rows.filter(row => row.type === "material").length}<UiText id="canvas.m1ba02a9dea7f" /></span>}
          </div>
          <div className="min-h-0 flex-1 p-2" data-canvas-library-materials data-library-layout={layout}>
            {!rows.length && <div className="mt-8 text-center text-xs leading-5 text-[var(--app-muted)]">{filtering ? <UiText id="canvas.ma200c9b55165" /> : <UiText id="canvas.m26375e6114f4" />}</div>}
            {!!rows.length && <Virtuoso
              key={`${layout}:${mediaFilter}:${normalizedQuery}`}
              initialScrollTop={mediaScroll.top.current}
              onScroll={mediaScroll.onScroll}
              data={displayRows}
              computeItemKey={(_, items) => items[0].id}
              initialItemCount={Math.min(LIBRARY_FIRST_SCREEN, displayRows.length)}
              defaultItemHeight={layout === "grid" ? 148 : 48}
              overscan={400}
              style={{ height: "100%" }}
              increaseViewportBy={{ top: 400, bottom: 600 }}
              itemContent={(index, entries) => {
                const row = entries[0];
                if (row.type === "group") return (
                  <button
                    type="button"
                    data-canvas-material-group-id={row.nodeId}
                    aria-expanded={row.expanded}
                    aria-label={`${row.expanded ? text("workspaceFollowup.m84a07f292f1f") : text("workspaceFollowup.m00bd3960fea8")} ${row.name}`}
                    aria-disabled={filtering || undefined}
                    onClick={() => {
                      if (filtering) return;
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(row.nodeId)) next.delete(row.nodeId);
                        else next.add(row.nodeId);
                        return next;
                      });
                    }}
                    title={row.name}
                    style={{ paddingLeft: 4 + row.depth * 20 }}
                    className="flex h-12 w-full items-center gap-2 rounded-md pr-2 text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)]"
                  >
                    {row.expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--app-muted)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--app-muted)]" />}
                    <Folder className="h-8 w-8 shrink-0 fill-[var(--app-muted)] text-[var(--app-muted)]" strokeWidth={1.25} />
                    <span className="truncate text-sm font-medium">{row.name}</span>
                  </button>
                );
                return (
                <div className={layout === "grid" ? "grid grid-cols-2 gap-2 pb-2" : undefined} style={layout === "grid" ? { paddingLeft: Math.min(row.depth, 4) * 12 } : undefined}>
                  {entries.map(entry => {
                    if (entry.type !== "material") return null;
                    const item = entry.material;
                    return (
                  <button
                    key={item.id}
                    type="button"
                    data-canvas-material-node-id={item.nodeId}
                    data-canvas-material-temporary={item.temporary ? "true" : undefined}
                    onClick={() => onLocateNode(item.nodeId)}
                    title={text("workspaceFollowup.me0c49f79b1a2", { v0: item.name })}
                    style={layout === "list" ? { paddingLeft: 24 + entry.depth * 20 } : undefined}
                    className={`flex w-full min-w-0 rounded-md text-left hover:bg-[var(--panel-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)] ${layout === "grid" ? "flex-col gap-1.5 p-1.5" : "h-12 items-center gap-2.5 pr-2"}`}
                  >
                    <span className={`relative shrink-0 overflow-hidden ${item.kind === "audio" || item.kind === "text" ? "rounded-lg bg-neutral-200 dark:bg-neutral-600" : "rounded-md bg-[var(--panel-2)]"} ${layout === "grid" ? "aspect-square w-full" : "h-9 w-9"}`}>
                      {item.kind === "audio" || item.kind === "text"
                        ? <span className="flex h-full w-full items-center justify-center">
                            <svg aria-hidden="true" data-canvas-material-icon={item.kind} viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500 dark:text-neutral-400">
                              <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" />
                              <path d={item.kind === "text" ? "M7 8h10M7 11h10M7 14h10M7 17h6" : "M13 15V7l4 1.5M13 15a2.5 2.5 0 1 1-2.5-2.5H13"}
                                fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-neutral-200 dark:stroke-neutral-600" />
                            </svg>
                          </span>
                        : item.temporary
                        ? <span className="flex h-full w-full items-center justify-center border border-dashed border-[var(--border-2)] text-[var(--app-muted)]">{item.kind === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}</span>
                        : item.kind === "image"
                          ? <MediaImage src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" previewSize={LIBRARY_PREVIEW_SIZE} loading={index < LIBRARY_FIRST_SCREEN ? "eager" : "lazy"} original={/^(blob:|data:)/.test(item.thumbnailUrl)} cacheInMemory={!/^(blob:|data:)/.test(item.thumbnailUrl)} />
                          : <MaterialVideoThumbnail item={item} eager={index < LIBRARY_FIRST_SCREEN} ownerId={ownerId} />}
                    </span>
                    <span className={layout === "grid" ? "w-full min-w-0" : "min-w-0 flex-1"}>
                      <span className="block truncate text-sm font-medium text-[var(--app-fg)]">{item.name}</span>
                    </span>
                  </button>
                    );
                  })}
                </div>
                );
              }}
            />}
          </div>
        </>
      )}
    </aside>
  );
}
