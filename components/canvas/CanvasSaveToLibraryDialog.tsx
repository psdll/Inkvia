"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronRight, Folder, FolderOpen, Loader2, Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CanvasPreviewItem } from "@/components/canvas/CanvasMediaPreview";
import { getCanvasMediaDownloadName } from "@/lib/canvas/material-name";
import type { PersonalFolder, PersonalLibrary } from "@/lib/canvas/personal-library-types";

type Props = {
  open: boolean;
  items: CanvasPreviewItem[];
  onClose: () => void;
  onSaved: (count: number) => void;
};

const emptyLibrary: PersonalLibrary = { version: 1, folders: [], items: [] };

function fallbackMime(kind: CanvasPreviewItem["kind"]) {
  return kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
}

export function CanvasSaveToLibraryDialog({ open, items, onClose, onSaved }: Props) {
  const { text, error: uiError } = useUiLocale();
  const [library, setLibrary] = React.useState<PersonalLibrary>(emptyLibrary);
  const [loading, setLoading] = React.useState(false);
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [folderName, setFolderName] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setSelectedFolder(null);
    setExpanded(new Set());
    setCreating(false);
    setFolderName("");
    setError("");
    void fetch("/api/canvas/materials", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "素材库加载失败");
        setLibrary(payload.library || emptyLibrary);
      })
      .catch(fetchError => {
        if (fetchError?.name !== "AbortError") setError(String(fetchError?.message || fetchError));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  const children = React.useMemo(() => {
    const map = new Map<string | null, PersonalFolder[]>();
    for (const folder of library.folders) {
      const siblings = map.get(folder.parentId) || [];
      siblings.push(folder);
      map.set(folder.parentId, siblings);
    }
    for (const siblings of map.values()) siblings.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return map;
  }, [library.folders]);

  const toggle = (folderId: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return next;
  });

  const folderTree = (parentId: string | null, depth = 0): React.ReactNode => (children.get(parentId) || []).map(folder => {
    const isExpanded = expanded.has(folder.id);
    const hasChildren = Boolean(children.get(folder.id)?.length);
    return <React.Fragment key={folder.id}>
      <div style={{ paddingLeft: Math.min(depth, 10) * 18 }} className={`flex items-center rounded-xl ${selectedFolder === folder.id ? "bg-[var(--panel-2)] ring-1 ring-inset ring-[var(--border)]" : "hover:bg-[var(--panel-2)]"}`}>
        <button type="button" aria-label={`${isExpanded ? text("workspaceFollowup.mafd4b783536b") : text("workspaceFollowup.m00bd3960fea8")}${folder.name}`} disabled={!hasChildren || loading} className="self-stretch px-2 text-[var(--app-muted)] disabled:opacity-25" onClick={() => toggle(folder.id)}><ChevronRight className={`h-4 w-4 ${isExpanded ? "rotate-90" : ""}`} /></button>
        <button type="button" aria-label={folder.name} aria-pressed={selectedFolder === folder.id} disabled={loading} className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left text-sm text-[var(--app-fg)]" onClick={() => { setSelectedFolder(folder.id); setError(""); if (hasChildren) setExpanded(current => new Set([...current, folder.id])); }}>
          {isExpanded ? <FolderOpen className="h-6 w-6 shrink-0 text-[var(--app-muted)]" /> : <Folder className="h-6 w-6 shrink-0 text-[var(--app-muted)]" />}
          <span className="truncate">{folder.name}</span>{selectedFolder === folder.id && <span className="ml-auto text-xs text-[var(--app-muted)]"><UiText id="canvas.m7ecf1cde6486" /></span>}
        </button>
      </div>
      {isExpanded && folderTree(folder.id, depth + 1)}
    </React.Fragment>;
  });

  const confirm = async () => {
    setError("");
    try {
      let destinationId = selectedFolder;
      if (creating) {
        const name = folderName.trim();
        if (!name) throw new Error("请输入文件夹名称");
        const previousIds = new Set(library.folders.map(folder => folder.id));
        const response = await fetch("/api/canvas/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "create", type: "folder", parentId: selectedFolder, name }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "新建文件夹失败");
        const nextLibrary = payload.library as PersonalLibrary;
        setLibrary(nextLibrary);
        destinationId = nextLibrary.folders.find(folder => !previousIds.has(folder.id))?.id ?? null;
      }
      if (!destinationId) throw new Error("请选择一个文件夹");

      const files = await Promise.all(items.map(async item => {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`“${item.name || "素材"}”读取失败`);
        const source = await response.blob();
        const mime = source.type && source.type !== "application/octet-stream" ? source.type : fallbackMime(item.kind);
        const name = getCanvasMediaDownloadName(item, mime);
        return new File([source], name, { type: mime });
      }));
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("folderId", destinationId);
        const response = await fetch("/api/canvas/materials", { method: "POST", body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `“${file.name}”保存失败`);
      }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("canvas-personal-library");
        channel.postMessage("changed");
        channel.close();
      }
      onSaved(files.length);
      return true;
    } catch (saveError) {
      setError(String((saveError as Error)?.message || saveError));
      return false;
    }
  };

  return <UiProps ids={{"title":["canvas.m0d6fad8138e7"],"confirmText":["canvas.m72dde8dfef88"]}}><ConfirmDialog
    open={open}
    title="canvas.m0d6fad8138e7"
    confirmText="canvas.m72dde8dfef88"
    confirmDisabled={loading || !items.length || (creating ? !folderName.trim() : !selectedFolder)}
    headerActions={<button type="button" disabled={loading} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-40" onClick={() => { setCreating(true); setFolderName(""); setError(""); }}><Plus className="h-3.5 w-3.5" /><UiText id="canvas.m84244abc71de" /></button>}
    onClose={onClose}
    onConfirm={confirm}
  >
    <div className="mb-3 rounded-xl bg-[var(--panel-2)] px-3 py-2 text-center text-sm text-[var(--app-fg)]"><UiText id="canvas.m15dec507959e" /></div>
    {creating && <div className="mb-3 rounded-xl border border-[var(--border)] p-3">
      <p className="mb-2 text-xs text-[var(--app-muted)]"><UiText id="canvas.m8f91a5ffaac9" />{selectedFolder ? library.folders.find(folder => folder.id === selectedFolder)?.name : <UiText id="canvas.m5f5e9b85e503" />}</p>
      <UiProps ids={{"aria-label":["canvas.mae51764fbb38"],"placeholder":["canvas.m0e37bff91e72"]}}><input autoFocus aria-label="canvas.mae51764fbb38" placeholder="canvas.m0e37bff91e72" value={folderName} onChange={event => setFolderName(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-muted)]" /></UiProps>
    </div>}
    <div className="max-h-[50vh] min-h-[280px] overflow-y-auto">
      {loading ? <p className="flex items-center justify-center gap-2 py-12 text-xs text-[var(--app-muted)]"><Loader2 className="h-4 w-4 animate-spin" /><UiText id="canvas.md04fcbda737f" /></p> : folderTree(null)}
      {!loading && !library.folders.length && !creating && <p className="py-12 text-center text-xs text-[var(--app-muted)]"><UiText id="canvas.mc09d5d3887c7" /></p>}
    </div>
    <p className="mt-2 text-xs text-[var(--app-muted)]"><UiText id="canvas.m517ee018c5f6" />{items.length}<UiText id="canvas.me87a3e641223" /></p>
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{uiError(error)}</p>}
  </ConfirmDialog></UiProps>;
}
