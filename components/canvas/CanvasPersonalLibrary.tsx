"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { useCanvasReadOnly, useCanvasObserver, canvasObserverUrl } from "./CanvasReadOnlyContext";
import * as React from "react";
import { createPortal } from "react-dom";
import { MediaImage } from "@/components/ui/media-image";
import { useAuth } from "@/components/auth/AuthProvider";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import { useQueryClient } from "@tanstack/react-query";
import { personalLibraryOptions } from "./canvas-library-cache";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Plus, Upload, Music2, Loader2 } from "lucide-react";
import CanvasLibraryToolbar, { type LibraryLayout, type LibraryMediaFilter } from "./CanvasLibraryToolbar";
import CanvasAssetManager, { type PersonalLibraryTarget as Target } from "./CanvasAssetManager";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { personalMaterialUrl, personalMaterialPreviewUrl, personalMaterialDownloadName, type PersonalLibrary, type PersonalMaterial, type PersonalFolder } from "@/lib/canvas/personal-library-types";
import type { LibraryAction } from "@/lib/canvas/personal-library";

import { libraryPositionKey, readLibraryPosition, writeLibraryPosition, useLibraryScroll } from "./use-library-position";

type ActionDialog = { action: LibraryAction; title: string; name: string };
const buttonClass = "rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--panel-2)] disabled:opacity-40";

export default function CanvasPersonalLibrary({ ownerId, canvasId }: { ownerId: number; canvasId: number }) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const { user } = useAuth();
  const readOnly = useCanvasReadOnly();
  const adminKey = useCanvasObserver();
  const resourceUrl = (url: string) => canvasObserverUrl(url, adminKey);
  const cache = useQueryClient();
  const positionKey = libraryPositionKey(ownerId, canvasId, "personal");
  const [saved] = React.useState(() => readLibraryPosition(positionKey, { query: "", selected: null as string | null, expanded: [] as string[], layout: "list", mediaFilter: "all" }));
  const [layout, setLayout] = React.useState<LibraryLayout>(saved.layout === "grid" ? "grid" : "list");
  const [mediaFilter, setMediaFilter] = React.useState<LibraryMediaFilter>(saved.mediaFilter === "image" || saved.mediaFilter === "video" || saved.mediaFilter === "audio" ? saved.mediaFilter : "all");
  const [library, setLibrary] = React.useState<PersonalLibrary>(() => cache.getQueryData(personalLibraryOptions(ownerId, adminKey).queryKey) || { version: 1, folders: [], items: [] });
  const [loading, setLoading] = React.useState(() => !cache.getQueryData(personalLibraryOptions(ownerId, adminKey).queryKey));
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [query, setQuery] = React.useState(saved.query);
  const [{ expanded, visited }, setFolderView] = React.useState(() => ({ expanded: new Set(saved.expanded), visited: new Set(saved.expanded) }));
  const setExpanded = React.useCallback((update: React.SetStateAction<Set<string>>) => {
    setFolderView(current => {
      const next = typeof update === "function" ? update(current.expanded) : update;
      return { expanded: next, visited: new Set([...current.visited, ...next]) };
    });
  }, []);
  const { childFolders, folderItems } = React.useMemo(() => {
    const childFolders = new Map<string | null, PersonalFolder[]>();
    const folderItems = new Map<string | null, PersonalMaterial[]>();
    for (const folder of library.folders) {
      const children = childFolders.get(folder.parentId) || [];
      children.push(folder); childFolders.set(folder.parentId, children);
    }
    for (const item of library.items) {
      const items = folderItems.get(item.folderId) || [];
      items.push(item); folderItems.set(item.folderId, items);
    }
    return { childFolders, folderItems };
  }, [library]);
  const [selected, setSelected] = React.useState<string | null>(saved.selected);
  const scroll = useLibraryScroll(`${positionKey}_scroll`, !loading);
  React.useEffect(() => {
    writeLibraryPosition(positionKey, { query, selected, expanded: [...expanded], layout, mediaFilter });
  }, [positionKey, query, selected, expanded, layout, mediaFilter]);
  const [menu, setMenu] = React.useState<Target | "add" | null>(null);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<ActionDialog | null>(null);
  const [dialogError, setDialogError] = React.useState("");
  const [destination, setDestination] = React.useState<string | null>(null);
  const [newDestinationName, setNewDestinationName] = React.useState("");
  const [preview, setPreview] = React.useState<{ item: PersonalMaterial; left: number; top: number; width: number; height: number } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const uploadFolderRef = React.useRef<string | null>(null);
  const [uploadDialog, setUploadDialog] = React.useState(false);
  const [uploadFolder, setUploadFolder] = React.useState<string | null>(null);
  const [uploadNewFolder, setUploadNewFolder] = React.useState(false);
  const [uploadFolderName, setUploadFolderName] = React.useState("");
  const [uploadError, setUploadError] = React.useState("");
  const [uploadExpanded, setUploadExpanded] = React.useState<Set<string>>(new Set());
  const busyRef = React.useRef(false);
  const requestVersion = React.useRef(0);

  const refresh = React.useCallback(async (force = false) => {
    const version = ++requestVersion.current;
    try {
      const options = personalLibraryOptions(ownerId, adminKey);
      if (force) await cache.invalidateQueries({ queryKey: options.queryKey });
      const next = await cache.fetchQuery({ ...options, ...(force ? { staleTime: 0 } : {}) });
      if (version === requestVersion.current) {
        setLibrary(next);
        setExpanded(current => new Set([...current].filter(id => next.folders.some(folder => folder.id === id))));
        setSelected(current => next.folders.some((f: PersonalFolder) => f.id === current) ? current : null);
      }
    } catch (error) { if (version === requestVersion.current) setMessage((error as Error).message); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [cache, ownerId, adminKey, setExpanded]);
  React.useEffect(() => {
    void refresh();
    const focus = () => { if (!busyRef.current) void refresh(); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("canvas-personal-library") : null;
    if (channel) channel.onmessage = () => { if (!busyRef.current) void refresh(true); };
    const invalidate = () => { ++requestVersion.current; };
    window.addEventListener("focus", focus);
    return () => { invalidate(); window.removeEventListener("focus", focus); channel?.close(); };
  }, [refresh]);
  React.useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest("[data-personal-menu]")) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopImmediatePropagation(); setMenu(null); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape, true); };
  }, [menu]);
  React.useEffect(() => {
    if (!preview) return;
    const close = () => setPreview(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", escape, true);
    };
  }, [preview]);

  const changed = () => {
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("canvas-personal-library"); channel.postMessage("changed"); channel.close(); }
  };
  const mutate = async (action: LibraryAction) => {
    if (readOnly) throw new Error("查看模式不会修改用户素材库");
    ++requestVersion.current;
    await cache.cancelQueries({ queryKey: personalLibraryOptions(ownerId, adminKey).queryKey });
    const response = await fetch("/api/canvas/materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "操作失败");
    cache.setQueryData(personalLibraryOptions(ownerId, adminKey).queryKey, payload.library);
    setLibrary(payload.library); changed();
    return payload.library as PersonalLibrary;
  };
  const openAction = (action: LibraryAction, name = "") => {
    if (readOnly) return;
    setMenu(null); setDialogError(""); setNewDestinationName("");
    setDestination(action.type === "folder" ? library.folders.find(f => f.id === action.id)?.parentId ?? null : library.items.find(it => it.id === action.id)?.folderId ?? null);
    setDialog({ action, name, title: action.operation === "create" ? text("workspaceFollowup.m84244abc71de") : action.operation === "rename" ? text("workspaceFollowup.m0d0cbac2eee5") : action.operation === "move" ? text("workspaceFollowup.mf3d717f55911") : action.operation === "copy" ? text("workspaceFollowup.ma675217463b2") : text("workspaceFollowup.m2f9daa828907") });
  };
  const openUpload = (createFolder = false, initialFolder: string | null = null) => {
    if (readOnly) return;
    setMenu(null); uploadFolderRef.current = null;
    setUploadFolder(initialFolder); setUploadNewFolder(createFolder); setUploadFolderName("");
    const ancestors = new Set<string>();
    for (let folder = library.folders.find(item => item.id === initialFolder); folder; folder = library.folders.find(item => item.id === folder!.parentId)) ancestors.add(folder.id);
    setUploadError(""); setUploadExpanded(ancestors); setUploadDialog(true);
  };
  const confirmUploadFolder = async () => {
    if (busyRef.current) return false;
    let folderId = uploadFolder;
    let uploadLibrary = library;
    busyRef.current = true; setBusy(true); setUploadError("");
    try {
      if (uploadNewFolder) {
        const name = uploadFolderName.trim();
        if (!name) throw new Error("请输入文件夹名称");
        uploadLibrary = await mutate({ operation: "create", type: "folder", parentId: uploadFolder, name });
        folderId = uploadLibrary.folders.find(folder => folder.parentId === uploadFolder && folder.name === name)?.id || null;
      }
      if (!folderId) throw new Error("请选择一个文件夹");
      uploadFolderRef.current = folderId;
      const ancestors = new Set<string>();
      let ancestor: string | null = folderId;
      while (ancestor && !ancestors.has(ancestor)) {
        ancestors.add(ancestor);
        ancestor = uploadLibrary.folders.find(folder => folder.id === ancestor)?.parentId ?? null;
      }
      setSelected(folderId); setExpanded(current => new Set([...current, ...ancestors]));
      // The confirmed destination stays fixed while the system file picker is open.
      fileInput.current?.click();
      return true;
    } catch (error) { setUploadError((error as Error).message); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length || busyRef.current) return;
    const folderId = uploadFolderRef.current;
    uploadFolderRef.current = null;
    if (!folderId) { setMessage("请先选择上传文件夹"); if (fileInput.current) fileInput.current.value = ""; return; }
    busyRef.current = true; setBusy(true); setMenu(null);
    let done = 0; const errors: string[] = [];
    try {
      for (const file of Array.from(files)) {
        setMessage(`正在上传 ${done + errors.length + 1}/${files.length}：${file.name}`);
        const form = new FormData(); form.append("file", file); form.append("folderId", folderId);
        try {
          const response = await fetch("/api/canvas/materials", { method: "POST", body: form });
          const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "上传失败"); done++;
        } catch (error) { errors.push(`${file.name}：${(error as Error).message}`); }
      }
      setExpanded(current => new Set([...current, folderId]));
      await cache.cancelQueries({ queryKey: personalLibraryOptions(ownerId, adminKey).queryKey });
      await refresh(true); changed();
      setMessage(`已上传 ${done} 个素材${errors.length ? `；${errors.join("；")}` : ""}`);
    } finally { busyRef.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const download = async (target: Target) => {
    setMenu(null); if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage("正在准备下载…");
    try {
      const response = await fetch(resourceUrl(target.type === "folder" ? `/api/canvas/materials/folders/${target.id}/download` : personalMaterialUrl(target.id) + "?download=1"));
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error || "下载失败"); }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = target.type === "folder" ? target.name + ".zip" : personalMaterialDownloadName(library.items.find(item => item.id === target.id)!); anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000); setMessage("下载已开始");
    } catch (error) { setMessage((error as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const addToCanvas = (item: PersonalMaterial) => {
    if (readOnly) return;
    setPreview(null);
    window.dispatchEvent(new CustomEvent("canvas-personal-material-use", { detail: { id: item.id } }));
  };
  const showPreview = (item: PersonalMaterial, anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect();
    const panelLeft = anchor.closest("[data-personal-library]")?.getBoundingClientRect().left ?? rect.left;
    const width = Math.min(260, window.innerWidth - 24);
    const height = Math.min(300, window.innerHeight - 24);
    setPreview({ item, width, height,
      left: Math.max(12, Math.min(panelLeft - width - 12, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 12)),
    });
  };
  const menuItems = (target: Target, compact = false) => <div role="menu" className={`absolute top-full z-30 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl ${compact ? "right-0 w-32" : "right-1 w-40"}`}>
    {target.type === "folder" && <button disabled={readOnly} role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => openAction({ operation: "create", type: "folder", parentId: target.id })}><UiText id="canvas.mb719a1912da4" /></button>}
    {target.type === "item" && <button disabled={readOnly} role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => { setMenu(null); addToCanvas(library.items.find(it => it.id === target.id)!); }}><UiText id="canvas.m675d68135324" /></button>}
    <button disabled={readOnly} role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => openAction({ operation: "rename", type: target.type, id: target.id }, target.name)}><UiText id="canvas.m0d0cbac2eee5" /></button>
    <button disabled={readOnly} role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => openAction({ operation: "move", type: target.type, id: target.id }, target.name)}><UiText id="canvas.m0bee1672c6d4" /></button>
    <button disabled={readOnly} role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => openAction({ operation: "copy", type: target.type, id: target.id }, target.name)}><UiText id="canvas.mf6825f1e73a1" /></button>
    <button role="menuitem" className={`${buttonClass} block w-full text-left`} onClick={() => void download(target)}><UiText id="canvas.m4673a2306165" /></button>
    <button disabled={readOnly} role="menuitem" className={`${buttonClass} mt-1 block w-full border-t border-[var(--border)] text-left text-red-400`} onClick={() => openAction({ operation: "delete", type: target.type, id: target.id }, target.name)}><UiText id="canvas.m2f9daa828907" /></button>
  </div>;
  const filteredItems = React.useMemo(() => library.items.filter(item => mediaFilter === "all" || item.kind === mediaFilter), [library.items, mediaFilter]);
  const visibleFolderIds = React.useMemo(() => {
    if (mediaFilter === "all") return new Set(library.folders.map(folder => folder.id));
    const parents = new Map(library.folders.map(folder => [folder.id, folder.parentId]));
    const ids = new Set<string>();
    for (const item of filteredItems) {
      let id = item.folderId;
      while (id && !ids.has(id)) { ids.add(id); id = parents.get(id) ?? null; }
    }
    return ids;
  }, [library.folders, filteredItems, mediaFilter]);
  const isFolderExpanded = (id: string) => mediaFilter !== "all" || expanded.has(id);
  const itemRow = (item: PersonalMaterial) => <div key={item.id} data-personal-material={item.id} className={`group relative flex min-w-0 rounded-md hover:bg-[var(--panel-2)] focus-within:bg-[var(--panel-2)] ${layout === "grid" ? "p-1.5" : "h-12 items-center gap-2 pl-6 pr-1"}`}>
    <button draggable={!readOnly} type="button" onDragStart={event => { setPreview(null); event.dataTransfer.setData("application/x-canvas-personal-material", item.id); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => { if (!readOnly) addToCanvas(item); }} onMouseEnter={event => showPreview(item, event.currentTarget)} onMouseLeave={() => setPreview(null)} onFocus={event => showPreview(item, event.currentTarget)} onBlur={() => setPreview(null)} aria-label={readOnly ? item.name : text("workspaceFollowup.m0d591888d966", { v0: item.name })} className={`flex h-full min-w-0 flex-1 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)] ${layout === "grid" ? "flex-col gap-1.5" : "items-center gap-2.5"}`}>
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--panel-2)] ${layout === "grid" ? "aspect-square w-full" : "h-9 w-9"}`}>
        {item.kind === "image" ? <MediaImage src={resourceUrl(personalMaterialPreviewUrl(item.id, ownerId))} alt="" loading="lazy" className="h-full w-full object-cover" /> : item.kind === "video" ? <VideoPosterPreview videoSrc={resourceUrl(`${personalMaterialUrl(item.id)}?owner=${ownerId}`)} alt="" className="h-full w-full" /> : <Music2 className="h-4 w-4" />}
      </span><span className={`truncate text-sm font-medium ${layout === "grid" ? "w-full pr-5" : ""}`}>{item.name}</span>
    </button>
    <div data-personal-menu className={layout === "grid" ? "absolute bottom-0.5 right-1" : undefined}><button disabled={busy} aria-label={text("workspaceFollowup.m90a3f08a77a0", { v0: item.name })} aria-haspopup="menu" className="rounded p-1 text-[var(--app-muted)] opacity-40 hover:bg-[var(--panel-bg)] group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => setMenu(menu && menu !== "add" && menu.id === item.id ? null : { type: "item", id: item.id, name: item.name })}><MoreHorizontal className="h-4 w-4" /></button>
    {!managerOpen && menu && menu !== "add" && menu.id === item.id && menuItems(menu)}</div>
  </div>;
  const materialRows = (items: PersonalMaterial[]) => <div className={layout === "grid" ? "grid grid-cols-2 gap-2 py-1" : undefined}>{items.filter(item => mediaFilter === "all" || item.kind === mediaFilter).map(itemRow)}</div>;
  const folderTree = (parentId: string | null, depth = 0): React.ReactNode => (childFolders.get(parentId) || []).filter(folder => visibleFolderIds.has(folder.id)).map(folder => <div key={folder.id}>
    <div className="group relative flex h-12 items-center rounded-md hover:bg-[var(--panel-2)] focus-within:bg-[var(--panel-2)]">
      <button type="button" aria-label={folder.name} aria-expanded={isFolderExpanded(folder.id)} aria-disabled={mediaFilter !== "all" || undefined} className="flex min-w-0 flex-1 touch-manipulation select-none items-center gap-2 self-stretch rounded-md pl-1 pr-2 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-bg)]" onClick={() => {
        if (mediaFilter !== "all") return;
        setSelected(folder.id); setMenu(null); setPreview(null);
        setExpanded(current => { const next = new Set(current); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; });
      }} title={folder.name}>
        <ChevronRight className={`h-3 w-3 shrink-0 text-[var(--app-muted)] transition-transform duration-100 motion-reduce:transition-none ${isFolderExpanded(folder.id) ? "rotate-90" : ""}`} />
        <Folder className="h-8 w-8 shrink-0 fill-[var(--app-muted)] text-[var(--app-muted)]" strokeWidth={1.25} /><span className="truncate">{folder.name}</span>
      </button>
      <div data-personal-menu><button disabled={busy} aria-label={text("workspaceFollowup.m90a3f08a77a0", { v0: folder.name })} aria-haspopup="menu" className="mr-1 rounded p-1 text-[var(--app-muted)] opacity-40 hover:bg-[var(--panel-bg)] group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => setMenu(menu && menu !== "add" && menu.id === folder.id ? null : { type: "folder", id: folder.id, name: folder.name })}><MoreHorizontal className="h-4 w-4" /></button>{!managerOpen && menu && menu !== "add" && menu.id === folder.id && menuItems(menu)}</div>
    </div>
    {(mediaFilter !== "all" || visited.has(folder.id)) && <div hidden={!isFolderExpanded(folder.id)} className={depth < 6 ? "ml-5" : ""}>
      {folderTree(folder.id, depth + 1)}{materialRows(folderItems.get(folder.id) || [])}
      {!childFolders.get(folder.id)?.length && !folderItems.get(folder.id)?.length && <p className="px-3 py-2 text-xs text-[var(--app-muted)]"><UiText id="canvas.m8413b6cec2be" /></p>}
    </div>}
  </div>);

  const choosingFolder = dialog?.action.operation === "move" || dialog?.action.operation === "copy";
  const blocked = new Set<string>();
  if (choosingFolder && dialog?.action.type === "folder" && dialog.action.id) {
    blocked.add(dialog.action.id);
    for (let i = 0; i < library.folders.length; i++) for (const f of library.folders) if (f.parentId && blocked.has(f.parentId)) blocked.add(f.id);
  }
  const destinationTree = (parentId: string | null, depth = 0): React.ReactNode => library.folders.filter(f => f.parentId === parentId).map(folder => <React.Fragment key={folder.id}>
    <button type="button" disabled={blocked.has(folder.id)} onClick={() => setDestination(folder.id)} style={{ paddingLeft: 12 + Math.min(depth, 10) * 16 }} className={`flex w-full items-center gap-2 rounded-lg py-2 text-left text-sm disabled:opacity-30 ${destination === folder.id ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"}`}><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span>{destination === folder.id && <span className="ml-auto pr-2 text-xs"><UiText id="canvas.m7ecf1cde6486" /></span>}</button>
    {destinationTree(folder.id, depth + 1)}
  </React.Fragment>);
  const normalized = query.trim().toLowerCase();
  const uploadParentNames: string[] = [];
  for (let parent = library.folders.find(folder => folder.id === uploadFolder); parent; parent = library.folders.find(folder => folder.id === parent!.parentId)) {
    uploadParentNames.unshift(parent.name);
  }
  const uploadFolderTree = (parentId: string | null, depth = 0): React.ReactNode => (childFolders.get(parentId) || []).map(folder => {
    const materials = folderItems.get(folder.id) || [];
    const isExpanded = uploadExpanded.has(folder.id);
    const toggle = () => setUploadExpanded(current => { const next = new Set(current); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; });
    return <React.Fragment key={folder.id}>
      <div style={{ paddingLeft: Math.min(depth, 10) * 18 }} className={`mb-1 flex items-center rounded-xl ${uploadFolder === folder.id ? "bg-[var(--panel-2)] ring-1 ring-inset ring-[var(--border)]" : "hover:bg-[var(--panel-2)]"}`}>
        <button type="button" aria-label={`${isExpanded ? text("workspaceFollowup.mafd4b783536b") : text("workspaceFollowup.m00bd3960fea8")}${folder.name}`} aria-expanded={isExpanded} disabled={busy} className="self-stretch px-2 text-[var(--app-muted)] disabled:opacity-25" onClick={toggle}><ChevronRight className={`h-4 w-4 ${isExpanded ? "rotate-90" : ""}`} /></button>
        <button type="button" disabled={busy} aria-label={folder.name} aria-expanded={isExpanded} aria-pressed={uploadFolder === folder.id} className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left text-sm text-[var(--app-fg)]" onClick={() => { setUploadFolder(folder.id); setUploadNewFolder(false); setUploadError(""); toggle(); }}>{isExpanded ? <FolderOpen className="h-6 w-6 shrink-0 text-[var(--app-muted)]" /> : <Folder className="h-6 w-6 shrink-0 text-[var(--app-muted)]" />}<span className="truncate">{folder.name}</span>{uploadFolder === folder.id && <span className="ml-auto text-xs text-[var(--app-muted)]"><UiText id="canvas.m7ecf1cde6486" /></span>}</button>
      </div>
      {isExpanded && <>
        {uploadFolderTree(folder.id, depth + 1)}
        {!!materials.length && <ul aria-label={text("workspaceFollowup.md53f0815e2f7", { v0: folder.name })} style={{ paddingLeft: 36 + Math.min(depth, 10) * 18 }} className="space-y-1 py-1 pr-3">
          {materials.map(item => <li key={item.id} title={item.name} className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-xs text-[var(--app-muted)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--panel-2)]">
              {item.kind === "image" ? <MediaImage src={resourceUrl(personalMaterialPreviewUrl(item.id, ownerId))} alt="" className="h-full w-full object-cover" /> : item.kind === "video" ? <VideoPosterPreview videoSrc={resourceUrl(`${personalMaterialUrl(item.id)}?owner=${ownerId}`)} alt="" className="h-full w-full" /> : <Music2 className="h-4 w-4" />}
            </span><span className="min-w-0 truncate">{item.name}</span>
          </li>)}
        </ul>}
        {!materials.length && !childFolders.get(folder.id)?.length && <p style={{ paddingLeft: 44 + Math.min(depth, 10) * 18 }} className="py-2 text-xs text-[var(--app-muted)]"><UiText id="canvas.m8413b6cec2be" /></p>}
      </>}
    </React.Fragment>;
  });
  return <div className="flex min-h-0 flex-1 flex-col text-[var(--app-fg)]" data-personal-library>
    <input ref={fileInput} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,video/*,audio/*" onChange={event => void upload(event.target.files)} />
    <UiProps ids={{"placeholder":["canvas.mc85dbe0cb0c4"]}}><CanvasLibraryToolbar controlsAtStart query={query} onQueryChange={value => { setQuery(value); setMenu(null); }} placeholder="canvas.mc85dbe0cb0c4" layout={layout} onLayoutChange={value => { setLayout(value); setPreview(null); setMenu(null); }} mediaFilter={mediaFilter} onMediaFilterChange={value => { setMediaFilter(value); setPreview(null); setMenu(null); }}
      onExpandAll={() => { setQuery(""); setExpanded(new Set(library.folders.map(folder => folder.id))); }}
      onCollapseAll={() => { setQuery(""); setMediaFilter("all"); setExpanded(new Set()); }} actions={<>
        <div className="relative" data-personal-menu>
          <UiProps ids={{"aria-label":["canvas.m65e213c1cea1"],"title":["canvas.m65e213c1cea1"]}}><button type="button" aria-label="canvas.m65e213c1cea1" title="canvas.m65e213c1cea1" aria-haspopup="menu" aria-expanded={!managerOpen && menu === "add"} disabled={readOnly || busy || loading} className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-40" onClick={() => setMenu(menu === "add" ? null : "add")}><Plus className="h-4 w-4" /></button></UiProps>
          {!managerOpen && menu === "add" && <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-40 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl">
            <button disabled={readOnly} role="menuitem" className={`${buttonClass} flex w-full items-center gap-2`} onClick={() => openUpload()}><Upload className="h-4 w-4" /><UiText id="canvas.m493ee58f81f5" /></button>
            <button disabled={readOnly} role="menuitem" className={`${buttonClass} flex w-full items-center gap-2`} onClick={() => openUpload(true)}><Folder className="h-4 w-4" /><UiText id="canvas.m84244abc71de" /></button>
          </div>}
        </div>
        <UiProps ids={{"aria-label":["canvas.mb3bd5ac7cc4d"],"title":["canvas.mb3bd5ac7cc4d"]}}><button type="button" aria-label="canvas.mb3bd5ac7cc4d" title="canvas.mb3bd5ac7cc4d" aria-haspopup="dialog" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]" onClick={() => { setMenu(null); setPreview(null); setManagerOpen(true); }}><Folder className="h-5 w-5 fill-[var(--app-muted)] text-[var(--app-muted)]" strokeWidth={1.25} /><UiText id="canvas.mbb6d995724f4" /></button></UiProps>
      </>} /></UiProps>
    <div className="mx-3 mb-2 flex items-center justify-between gap-1 text-[13px] text-[var(--app-muted)]"><UiProps ids={{"title":["canvas.mb2ed1e9db973"]}}><button className="truncate text-left hover:text-[var(--app-fg)]" onClick={() => setSelected(null)} title="canvas.mb2ed1e9db973">{selected ? <UiText id="canvas.m71234ac59b8f" values={{v0: String(library.folders.find(f => f.id === selected)?.name || "个人素材库")}} /> : <UiText id="canvas.m5f5e9b85e503" />}</button></UiProps>{selected && <button onClick={() => setSelected(null)} className="shrink-0"><UiText id="canvas.mc3bba2b26e69" /></button>}</div>
    <div ref={scroll.ref} onScroll={scroll.onScroll} className="scrollbar-hide min-h-0 flex-1 overflow-auto px-2 pb-48" data-library-layout={layout}>
      {loading ? <p className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--app-muted)]"><Loader2 className="h-4 w-4 animate-spin" /><UiText id="canvas.md04fcbda737f" /></p> : normalized ? <>
        {library.folders.filter(f => visibleFolderIds.has(f.id) && f.name.toLowerCase().includes(normalized)).map(f => <button key={f.id} className="flex w-full items-center gap-2 rounded-lg p-2 text-sm hover:bg-[var(--panel-2)]" onClick={() => { const parents = new Set([f.id]); let current = f; while (current.parentId) { parents.add(current.parentId); current = library.folders.find(p => p.id === current.parentId)!; } setExpanded(parents); setSelected(f.id); setQuery(""); }}><Folder className="h-4 w-4" />{f.name}</button>)}
        {materialRows(filteredItems.filter(it => it.name.toLowerCase().includes(normalized)))}
        {!filteredItems.some(it => it.name.toLowerCase().includes(normalized)) && !library.folders.some(f => visibleFolderIds.has(f.id) && f.name.toLowerCase().includes(normalized)) && <p className="py-8 text-center text-xs text-[var(--app-muted)]"><UiText id="canvas.m8977d8459edf" /></p>}
      </> : <>{folderTree(null)}{materialRows(filteredItems.filter(it => !it.folderId))}{mediaFilter !== "all" && !filteredItems.length && <p className="py-8 text-center text-xs text-[var(--app-muted)]"><UiText id="canvas.m8977d8459edf" /></p>}</>}
    </div>
    {message && <p role="status" className="max-h-24 overflow-auto break-words px-3 pb-2 text-xs text-[var(--app-muted)]">{busy && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{uiLabel(message)}</p>}
    {managerOpen && <CanvasAssetManager library={library} ownerId={ownerId} ownerName={user?.id === ownerId ? user.username : undefined} loading={loading} busy={busy} readOnly={readOnly} message={message} nestedDialogOpen={!!dialog || uploadDialog} menu={menu} onMenuChange={setMenu} renderMenu={target => menuItems(target, true)} resourceUrl={resourceUrl} onCreateFolder={parentId => openAction({ operation: "create", type: "folder", parentId })} onUpload={folderId => openUpload(false, folderId)} onAddToCanvas={addToCanvas} onDownload={target => void download(target)} onDelete={item => openAction({ operation: "delete", type: "item", id: item.id }, item.name)} onClose={() => { setManagerOpen(false); setMenu(null); }} />}
    <UiProps ids={{"title":["canvas.m0d6fad8138e7"],"confirmText":["canvas.m36f33adaf094"]}}><ConfirmDialog open={uploadDialog} title="canvas.m0d6fad8138e7" confirmText="canvas.m36f33adaf094" confirmDisabled={busy || (uploadNewFolder ? !uploadFolderName.trim() : !library.folders.some(folder => folder.id === uploadFolder))} headerActions={<button type="button" disabled={busy} className={`${buttonClass} flex items-center gap-1 text-[var(--app-muted)]`} onClick={() => { setUploadNewFolder(true); setUploadFolderName(""); setUploadError(""); }}><Plus className="h-3.5 w-3.5" /><UiText id="canvas.m84244abc71de" /></button>} onClose={() => { setUploadDialog(false); setUploadError(""); }} onConfirm={confirmUploadFolder}>
      <div className="h-[360px] max-h-[min(50dvh,calc(100dvh-208px))] overflow-y-auto overscroll-contain">
        {uploadNewFolder && <div className="mb-2 px-2 py-1"><div className="mb-2 flex items-start justify-between gap-2 text-xs text-[var(--app-muted)]"><span className="min-w-0 break-words"><UiText id="canvas.m8f91a5ffaac9" />{["个人素材库", ...uploadParentNames].join(" / ")}</span>{uploadFolder && <button type="button" disabled={busy} className="shrink-0 hover:text-[var(--app-fg)]" onClick={() => setUploadFolder(null)}><UiText id="canvas.mf25b28971631" /></button>}</div><UiProps ids={{"aria-label":["canvas.mae51764fbb38"],"placeholder":["canvas.m0e37bff91e72"]}}><input autoFocus aria-label="canvas.mae51764fbb38" placeholder="canvas.m0e37bff91e72" disabled={busy} value={uploadFolderName} onChange={event => setUploadFolderName(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-muted)]" /></UiProps></div>}
        {uploadFolderTree(null)}
        {!library.folders.length && !uploadNewFolder && <p className="py-10 text-center text-xs text-[var(--app-muted)]"><UiText id="canvas.mc09d5d3887c7" /></p>}
      </div>
      {uploadError && <p role="alert" className="mt-2 text-xs text-red-400">{uiError(uploadError)}</p>}
    </ConfirmDialog></UiProps>
    <ConfirmDialog open={!!dialog} title={dialog?.title || ""} danger={dialog?.action.operation === "delete"} description={dialog?.action.operation === "delete" ? text("workspaceFollowup.mdc7ca2fbc847", { v0: dialog.name, v1: dialog.action.type === "folder" ? text("workspaceFollowup.med1d813f34ce") : "" }) : undefined} onClose={() => { setDialog(null); setDialogError(""); }} onConfirm={async () => {
      if (!dialog || busyRef.current) return false;
      busyRef.current = true; setBusy(true);
      try {
        const action = { ...dialog.action, ...(choosingFolder ? { parentId: destination } : {}), ...(dialog.action.operation === "create" || dialog.action.operation === "rename" ? { name: dialog.name } : {}) };
        const next = await mutate(action);
        setSelected(current => next.folders.some(f => f.id === current) ? current : null);
        if (action.parentId) setExpanded(current => new Set([...current, action.parentId!]));
        setMessage(`${dialog.title}成功`); return true;
      } catch (error) { setDialogError((error as Error).message); return false; }
      finally { busyRef.current = false; setBusy(false); }
    }}>
      {(dialog?.action.operation === "create" || dialog?.action.operation === "rename") && <UiProps ids={{"aria-label":["canvas.md44e9b3d3b31"],"placeholder":["canvas.md79dfce4989f"]}}><input autoFocus aria-label="canvas.md44e9b3d3b31" value={dialog.name} onChange={event => setDialog({ ...dialog, name: event.target.value })} className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none" placeholder="canvas.md79dfce4989f" /></UiProps>}
      {choosingFolder && <><p className="mb-2 text-xs text-[var(--app-muted)]">{dialog?.name} → {destination ? library.folders.find(f => f.id === destination)?.name : <UiText id="canvas.m5f5e9b85e503" />}</p><div className="max-h-72 overflow-y-auto"><button className={`${buttonClass} w-full text-left ${destination === null ? "bg-[var(--panel-2)]" : ""}`} onClick={() => setDestination(null)}><UiText id="canvas.m5f5e9b85e503" />{destination === null ? " ✓" : ""}</button>{destinationTree(null)}</div>
        <div className="mt-3 flex gap-2"><UiProps ids={{"aria-label":["canvas.m6ec6c5bc7daf"],"placeholder":["canvas.m17853ef045ce"]}}><input aria-label="canvas.m6ec6c5bc7daf" placeholder="canvas.m17853ef045ce" value={newDestinationName} onChange={event => setNewDestinationName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-xs" /></UiProps><button type="button" className={buttonClass} disabled={!newDestinationName.trim() || busy} onClick={async () => { if (busyRef.current) return; busyRef.current = true; setBusy(true); try { const previous = new Set(library.folders.map(f => f.id)); const next = await mutate({ operation: "create", type: "folder", parentId: destination, name: newDestinationName }); setDestination(next.folders.find(f => !previous.has(f.id))?.id ?? destination); setNewDestinationName(""); setDialogError(""); } catch (error) { setDialogError((error as Error).message); } finally { busyRef.current = false; setBusy(false); } }}><UiText id="canvas.m50ef2f4cf6a4" /></button></div>
      </>}
      {dialogError && <p role="alert" className="mt-2 text-xs text-red-400">{uiError(dialogError)}</p>}
    </ConfirmDialog>
    {preview && createPortal(<div role="tooltip" aria-label={text("workspaceFollowup.m38eaa526a2d0", { v0: preview.item.name })} className="pointer-events-none fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--app-fg)] shadow-2xl" style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/20">
        {preview.item.kind === "image" && <MediaImage src={resourceUrl(personalMaterialPreviewUrl(preview.item.id, ownerId, 600))} alt={preview.item.name} loading="eager" className="h-full w-full object-contain" />}
        {preview.item.kind === "video" && <VideoPosterPreview key={preview.item.id} videoSrc={resourceUrl(`${personalMaterialUrl(preview.item.id)}?owner=${ownerId}`)} alt={preview.item.name} fit="contain" className="h-full w-full" />}
        {preview.item.kind === "audio" && <Music2 className="h-12 w-12 text-[var(--app-muted)]" />}
      </div>
      <p className="shrink-0 truncate px-1 pt-2 text-xs">{preview.item.name}</p>
    </div>, document.body)}
  </div>;
}
