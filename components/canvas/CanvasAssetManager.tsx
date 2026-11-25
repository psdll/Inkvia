"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronRight, Download, Folder, Loader2, MoreHorizontal, Music2, Plus, Trash2, Upload, X } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import { personalMaterialPreviewUrl, personalMaterialUrl, type PersonalFolder, type PersonalLibrary, type PersonalMaterial } from "@/lib/canvas/personal-library-types";
import CanvasLibraryToolbar, { type LibraryLayout, type LibraryMediaFilter } from "./CanvasLibraryToolbar";

export type PersonalLibraryTarget = { type: "folder" | "item"; id: string; name: string };
type Props = {
  library: PersonalLibrary;
  ownerId: number;
  ownerName?: string;
  loading: boolean;
  busy: boolean;
  readOnly: boolean;
  nestedDialogOpen: boolean;
  message: string;
  menu: PersonalLibraryTarget | "add" | null;
  onMenuChange: (menu: PersonalLibraryTarget | "add" | null) => void;
  renderMenu: (target: PersonalLibraryTarget) => React.ReactNode;
  resourceUrl: (url: string) => string;
  onCreateFolder: (parentId: string | null) => void;
  onUpload: (folderId: string | null) => void;
  onAddToCanvas: (item: PersonalMaterial) => void;
  onDownload: (target: PersonalLibraryTarget) => void;
  onDelete: (item: PersonalMaterial) => void;
  onClose: () => void;
};
const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)]";
const folderIcon = "shrink-0 fill-[var(--app-muted)] text-[var(--app-muted)]";

export default function CanvasAssetManager(props: Props) {
  const { text, locale } = useUiLocale();
  const { library, ownerId, ownerName, loading, busy, readOnly, nestedDialogOpen, message, menu, onMenuChange, renderMenu, resourceUrl, onCreateFolder, onUpload, onAddToCanvas, onDownload, onDelete, onClose } = props;
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [layout, setLayout] = React.useState<LibraryLayout>("grid");
  const [mediaFilter, setMediaFilter] = React.useState<LibraryMediaFilter>("all");
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null);
  const selectedItem = library.items.find(item => item.id === selectedItemId);
  const panel = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const backdropDown = React.useRef(false);
  const titleId = React.useId();
  const state = React.useRef({ nestedDialogOpen, selectedItem, menu, onClose });
  state.current = { nestedDialogOpen, selectedItem, menu, onClose };

  React.useEffect(() => {
    const dialog = panel.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.focus();
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]'));
    const focus = (event: FocusEvent) => {
      if (state.current.nestedDialogOpen || dialog.contains(event.target as Node)) return;
      dialog.focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || state.current.nestedDialogOpen) return;
      if (event.key === "Escape") {
        // Menus and search handle Escape first, keeping the manager open.
        if (state.current.menu || dialog.querySelector('[aria-expanded="true"], input')) return;
        if (state.current.selectedItem) {
          event.preventDefault(); event.stopImmediatePropagation(); setSelectedItemId(null); dialog.focus(); return;
        }
        event.preventDefault(); event.stopImmediatePropagation(); state.current.onClose();
      } else if (event.key === "Tab") {
        const elements = focusables();
        const first = elements[0] || dialog, last = elements[elements.length - 1] || dialog;
        if (document.activeElement === dialog || !dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("focusin", focus);
    window.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("focusin", focus);
      window.removeEventListener("keydown", keydown, true);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  React.useEffect(() => {
    if (!loading && folderId && !library.folders.some(folder => folder.id === folderId)) setFolderId(null);
  }, [library.folders, loading, folderId]);
  React.useEffect(() => {
    if (!nestedDialogOpen && !panel.current?.contains(document.activeElement)) panel.current?.focus();
  }, [nestedDialogOpen, selectedItem]);
  const navigate = (id: string | null) => {
    setFolderId(id); setQuery(""); setSelectedItemId(null); onMenuChange(null); panel.current?.focus();
    if (content.current) content.current.scrollTop = 0;
  };
  const breadcrumbs: PersonalFolder[] = [];
  for (let folder = library.folders.find(item => item.id === folderId); folder; folder = library.folders.find(item => item.id === folder!.parentId)) breadcrumbs.unshift(folder);
  const normalized = query.trim().toLowerCase();
  const folders = library.folders.filter(folder => normalized ? folder.name.toLowerCase().includes(normalized) : folder.parentId === folderId);
  const items = library.items.filter(item => (normalized ? item.name.toLowerCase().includes(normalized) : item.folderId === folderId) && (mediaFilter === "all" || item.kind === mediaFilter));
  const more = (target: PersonalLibraryTarget) => <div data-personal-menu className="relative shrink-0">
    <button type="button" disabled={busy} aria-label={text("workspaceFollowup.m90a3f08a77a0", { v0: target.name })} aria-haspopup="menu" aria-expanded={menu !== "add" && menu?.id === target.id} className="flex h-6 w-6 items-center justify-center rounded text-[var(--app-muted)] hover:bg-[var(--panel-2)]" onClick={() => onMenuChange(menu !== "add" && menu?.id === target.id ? null : target)}><MoreHorizontal className="h-4 w-4" /></button>
    {menu !== "add" && menu?.id === target.id && renderMenu(target)}
  </div>;

  return createPortal(<>
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-[var(--overlay)] p-3 sm:p-8" data-canvas-asset-manager
      onPointerDown={event => { backdropDown.current = event.target === event.currentTarget; }}
      onClick={event => { if (backdropDown.current && event.target === event.currentTarget && !nestedDialogOpen) onClose(); backdropDown.current = false; event.stopPropagation(); }}
      onWheel={event => event.stopPropagation()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="relative flex h-[82dvh] max-h-[900px] w-[min(1600px,90vw)] min-w-0 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] shadow-[var(--shadow-2)] outline-none max-sm:h-[92dvh] max-sm:w-full">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--border)] px-6">
          <h2 id={titleId} className="text-lg font-semibold"><UiText id="canvas.m76b6b29831ea" /></h2>
          <UiProps ids={{"aria-label":["canvas.m155e0da77d76"],"title":["canvas.m3fd47edce45b"]}}><button type="button" aria-label="canvas.m155e0da77d76" title="canvas.m3fd47edce45b" className={iconButton} onClick={onClose}><X className="h-4 w-4" /></button></UiProps>
        </header>
        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <aside className="w-[240px] shrink-0 border-r border-[var(--border)] p-3 max-sm:w-full max-sm:border-b max-sm:border-r-0">
            <button type="button" aria-current="page" onClick={() => { navigate(null); setMediaFilter("all"); }} className="flex h-9 w-full items-center gap-2 rounded-xl bg-[var(--panel-3)] px-3 text-left text-sm"><Archive className="h-4 w-4" /><UiText id="canvas.m90807915e409" /></button>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-[60px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
              <UiProps ids={{"aria-label":["canvas.m32d372a91f3f"]}}><nav aria-label="canvas.m32d372a91f3f" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-base">
                <button type="button" onClick={() => navigate(null)} className={folderId ? "text-[var(--app-muted)] hover:text-[var(--app-fg)]" : "text-[var(--app-fg)]"}><UiText id="canvas.m90807915e409" /></button>
                {breadcrumbs.map((folder, index) => <React.Fragment key={folder.id}><ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" /><button type="button" aria-current={index === breadcrumbs.length - 1 ? "page" : undefined} className={`max-w-48 truncate ${index < breadcrumbs.length - 1 ? "text-[var(--app-muted)] hover:text-[var(--app-fg)]" : ""}`} onClick={() => navigate(folder.id)}>{folder.name}</button></React.Fragment>)}
              </nav></UiProps>
              <UiProps ids={{"placeholder":["canvas.m05697124c39d"]}}><CanvasLibraryToolbar controlsAtStart query={query} onQueryChange={value => { setQuery(value); onMenuChange(null); }} placeholder="canvas.m05697124c39d" layout={layout} onLayoutChange={setLayout} mediaFilter={mediaFilter} onMediaFilterChange={setMediaFilter} actions={<div className="relative ml-2" data-personal-menu>
                <UiProps ids={{"aria-label":["canvas.m50ef2f4cf6a4"]}}><button type="button" disabled={readOnly || busy || loading} aria-label="canvas.m50ef2f4cf6a4" aria-haspopup="menu" aria-expanded={menu === "add"} className="flex h-9 items-center gap-1.5 rounded-xl bg-[var(--app-fg)] px-4 text-sm text-[var(--app-bg)] disabled:opacity-40" onClick={() => onMenuChange(menu === "add" ? null : "add")}><Plus className="h-4 w-4" /><UiText id="canvas.m50ef2f4cf6a4" /></button></UiProps>
                {menu === "add" && <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-40 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl">
                  <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]" onClick={() => onUpload(folderId)}><Upload className="h-4 w-4" /><UiText id="canvas.m493ee58f81f5" /></button>
                  <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)]" onClick={() => onCreateFolder(folderId)}><Folder className="h-4 w-4" /><UiText id="canvas.m84244abc71de" /></button>
                </div>}
              </div>} /></UiProps>
            </div>
            <div ref={content} data-asset-manager-content data-library-layout={layout} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-32">
              {loading ? <p className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--app-muted)]"><Loader2 className="h-4 w-4 animate-spin" /><UiText id="canvas.md04fcbda737f" /></p> : <div className={layout === "grid" ? "grid grid-cols-[repeat(auto-fill,136px)] gap-x-3.5 gap-y-4 max-sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]" : "flex flex-col gap-1"}>
                {folders.map(folder => <div key={folder.id} className={`group min-w-0 ${layout === "list" ? "flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--panel-2)]" : ""}`}>
                  <button type="button" aria-label={text("workspaceFollowup.mba30c02049e2", { v0: folder.name })} title={folder.name} onClick={() => navigate(folder.id)} className={`flex shrink-0 items-center justify-center rounded-xl bg-[var(--panel-3)] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)] ${layout === "grid" ? "aspect-square w-full" : "h-12 w-12"}`}><Folder className={`${folderIcon} ${layout === "grid" ? "h-14 w-14" : "h-8 w-8"}`} strokeWidth={1.25} /></button>
                  <div className={`flex min-w-0 items-center gap-1 ${layout === "grid" ? "mt-1.5 pl-1" : "flex-1"}`}><button type="button" className="min-w-0 flex-1 truncate text-left text-[13px]" onClick={() => navigate(folder.id)}>{folder.name}</button>{more({ type: "folder", id: folder.id, name: folder.name })}</div>
                </div>)}
                {items.map(item => <div key={item.id} data-managed-material={item.id} className={`group min-w-0 ${layout === "list" ? "flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--panel-2)]" : ""}`}>
                  <button type="button" aria-label={text("workspaceFollowup.m40e052dc4a03", { v0: item.name })} aria-pressed={selectedItemId === item.id} title={item.name} onClick={() => { onMenuChange(null); setSelectedItemId(item.id); }} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--panel-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)] ${selectedItemId === item.id ? "ring-2 ring-[var(--app-muted)]" : ""} ${layout === "grid" ? "aspect-square w-full" : "h-12 w-12"}`}>
                    {item.kind === "image" ? <MediaImage src={resourceUrl(personalMaterialPreviewUrl(item.id, ownerId, 600))} alt="" loading="lazy" className="h-full w-full object-cover" /> : item.kind === "video" ? <VideoPosterPreview videoSrc={resourceUrl(`${personalMaterialUrl(item.id)}?owner=${ownerId}`)} alt="" className="h-full w-full" /> : <Music2 className="h-8 w-8 text-[var(--app-muted)]" />}
                  </button>
                  <div className={`min-w-0 ${layout === "grid" ? "mt-1.5 pl-1" : "flex-1"}`}><div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-[13px]" title={item.name}>{item.name}</span>{more({ type: "item", id: item.id, name: item.name })}</div><time dateTime={item.createdAt} className="text-xs text-[var(--app-muted)] opacity-60">{item.createdAt.slice(0, 10)}</time></div>
                </div>)}
              </div>}
              {!loading && !folders.length && !items.length && <p className="py-16 text-center text-sm text-[var(--app-muted)]">{normalized || mediaFilter !== "all" ? <UiText id="canvas.m8977d8459edf" /> : <UiText id="canvas.m150d6078e0e8" />}</p>}
            </div>
            {message && <p role="status" className="max-h-20 shrink-0 overflow-auto break-words px-4 py-2 text-xs text-[var(--app-muted)]">{message}</p>}
          </section>
          {selectedItem && <UiProps ids={{"aria-label":["canvas.m9713e97b9941"]}}><aside aria-label="canvas.m9713e97b9941" className="flex w-[320px] shrink-0 flex-col border-l border-[var(--border)] p-3.5 max-lg:w-[280px] max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-[72px] max-sm:w-full max-sm:bg-[var(--panel-2)]">
            <div className="mb-4 flex h-7 shrink-0 items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={selectedItem.name}>{selectedItem.name}</h3>
              <UiProps ids={{"aria-label":["canvas.m543aa424a7c1"]}}><button type="button" aria-label="canvas.m543aa424a7c1" className={iconButton} onClick={() => { setSelectedItemId(null); panel.current?.focus(); }}><X className="h-3.5 w-3.5" /></button></UiProps>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--panel-bg)]">
                {selectedItem.kind === "image" ? <MediaImage src={resourceUrl(personalMaterialPreviewUrl(selectedItem.id, ownerId, 600))} alt={selectedItem.name} loading="eager" className="h-full w-full object-contain" />
                  : selectedItem.kind === "video" ? <AppVideoPlayer key={selectedItem.id} src={resourceUrl(`${personalMaterialUrl(selectedItem.id)}?owner=${ownerId}`)} preload="metadata" playsInline compact className="h-full w-full object-contain" containerClassName="h-full w-full" />
                  : <div className="flex w-full flex-col items-center gap-6 px-2"><Music2 className="h-12 w-12 text-[var(--app-muted)]" /><audio key={selectedItem.id} aria-label={selectedItem.name} controls preload="metadata" src={resourceUrl(`${personalMaterialUrl(selectedItem.id)}?owner=${ownerId}`)} className="w-full" /></div>}
              </div>
              <dl className="mt-5 space-y-4 px-1 text-xs">
                {ownerName && <div className="flex items-center justify-between gap-3"><dt className="shrink-0 text-[var(--app-muted)]"><UiText id="canvas.m43a7f4b4c5c8" /></dt><dd className="truncate" title={ownerName}>{ownerName}</dd></div>}
                <div className="flex items-center justify-between gap-3"><dt className="shrink-0 text-[var(--app-muted)]"><UiText id="canvas.mdc4d662d071e" /></dt><dd><time dateTime={selectedItem.createdAt}>{new Date(selectedItem.createdAt).toLocaleString(locale === "en" ? "en-US" : "sv-SE", locale === "en" ? { dateStyle: "medium", timeStyle: "short" } : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></dd></div>
              </dl>
            </div>
            <div className="mt-4 shrink-0 space-y-2">
              <button type="button" disabled={readOnly || busy} onClick={() => onAddToCanvas(selectedItem)} className="h-8 w-full rounded-lg bg-[var(--app-fg)] text-xs text-[var(--app-bg)] disabled:opacity-40"><UiText id="canvas.m675d68135324" /></button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={readOnly || busy} onClick={() => onDelete(selectedItem)} className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-red-500/10 text-xs text-red-500 hover:bg-red-500/20 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /><UiText id="canvas.m2f9daa828907" /></button>
                <button type="button" disabled={busy} onClick={() => onDownload({ type: "item", id: selectedItem.id, name: selectedItem.name })} className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[var(--panel-3)] text-xs hover:brightness-110 disabled:opacity-40"><Download className="h-3.5 w-3.5" /><UiText id="canvas.m4673a2306165" /></button>
              </div>
            </div>
          </aside></UiProps>}
        </div>
      </div>
    </div>
  </>, document.body);
}
