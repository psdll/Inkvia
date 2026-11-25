"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, History, Loader2, Plus, UploadCloud, X } from "lucide-react";
import { SuggestSelect } from "@/components/ui/suggest-select";

const UPLOAD_HISTORY_KEY = "material-upload-history:v1";
const UPLOAD_HISTORY_LIMIT = 30;
type UploadHistory = { tags: string[] };
const EMPTY_UPLOAD_HISTORY: UploadHistory = { tags: [] };

type UploadGroupStatus = "idle" | "uploading" | "done" | "error";
type UploadGroupDraft = {
  id: string;
  title: string;
  category: string;
  tags: string;
  creatorName: string;
  modelName: string;
  files: File[];
  coverIndex: number;
  status: UploadGroupStatus;
  note?: string;
};
type FolderUploadFile = { file: File; path: string };

const GROUP_MEDIA_LIMIT = 15;
const MATERIAL_ACCEPT_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "mp4", "webm", "mov", "mkv"];

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const v = String(raw || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function parseTagList(raw: string): string[] {
  return dedupStrings(String(raw || "").split(/[,，]/));
}

function readUploadHistory(): UploadHistory {
  if (typeof window === "undefined") return EMPTY_UPLOAD_HISTORY;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UPLOAD_HISTORY_KEY) || "{}");
    const pick = (v: any) => (Array.isArray(v) ? dedupStrings(v).slice(0, UPLOAD_HISTORY_LIMIT) : []);
    return { tags: pick(parsed?.tags) };
  } catch {
    return EMPTY_UPLOAD_HISTORY;
  }
}

function recordUploadHistory(patch: { tags?: string[] }): UploadHistory {
  if (typeof window === "undefined") return EMPTY_UPLOAD_HISTORY;
  const cur = readUploadHistory();
  const merge = (prev: string[], incoming: string[]) => dedupStrings([...incoming, ...prev]).slice(0, UPLOAD_HISTORY_LIMIT);
  const next: UploadHistory = {
    tags: patch.tags && patch.tags.length ? merge(cur.tags, patch.tags) : cur.tags,
  };
  try {
    window.localStorage.setItem(UPLOAD_HISTORY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function formatSize(n?: number | null) {
  const size = Number(n || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileKey(f: File) {
  return `${f.name}_${f.size}_${f.lastModified}`;
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  };
  return map[ext] || "application/octet-stream";
}

function isZipFile(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function isImageUploadFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
}

async function expandMaterialFiles(incoming: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of incoming) {
    if (isZipFile(file)) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || entry.name.includes("__MACOSX/")) continue;
          const base = entry.name.split("/").pop() || entry.name;
          if (!base || base.startsWith(".")) continue;
          const ext = (base.split(".").pop() || "").toLowerCase();
          if (!MATERIAL_ACCEPT_EXT.includes(ext)) continue;
          const blob = await entry.async("blob");
          out.push(new File([blob], base, { type: extToMime(ext) }));
        }
      } catch {
      }
      continue;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (MATERIAL_ACCEPT_EXT.includes(ext)) out.push(file);
  }
  return out;
}

function mergeFilesDedup(prev: File[], next: File[]): File[] {
  const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
  const merged = [...prev];
  for (const f of next) {
    const key = `${f.name}|${f.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }
  return merged;
}

function createUploadGroupDraft(input: {
  title: string;
  category: string;
  tags: string;
  creatorName: string;
  modelName: string;
  files: File[];
  coverIndex?: number;
  note?: string;
}): UploadGroupDraft {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title: input.title.trim(),
    category: input.category.trim(),
    tags: input.tags.trim(),
    creatorName: input.creatorName.trim(),
    modelName: input.modelName.trim(),
    files: input.files,
    coverIndex: Math.min(Math.max(0, input.coverIndex || 0), Math.max(0, input.files.length - 1)),
    status: "idle",
    note: input.note,
  };
}

function createFolderUploadGroups(
  incoming: FolderUploadFile[],
  defaults: { category: string; tags: string; creatorName: string; modelName: string }
) {
  const grouped = new Map<string, FolderUploadFile[]>();
  let skipped = 0;
  for (const item of incoming) {
    const file = item.file;
    if (!isImageUploadFile(file)) {
      skipped += 1;
      continue;
    }
    const relativePath = String(item.path || file.webkitRelativePath || "");
    const parts = relativePath.split(/[\\/]/).filter(Boolean);
    if (parts.length < 2) {
      skipped += 1;
      continue;
    }
    const groupName = (parts.length >= 3 ? parts[1] : parts[0]) || "";
    if (!groupName) {
      skipped += 1;
      continue;
    }
    const list = grouped.get(groupName) || [];
    list.push(item);
    grouped.set(groupName, list);
  }

  const groups = Array.from(grouped.entries()).map(([name, items]) => {
    const sortedItems = [...items].sort((a, b) =>
      String(a.path || a.file.name).localeCompare(String(b.path || b.file.name), "zh-CN")
    );
    const keptFiles = sortedItems.slice(0, GROUP_MEDIA_LIMIT).map((item) => item.file);
    const overflow = sortedItems.length - keptFiles.length;
    return createUploadGroupDraft({
      title: name,
      category: defaults.category,
      tags: defaults.tags,
      creatorName: defaults.creatorName,
      modelName: defaults.modelName,
      files: keptFiles,
      note: overflow > 0 ? `超过 ${GROUP_MEDIA_LIMIT} 张，已保留前 ${GROUP_MEDIA_LIMIT} 张` : undefined,
    });
  });

  return { groups, skipped };
}

function readFileEntry(entry: any, pathPrefix: string): Promise<FolderUploadFile[]> {
  return new Promise((resolve) => {
    entry.file(
      (file: File) => resolve([{ file, path: `${pathPrefix}/${file.name}`.replace(/^\/+/, "") }]),
      () => resolve([])
    );
  });
}

async function readDirectoryEntry(entry: any, pathPrefix = ""): Promise<FolderUploadFile[]> {
  const currentPath = `${pathPrefix}/${entry.name || ""}`.replace(/^\/+/, "");
  if (entry.isFile) return readFileEntry(entry, pathPrefix);
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children: any[] = [];
  while (true) {
    const batch = await new Promise<any[]>((resolve) => {
      reader.readEntries((entries: any[]) => resolve(entries || []), () => resolve([]));
    });
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => readDirectoryEntry(child, currentPath)));
  return nested.flat();
}

async function readFolderUploadFiles(dataTransfer: DataTransfer): Promise<FolderUploadFile[]> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => {
      const getEntry = (item as any).webkitGetAsEntry;
      return typeof getEntry === "function" ? getEntry.call(item) : null;
    })
    .filter(Boolean);
  if (!entries.length) return [];
  const nested = await Promise.all(entries.map((entry) => readDirectoryEntry(entry)));
  return nested.flat();
}

async function readDirectoryHandle(handle: any, pathPrefix = ""): Promise<FolderUploadFile[]> {
  const currentPath = `${pathPrefix}/${handle.name || ""}`.replace(/^\/+/, "");
  const out: FolderUploadFile[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "file") {
      const file = await entry.getFile();
      out.push({ file, path: `${currentPath}/${name}`.replace(/^\/+/, "") });
    } else if (entry.kind === "directory") {
      out.push(...(await readDirectoryHandle(entry, currentPath)));
    }
  }
  return out;
}

async function pickFolderUploadFiles(): Promise<FolderUploadFile[]> {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== "function") {
    throw new Error("当前浏览器不支持点击选择文件夹，请使用 Chrome/Edge，或直接拖入总文件夹。");
  }
  const handle = await picker.call(window);
  return readDirectoryHandle(handle);
}

function LegacySuggestSelect({
  value,
  onChange,
  options,
  placeholder = "输入新名称即可新建分类",
  createLabel,
  emptyHint = "暂无分类，直接输入可新建",
  optionIcon,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  createLabel?: (v: string) => string;
  emptyHint?: string;
  optionIcon?: React.ReactNode;
  maxLength?: number;
}) {
  const { label: uiLabel } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);

  const filtered = React.useMemo(() => {
    const kw = inputValue.trim().toLowerCase();
    if (!kw) return options;
    if (options.some((o) => o.toLowerCase() === kw)) return options;
    return options.filter((o) => o.toLowerCase().includes(kw));
  }, [inputValue, options]);

  const showCreate =
    inputValue.trim().length > 0 &&
    !options.some((o) => o.toLowerCase() === inputValue.trim().toLowerCase());

  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  const useIsoLayoutEffect =
    typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
  useIsoLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const update = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        right: Math.max(0, window.innerWidth - rect.right),
        zIndex: 300,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const commit = (v: string) => {
    onChange(v);
    setInputValue(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--input-bg)] transition focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
        <input
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => {
            setOpen(true);
            if (inputValue && options.some((o) => o === inputValue)) {
              e.currentTarget.select();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]"
        />
        {inputValue ? (
          <UiProps ids={{"title":["settings.m1ef3de06b32e"]}}><button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setInputValue("");
              onChange("");
              setOpen(true);
            }}
            title="settings.m1ef3de06b32e"
            className="flex h-10 w-8 shrink-0 items-center justify-center text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button></UiProps>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="flex h-10 w-9 shrink-0 items-center justify-center border-l border-[var(--border)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
        >
          <ChevronDown className={["h-4 w-4 transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button>
      </div>

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listRef}
              style={menuStyle}
              className="overflow-hidden rounded-2xl
                border border-black/[0.08] bg-[#fbfbfd]
                shadow-[0_14px_40px_-10px_rgba(15,15,25,0.22),_0_2px_8px_-2px_rgba(15,15,25,0.08)]
                dark:border-white/[0.07] dark:bg-[#2c2c2e]
                dark:shadow-[0_14px_40px_-10px_rgba(0,0,0,0.7),_0_2px_8px_-2px_rgba(0,0,0,0.45)]"
            >
              <div className="max-h-[240px] overflow-y-auto p-1.5">
                {showCreate ? (
                  <button
                    type="button"
                    onClick={() => commit(inputValue.trim())}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[12px] text-blue-500 transition hover:bg-blue-500/8"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    {createLabel ? uiLabel(createLabel(inputValue.trim())) : <UiText id="settings.m0b02ae6cae13" values={{v0: String(inputValue.trim())}} />}
                  </button>
                ) : null}
                {filtered.length === 0 && !showCreate ? (
                  <div className="px-3 py-3 text-center text-[12px] text-[var(--app-muted)]">
                    {emptyHint}
                  </div>
                ) : (
                  filtered.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => commit(opt)}
                      className={[
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition",
                        value === opt
                          ? "bg-blue-500/10 text-blue-500"
                          : "text-[var(--app-fg)] hover:bg-[var(--panel-2)]",
                      ].join(" ")}
                    >
                      {optionIcon ? <span className="shrink-0 text-[var(--app-muted)]">{optionIcon}</span> : null}
                      <span className="flex-1 truncate">{opt}</span>
                    </button>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function FileThumbnail({ file }: { file: File }) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (!isImageUploadFile(file)) {
      setUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  if (!url) {
    return (
      <div className="flex aspect-square items-center justify-center bg-[var(--panel-3)] text-[11px] text-[var(--app-muted)]"><UiText id="settings.m39932f24fe11" /></div>
    );
  }
  return <img src={url} alt="" className="aspect-square w-full object-cover" />;
}

export function MaterialUploadPanel({ defaultCreatorName }: { defaultCreatorName?: string }) {
  const { error: uiError } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [creators, setCreators] = React.useState<string[]>([]);
  const [models, setModels] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [uploadDone, setUploadDone] = React.useState(0);
  const [uploadTotal, setUploadTotal] = React.useState(0);
  const [failedReasons, setFailedReasons] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [categoryDraft, setCategoryDraft] = React.useState("");
  const [tagDraft, setTagDraft] = React.useState("");
  const [titleDraft, setTitleDraft] = React.useState("");
  const [creatorNameDraft, setCreatorNameDraft] = React.useState(defaultCreatorName || "");
  const [modelNameDraft, setModelNameDraft] = React.useState("");
  const [uploadHistory, setUploadHistory] = React.useState<UploadHistory>(EMPTY_UPLOAD_HISTORY);
  const [files, setFiles] = React.useState<File[]>([]);
  const [groupQueue, setGroupQueue] = React.useState<UploadGroupDraft[]>([]);
  const [uploadMode, setUploadMode] = React.useState<"single" | "group">("single");
  const [coverIndex, setCoverIndex] = React.useState(0);
  const [dragZone, setDragZone] = React.useState<"folder" | "files" | null>(null);
  const [ingesting, setIngesting] = React.useState(false);

  React.useEffect(() => {
    setUploadHistory(readUploadHistory());
  }, []);

  React.useEffect(() => {
    setCreatorNameDraft((current) => current || defaultCreatorName || "");
  }, [defaultCreatorName]);

  React.useEffect(() => {
    setCoverIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, files.length - 1)));
  }, [files.length]);

  const refreshOptionValues = React.useCallback(async () => {
    try {
      const res = await fetch("/api/material-assets/options", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { categories?: string[]; creators?: string[]; models?: string[] } | null;
      if (!res.ok) throw new Error();
      setCategories(Array.isArray(json?.categories) ? json.categories : []);
      setCreators(Array.isArray(json?.creators) ? json.creators : []);
      setModels(Array.isArray(json?.models) ? json.models : []);
    } catch {
      setCategories([]);
      setCreators([]);
      setModels([]);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void refreshOptionValues();
  }, [open, refreshOptionValues]);

  const categoryOptions = React.useMemo(() => dedupStrings(categories), [categories]);
  const creatorOptions = React.useMemo(() => dedupStrings(creators), [creators]);
  const modelOptions = React.useMemo(() => dedupStrings(models), [models]);

  const deleteOption = React.useCallback(async (kind: "category" | "creator" | "model", value: string) => {
    try {
      const res = await fetch("/api/material-assets/options", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, value }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "删除候选项失败");
      const remove = (items: string[]) => items.filter((item) => item !== value);
      if (kind === "category") setCategories(remove);
      if (kind === "creator") setCreators(remove);
      if (kind === "model") setModels(remove);
    } catch (err: any) {
      setError(String(err?.message || "删除候选项失败"));
    }
  }, []);

  const ingestFiles = React.useCallback(async (incoming: File[], mode: "append" | "replace") => {
    if (!incoming.length) return;
    setIngesting(true);
    try {
      const expanded = await expandMaterialFiles(incoming);
      if (!expanded.length) {
        setError("没有可上传的文件（支持 jpg/png/webp/gif/bmp 等，或含图片的 zip 压缩包）");
        return;
      }
      setError("");
      setFiles((prev) => (mode === "append" ? mergeFilesDedup(prev, expanded) : expanded));
    } finally {
      setIngesting(false);
    }
  }, []);

  const onDropFiles = React.useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragZone(null);
      void ingestFiles(Array.from(e.dataTransfer?.files || []), "append");
    },
    [ingestFiles]
  );

  const importFolderGroups = React.useCallback((incoming: FolderUploadFile[]) => {
    if (!incoming.length) return;
    const { groups, skipped } = createFolderUploadGroups(incoming, {
      category: categoryDraft,
      tags: tagDraft,
      creatorName: creatorNameDraft,
      modelName: modelNameDraft,
    });
    if (!groups.length) {
      setError("没有识别到子文件夹组。请把总文件夹拖到这里，结构应为：总文件夹 / 每组子文件夹 / 图片。");
      return;
    }
    setUploadMode("group");
    setError("");
    setGroupQueue((prev) => [...prev, ...groups]);
    setMessage(`已导入 ${groups.length} 组${skipped ? `，跳过 ${skipped} 个非图片或根目录文件` : ""}`);
  }, [categoryDraft, creatorNameDraft, modelNameDraft, tagDraft]);

  const onDropFolderGroups = React.useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragZone(null);
      setIngesting(true);
      try {
        const folderFiles = await readFolderUploadFiles(e.dataTransfer);
        if (!folderFiles.length) {
          setError("没有读取到文件夹内容。请把总文件夹拖到这里。");
          return;
        }
        importFolderGroups(folderFiles);
      } finally {
        setIngesting(false);
      }
    },
    [importFolderGroups]
  );

  const chooseFolderGroups = React.useCallback(async () => {
    setIngesting(true);
    setError("");
    try {
      const folderFiles = await pickFolderUploadFiles();
      if (!folderFiles.length) {
        setError("没有读取到文件夹内容。");
        return;
      }
      importFolderGroups(folderFiles);
    } catch (err: any) {
      if (String(err?.name || "") === "AbortError") return;
      setError(String(err?.message || "读取文件夹失败"));
    } finally {
      setIngesting(false);
    }
  }, [importFolderGroups]);

  const addCurrentGroupToQueue = React.useCallback(() => {
    if (!files.length) return;
    if (files.length > GROUP_MEDIA_LIMIT) {
      setError(`系列图最多 ${GROUP_MEDIA_LIMIT} 张`);
      return;
    }
    const badFile = files.find((file) => !isImageUploadFile(file));
    if (badFile) {
      setError(`系列图仅支持图片：${badFile.name}`);
      return;
    }
    setGroupQueue((prev) => [
      ...prev,
      createUploadGroupDraft({
        title: titleDraft.trim() || `系列图 ${prev.length + 1}`,
        category: categoryDraft,
        tags: tagDraft,
        creatorName: creatorNameDraft,
        modelName: modelNameDraft,
        files: [...files],
        coverIndex,
      }),
    ]);
    setFiles([]);
    setTitleDraft("");
    setCoverIndex(0);
    setError("");
    setMessage("已加入待上传队列");
  }, [categoryDraft, coverIndex, creatorNameDraft, files, modelNameDraft, tagDraft, titleDraft]);

  const updateQueuedGroup = React.useCallback((id: string, patch: Partial<UploadGroupDraft>) => {
    setGroupQueue((prev) => prev.map((group) => (group.id === id ? { ...group, ...patch } : group)));
  }, []);

  const uploadOneForm = React.useCallback(async (form: FormData, fallback: string) => {
    const res = await fetch("/api/material-assets/upload", { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(json?.error || fallback);
  }, []);

  const upload = React.useCallback(async () => {
    if (uploading || (!files.length && !(uploadMode === "group" && groupQueue.length))) return;
    setUploading(true);
    setError("");
    setMessage("");

    if (uploadMode === "group" && groupQueue.length) {
      const queueGroups = [...groupQueue];
      setUploadTotal(queueGroups.length);
      setUploadDone(0);
      setFailedReasons({});
      setGroupQueue((prev) => prev.map((group) => ({ ...group, status: "idle" as UploadGroupStatus })));
      const failedGroups: UploadGroupDraft[] = [];
      let successGroups = 0;

      for (let i = 0; i < queueGroups.length; i++) {
        const group = queueGroups[i];
        setGroupQueue((prev) => prev.map((row) => (row.id === group.id ? { ...row, status: "uploading" } : row)));
        try {
          if (!group.files.length) throw new Error("组内没有图片");
          const badFile = group.files.find((file) => !isImageUploadFile(file));
          if (badFile) throw new Error(`系列图仅支持图片：${badFile.name}`);
          if (group.files.length > GROUP_MEDIA_LIMIT) throw new Error(`系列图最多 ${GROUP_MEDIA_LIMIT} 张`);
          const form = new FormData();
          group.files.forEach((file) => form.append("files", file));
          form.set("uploadMode", "group");
          form.set("coverIndex", String(group.coverIndex));
          if (group.category.trim()) form.set("category", group.category.trim());
          if (group.tags.trim()) form.set("tags", group.tags.trim());
          if (group.title.trim()) form.set("title", group.title.trim());
          if (group.creatorName.trim()) form.set("creatorName", group.creatorName.trim());
          if (group.modelName.trim()) form.set("modelName", group.modelName.trim());
          await uploadOneForm(form, "系列图上传失败");
          successGroups += 1;
          setGroupQueue((prev) => prev.map((row) => (row.id === group.id ? { ...row, status: "done" } : row)));
        } catch (err: any) {
          const failed = { ...group, status: "error" as UploadGroupStatus, note: String(err?.message || "系列图上传失败") };
          failedGroups.push(failed);
          setGroupQueue((prev) => prev.map((row) => (row.id === group.id ? failed : row)));
        } finally {
          setUploadDone(i + 1);
        }
      }

      setGroupQueue(failedGroups);
      if (failedGroups.length) {
        setError(`成功 ${successGroups} 组，失败 ${failedGroups.length} 组。失败组已保留，可修改后重试。`);
      } else {
        setMessage(`已上传 ${successGroups} 组素材`);
        setFiles([]);
        setTitleDraft("");
        setCreatorNameDraft(defaultCreatorName || "");
        setCoverIndex(0);
      }
      if (successGroups > 0) {
        setUploadHistory(recordUploadHistory({ tags: parseTagList(tagDraft) }));
        void refreshOptionValues();
      }
      setUploading(false);
      return;
    }

    const queue = [...files];
    const total = queue.length;
    setUploadTotal(total);
    setUploadDone(0);
    setFailedReasons({});

    if (uploadMode === "group") {
      if (queue.length > GROUP_MEDIA_LIMIT) {
        setError(`系列图最多 ${GROUP_MEDIA_LIMIT} 张`);
        setUploading(false);
        return;
      }
      const badFile = queue.find((file) => !isImageUploadFile(file));
      if (badFile) {
        setError(`系列图仅支持图片：${badFile.name}`);
        setUploading(false);
        return;
      }
      const form = new FormData();
      queue.forEach((file) => form.append("files", file));
      form.set("uploadMode", "group");
      form.set("coverIndex", String(coverIndex));
      if (categoryDraft.trim()) form.set("category", categoryDraft.trim());
      if (tagDraft.trim()) form.set("tags", tagDraft.trim());
      if (titleDraft.trim()) form.set("title", titleDraft.trim());
      if (creatorNameDraft.trim()) form.set("creatorName", creatorNameDraft.trim());
      if (modelNameDraft.trim()) form.set("modelName", modelNameDraft.trim());
      try {
        await uploadOneForm(form, "系列图上传失败");
        setUploadDone(queue.length);
        setFiles([]);
        setFailedReasons({});
        setTitleDraft("");
        setCreatorNameDraft(defaultCreatorName || "");
        setCoverIndex(0);
        setMessage(`已上传 1 组素材，共 ${queue.length} 张`);
        setUploadHistory(recordUploadHistory({ tags: parseTagList(tagDraft) }));
        void refreshOptionValues();
      } catch (err: any) {
        setError(String(err?.message || "系列图上传失败"));
      } finally {
        setUploading(false);
      }
      return;
    }

    let success = 0;
    const failed: File[] = [];
    const reasons: Record<string, string> = {};
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      const form = new FormData();
      form.append("files", file);
      if (categoryDraft.trim()) form.set("category", categoryDraft.trim());
      if (tagDraft.trim()) form.set("tags", tagDraft.trim());
      if (titleDraft.trim()) form.set("title", titleDraft.trim());
      if (creatorNameDraft.trim()) form.set("creatorName", creatorNameDraft.trim());
      if (modelNameDraft.trim()) form.set("modelName", modelNameDraft.trim());
      try {
        await uploadOneForm(form, `上传失败（${file.name}）`);
        success += 1;
      } catch (err: any) {
        const raw = String(err?.message || "上传失败");
        const reason = raw.startsWith(`${file.name}：`) ? raw.slice(file.name.length + 1) : raw;
        failed.push(file);
        reasons[fileKey(file)] = reason;
      } finally {
        setUploadDone(i + 1);
      }
    }

    setFiles(failed);
    setFailedReasons(reasons);
    if (failed.length === 0) {
      setMessage(`已上传 ${success} 张素材`);
      setTitleDraft("");
      setCreatorNameDraft(defaultCreatorName || "");
    } else {
      setError(`成功 ${success} 张，失败 ${failed.length} 张：失败文件已在下方标红并注明原因，可修正后重试`);
    }
    if (success > 0) {
      setUploadHistory(recordUploadHistory({ tags: parseTagList(tagDraft) }));
      void refreshOptionValues();
    }
    setUploading(false);
  }, [categoryDraft, coverIndex, creatorNameDraft, defaultCreatorName, files, groupQueue, modelNameDraft, tagDraft, titleDraft, uploadMode, uploading, uploadOneForm]);

  return (
    <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow-2)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="settings.m493ee58f81f5" /></div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="settings.m6365edacee55" /></div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-[13px] font-medium text-white shadow-sm transition hover:bg-blue-600"
          >
            <UploadCloud className="h-4 w-4" /><UiText id="settings.m493ee58f81f5" /></button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={() => !uploading && setOpen(false)}>
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="inline-flex items-center gap-2">
                <UploadCloud className="h-[18px] w-[18px] text-blue-500" />
                <span className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="settings.m493ee58f81f5" /></span>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-0.5">
                {(["single", "group"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setUploadMode(mode)}
                    disabled={uploading}
                    className={[
                      "h-8 rounded-md px-3 text-[12px] transition",
                      uploadMode === mode ? "bg-blue-500 text-white shadow-sm" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
                    ].join(" ")}
                  >
                    {mode === "single" ? <UiText id="settings.m9e255e169951" /> : <UiText id="settings.m7429b5611bdd" />}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="settings.m515559957fd3" /></label>
                  <div className="mt-1.5">
                    <SuggestSelect value={categoryDraft} onChange={setCategoryDraft} options={categoryOptions} onDeleteOption={(value) => void deleteOption("category", value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="settings.mc3405f8c7d9d" /></label>
                  <UiProps ids={{"placeholder":["settings.m40e01f6642bc"]}}><input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                    placeholder="settings.m40e01f6642bc"
                  /></UiProps>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="settings.m531ab1593149" /></label>
                  <div className="mt-1.5">
                    <UiProps ids={{"placeholder":["settings.m2b33c9a68e61"]}}><SuggestSelect
                      value={creatorNameDraft}
                      onChange={setCreatorNameDraft}
                      options={creatorOptions}
                      placeholder="settings.m2b33c9a68e61"
                      createLabel={(v) => `使用「${v}」`}
                      emptyHint="输入即可添加制作人"
                      optionIcon={<History className="h-3.5 w-3.5" />}
                      maxLength={80}
                      onDeleteOption={(value) => void deleteOption("creator", value)}
                    /></UiProps>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="settings.m322408c53bed" /></label>
                  <div className="mt-1.5">
                    <UiProps ids={{"placeholder":["settings.m72d4c72d1d7b"]}}><SuggestSelect
                      value={modelNameDraft}
                      onChange={setModelNameDraft}
                      options={modelOptions}
                      placeholder="settings.m72d4c72d1d7b"
                      createLabel={(value) => `使用「${value}」`}
                      emptyHint="输入即可添加型号"
                      optionIcon={<History className="h-3.5 w-3.5" />}
                      maxLength={80}
                      onDeleteOption={(value) => void deleteOption("model", value)}
                    /></UiProps>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="settings.m1d0fd5f9336d" /></label>
                  <UiProps ids={{"placeholder":["settings.m07a7f1dd375a"]}}><input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                    placeholder="settings.m07a7f1dd375a"
                  /></UiProps>
                  {uploadHistory.tags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {uploadHistory.tags.map((t) => {
                        const current = parseTagList(tagDraft);
                        const active = current.includes(t);
                        return (
                          <UiProps key={t} ids={{"title":["settings.m96fc74daea7d","settings.m934984ed16ea"]}}><button

                            type="button"
                            onClick={() =>
                              setTagDraft((active ? current.filter((x) => x !== t) : [...current, t]).join(", "))
                            }
                            className={[
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition",
                              active
                                ? "bg-blue-500/12 text-blue-500"
                                : "bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
                            ].join(" ")}
                            title={active ? "settings.m96fc74daea7d" : "settings.m934984ed16ea"}
                          >
                            {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                            {t}
                          </button></UiProps>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              {uploadMode === "group" ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dragZone !== "folder") setDragZone("folder");
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setDragZone((prev) => (prev === "folder" ? null : prev));
                  }}
                  onDrop={(event) => void onDropFolderGroups(event)}
                  className={[
                    "mb-10 mt-5 flex flex-wrap items-center gap-2 rounded-xl border p-3 transition",
                    dragZone === "folder" ? "border-blue-500/60 bg-blue-500/10" : "border-[var(--border)] bg-[var(--app-bg)]",
                  ].join(" ")}
                >
                  <div className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-dashed border-blue-500/25 bg-blue-500/10 px-2 text-[12px] font-medium text-blue-500">
                    <button
                      type="button"
                      disabled={uploading || ingesting}
                      onClick={() => void chooseFolderGroups()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-500 px-2.5 text-white transition hover:bg-blue-600 disabled:pointer-events-none disabled:opacity-45"
                    >
                      <UploadCloud className="h-3.5 w-3.5" /><UiText id="settings.m35eced8c0e13" /></button>
                    <span className="pr-1 text-[11px] text-blue-500/80"><UiText id="settings.mea8464f079dd" /></span>
                  </div>
                  <button
                    type="button"
                    disabled={!files.length || uploading || ingesting}
                    onClick={addCurrentGroupToQueue}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" /><UiText id="settings.m1ac7bd4d651b" /></button>
                  <div className="min-w-[180px] flex-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="settings.med0edf0a8bf9" /></div>
                </div>
              ) : null}

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragZone !== "files") setDragZone("files");
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragZone((prev) => (prev === "files" ? null : prev));
                }}
                onDrop={onDropFiles}
                className={[
                  "group mt-5 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition",
                  dragZone === "files"
                    ? "border-blue-500/60 bg-blue-500/10"
                    : "border-[var(--border)] bg-[var(--app-bg)] hover:border-blue-500/40 hover:bg-blue-500/5",
                ].join(" ")}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] transition group-hover:border-blue-500/30 group-hover:bg-blue-500/10">
                  {ingesting ? (
                    <Loader2 className="h-[18px] w-[18px] animate-spin text-blue-500" />
                  ) : (
                    <Plus className="h-[18px] w-[18px] text-[var(--app-muted)] transition group-hover:text-blue-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    {ingesting
                      ? <UiText id="settings.me8ee7d77e58d" />
                      : files.length
                        ? <UiText id="settings.mac88babab779" values={{v0: String(files.length)}} />
                        : dragZone === "files"
                          ? <UiText id="settings.mc57e1ab5dc60" />
                          : <UiText id="settings.mdb1ed01084c7" />}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]"><UiText id="settings.m884bb36402cd" /></div>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,video/mp4,video/webm,video/quicktime,video/x-matroska,application/zip,application/x-zip-compressed,.zip"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void ingestFiles(Array.from(e.target.files || []), "append");
                    e.target.value = "";
                  }}
                />
              </label>

              {files.length && uploadMode === "group" ? (
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3">
                  <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                    <span><UiText id="settings.m2289893e7581" />{GROUP_MEDIA_LIMIT}<UiText id="settings.me9e0fdc242b4" /></span>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles([]);
                        setCoverIndex(0);
                      }}
                      className="underline-offset-2 transition hover:text-rose-500 hover:underline"
                    ><UiText id="settings.mb730d8da2058" /></button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="group relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
                        <FileThumbnail file={file} />
                        <div className="absolute left-1.5 top-1.5 flex gap-1">
                          <span className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}</span>
                          {index === coverIndex ? <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white"><UiText id="settings.mccbb5ee62b1a" /></span> : null}
                        </div>
                        <div className="absolute inset-x-1.5 bottom-1.5 flex flex-wrap gap-1 opacity-0 transition group-hover:opacity-100">
                          <button type="button" onClick={() => setCoverIndex(index)} className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"><UiText id="settings.m38afa58cf1a3" /></button>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => setFiles((prev) => {
                              const next = [...prev];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              setCoverIndex((old) => old === index ? index - 1 : old === index - 1 ? index : old);
                              return next;
                            })}
                            className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-40"
                          ><UiText id="settings.mf853a70b1204" /></button>
                          <button
                            type="button"
                            disabled={index === files.length - 1}
                            onClick={() => setFiles((prev) => {
                              const next = [...prev];
                              [next[index + 1], next[index]] = [next[index], next[index + 1]];
                              setCoverIndex((old) => old === index ? index + 1 : old === index + 1 ? index : old);
                              return next;
                            })}
                            className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-40"
                          ><UiText id="settings.me75e8b4e5c97" /></button>
                          <button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            className="rounded bg-rose-500/85 px-1.5 py-0.5 text-[10px] text-white"
                          ><UiText id="settings.m6135d4159e89" /></button>
                        </div>
                        <div className="truncate px-1.5 py-1 text-[10px] text-[var(--app-muted)]" title={file.name}>{file.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : files.length ? (
                <div className="mt-4 max-h-56 space-y-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2">
                  <div className="flex items-center justify-between px-1 pb-1 text-[11px] text-[var(--app-muted)]">
                    <span><UiText id="settings.m52c963128eab" />{files.length}<UiText id="settings.m7aaf96ad52e0" /></span>
                    <button type="button" onClick={() => setFiles([])} className="underline-offset-2 transition hover:text-rose-500 hover:underline"><UiText id="settings.mb730d8da2058" /></button>
                  </div>
                  {files.map((file, index) => {
                    const reason = failedReasons[fileKey(file)];
                    return (
                      <div key={`${file.name}-${file.size}-${index}`} className={["rounded-md px-1 py-0.5", reason ? "bg-rose-500/5" : "hover:bg-[var(--panel-2)]"].join(" ")}>
                        <div className="flex items-center gap-2">
                          <span className={["min-w-0 flex-1 truncate text-[11px]", reason ? "text-rose-500" : "text-[var(--app-muted)]"].join(" ")} title={file.name}>
                            {file.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{formatSize(file.size)}</span>
                          <UiProps ids={{"title":["settings.m4d833f111c6f"]}}><button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            title="settings.m4d833f111c6f"
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--app-muted)] transition hover:bg-rose-500/10 hover:text-rose-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button></UiProps>
                        </div>
                        {reason ? <div className="pl-1 pt-0.5 text-[10px] leading-tight text-rose-500">⚠ {reason}</div> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {uploadMode === "group" && groupQueue.length ? (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <div className="font-medium text-[var(--app-fg)]"><UiText id="settings.mf6b24adada1a" />{groupQueue.length}</div>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={uploading} onClick={() => setGroupQueue((prev) => prev.map((group) => ({ ...group, category: categoryDraft })))} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:pointer-events-none disabled:opacity-45"><UiText id="settings.m88721d7315dc" /></button>
                      <button type="button" disabled={uploading} onClick={() => setGroupQueue([])} className="rounded-lg border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-500 transition hover:bg-rose-500/10 disabled:pointer-events-none disabled:opacity-45"><UiText id="settings.md18e02739127" /></button>
                    </div>
                  </div>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {groupQueue.map((group, index) => (
                      <div key={group.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2">
                        <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-[var(--panel-2)]">
                          {group.files[0] ? <FileThumbnail file={group.files[group.coverIndex] || group.files[0]} /> : null}
                          <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                        </div>
                        <div className="min-w-0 space-y-2">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <UiProps ids={{"placeholder":["settings.mc3405f8c7d9d"]}}><input value={group.title} onChange={(event) => updateQueuedGroup(group.id, { title: event.target.value })} placeholder="settings.mc3405f8c7d9d" className="h-8 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-[12px] outline-none focus:border-blue-500/50" /></UiProps>
                            <SuggestSelect value={group.category} onChange={(value) => updateQueuedGroup(group.id, { category: value })} options={categoryOptions} onDeleteOption={(value) => void deleteOption("category", value)} />
                            <UiProps ids={{"placeholder":["settings.m531ab1593149"]}}><SuggestSelect value={group.creatorName} onChange={(value) => updateQueuedGroup(group.id, { creatorName: value })} options={creatorOptions} placeholder="settings.m531ab1593149" onDeleteOption={(value) => void deleteOption("creator", value)} /></UiProps>
                            <UiProps ids={{"placeholder":["settings.m322408c53bed"]}}><SuggestSelect value={group.modelName} onChange={(value) => updateQueuedGroup(group.id, { modelName: value })} options={modelOptions} placeholder="settings.m322408c53bed" onDeleteOption={(value) => void deleteOption("model", value)} /></UiProps>
                            <UiProps ids={{"placeholder":["settings.md0835da5fdb6"]}}><input value={group.tags} onChange={(event) => updateQueuedGroup(group.id, { tags: event.target.value })} placeholder="settings.md0835da5fdb6" className="h-8 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-[12px] outline-none focus:border-blue-500/50" /></UiProps>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-muted)]">
                            <span>{group.files.length}<UiText id="settings.me9e0fdc242b4" /></span>
                            {group.status === "uploading" ? <span className="text-blue-500"><UiText id="settings.m403b055e56f5" /></span> : null}
                            {group.status === "done" ? <span className="text-emerald-500"><UiText id="settings.mf28461bb49c8" /></span> : null}
                            {group.status === "error" ? <span className="text-rose-500"><UiText id="settings.m28384d7afd2e" /></span> : null}
                            {group.note ? <span className={group.status === "error" ? "text-rose-500" : "text-amber-500"}>{group.note}</span> : null}
                          </div>
                        </div>
                        <UiProps ids={{"title":["settings.m620566cd1af2"]}}><button type="button" disabled={uploading} onClick={() => setGroupQueue((prev) => prev.filter((row) => row.id !== group.id))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-rose-500/10 hover:text-rose-500 disabled:pointer-events-none disabled:opacity-45" title="settings.m620566cd1af2">
                          <X className="h-4 w-4" />
                        </button></UiProps>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-[var(--border)] px-6 py-4">
              {error ? <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-400">{uiError(error)}</div> : null}
              {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-500">{uiError(message)}</div> : null}
              {uploading ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                    <span><UiText id="settings.m3b91af90e9a2" />{uploadDone}/{uploadTotal}</span>
                    <span>{uploadTotal ? Math.round((uploadDone / uploadTotal) * 100) : 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-3)]">
                    <div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${uploadTotal ? Math.round((uploadDone / uploadTotal) * 100) : 0}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button type="button" disabled={uploading} onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"><UiText id="settings.m2cd0f3be8738" /></button>
                <button type="button" disabled={uploading || ingesting || (uploadMode === "group" ? !files.length && !groupQueue.length : !files.length)} onClick={() => void upload()} className="inline-flex h-10 min-w-[148px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-[13px] font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-[var(--panel-3)] disabled:text-[var(--app-muted)] disabled:shadow-none">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {uploading
                    ? <UiText id="settings.m4bcdd28be132" values={{v0: String(uploadDone), v1: String(uploadTotal)}} />
                    : uploadMode === "group" && groupQueue.length
                      ? <UiText id="settings.me20e2b5897b6" values={{v0: String(groupQueue.length)}} />
                      : <UiText id="settings.m221cff25b791" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
