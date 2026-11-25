"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronRight, Folder, MoreHorizontal, Music2, Plus, Video } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";
import type { ProductFolder, ProductFolderAction } from "@/lib/media-library-folders";

export async function updateProductFolders(action: ProductFolderAction) {
  const response = await fetch("/api/media-library/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "目录操作失败");
  return payload as { folders: ProductFolder[]; destination: string | null };
}

type FolderMaterial = { id: number; title: string; kind: string; fileUrl: string; thumbnailUrl?: string | null };
function FolderMaterials({ folderId }: { folderId: string }) {
  const { error: localizeError } = useUiLocale();
  const [items, setItems] = React.useState<FolderMaterial[]>([]);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ scope: "private", groupName: folderId, page: String(page), pageSize: "48" });
    void fetch(`/api/media-library?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || "素材加载失败");
      setItems(previous => page === 1 ? payload.items || [] : [...previous, ...(payload.items || [])].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index));
      setHasMore(Boolean(payload.pagination?.hasMore));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || "素材加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [folderId, page, retry]);
  return <UiProps ids={{"aria-label":["materials.m517a19d463b5"]}}><div aria-label="materials.m517a19d463b5" className="ml-8 space-y-1 pb-2">
    {items.map(item => <div key={item.id} className="flex items-center gap-3 px-3 py-1.5" title={item.title}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--panel-2)] text-[var(--app-muted)]">
        {item.kind === "audio" ? <Music2 size={18} /> : item.kind === "video" && (!item.thumbnailUrl || item.thumbnailUrl === item.fileUrl) ? <Video size={18} /> : <MediaImage src={item.thumbnailUrl || item.fileUrl} alt="" previewSize={{ width: 72, height: 72 }} className="h-full w-full object-cover" />}
      </div><span className="truncate text-xs">{item.title || <UiText id="materials.mcb30b4bb3bb2" />}</span>
    </div>)}
    {loading && <p className="px-3 py-2 text-xs text-[var(--app-muted)]"><UiText id="materials.m1d32e2333611" /></p>}
    {!loading && !error && !items.length && <p className="px-3 py-2 text-xs text-[var(--app-muted)]"><UiText id="materials.mbc5bb2654621" /></p>}
    {error && <div role="alert" className="px-3 py-2 text-xs text-red-400">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline"><UiText id="materials.mb8784c8dd563" /></button></div>}
    {!loading && !error && hasMore && <button type="button" onClick={() => setPage(value => value + 1)} className="px-3 py-2 text-xs text-[var(--app-muted)]"><UiText id="materials.m06684bd49a97" /></button>}
  </div></UiProps>;
}

export function ProductFolderPicker({ open, folders, loading, error: loadError, operationError, title: titleProp, confirmText: confirmTextProp, allowRoot = false, exclude, onClose, onConfirm, onChanged }: {
  open: boolean; folders: ProductFolder[]; loading?: boolean; error?: string; operationError?: string; title?: string; confirmText?: string; allowRoot?: boolean; exclude?: string;
  onClose: () => void; onConfirm: (id: string) => void | boolean | Promise<void | boolean>; onChanged: (folders: ProductFolder[]) => void;
}) {
  const { text, error: localizeError } = useUiLocale();
  const title = titleProp ?? text("createDynamic.m0d6fad8138e7");
  const confirmText = confirmTextProp ?? text("createDynamic.m36f33adaf094");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => { if (open) { setSelected(null); setExpanded(new Set()); setCreating(false); setName(""); setError(""); } }, [open]);
  const toggleFolder = (id: string) => setExpanded(value => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const folderRows = folders.filter(folder => folder.id !== exclude && !folder.id.startsWith((exclude || "\0") + "/")).map(folder => <React.Fragment key={folder.id}>
    <div className={`flex items-center rounded-xl ${selected === folder.id ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"}`}>
      <button type="button" aria-label={expanded.has(folder.id) ? text("createDynamic.m777637078bce", { title: folder.name }) : text("createDynamic.m79e38a081350", { title: folder.name })} aria-expanded={expanded.has(folder.id)} onClick={() => toggleFolder(folder.id)} className="p-2 text-[var(--app-muted)]"><ChevronRight size={16} className={expanded.has(folder.id) ? "rotate-90" : ""} /></button>
      <button type="button" aria-pressed={selected === folder.id} aria-expanded={expanded.has(folder.id)} onClick={() => { setSelected(folder.id); setError(""); toggleFolder(folder.id); }} className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left"><Folder className="h-6 w-6 shrink-0 fill-[var(--app-muted)] text-[var(--app-muted)]" strokeWidth={1.25} /><span className="truncate">{folder.id}</span></button>
    </div>
    {expanded.has(folder.id) && <FolderMaterials folderId={folder.id} />}
  </React.Fragment>);
  return <UiProps ids={{"confirmText":["materials.m10a5f1c1d097"]}}><ConfirmDialog open={open} title={title} confirmText={creating ? "materials.m10a5f1c1d097" : confirmText} onClose={onClose}
    confirmDisabled={loading || Boolean(loadError) || (creating ? !name.trim() : selected === null)}
    headerActions={<button type="button" disabled={loading || Boolean(loadError)} className="flex items-center gap-1 px-2 py-1 text-xs" onClick={() => { setCreating(value => !value); setName(""); }}><Plus size={14} /><UiText id="materials.m84244abc71de" /></button>}
    onConfirm={async () => {
      try {
        let destination = selected;
        if (creating) {
          const result = await updateProductFolders({ operation: "create", name, parentId: null });
          onChanged(result.folders); destination = result.destination; setSelected(destination); setCreating(false);
          // Keep the next confirmation a direct user gesture for the file picker.
          return false;
        }
        if (destination === null) return false;
        return await onConfirm(destination);
      } catch (cause) { setError((cause as Error).message); return false; }
    }}>
    <div className="mb-3 rounded-xl bg-[var(--panel-2)] px-3 py-2 text-center text-sm"><UiText id="materials.m15dec507959e" /></div>
    {creating && <div className="mb-3 space-y-2 rounded-xl border border-[var(--border)] p-3"><p className="text-xs text-[var(--app-muted)]"><UiText id="materials.m2601508aa4e6" /></p><UiProps ids={{"aria-label":["materials.mae51764fbb38"],"placeholder":["materials.m0e37bff91e72"]}}><input autoFocus aria-label="materials.mae51764fbb38" placeholder="materials.m0e37bff91e72" value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm" /></UiProps></div>}
    <div className="h-[260px] max-h-[50vh] overflow-y-auto overscroll-contain text-sm">
      {loading ? <p className="py-10 text-center text-[var(--app-muted)]"><UiText id="materials.m4927a53bcc88" /></p> : <>
        <button type="button" aria-pressed={selected === (allowRoot ? "" : MEDIA_LIBRARY_UNGROUPED)} onClick={() => setSelected(allowRoot ? "" : MEDIA_LIBRARY_UNGROUPED)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-9 py-3 text-left ${selected === (allowRoot ? "" : MEDIA_LIBRARY_UNGROUPED) ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"}`}><Folder className="h-6 w-6 shrink-0 fill-[var(--app-muted)] text-[var(--app-muted)]" strokeWidth={1.25} />{allowRoot ? <UiText id="materials.m42ee2863b6d7" /> : <UiText id="materials.m54b89f901274" />}</button>
        {folderRows}
      </>}
    </div>
    {(error || loadError || operationError) && <p role="alert" className="mt-2 text-sm text-red-400">{localizeError(error || loadError || operationError)}</p>}
  </ConfirmDialog></UiProps>;
}

export function ProductFolderNavigation({ folders, availableGroups, hasUngrouped, current, onSelect, onChanged }: { folders: ProductFolder[]; availableGroups: string[]; hasUngrouped: boolean; current: string; onSelect: (id: string) => void; onChanged: (folders: ProductFolder[]) => void | Promise<void> }) {
  const { text, error: localizeError } = useUiLocale();
  const [menu, setMenu] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<{ kind: "rename" | "delete"; folder?: ProductFolder } | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const run = async (input: ProductFolderAction) => {
    try {
      const result = await updateProductFolders(input);
      await onChanged(result.folders);
      if (input.operation === "delete" && input.id && (current === input.id || current.startsWith(input.id + "/"))) onSelect(MEDIA_LIBRARY_UNGROUPED);
      else if (result.destination) {
        onSelect(result.destination);
      }
      setAction(null); setError(""); return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  };
  const menuFolder = folders.find(folder => folder.id === menu);
  return <UiProps ids={{"aria-label":["materials.m3c3248d1be6d"]}}><div aria-label="materials.m3c3248d1be6d" className="min-w-0 text-[var(--app-fg)]">
    <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {[{ id: "all", name: text("createDynamic.m5c55a67935af") }, ...(hasUngrouped ? [{ id: MEDIA_LIBRARY_UNGROUPED, name: text("createDynamic.m54b89f901274") }] : []), ...folders.filter(folder => availableGroups.includes(folder.id))].map(folder => (
          <div key={folder.id} className={`group inline-flex h-7 shrink-0 items-center rounded-full border text-[12px] font-medium transition ${current === folder.id ? "border-transparent bg-[var(--panel-2)] text-[var(--app-fg)]" : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:border-[var(--border-2)] hover:text-[var(--app-fg)]"}`}>
            <UiProps ids={{"title":["materials.m5c55a67935af","materials.m54b89f901274"]}}><button type="button" title={folder.id === "all" ? "materials.m5c55a67935af" : folder.id === MEDIA_LIBRARY_UNGROUPED ? "materials.m54b89f901274" : folder.id} aria-pressed={current === folder.id} onClick={() => onSelect(folder.id)} className="h-full max-w-[240px] truncate px-3">{folder.id === "all" || folder.id === MEDIA_LIBRARY_UNGROUPED ? folder.name : folder.id}</button></UiProps>
            {"parentId" in folder && <button type="button" aria-label={text("createDynamic.m89a10e759e50", { folder: folder.id })} onClick={() => setMenu(menu === folder.id ? null : folder.id)} className="mr-1 rounded-full p-1 opacity-0 hover:bg-[var(--panel-2)] focus:opacity-100 group-hover:opacity-100" aria-expanded={menu === folder.id}><MoreHorizontal size={13} /></button>}
          </div>
        ))}
      </div>
    </div>
    {menuFolder && <div className="mt-2 flex flex-wrap items-center gap-1 text-xs"><span className="mr-2 text-[var(--app-muted)]">{menuFolder.id}</span>{([["rename", text("createDynamic.m0d0cbac2eee5")], ["delete", text("createDynamic.m2f9daa828907")]] as const).map(([kind, label]) => <button type="button" className="rounded-lg px-2 py-1 hover:bg-[var(--panel-2)]" key={kind} onClick={() => { setAction({ kind, folder: menuFolder }); setName(kind === "rename" ? menuFolder.name : ""); setError(""); setMenu(null); }}>{label}</button>)}<button type="button" className="px-2 py-1 text-[var(--app-muted)]" onClick={() => setMenu(null)}><UiText id="materials.m2cd0f3be8738" /></button></div>}
    <UiProps ids={{"title":["materials.m780dfc4c1142","materials.mda2f8f756e74"]}}><ConfirmDialog open={Boolean(action)} title={action?.kind === "delete" ? "materials.m780dfc4c1142" : "materials.mda2f8f756e74"} danger={action?.kind === "delete"} description={action?.kind === "delete" ? text("createDynamic.m7bdf457623a3", { folder: String(action.folder?.id) }) : undefined} onClose={() => setAction(null)} confirmDisabled={action?.kind !== "delete" && !name.trim()} onConfirm={() => run({ operation: action!.kind, id: action?.folder?.id, name })}>
      {action?.kind !== "delete" && <UiProps ids={{"aria-label":["materials.mbacf701908d8"]}}><input aria-label="materials.mbacf701908d8" autoFocus value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm" /></UiProps>}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{localizeError(error)}</p>}
    </ConfirmDialog></UiProps>
  </div></UiProps>;
}
