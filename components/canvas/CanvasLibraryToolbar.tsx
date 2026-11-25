"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Check, Grid2X2, List, ListCollapse, ListTree, ListFilter, Search, X } from "lucide-react";

export type LibraryLayout = "list" | "grid";
export type LibraryMediaFilter = "all" | "image" | "video" | "audio" | "text";
const filterNames = { all: "全部", image: "图片", video: "视频", audio: "音频", text: "文本" };

export default function CanvasLibraryToolbar({ query, onQueryChange, placeholder, layout, onLayoutChange, onExpandAll, onCollapseAll, mediaFilter, onMediaFilterChange, includeText = false, controlsAtStart = false, actions }: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  layout: LibraryLayout;
  onLayoutChange: (value: LibraryLayout) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  mediaFilter: LibraryMediaFilter;
  onMediaFilterChange: (value: LibraryMediaFilter) => void;
  includeText?: boolean;
  controlsAtStart?: boolean;
  actions?: React.ReactNode;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const [searchOpen, setSearchOpen] = React.useState(Boolean(query));
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const filterRef = React.useRef<HTMLDivElement>(null);
  const filterButton = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const searchButton = React.useRef<HTMLButtonElement>(null);
  const menuButton = React.useRef<HTMLButtonElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const searching = searchOpen || Boolean(query);
  const closeSearch = () => { onQueryChange(""); setSearchOpen(false); requestAnimationFrame(() => searchButton.current?.focus()); };
  React.useEffect(() => { if (searching) input.current?.focus(); }, [searching]);
  React.useEffect(() => {
    if (!menuOpen && !filterOpen && !searching) return;
    const pointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== (toolbarRef.current?.closest('[role="dialog"]') || null)) return;
      event.preventDefault(); event.stopPropagation();
      if (filterOpen) { setFilterOpen(false); filterButton.current?.focus(); }
      else if (menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      else closeSearch();
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", pointer); window.removeEventListener("keydown", escape, true); };
  });
  const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)]";
  const action = "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--panel-2)] focus-visible:bg-[var(--panel-2)] focus-visible:outline-none";
  return <div ref={toolbarRef} className="flex h-11 shrink-0 items-center gap-1 px-2" data-canvas-library-toolbar>
    {searching ? <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--panel-2)] px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" />
        <input ref={input} aria-label={placeholder} placeholder={placeholder} value={query} onChange={event => onQueryChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--app-fg)] outline-none" />
      </label> : <button ref={searchButton} type="button" aria-label={placeholder} title={placeholder} className={iconButton} onClick={() => { setSearchOpen(true); setMenuOpen(false); setFilterOpen(false); }}><Search className="h-4 w-4" /></button>}
      <div ref={filterRef} className={`relative shrink-0 ${controlsAtStart ? "order-2" : ""}`}>
        <button ref={filterButton} type="button" aria-label={text("workspaceFollowup.m5fba39511b28", { v0: uiLabel(filterNames[mediaFilter]) })} title={text("workspaceFollowup.m5fba39511b28", { v0: uiLabel(filterNames[mediaFilter]) })} aria-haspopup="true" aria-expanded={filterOpen} className={`${iconButton} ${mediaFilter !== "all" ? "bg-[var(--panel-2)] text-[var(--app-fg)]" : ""}`} onClick={() => { setFilterOpen(value => !value); setMenuOpen(false); }}><ListFilter className="h-4 w-4" /></button>
        {filterOpen && <UiProps ids={{"aria-label":["canvas.m3be96f8eb83d"]}}><div aria-label="canvas.m3be96f8eb83d" className={`absolute top-full z-40 mt-1 w-40 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 text-[var(--app-fg)] shadow-xl ${searching ? "right-0" : "left-0"}`}>
          {(["all", "image", "video", "audio", "text"] as const).filter(value => includeText || value !== "text").map(value => <button key={value} type="button" aria-pressed={mediaFilter === value} className={`${action} ${mediaFilter === value ? "bg-[var(--panel-2)]" : ""}`} onClick={() => { onMediaFilterChange(value); setFilterOpen(false); filterButton.current?.focus(); }}>{uiLabel(filterNames[value])}{mediaFilter === value && <Check className="ml-auto h-3.5 w-3.5" />}</button>)}
        </div></UiProps>}
      </div>
    {searching ? <UiProps ids={{"aria-label":["canvas.mab008ef18dac"],"title":["canvas.mab008ef18dac"]}}><button type="button" aria-label="canvas.mab008ef18dac" title="canvas.mab008ef18dac" className={`${iconButton} ${controlsAtStart ? "order-3" : ""}`} onClick={closeSearch}><X className="h-4 w-4" /></button></UiProps> : <>
      <span className={`min-w-0 flex-1 truncate text-sm text-[var(--app-muted)] ${controlsAtStart ? "order-3" : ""}`}>{mediaFilter !== "all" ? filterNames[mediaFilter] : ""}</span>
      <div ref={menuRef} className={`relative ${controlsAtStart ? "order-1" : ""}`}>
        <UiProps ids={{"aria-label":["canvas.m7ce72c08ff9c"],"title":["canvas.m7ce72c08ff9c"]}}><button ref={menuButton} type="button" aria-label="canvas.m7ce72c08ff9c" title="canvas.m7ce72c08ff9c" aria-haspopup="true" aria-expanded={menuOpen} className={iconButton} onClick={() => { setMenuOpen(value => !value); setFilterOpen(false); }}>{layout === "grid" ? <Grid2X2 className="h-4 w-4" /> : <List className="h-4 w-4" />}</button></UiProps>
        {menuOpen && <UiProps ids={{"aria-label":["canvas.m7ce72c08ff9c"]}}><div aria-label="canvas.m7ce72c08ff9c" className={`absolute top-full z-40 mt-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 text-[var(--app-fg)] shadow-xl ${controlsAtStart && actions ? "left-0" : "right-0"}`}>
          {(["list", "grid"] as const).map(value => <button key={value} type="button" aria-pressed={layout === value} className={action} onClick={() => { onLayoutChange(value); setMenuOpen(false); menuButton.current?.focus(); }}>
            {value === "list" ? <List className="h-3.5 w-3.5" /> : <Grid2X2 className="h-3.5 w-3.5" />}{value === "list" ? <UiText id="canvas.meff4c9177dd3" /> : <UiText id="canvas.m6245d66d7681" />}{layout === value && <Check className="ml-auto h-3.5 w-3.5" />}
          </button>)}
          {(onExpandAll || onCollapseAll) && <div className="my-1 border-t border-[var(--border)]" />}
          {onExpandAll && <button type="button" className={action} onClick={() => { onExpandAll(); setMenuOpen(false); menuButton.current?.focus(); }}><ListTree className="h-3.5 w-3.5" /><UiText id="canvas.m1fc0d67f78f2" /></button>}
          {onCollapseAll && <button type="button" className={action} onClick={() => { onCollapseAll(); setMenuOpen(false); menuButton.current?.focus(); }}><ListCollapse className="h-3.5 w-3.5" /><UiText id="canvas.m7087ba9c2a01" /></button>}
        </div></UiProps>}
      </div>
    </>}
    {!searching && actions && <div className="order-4 flex shrink-0 items-center gap-1">{actions}</div>}
  </div>;
}
