"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { createPortal } from "react-dom";
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  History,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";
import { ResilientImage, warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { SuggestSelect } from "@/components/ui/suggest-select";
import { buildMediaOriginalUrl, buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";
import { MATERIAL_ASSET_UNCATEGORIZED } from "@/lib/material-assets";
import { getWarmParams } from "@/lib/image-cache-config";
import { useAutoPaginate } from "@/hooks/use-auto-paginate";

/* ─── 上传字段历史（localStorage）：分类 / 制作人 / 标签 填过即记，下次可直接下拉选 ─── */
const UPLOAD_HISTORY_KEY = "material-upload-history:v1";
const UPLOAD_HISTORY_LIMIT = 30;
type UploadHistory = { tags: string[] };
const EMPTY_UPLOAD_HISTORY: UploadHistory = { tags: [] };

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

type DownloadRecord = {
  id: number;
  userId: number;
  username: string;
  downloadedAt: string;
};

type MaterialMediaItem = {
  id: string;
  originalUrl: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  mime?: string | null;
  size?: number | null;
  fileKey?: string;
};

type MaterialAsset = {
  id: number;
  category: string | null;
  title: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  tags?: string[];
  creatorName?: string | null;
  modelName?: string | null;
  inspiration?: string | null;
  createdAt: string;
  selectedBy?: { id: number; username: string; selectedAt: string | null; selectedMediaId?: string | null } | null;
  selectedMediaId?: string | null;
  mediaCount?: number;
  mediaItems?: MaterialMediaItem[];
  isSelected?: boolean;
  downloadCount?: number;
  recentDownloads?: DownloadRecord[];
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

type StatusFilter = "all" | "available" | "selected";
type ModelGroup = { category: string; models: string[] };
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
type FolderUploadFile = {
  file: File;
  path: string;
};

const PAGE_SIZE = 48;
const GROUP_MEDIA_LIMIT = 15;
const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "available", label: "未被选中" },
  { key: "selected", label: "已被选中" },
];

function formatTime(raw?: string | null) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function localYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const ASSET_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
// 素材上传日（本地 yyyy-mm-dd），用于按天分组
function assetDayKey(raw?: string | null): string {
  if (!raw) return "未知";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "未知";
  return localYmd(d);
}
// 日期分组头展示：日期 + 今天/昨天/星期
function dayHeaderParts(key: string): { date: string; rel: string } {
  if (!key || key === "未知") return { date: "未知日期", rel: "" };
  const today = localYmd(new Date());
  const yesterday = localYmd(new Date(Date.now() - 86400000));
  const d = new Date(`${key}T00:00:00`);
  const weekday = Number.isNaN(d.getTime()) ? "" : ASSET_WEEKDAYS[d.getDay()];
  const rel = key === today ? "今天" : key === yesterday ? "昨天" : weekday;
  return { date: key, rel };
}

function formatSize(n?: number | null) {
  const size = Number(n || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

// 文件身份 key：用于把"上传失败原因"绑定到具体文件，在已选列表里逐条显示
function fileKey(f: File) {
  return `${f.name}_${f.size}_${f.lastModified}`;
}

// 可上传的素材后缀（与文件选择框 accept 保持一致：图片 + 视频）
const MATERIAL_ACCEPT_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "mp4", "webm", "mov", "mkv"];
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
// 把传入文件展开：zip → 解包出其中的图片/视频；普通文件 → 按后缀过滤
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
        // 解压失败：跳过该压缩包
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

function previewCandidates(item: MaterialAsset, size = 600) {
  const rawCandidates = [item.previewUrl, item.imageUrl, item.thumbnailUrl].filter(Boolean);
  return Array.from(
    new Set(
      rawCandidates
        .flatMap((raw) => buildMediaPreviewCandidates(raw, { width: size, height: size, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

// 网格卡片只有 ~300px，按高分屏取 600 档即可。素材的 previewUrl 是上传时生成的 1280 大图，
// 且 buildMediaPreviewCandidates 对“已生成展示资源”会原样返回、忽略尺寸——直接用等于给每个
// 小格子下载约 4 倍像素的大图。改成用原图按 600 档生成缩略图（本地走 /api/thumb 落盘 immutable
// 缓存，首拉后永久命中），显示在网格里同样清晰；600 拿不到再回退到原有候选。
function cardImageCandidates(item: MaterialAsset) {
  const sized = buildMediaPreviewCandidates(item.imageUrl, { width: 600, height: 600, mode: "cover" })
    .map((url) => buildMediaProxyUrl(url) || url)
    .filter(Boolean);
  return Array.from(new Set([...sized, ...previewCandidates(item, 600)]));
}

function mediaItemsForAsset(item: MaterialAsset): MaterialMediaItem[] {
  if (Array.isArray(item.mediaItems) && item.mediaItems.length) return item.mediaItems;
  return [
    {
      id: item.selectedMediaId || `asset-${item.id}-cover`,
      originalUrl: item.imageUrl,
      thumbnailUrl: item.thumbnailUrl,
      previewUrl: item.previewUrl,
      mime: item.mimeType,
      size: item.sizeBytes,
    },
  ];
}

function previewCandidatesForMedia(media: MaterialMediaItem, size = 600) {
  const rawCandidates = [media.previewUrl, media.thumbnailUrl, media.originalUrl].filter(Boolean);
  return Array.from(
    new Set(
      rawCandidates
        .flatMap((raw) => buildMediaPreviewCandidates(raw, { width: size, height: size, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

function originalHref(item: MaterialAsset) {
  const raw = buildMediaOriginalUrl(item.imageUrl || item.previewUrl || item.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function originalHrefForMedia(media: MaterialMediaItem) {
  return buildMediaOriginalUrl(media.originalUrl || media.previewUrl || media.thumbnailUrl || "");
}

function responseFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

async function downloadAdminMaterial(assetId: number, mode: "current" | "series", mediaId?: string) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (mode === "current" && mediaId) params.set("mediaId", mediaId);
  const response = await fetch(`/api/admin/material-assets/${assetId}/download?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || "下载失败");
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = responseFileName(response, mode === "series" ? `material-${assetId}.zip` : `material-${assetId}`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

function isMaterialAssetVideo(item: MaterialAsset, src?: string | null) {
  return Boolean(
    String(item.mimeType || "").toLowerCase().startsWith("video/") ||
      isVideoMediaUrl(src || item.imageUrl || item.previewUrl || item.thumbnailUrl || "")
  );
}

function warmAdminMaterialPreviewBatch(list: MaterialAsset[]) {
  if (!list.length) return;
  const params = getWarmParams("library");
  if (!params) return;
  // 只预热首屏高优先级卡片；其余卡片交给虚拟列表与原生 lazy 按需加载。
  const groups = list.slice(0, 12).map((item) =>
    isMaterialAssetVideo(item) ? previewCandidates(item, 600) : cardImageCandidates(item)
  );
  warmResilientImageCandidatesBatch(groups, params);
}

/* ─── Custom category select dropdown ─── */
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
    // 当输入值正好等于已选分类时（刚打开下拉、用户还没输入新关键字），
    // 不做过滤，展示全部分类供切换。
    if (options.some((o) => o.toLowerCase() === kw)) return options;
    return options.filter((o) => o.toLowerCase().includes(kw));
  }, [inputValue, options]);

  const showCreate =
    inputValue.trim().length > 0 &&
    !options.some((o) => o.toLowerCase() === inputValue.trim().toLowerCase());

  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  // 用 useLayoutEffect 在浏览器 paint 前算好位置，避免首次打开时
  // 先以默认 static 定位渲染一帧再跳到正确位置导致的视觉错位。
  // SSR 环境下退化为 useEffect 以避免告警。
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
      // 同时锚定 left 和 right，避免 width 计算偏差导致下拉框比触发器宽。
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        right: Math.max(0, window.innerWidth - rect.right),
        zIndex: 200,
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
            // 聚焦时若内容是已选分类，自动全选，方便直接输入新分类名覆盖
            if (inputValue && options.some((o) => o === inputValue)) {
              e.currentTarget.select();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[13px] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]"
        />
        {inputValue ? (
          <UiProps ids={{"title":["admin.m1ef3de06b32e"]}}><button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setInputValue("");
              onChange("");
              setOpen(true);
            }}
            title="admin.m1ef3de06b32e"
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
                    {createLabel ? uiLabel(createLabel(inputValue.trim())) : <UiText id="admin.m0b02ae6cae13" values={{v0: String(inputValue.trim())}} />}
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

/* ─── Page ─── */
export default function AdminMaterialAssetsPage() {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const [items, setItems] = React.useState<MaterialAsset[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [activeCategory, setActiveCategory] = React.useState("all");
  // 作者筛选：选项从已上传素材的 creatorName 自动收集，"unsigned" 表示未署名
  const [creators, setCreators] = React.useState<string[]>([]);
  const [models, setModels] = React.useState<string[]>([]);
  const [modelGroups, setModelGroups] = React.useState<ModelGroup[]>([]);
  const [activeModelName, setActiveModelName] = React.useState("");
  const [hasUncategorized, setHasUncategorized] = React.useState<boolean | null>(null);
  const [activeCreator, setActiveCreator] = React.useState("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  // 按上传时间筛选（yyyy-mm-dd，本地时区；空 = 不限）
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [pagination, setPagination] = React.useState<Pagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [loading, setLoading] = React.useState(true);
  const filterKey = JSON.stringify([activeCategory, activeCreator, activeModelName, status, debouncedQuery, dateFrom, dateTo]);
  const [loadedFilterKey, setLoadedFilterKey] = React.useState<string | null>(null);
  const itemsRequestRef = React.useRef(0);
  const filterResultsReady = !loading && loadedFilterKey === filterKey && query.trim() === debouncedQuery;
  // 首次加载完成后置 true。后续切换筛选/搜索时只静默重取，不再展示骨架，
  // 避免画面在 skeleton ⇄ 空态 / 结果 间反复跳动。
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  // 上传进度：逐个文件顺序上传，按"已完成 / 总数"显示真实进度
  const [uploadDone, setUploadDone] = React.useState(0);
  const [uploadTotal, setUploadTotal] = React.useState(0);
  // 每个文件的失败原因（key = 文件名_大小_修改时间），用于在已选列表里逐条标红显示原因
  const [failedReasons, setFailedReasons] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [categoryDraft, setCategoryDraft] = React.useState("");
  const [tagDraft, setTagDraft] = React.useState("");
  const [titleDraft, setTitleDraft] = React.useState("");
  const [creatorNameDraft, setCreatorNameDraft] = React.useState("");
  const [modelNameDraft, setModelNameDraft] = React.useState("");
  const [uploadHistory, setUploadHistory] = React.useState<UploadHistory>(EMPTY_UPLOAD_HISTORY);
  React.useEffect(() => {
    setUploadHistory(readUploadHistory());
  }, []);
  const categoryOptions = React.useMemo(() => dedupStrings(categories), [categories]);
  const creatorOptions = React.useMemo(() => dedupStrings(creators), [creators]);
  const modelOptions = React.useMemo(() => dedupStrings(models), [models]);
  const [files, setFiles] = React.useState<File[]>([]);
  const [groupQueue, setGroupQueue] = React.useState<UploadGroupDraft[]>([]);
  const [uploadMode, setUploadMode] = React.useState<"single" | "group">("single");
  const [coverIndex, setCoverIndex] = React.useState(0);
  // 哪个拖放区正被拖入（folder=总文件夹框，files=图片/zip 框）；用于只高亮鼠标所在的那个框
  const [dragZone, setDragZone] = React.useState<"folder" | "files" | null>(null);
  const [ingesting, setIngesting] = React.useState(false);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);
  const [selectingDay, setSelectingDay] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MaterialAsset | null>(null);
  const [batchDeleteTarget, setBatchDeleteTarget] = React.useState<"selected" | "filtered" | null>(null);
  const mainScrollRef = React.useRef<HTMLElement | null>(null);
  const dateSelectionRequestRef = React.useRef(0);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const handleCategoryChange = React.useCallback((category: string) => {
    setActiveCategory(category);
    setActiveModelName("");
  }, []);

  const handleModelChange = React.useCallback((category: string, modelName: string) => {
    setActiveCategory(category);
    setActiveModelName((current) => (current === modelName ? "" : modelName));
  }, []);

  const fetchItems = React.useCallback(
    async (page = 1, mode: "replace" | "append" = "replace") => {
      const requestId = ++itemsRequestRef.current;
      if (mode === "replace") setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
      params.set("includeOptions", mode === "append" ? "0" : "1");
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (activeCategory === "uncategorized") params.set("category", MATERIAL_ASSET_UNCATEGORIZED);
      else if (activeCategory !== "all") params.set("category", activeCategory);
      if (activeModelName) params.set("modelName", activeModelName);
      if (activeCreator === "unsigned") params.set("creator", "__unsigned__");
      else if (activeCreator !== "all") params.set("creator", activeCreator);
      // 上传时间区间：把本地日期换算成 ISO 边界，时区无关地交给后端比较 createdAt
      if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59.999`).toISOString());
      try {
        const res = await fetch(`/api/admin/material-assets?${params.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as {
          items?: MaterialAsset[];
          categories?: string[];
          creators?: string[];
          models?: string[];
          modelGroups?: ModelGroup[];
          hasUncategorized?: boolean;
          pagination?: Pagination;
          error?: string;
        } | null;
        if (requestId !== itemsRequestRef.current) return false;
        if (!res.ok) throw new Error(json?.error || "加载素材失败");
        const nextItems = Array.isArray(json?.items) ? json!.items! : [];
        setItems((prev) => (mode === "append" ? [...prev, ...nextItems] : nextItems));
        warmAdminMaterialPreviewBatch(nextItems);
        if (mode === "replace") {
          if (Array.isArray(json?.categories)) setCategories(json!.categories!);
          if (Array.isArray(json?.creators)) setCreators(json!.creators!);
          if (Array.isArray(json?.models)) setModels(json!.models!);
          if (Array.isArray(json?.modelGroups)) setModelGroups(json!.modelGroups!);
          if (typeof json?.hasUncategorized === "boolean") setHasUncategorized(json.hasUncategorized);
        }
        setPagination(
          json?.pagination || { page, pageSize: PAGE_SIZE, total: nextItems.length, totalPages: 1, hasMore: false }
        );
        setLoadedFilterKey(filterKey);
        return true;
      } catch (err: any) {
        if (requestId !== itemsRequestRef.current) return false;
        setLoadedFilterKey(null);
        setError(String(err?.message || "加载素材失败"));
        return false;
      } finally {
        if (requestId === itemsRequestRef.current) {
          setLoading(false);
          setHasLoadedOnce(true);
        }
      }
    },
    [activeCategory, activeCreator, activeModelName, debouncedQuery, status, dateFrom, dateTo, filterKey]
  );

  React.useEffect(() => {
    void fetchItems(1, "replace");
  }, [fetchItems]);

  React.useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [activeCategory, activeCreator, activeModelName, debouncedQuery, status, dateFrom, dateTo]);

  React.useEffect(() => {
    dateSelectionRequestRef.current += 1;
    setSelectingDay(null);
    setSelectedIds([]);
  }, [activeCategory, activeCreator, activeModelName, debouncedQuery, status, dateFrom, dateTo]);

  React.useEffect(() => {
    if (activeCategory === "uncategorized" && hasUncategorized === false) {
      setActiveCategory("all");
      setActiveModelName("");
    }
  }, [activeCategory, hasUncategorized]);

  React.useEffect(() => {
    if (!activeModelName) return;
    const group = modelGroups.find((item) => item.category === activeCategory);
    if (!group?.models.includes(activeModelName)) setActiveModelName("");
  }, [activeCategory, activeModelName, modelGroups]);

  React.useEffect(() => {
    if (selectionMode) return;
    dateSelectionRequestRef.current += 1;
    setSelectingDay(null);
  }, [selectionMode]);

  React.useEffect(() => {
    setCoverIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, files.length - 1)));
  }, [files.length]);

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
          const res = await fetch("/api/admin/material-assets/upload", { method: "POST", body: form });
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(json?.error || "系列图上传失败");
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
        setCreatorNameDraft("");
        setCoverIndex(0);
      }
      await fetchItems(1, "replace");
      setUploading(false);
      return;
    }
    // 逐个文件上传：服务器对每张图要落盘+缩略图+入库，单请求整批传时客户端看不到处理到第几张；
    // 拆成一张一个请求后，每张完成就推进进度，得到真实的"已上传 X/N"。
    const queue = [...files];
    const total = queue.length;
    setUploadTotal(total);
    setUploadDone(0);
    setFailedReasons({});

    let success = 0;
    const failed: File[] = [];
    const reasons: Record<string, string> = {};

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
        const res = await fetch("/api/admin/material-assets/upload", { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "系列图上传失败");
        setUploadDone(queue.length);
        setFiles([]);
        setFailedReasons({});
        setTitleDraft("");
        setCreatorNameDraft("");
        setCoverIndex(0);
        setMessage(`已上传 1 组素材，共 ${queue.length} 张`);
        setUploadHistory(recordUploadHistory({ tags: parseTagList(tagDraft) }));
        await fetchItems(1, "replace");
      } catch (err: any) {
        setError(String(err?.message || "系列图上传失败"));
      } finally {
        setUploading(false);
      }
      return;
    }

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
        const res = await fetch("/api/admin/material-assets/upload", { method: "POST", body: form });
        let json: { error?: string } | null = null;
        try {
          json = await res.json();
        } catch {}
        if (!res.ok) {
          // 服务器返回 JSON 错误就用它；413/网关层拦截等非 JSON 情况给出可读兜底
          throw new Error(
            json?.error ||
              (res.status === 413 ? "文件过大，被服务器拒绝接收" : `上传失败（HTTP ${res.status}）`)
          );
        }
        success += 1;
      } catch (err: any) {
        const raw = String(err?.message || "上传失败");
        // 服务端校验错误已带文件名前缀（如「xxx.png：文件过大…」），逐条显示时去掉冗余前缀
        const reason = raw.startsWith(`${file.name}：`) ? raw.slice(file.name.length + 1) : raw;
        failed.push(file);
        reasons[fileKey(file)] = reason;
      } finally {
        setUploadDone(i + 1);
      }
    }

    // 成功的从列表移除，失败的保留下来并标红显示原因，方便修正后重试
    setFiles(failed);
    setFailedReasons(reasons);
    if (failed.length === 0) {
      setMessage(`已上传 ${success} 张素材`);
      setTitleDraft("");
      setCreatorNameDraft("");
    } else {
      setError(`成功 ${success} 张，失败 ${failed.length} 张：失败文件已在下方标红并注明原因，可修正后重试`);
    }
    if (success > 0) {
      setUploadHistory(recordUploadHistory({ tags: parseTagList(tagDraft) }));
    }
    await fetchItems(1, "replace");
    setUploading(false);
  }, [categoryDraft, coverIndex, creatorNameDraft, fetchItems, files, groupQueue, modelNameDraft, tagDraft, titleDraft, uploadMode, uploading]);

  const remove = React.useCallback(async () => {
    const item = deleteTarget;
    if (!item) return false;
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/material-assets/${item.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "删除素材失败");
      setSelectedIds((prev) => prev.filter((id) => id !== item.id));
      setMessage("素材已删除");
      await fetchItems(1, "replace");
      return true;
    } catch (err: any) {
      setError(String(err?.message || "删除素材失败"));
      return false;
    } finally {
      setBusyId(null);
    }
  }, [deleteTarget, fetchItems]);

  const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const currentPageAllSelected = items.length > 0 && items.every((item) => selectedIdSet.has(item.id));

  const toggleAssetSelected = React.useCallback((item: MaterialAsset) => {
    setSelectedIds((prev) => {
      if (prev.includes(item.id)) return prev.filter((id) => id !== item.id);
      return [...prev, item.id];
    });
  }, []);

  const toggleCurrentPageSelection = React.useCallback(() => {
    const ids = items.map((item) => item.id);
    setSelectedIds((prev) => {
      if (ids.length && ids.every((id) => prev.includes(id))) {
        return prev.filter((id) => !ids.includes(id));
      }
      return Array.from(new Set([...prev, ...ids]));
    });
  }, [items]);

  const toggleDateGroupSelection = React.useCallback(async (dayKey: string) => {
    if (dayKey === "未知") return;

    const requestId = dateSelectionRequestRef.current + 1;
    dateSelectionRequestRef.current = requestId;
    setSelectingDay(dayKey);
    setError("");

    const params = new URLSearchParams({ idsOnly: "1", status });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (activeCategory === "uncategorized") params.set("category", MATERIAL_ASSET_UNCATEGORIZED);
    else if (activeCategory !== "all") params.set("category", activeCategory);
    if (activeModelName) params.set("modelName", activeModelName);
    if (activeCreator === "unsigned") params.set("creator", "__unsigned__");
    else if (activeCreator !== "all") params.set("creator", activeCreator);
    params.set("dateFrom", new Date(`${dayKey}T00:00:00`).toISOString());
    params.set("dateTo", new Date(`${dayKey}T23:59:59.999`).toISOString());

    try {
      const res = await fetch(`/api/admin/material-assets?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { ids?: unknown; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "加载日期素材失败");
      const ids = Array.isArray(json?.ids)
        ? json.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (dateSelectionRequestRef.current !== requestId || !ids.length) return;
      setSelectedIds((prev) => {
        const allSelected = ids.every((id) => prev.includes(id));
        return allSelected
          ? prev.filter((id) => !ids.includes(id))
          : Array.from(new Set([...prev, ...ids]));
      });
    } catch (err: any) {
      if (dateSelectionRequestRef.current === requestId) {
        setError(String(err?.message || "加载日期素材失败"));
      }
    } finally {
      if (dateSelectionRequestRef.current === requestId) setSelectingDay(null);
    }
  }, [activeCategory, activeCreator, activeModelName, debouncedQuery, status]);

  const batchDelete = React.useCallback(async () => {
    const target = batchDeleteTarget;
    if (!target) return false;
    if (target === "filtered" && !filterResultsReady) return false;
    if (target === "selected" && selectedIds.length === 0) return false;
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> =
        target === "selected"
          ? { ids: selectedIds }
          : {
              scope: "filtered",
              category:
                activeCategory === "uncategorized"
                  ? MATERIAL_ASSET_UNCATEGORIZED
                  : activeCategory !== "all"
                    ? activeCategory
                    : "",
              creator:
                activeCreator === "unsigned"
                  ? "__unsigned__"
                  : activeCreator !== "all"
                    ? activeCreator
                    : "",
              modelName: activeModelName,
              status,
              q: debouncedQuery,
              dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : "",
              dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : "",
            };
      const res = await fetch("/api/admin/material-assets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { count?: number; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "批量删除素材失败");
      setSelectedIds([]);
      setSelectionMode(false);
      setMessage(`已删除 ${Number(json?.count || 0)} 个素材`);
      await fetchItems(1, "replace");
      return true;
    } catch (err: any) {
      setError(String(err?.message || "批量删除素材失败"));
      return false;
    }
  }, [activeCategory, activeCreator, activeModelName, batchDeleteTarget, dateFrom, dateTo, debouncedQuery, fetchItems, selectedIds, status, filterResultsReady]);

  const [releaseTarget, setReleaseTarget] = React.useState<MaterialAsset | null>(null);
  const [releaseReason, setReleaseReason] = React.useState("");
  const [previewItem, setPreviewItem] = React.useState<MaterialAsset | null>(null);
  const [previewMediaIndex, setPreviewMediaIndex] = React.useState(0);
  const [downloadBusy, setDownloadBusy] = React.useState<"current" | "series" | null>(null);
  const [editTarget, setEditTarget] = React.useState<MaterialAsset | null>(null);

  // 打开二次确认弹窗（替代原来的 window.prompt）
  const releaseSelection = React.useCallback((item: MaterialAsset) => {
    setReleaseReason("");
    setError("");
    setMessage("");
    setReleaseTarget(item);
  }, []);

  const confirmRelease = React.useCallback(async () => {
    const item = releaseTarget;
    if (!item) return;
    const reason = releaseReason.trim();
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/material-assets/${item.id}/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "重新上架素材失败");
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, selectedBy: null, isSelected: false } : row)));
      setMessage("素材已重新上架，原挑选记录已保留。");
      setReleaseTarget(null);
    } catch (err: any) {
      setError(String(err?.message || "重新上架素材失败"));
    } finally {
      setBusyId(null);
    }
  }, [releaseTarget, releaseReason]);

  const openPreview = React.useCallback(async (item: MaterialAsset) => {
    setPreviewMediaIndex(0);
    setPreviewItem(item);
    try {
      const res = await fetch(`/api/admin/material-assets/${item.id}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { item?: MaterialAsset } | null;
      if (!res.ok || !json?.item) return;
      setPreviewItem(json.item);
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, ...json.item } : row)));
    } catch {
      // Preview can still fall back to list data.
    }
  }, []);

  const previewMediaItems = React.useMemo(() => (previewItem ? mediaItemsForAsset(previewItem) : []), [previewItem]);
  const safePreviewMediaIndex = Math.min(previewMediaIndex, Math.max(0, previewMediaItems.length - 1));
  const previewMedia = previewMediaItems[safePreviewMediaIndex] || null;
  const previewSrc = previewMedia ? originalHrefForMedia(previewMedia) : previewItem ? originalHref(previewItem) : null;
  const previewKind: "image" | "video" =
    previewItem && isMaterialAssetVideo(previewItem, previewSrc || undefined) ? "video" : "image";

  const runDownload = React.useCallback(async (mode: "current" | "series", mediaId?: string) => {
    if (!previewItem || downloadBusy) return;
    if (mode === "current" && !mediaId) {
      setError("当前素材图片不存在，请刷新后重试");
      return;
    }
    setDownloadBusy(mode);
    setError("");
    try {
      await downloadAdminMaterial(previewItem.id, mode, mediaId);
    } catch (downloadError: any) {
      setError(String(downloadError?.message || "下载失败"));
    } finally {
      setDownloadBusy(null);
    }
  }, [downloadBusy, previewItem]);

  React.useEffect(() => {
    setPreviewMediaIndex((prev) => Math.min(prev, Math.max(0, previewMediaItems.length - 1)));
  }, [previewMediaItems.length]);

  const selectedCount = items.filter((item) => item.isSelected).length;
  // 是否有任意筛选条件生效：用于区分“素材库真的空”和“只是筛选没命中”
  const hasActiveFilter =
    activeCategory !== "all" ||
    activeCreator !== "all" ||
    Boolean(activeModelName) ||
    status !== "all" ||
    debouncedQuery.trim() !== "" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);
  const batchDeleteCount = batchDeleteTarget === "selected" ? selectedIds.length : pagination.total;
  const batchDeleteDescription =
    batchDeleteTarget === "selected"
      ? `将删除已勾选的 ${batchDeleteCount} 个素材。删除后素材记录会下架，关联的本地文件会在确认未被其他记录引用后清理。`
      : `将删除当前筛选条件下的全部 ${batchDeleteCount} 个素材。删除后素材记录会下架，关联的本地文件会在确认未被其他记录引用后清理。`;
  const autoPagination = useAutoPaginate({
    scrollRef: mainScrollRef,
    enabled: hasLoadedOnce && !loading,
    hasMore: pagination.hasMore,
    currentPage: pagination.page,
    loadPage: (page) => fetchItems(page, "append"),
  });

  return (
    <AtomicPageReveal ready={hasLoadedOnce}>
    <main ref={mainScrollRef} onScroll={autoPagination.onScroll} className="flex-1 overflow-auto bg-[var(--app-bg)] text-[var(--app-fg)]">
      <UiProps ids={{"title":["admin.mbb657b83d9d6"],"confirmText":["admin.ma3ea3c17b401"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={deleteTarget !== null}
        title="admin.mbb657b83d9d6"
        description={deleteTarget ? `确定删除素材「${deleteTarget.title}」？删除后不可恢复。` : ""}
        confirmText="admin.ma3ea3c17b401"
        cancelText="admin.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      /></UiProps>
      <UiProps ids={{"title":["admin.mf5ec75a722cf","admin.m3de25e3694e4"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={batchDeleteTarget !== null}
        title={batchDeleteTarget === "selected" ? "admin.mf5ec75a722cf" : "admin.m3de25e3694e4"}
        description={batchDeleteDescription}
        confirmText={tLabel(`删除 ${batchDeleteCount} 项`)}
        cancelText="admin.m2cd0f3be8738"
        danger
        onClose={() => setBatchDeleteTarget(null)}
        onConfirm={batchDelete}
      /></UiProps>
      {releaseTarget ? (
        <div className="fixed inset-0 z-[120] grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { if (busyId === null) setReleaseTarget(null); }}
          />
          <div className="relative w-full max-w-[520px] rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)] p-5">
            <div className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mf8347f9a9dcc" /></div>
            <div className="mt-3 whitespace-pre-wrap break-words text-[13px] text-[var(--app-muted)]">
              {<UiText id="admin.m3c2d8a0b6a1c" values={{v0: String(releaseTarget.title)}} />}
            </div>
            <div className="mt-4 space-y-2">
              <label className="block text-xs font-medium text-[var(--app-fg)]"><UiText id="admin.m52e9595aa55d" /></label>
              <UiProps ids={{"placeholder":["admin.ma9922e7dd763"]}}><textarea
                value={releaseReason}
                onChange={(event) => setReleaseReason(event.target.value)}
                rows={3}
                placeholder="admin.ma9922e7dd763"
                className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
              /></UiProps>
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => setReleaseTarget(null)}
                className="h-9 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50 disabled:pointer-events-none transition"
              ><UiText id="admin.m2cd0f3be8738" /></button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void confirmRelease()}
                className="h-9 px-4 rounded-xl bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-500 disabled:opacity-50 disabled:pointer-events-none transition"
              >
                {busyId === releaseTarget.id ? <UiText id="admin.m39a8d885eb2f" /> : <UiText id="admin.m2381510341cf" />}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--app-bg)]/95 backdrop-blur-sm">
        <div className="w-full px-5 py-3">
          {/* Title row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
                  <h1 className="text-[15px] font-semibold tracking-tight"><UiText id="admin.m25f78d016636" /></h1>
                  <span className="hidden text-[12px] text-[var(--app-muted)] sm:inline"><UiText id="admin.mdcb8c1c55706" /></span>
                </div>
                <p className="hidden text-[11px] leading-5 text-[var(--app-muted)] sm:block"><UiText id="admin.m1245171494e4" /></p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <UiProps ids={{"label":["admin.me8dc871a7fde"]}}><StatChip label="admin.me8dc871a7fde" value={pagination.total} /></UiProps>
              <UiProps ids={{"label":["admin.m7ecf1cde6486"]}}><StatChip label="admin.m7ecf1cde6486" value={selectedCount} accent /></UiProps>
              <UiProps ids={{"label":["admin.m515559957fd3"]}}><StatChip label="admin.m515559957fd3" value={categories.length} /></UiProps>
              <button
                type="button"
                onClick={() => {
                  if (selectionMode) setSelectedIds([]);
                  setSelectionMode(!selectionMode);
                }}
                className={[
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition",
                  selectionMode
                    ? "border-blue-500/30 bg-blue-500/12 text-blue-500"
                    : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)]",
                ].join(" ")}
              >
                {selectionMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                {selectionMode ? <UiText id="admin.m4fbb4458eb2a" /> : <UiText id="admin.m461e085d5ca2" />}
              </button>
              {selectionMode ? (
                <>
                  <button
                    type="button"
                    disabled={!items.length}
                    onClick={toggleCurrentPageSelection}
                    className="inline-flex h-8 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-45"
                  >
                    {currentPageAllSelected ? <UiText id="admin.m530a2306a03a" /> : <UiText id="admin.mbd082d9acb40" />}
                  </button>
                  <button
                    type="button"
                    disabled={!selectedIds.length}
                    onClick={() => setBatchDeleteTarget("selected")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 text-[12px] font-medium text-rose-600 transition hover:bg-rose-500/15 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Trash2 className="h-3.5 w-3.5" /><UiText id="admin.mf123a39570b9" />{selectedIds.length}<UiText id="admin.mf9d529eacdf3" /></button>
                </>
              ) : null}
              <UiProps ids={{"title":["admin.m4fcf8d5c2cc0","admin.mccb1e50e3529"]}}><button
                type="button"
                disabled={!filterResultsReady || !pagination.total}
                title={filterResultsReady ? "admin.m4fcf8d5c2cc0" : "admin.mccb1e50e3529"}
                onClick={() => setBatchDeleteTarget("filtered")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-rose-500 disabled:pointer-events-none disabled:opacity-45"
              >
                <Trash2 className="h-3.5 w-3.5" /><UiText id="admin.m3de25e3694e4" />{filterResultsReady ? <UiText id="admin.mb28a9fa0a0fd" values={{v0: String(pagination.total)}} /> : ""}
              </button></UiProps>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-500 px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-blue-600"
              >
                <UploadCloud className="h-3.5 w-3.5" /><UiText id="admin.m493ee58f81f5" /></button>
            </div>
          </div>

          {/* Filter row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <UiProps ids={{"label":["admin.m5c55a67935af"]}}><CategoryTabBtn active={activeCategory === "all"} label="admin.m5c55a67935af" onClick={() => handleCategoryChange("all")} /></UiProps>
              {categories.map((cat) => (
                <CategoryTabBtn key={cat} active={activeCategory === cat} label={cat} onClick={() => handleCategoryChange(cat)} />
              ))}
              {hasUncategorized === true ? (
                <UiProps ids={{"label":["admin.m54b89f901274"]}}><CategoryTabBtn
                  active={activeCategory === "uncategorized"}
                  label="admin.m54b89f901274"
                  onClick={() => handleCategoryChange("uncategorized")}
                /></UiProps>
              ) : null}
            </div>
            <AdminMaterialsFilterPanel
              status={status}
              creators={creators}
              activeCreator={activeCreator}
              activeCategory={activeCategory}
              activeModelName={activeModelName}
              modelGroups={modelGroups}
              onStatusChange={setStatus}
              onCreatorChange={setActiveCreator}
              onModelChange={handleModelChange}
              onClear={() => {
                setStatus("all");
                setActiveCreator("all");
                setActiveModelName("");
              }}
            />
            {/* 按上传时间筛选：自定义起止 */}
            <DateRangePicker from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
            <div className="relative w-full sm:w-48">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-muted)]" />
              <UiProps ids={{"placeholder":["admin.mf8c860a4c698"]}}><input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="admin.mf8c860a4c698"
                className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] pl-8 pr-3 text-[12px] outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
              /></UiProps>
            </div>
            <UiProps ids={{"title":["admin.maee887434131"]}}><button
              type="button"
              onClick={() => void fetchItems(1, "replace")}
              title="admin.maee887434131"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            >
              <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} />
            </button></UiProps>
          </div>
        </div>
      </div>

      {/* Grid area */}
      <div className="w-full px-5 py-5">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-400">
            {uiError(error)}
          </div>
        ) : null}
        {message ? (
          <div className="mb-4 rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-3 text-[13px] text-blue-500">
            {uiError(message)}
          </div>
        ) : null}

        {loading && !hasLoadedOnce ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]">
                <div className="aspect-[3/4] animate-pulse bg-[var(--panel-2)]" />
                <div className="space-y-1.5 p-2.5">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--panel-2)]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--panel-2)]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length ? (
          <>
            <VirtualAdminAssetGrid
              items={items}
              busyId={busyId}
              scrollTop={autoPagination.scrollTop}
              viewportHeight={autoPagination.viewportHeight}
              selectionMode={selectionMode}
              selectedIds={selectedIdSet}
              selectingDay={selectingDay}
              onPreview={(item) => void openPreview(item)}
              onToggleSelect={(item) => toggleAssetSelected(item)}
              onToggleDateSelection={(dayKey) => void toggleDateGroupSelection(dayKey)}
              onDelete={setDeleteTarget}
              onRelease={(item) => void releaseSelection(item)}
            />
            {autoPagination.failedAppendPage ? (
              <div className="flex justify-center py-8">
                <button
                  type="button"
                  onClick={() => void autoPagination.retryAppend()}
                  disabled={autoPagination.appendInFlight}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-5 text-[13px] transition hover:bg-[var(--panel-3)]"
                >
                  {autoPagination.appendInFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}<UiText id="admin.m8924c7887461" /></button>
              </div>
            ) : autoPagination.appendInFlight ? (
              <div className="flex justify-center py-8 text-[12px] text-[var(--app-muted)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /><UiText id="admin.mb3cb3861e481" /></div>
            ) : !pagination.hasMore ? (
              <p className="py-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" />{pagination.total}<UiText id="admin.m4aa5fdba2ac7" /></p>
            ) : null}
          </>
        ) : (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)]">
            <ImageIcon className="h-10 w-10 text-[var(--app-muted)]/40" />
            {hasActiveFilter ? (
              // 因筛选而空：不是没素材，是当前条件没命中——别再引导“上传”
              <p className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.me8f2ba6bb4f9" /></p>
            ) : (
              // 素材库真的空：保留首次上传引导
              <>
                <p className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m8f7af3e1678b" /></p>
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-500 px-4 text-[13px] font-medium text-white transition hover:bg-blue-600"
                >
                  <UploadCloud className="h-4 w-4" /><UiText id="admin.m36be85bac93d" /></button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Upload modal */}
      {uploadOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onMouseDown={() => {
            if (!uploading) setUploadOpen(false);
          }}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-[#fbfbfd] shadow-[0_30px_90px_-30px_rgba(15,15,25,0.45)] dark:border-white/[0.08] dark:bg-[#1c1c1e]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-[18px] w-[18px] text-blue-500" />
                <span className="text-[15px] font-semibold"><UiText id="admin.m493ee58f81f5" /></span>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => setUploadOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
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
                    {mode === "single" ? <UiText id="admin.m9e255e169951" /> : <UiText id="admin.m7429b5611bdd" />}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m515559957fd3" /></label>
                  <div className="mt-1.5">
                    <SuggestSelect
                      value={categoryDraft}
                      onChange={setCategoryDraft}
                      options={categoryOptions}
                      onDeleteOption={(value) => void deleteOption("category", value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.mc3405f8c7d9d" /></label>
                  <UiProps ids={{"placeholder":["admin.m40e01f6642bc"]}}><input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                    placeholder="admin.m40e01f6642bc"
                  /></UiProps>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m531ab1593149" /></label>
                  <div className="mt-1.5">
                    <UiProps ids={{"placeholder":["admin.m2b33c9a68e61"]}}><SuggestSelect
                      value={creatorNameDraft}
                      onChange={setCreatorNameDraft}
                      options={creatorOptions}
                      placeholder="admin.m2b33c9a68e61"
                      createLabel={(v) => `使用「${v}」`}
                      emptyHint="输入即可添加制作人"
                      optionIcon={<History className="h-3.5 w-3.5" />}
                      maxLength={80}
                      onDeleteOption={(value) => void deleteOption("creator", value)}
                    /></UiProps>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m322408c53bed" /></label>
                  <div className="mt-1.5">
                    <UiProps ids={{"placeholder":["admin.m72d4c72d1d7b"]}}><SuggestSelect
                      value={modelNameDraft}
                      onChange={setModelNameDraft}
                      options={modelOptions}
                      placeholder="admin.m72d4c72d1d7b"
                      createLabel={(value) => `使用「${value}」`}
                      emptyHint="输入即可添加型号"
                      optionIcon={<History className="h-3.5 w-3.5" />}
                      maxLength={80}
                      onDeleteOption={(value) => void deleteOption("model", value)}
                    /></UiProps>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m1d0fd5f9336d" /></label>
                  <UiProps ids={{"placeholder":["admin.m07a7f1dd375a"]}}><input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none transition focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                    placeholder="admin.m07a7f1dd375a"
                  /></UiProps>
                  {uploadHistory.tags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {uploadHistory.tags.map((t) => {
                        const current = parseTagList(tagDraft);
                        const active = current.includes(t);
                        return (
                          <UiProps key={t} ids={{"title":["admin.m96fc74daea7d","admin.m934984ed16ea"]}}><button

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
                            title={active ? "admin.m96fc74daea7d" : "admin.m934984ed16ea"}
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
                    dragZone === "folder"
                      ? "border-blue-500/60 bg-blue-500/10"
                      : "border-[var(--border)] bg-[var(--app-bg)]",
                  ].join(" ")}
                >
                  <div className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-dashed border-blue-500/25 bg-blue-500/10 px-2 text-[12px] font-medium text-blue-500">
                    <button
                      type="button"
                      disabled={uploading || ingesting}
                      onClick={() => void chooseFolderGroups()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-500 px-2.5 text-white transition hover:bg-blue-600 disabled:pointer-events-none disabled:opacity-45"
                    >
                      <UploadCloud className="h-3.5 w-3.5" /><UiText id="admin.m35eced8c0e13" /></button>
                    <span className="pr-1 text-[11px] text-blue-500/80"><UiText id="admin.mea8464f079dd" /></span>
                  </div>
                  <button
                    type="button"
                    disabled={!files.length || uploading || ingesting}
                    onClick={addCurrentGroupToQueue}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" /><UiText id="admin.m1ac7bd4d651b" /></button>
                  <div className="min-w-[180px] flex-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.med0edf0a8bf9" /></div>
                </div>
              ) : null}

              {/* File picker (支持点击 / 拖拽 / zip 压缩包) */}
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
                        ? <UiText id="admin.me8ee7d77e58d" />
                        : files.length
                          ? <UiText id="admin.mac88babab779" values={{v0: String(files.length)}} />
                          : dragZone === "files"
                            ? <UiText id="admin.mc57e1ab5dc60" />
                            : <UiText id="admin.mf556fdd40a53" />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m8e77e17421a1" /></div>
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
                    <span><UiText id="admin.m2289893e7581" />{GROUP_MEDIA_LIMIT}<UiText id="admin.me9e0fdc242b4" /></span>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles([]);
                        setCoverIndex(0);
                      }}
                      className="underline-offset-2 transition hover:text-rose-500 hover:underline"
                    ><UiText id="admin.mb730d8da2058" /></button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {files.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="group relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
                        <FileThumbnail file={file} />
                        <div className="absolute left-1.5 top-1.5 flex gap-1">
                          <span className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}</span>
                          {index === coverIndex ? <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white"><UiText id="admin.mccbb5ee62b1a" /></span> : null}
                        </div>
                        <div className="absolute inset-x-1.5 bottom-1.5 flex flex-wrap gap-1 opacity-0 transition group-hover:opacity-100">
                          <button type="button" onClick={() => setCoverIndex(index)} className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"><UiText id="admin.m38afa58cf1a3" /></button>
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
                          ><UiText id="admin.mf853a70b1204" /></button>
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
                          ><UiText id="admin.me75e8b4e5c97" /></button>
                          <button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            className="rounded bg-rose-500/85 px-1.5 py-0.5 text-[10px] text-white"
                          ><UiText id="admin.m6135d4159e89" /></button>
                        </div>
                        <div className="truncate px-1.5 py-1 text-[10px] text-[var(--app-muted)]" title={file.name}>{file.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : files.length ? (
                <div className="mt-4 max-h-56 space-y-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2">
                    <div className="flex items-center justify-between px-1 pb-1 text-[11px] text-[var(--app-muted)]">
                      <span><UiText id="admin.m52c963128eab" />{files.length}<UiText id="admin.m7aaf96ad52e0" /></span>
                      <button
                        type="button"
                        onClick={() => setFiles([])}
                        className="underline-offset-2 transition hover:text-rose-500 hover:underline"
                      ><UiText id="admin.mb730d8da2058" /></button>
                    </div>
                    {files.map((file, index) => {
                      const reason = failedReasons[fileKey(file)];
                      return (
                        <div
                          key={`${file.name}-${file.size}-${index}`}
                          className={[
                            "rounded-md px-1 py-0.5",
                            reason ? "bg-rose-500/5" : "hover:bg-[var(--panel-2)]"
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={[
                                "min-w-0 flex-1 truncate text-[11px]",
                                reason ? "text-rose-500" : "text-[var(--app-muted)]"
                              ].join(" ")}
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{formatSize(file.size)}</span>
                            <UiProps ids={{"title":["admin.m4d833f111c6f"]}}><button
                              type="button"
                              onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                              title="admin.m4d833f111c6f"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--app-muted)] transition hover:bg-rose-500/10 hover:text-rose-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button></UiProps>
                          </div>
                          {reason ? (
                            <div className="pl-1 pt-0.5 text-[10px] leading-tight text-rose-500">⚠ {reason}</div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              ) : null}

              {uploadMode === "group" && groupQueue.length ? (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <div className="font-medium text-[var(--app-fg)]"><UiText id="admin.mf6b24adada1a" />{groupQueue.length}</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => setGroupQueue((prev) => prev.map((group) => ({ ...group, category: categoryDraft })))}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:pointer-events-none disabled:opacity-45"
                      ><UiText id="admin.m88721d7315dc" /></button>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => setGroupQueue([])}
                        className="rounded-lg border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-500 transition hover:bg-rose-500/10 disabled:pointer-events-none disabled:opacity-45"
                      ><UiText id="admin.md18e02739127" /></button>
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
                            <UiProps ids={{"placeholder":["admin.mc3405f8c7d9d"]}}><input
                              value={group.title}
                              onChange={(event) => updateQueuedGroup(group.id, { title: event.target.value })}
                              placeholder="admin.mc3405f8c7d9d"
                              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-[12px] outline-none focus:border-blue-500/50"
                            /></UiProps>
                            <SuggestSelect
                              value={group.category}
                              onChange={(value) => updateQueuedGroup(group.id, { category: value })}
                              options={categoryOptions}
                              onDeleteOption={(value) => void deleteOption("category", value)}
                            />
                            <UiProps ids={{"placeholder":["admin.m531ab1593149"]}}><SuggestSelect
                              value={group.creatorName}
                              onChange={(value) => updateQueuedGroup(group.id, { creatorName: value })}
                              options={creatorOptions}
                              placeholder="admin.m531ab1593149"
                              onDeleteOption={(value) => void deleteOption("creator", value)}
                            /></UiProps>
                            <UiProps ids={{"placeholder":["admin.m322408c53bed"]}}><SuggestSelect
                              value={group.modelName}
                              onChange={(value) => updateQueuedGroup(group.id, { modelName: value })}
                              options={modelOptions}
                              placeholder="admin.m322408c53bed"
                              onDeleteOption={(value) => void deleteOption("model", value)}
                            /></UiProps>
                            <UiProps ids={{"placeholder":["admin.md0835da5fdb6"]}}><input
                              value={group.tags}
                              onChange={(event) => updateQueuedGroup(group.id, { tags: event.target.value })}
                              placeholder="admin.md0835da5fdb6"
                              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-[12px] outline-none focus:border-blue-500/50"
                            /></UiProps>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-muted)]">
                            <span>{group.files.length}<UiText id="admin.me9e0fdc242b4" /></span>
                            {group.status === "uploading" ? <span className="text-blue-500"><UiText id="admin.m403b055e56f5" /></span> : null}
                            {group.status === "done" ? <span className="text-emerald-500"><UiText id="admin.mf28461bb49c8" /></span> : null}
                            {group.status === "error" ? <span className="text-rose-500"><UiText id="admin.m28384d7afd2e" /></span> : null}
                            {group.note ? <span className={group.status === "error" ? "text-rose-500" : "text-amber-500"}>{group.note}</span> : null}
                          </div>
                        </div>
                        <UiProps ids={{"title":["admin.m620566cd1af2"]}}><button
                          type="button"
                          disabled={uploading}
                          onClick={() => setGroupQueue((prev) => prev.filter((row) => row.id !== group.id))}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-rose-500/10 hover:text-rose-500 disabled:pointer-events-none disabled:opacity-45"
                          title="admin.m620566cd1af2"
                        >
                          <X className="h-4 w-4" />
                        </button></UiProps>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Modal footer */}
            <div className="space-y-3 border-t border-[var(--border)] px-6 py-4">
              {error ? (
                <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-400">
                  {uiError(error)}
                </div>
              ) : null}
              {uploading ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                    <span><UiText id="admin.m3b91af90e9a2" />{uploadDone}/{uploadTotal}</span>
                    <span>{uploadTotal ? Math.round((uploadDone / uploadTotal) * 100) : 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-3)]">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
                      style={{ width: `${uploadTotal ? Math.round((uploadDone / uploadTotal) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setUploadOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                ><UiText id="admin.m2cd0f3be8738" /></button>
                <button
                  type="button"
                  disabled={uploading || ingesting || (uploadMode === "group" ? !files.length && !groupQueue.length : !files.length)}
                  onClick={() => void upload()}
                  className="inline-flex h-10 min-w-[148px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-[13px] font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-[var(--panel-3)] disabled:text-[var(--app-muted)] disabled:shadow-none"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {uploading
                    ? <UiText id="admin.m4bcdd28be132" values={{v0: String(uploadDone), v1: String(uploadTotal)}} />
                    : uploadMode === "group" && groupQueue.length
                      ? <UiText id="admin.me20e2b5897b6" values={{v0: String(groupQueue.length)}} />
                      : <UiText id="admin.m221cff25b791" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <MediaLightbox
        open={!!previewItem}
        src={previewSrc}
        kind={previewKind}
        title={previewItem?.title || ""}
        layout="material-detail"
        counter={previewMediaItems.length > 1 ? `${safePreviewMediaIndex + 1}/${previewMediaItems.length}` : undefined}
        counterAlwaysVisible
        dots={previewMediaItems.length > 1 ? { count: previewMediaItems.length, activeIndex: safePreviewMediaIndex } : undefined}
        details={previewItem ? (
          <MaterialAssetPreviewDetails
            item={previewItem}
            activeMediaIndex={safePreviewMediaIndex}
            onSelectMedia={setPreviewMediaIndex}
            onEdit={() => setEditTarget(previewItem)}
            downloadBusy={downloadBusy}
            onDownloadCurrent={() => void runDownload("current", previewMedia?.id)}
            onDownloadSeries={() => void runDownload("series")}
          />
        ) : null}
        dimBackdrop={false}
        hasPrev={previewMediaItems.length > 1 && safePreviewMediaIndex > 0}
        hasNext={previewMediaItems.length > 1 && safePreviewMediaIndex < previewMediaItems.length - 1}
        onPrev={() => setPreviewMediaIndex((i) => Math.max(0, i - 1))}
        onNext={() => setPreviewMediaIndex((i) => Math.min(previewMediaItems.length - 1, i + 1))}
        onClose={() => {
          setPreviewItem(null);
          setPreviewMediaIndex(0);
        }}
      />
      {editTarget ? (
        <MaterialAssetEditModal
          item={editTarget}
          categories={categories}
          models={models}
          busy={busyId === editTarget.id}
          onClose={() => setEditTarget(null)}
          onSaved={(next) => {
            setItems((prev) => prev.map((row) => (row.id === next.id ? { ...row, ...next } : row)));
            setPreviewItem((prev) => (prev?.id === next.id ? { ...prev, ...next } : prev));
            if (next.modelName) setModels((prev) => dedupStrings([...prev, next.modelName!]));
            setEditTarget(null);
            void fetchItems(1, "replace");
          }}
          onBusy={(busy) => setBusyId(busy ? editTarget.id : null)}
          onError={setError}
          onMessage={setMessage}
        />
      ) : null}
    </main>
    </AtomicPageReveal>
  );
}

function AdminMaterialsFilterPanel({
  status,
  creators,
  activeCreator,
  activeCategory,
  activeModelName,
  modelGroups,
  onStatusChange,
  onCreatorChange,
  onModelChange,
  onClear,
}: {
  status: StatusFilter;
  creators: string[];
  activeCreator: string;
  activeCategory: string;
  activeModelName: string;
  modelGroups: ModelGroup[];
  onStatusChange: (status: StatusFilter) => void;
  onCreatorChange: (creator: string) => void;
  onModelChange: (category: string, modelName: string) => void;
  onClear: () => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { label: uiLabel } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [panelPosition, setPanelPosition] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const activeFilterCount =
    (status !== "all" ? 1 : 0) +
    (activeCreator !== "all" ? 1 : 0) +
    (activeModelName ? 1 : 0);
  const visibleModelGroups =
    activeCategory === "all"
      ? modelGroups
      : activeCategory === "uncategorized"
        ? []
        : modelGroups.filter((group) => group.category === activeCategory);

  const closeAndFocus = React.useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 16;
    const width = Math.min(480, window.innerWidth - margin * 2);
    const minLeft = Math.max(margin, document.querySelector("main")?.getBoundingClientRect().left ?? margin);
    setPanelPosition({
      top: rect.bottom + 8,
      left: Math.min(Math.max(minLeft, rect.left), window.innerWidth - width - margin),
      maxHeight: Math.max(0, window.innerHeight - rect.bottom - 24),
    });

    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (document.getElementById("admin-materials-filter-panel")?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndFocus();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && document.getElementById("admin-materials-filter-panel")?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [closeAndFocus, open]);

  const creatorOptions = [
    { value: "all", label: "全部" },
    ...creators.map((creator) => ({ value: creator, label: creator })),
    { value: "unsigned", label: "未署名" },
  ];

  return (
    <>
      <UiProps ids={{"title":["admin.mb5f15473fdc0"]}}><button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="admin.mb5f15473fdc0"
        aria-expanded={open}
        aria-controls="admin-materials-filter-panel"
        className={[
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition",
          activeFilterCount > 0
            ? "border-blue-500/30 bg-blue-500/12 text-blue-500"
            : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)]",
        ].join(" ")}
      >
        <Filter className="h-3.5 w-3.5" />
        <span><UiText id="admin.mb5f15473fdc0" /></span>
        {activeFilterCount > 0 ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] text-white">
            {activeFilterCount}
          </span>
        ) : null}
        <ChevronDown className={["h-3.5 w-3.5 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button></UiProps>

      {open && panelPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              id="admin-materials-filter-panel"
              style={{
                position: "fixed",
                top: panelPosition.top,
                left: panelPosition.left,
                maxHeight: panelPosition.maxHeight,
                zIndex: 60,
              }}
              className="w-[min(480px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[var(--app-fg)] shadow-[var(--shadow)]"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb5f15473fdc0" /></div>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    closeAndFocus();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /><UiText id="admin.m28154c1bae22" /></button>
              </div>

              <UiProps ids={{"title":["admin.m6320b4a8722a"]}}><AdminFilterSection title="admin.m6320b4a8722a">
                {STATUS_OPTIONS.map((option) => (
                  <AdminFilterOptionButton
                    key={option.key}
                    active={status === option.key}
                    label={uiLabel(option.label)}
                    onClick={() => {
                      onStatusChange(option.key);
                      closeAndFocus();
                    }}
                  />
                ))}
              </AdminFilterSection></UiProps>

              <UiProps ids={{"title":["admin.m531ab1593149"]}}><AdminFilterSection title="admin.m531ab1593149">
                {creatorOptions.map((option) => (
                  <AdminFilterOptionButton
                    key={option.value}
                    active={activeCreator === option.value}
                    label={uiLabel(option.label)}
                    onClick={() => {
                      onCreatorChange(option.value);
                      closeAndFocus();
                    }}
                  />
                ))}
              </AdminFilterSection></UiProps>

              {visibleModelGroups.map((group) => (
                <AdminFilterSection key={group.category} title={tLabel(`${group.category}型号`)}>
                  {group.models.map((modelName) => (
                    <AdminFilterOptionButton
                      key={`${group.category}:${modelName}`}
                      active={activeCategory === group.category && activeModelName === modelName}
                      label={modelName}
                      onClick={() => {
                        onModelChange(group.category, modelName);
                        closeAndFocus();
                      }}
                    />
                  ))}
                </AdminFilterSection>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AdminFilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-2 text-[13px] font-semibold text-[var(--app-fg)]">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function AdminFilterOptionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex h-8 max-w-full min-w-[58px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition",
        active
          ? "border-blue-500/35 bg-blue-500/12 text-blue-500"
          : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:border-blue-500/25 hover:bg-blue-500/8",
      ].join(" ")}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
    </button>
  );
}

function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={[
        "hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 sm:flex",
        accent
          ? "border-blue-500/20 bg-blue-500/8 text-blue-500"
          : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)]",
      ].join(" ")}
    >
      <span className="text-[11px] text-[var(--app-muted)]">{label}</span>
      <span className="text-[13px] font-semibold">{value}</span>
    </div>
  );
}

function CategoryTabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={[
        "h-7 max-w-[120px] truncate rounded-full px-3 text-[12px] transition",
        active
          ? "bg-blue-500/12 text-blue-500 ring-1 ring-blue-500/25"
          : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

const ADMIN_GRID_GAP = 3;
const ADMIN_GRID_MIN_CARD_WIDTH = 190;
const ADMIN_GRID_CARD_RATIO = 3 / 4;
const ADMIN_GRID_INFO_HEIGHT = 76;
const ADMIN_GRID_HEADER_HEIGHT = 40;
const ADMIN_GRID_GROUP_GAP = 12;

function VirtualAdminAssetGrid({
  items,
  busyId,
  scrollTop,
  viewportHeight,
  selectionMode,
  selectedIds,
  selectingDay,
  onPreview,
  onToggleSelect,
  onToggleDateSelection,
  onDelete,
  onRelease,
}: {
  items: MaterialAsset[];
  busyId: number | null;
  scrollTop: number;
  viewportHeight: number;
  selectionMode: boolean;
  selectedIds: Set<number>;
  selectingDay: string | null;
  onPreview: (item: MaterialAsset) => void;
  onToggleSelect: (item: MaterialAsset) => void;
  onToggleDateSelection: (dayKey: string) => void;
  onDelete: (item: MaterialAsset) => void;
  onRelease: (item: MaterialAsset) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [containerOffsetTop, setContainerOffsetTop] = React.useState(0);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      setContainerWidth(node.getBoundingClientRect().width);
      setContainerOffsetTop(node.offsetTop);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const columnCount = Math.max(1, Math.floor((containerWidth + ADMIN_GRID_GAP) / (ADMIN_GRID_MIN_CARD_WIDTH + ADMIN_GRID_GAP)));
  const cardWidth = containerWidth > 0
    ? (containerWidth - ADMIN_GRID_GAP * (columnCount - 1)) / columnCount
    : ADMIN_GRID_MIN_CARD_WIDTH;
  const cardHeight = cardWidth / ADMIN_GRID_CARD_RATIO + ADMIN_GRID_INFO_HEIGHT;
  const rowHeight = cardHeight + ADMIN_GRID_GAP;
  // 按上传日分组（items 已按时间倒序）；为日期头与每张卡片算出绝对位置，再一起做虚拟化
  const layout = React.useMemo(() => {
    const groupMap = new Map<string, MaterialAsset[]>();
    for (const item of items) {
      const key = assetDayKey(item.createdAt);
      const arr = groupMap.get(key);
      if (arr) arr.push(item);
      else groupMap.set(key, [item]);
    }
    const orderedKeys = Array.from(groupMap.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const headers: { key: string; count: number; ids: number[]; top: number }[] = [];
    const cells: { item: MaterialAsset; index: number; top: number; left: number }[] = [];
    let y = 0;
    let index = 0;
    for (const key of orderedKeys) {
      const list = groupMap.get(key)!;
      headers.push({ key, count: list.length, ids: list.map((item) => item.id), top: y });
      y += ADMIN_GRID_HEADER_HEIGHT;
      list.forEach((item, i) => {
        cells.push({
          item,
          index: index++,
          top: y + Math.floor(i / columnCount) * rowHeight,
          left: (i % columnCount) * (cardWidth + ADMIN_GRID_GAP),
        });
      });
      y += Math.ceil(list.length / columnCount) * rowHeight + ADMIN_GRID_GROUP_GAP;
    }
    return { headers, cells, totalHeight: Math.max(1, y) };
  }, [items, columnCount, cardWidth, rowHeight]);
  const overscan = Math.max(900, viewportHeight * 1.5);
  const visibleTop = scrollTop - containerOffsetTop - overscan;
  const visibleBottom = scrollTop - containerOffsetTop + viewportHeight + overscan;
  const visibleHeaders = layout.headers.filter(
    (h) => h.top + ADMIN_GRID_HEADER_HEIGHT >= visibleTop && h.top <= visibleBottom
  );
  const visibleCells = layout.cells.filter(
    (c) => c.top + cardHeight >= visibleTop && c.top <= visibleBottom
  );

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: `${layout.totalHeight}px` }}>
      {visibleHeaders.map((header) => {
        const { date, rel } = dayHeaderParts(header.key);
        const allSelected = header.ids.length > 0 && header.ids.every((id) => selectedIds.has(id));
        const someSelected = header.ids.some((id) => selectedIds.has(id));
        const selecting = selectingDay === header.key;
        return (
          <div
            key={`day_${header.key}`}
            className="absolute left-0 right-0 flex items-center gap-2.5"
            style={{ top: header.top, height: ADMIN_GRID_HEADER_HEIGHT }}
          >
            {selectionMode ? (
              <button
                type="button"
                disabled={selecting || header.key === "未知"}
                onClick={() => onToggleDateSelection(header.key)}
                className={[
                  "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-left transition disabled:opacity-60",
                  allSelected
                    ? "border-blue-500/35 bg-blue-500/10 text-blue-500"
                    : someSelected
                      ? "border-blue-500/25 bg-blue-500/5 text-[var(--app-fg)]"
                      : "border-transparent text-[var(--app-fg)] hover:border-[var(--border)] hover:bg-[var(--panel-2)]",
                ].join(" ")}
                aria-label={allSelected ? `取消选择${date}上传的素材` : `选择${date}上传的素材`}
              >
                {selecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : allSelected ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                <span className="text-[13px] font-semibold">{date}</span>
                {rel ? (
                  <span className="rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--app-muted)]">{rel}</span>
                ) : null}
                <span className="text-[11px] text-[var(--app-muted)]">{header.count}<UiText id="admin.me9e0fdc242b4" /></span>
              </button>
            ) : (
              <>
                <span className="text-[13px] font-semibold text-[var(--app-fg)]">{date}</span>
                {rel ? (
                  <span className="rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--app-muted)]">{rel}</span>
                ) : null}
                <span className="text-[11px] text-[var(--app-muted)]">{header.count}<UiText id="admin.me9e0fdc242b4" /></span>
              </>
            )}
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        );
      })}
      {visibleCells.map(({ item, index, top, left }) => (
        <div
          key={item.id}
          className="absolute"
          style={{ left, top, width: cardWidth, height: cardHeight }}
        >
          <AssetCard
            item={item}
            eager={index < 18}
            busy={busyId === item.id}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onPreview={() => onPreview(item)}
            onToggleSelect={() => onToggleSelect(item)}
            onDelete={() => onDelete(item)}
            onRelease={() => onRelease(item)}
          />
        </div>
      ))}
    </div>
  );
}

function AssetCard({
  item,
  eager,
  busy,
  selectionMode,
  selected,
  onPreview,
  onToggleSelect,
  onDelete,
  onRelease,
}: {
  item: MaterialAsset;
  eager: boolean;
  busy: boolean;
  selectionMode: boolean;
  selected: boolean;
  onPreview: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onRelease: () => void;
}) {
  const previewSrc = originalHref(item);
  const isVideo = isMaterialAssetVideo(item, previewSrc);
  const videoPoster = isVideo ? previewCandidates(item, 600).find((src) => !isVideoMediaUrl(src)) : "";
  const inspiration = item.inspiration?.trim() || "";
  return (
    <article
      className={[
        "group flex h-full flex-col overflow-hidden rounded-xl border bg-[var(--panel-2)] transition hover:shadow-md",
        selected ? "border-blue-500 ring-2 ring-blue-500/35" : "border-[var(--border)]",
      ].join(" ")}
    >
      <div className="relative min-h-0 flex-1 bg-[var(--input-bg)]">
        <UiProps ids={{"title":["admin.m771c680268c7"]}}><button
          type="button"
          onClick={selectionMode ? onToggleSelect : onPreview}
          className="block h-full w-full overflow-hidden text-left"
          title="admin.m771c680268c7"
        >
          {isVideo ? (
            <HoverPreviewVideo
              src={previewSrc}
              posterSrc={videoPoster}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              eager={eager}
            />
          ) : (
            <ResilientImage
              candidates={cardImageCandidates(item)}
              alt={item.title}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          )}
        </button></UiProps>
        {selectionMode ? (
          <UiProps ids={{"aria-label":["admin.m31762df00df4","admin.m1ec8b306f4c8"]}}><button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect();
            }}
            className={[
              "absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-sm transition",
              selected
                ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                : "border-white/50 bg-black/30 text-white hover:bg-black/45",
            ].join(" ")}
            aria-label={selected ? "admin.m31762df00df4" : "admin.m1ec8b306f4c8"}
          >
            {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button></UiProps>
        ) : null}
        {/* Hover action overlay */}
        {!selectionMode ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-end gap-2 bg-gradient-to-t from-black/55 via-transparent to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <a
            target="_blank"
            rel="noreferrer"
            className="hidden"
          ><UiText id="admin.mc8d7aa3a3745" /></a>
          <div className="pointer-events-auto flex items-center gap-1.5">
            {item.isSelected ? (
              <UiProps ids={{"title":["admin.mcf43f802981d"]}}><button
                type="button"
                disabled={busy}
                onClick={onRelease}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-300/30 bg-emerald-500/25 px-2 text-[11px] font-medium text-emerald-100 backdrop-blur-sm transition hover:bg-emerald-500/50 disabled:opacity-50"
                title="admin.mcf43f802981d"
              >
                <RotateCcw className="h-3.5 w-3.5" /><UiText id="admin.m40c5340bc430" /></button></UiProps>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-400/30 bg-rose-500/25 text-rose-200 backdrop-blur-sm transition hover:bg-rose-500/50 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        ) : null}
        {/* Status badge */}
        <div className="absolute left-2 top-2">
          <Badge tone={item.isSelected ? "amber" : "default"}>
            {item.isSelected ? <UiText id="admin.m7ecf1cde6486" /> : <UiText id="admin.m3005eadbbbcd" />}
          </Badge>
        </div>
        {(item.mediaCount || 1) > 1 ? (
          <div className={["absolute right-2", selectionMode ? "top-11" : "top-2"].join(" ")}>
            <Badge><UiText id="admin.m9bbfefa108cf" /></Badge>
          </div>
        ) : null}
      </div>
      <div className="h-[86px] shrink-0 border-t border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2">
        <div className={inspiration ? "" : "invisible"} aria-hidden={!inspiration}>
          <div className="h-[70px] border-l-2 border-indigo-500/70 bg-[var(--app-bg)]/80 px-2.5 py-1.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold leading-none text-indigo-600 dark:text-indigo-300">
              <Lightbulb className="h-3.5 w-3.5 shrink-0" /><UiText id="admin.m674a5c6c5653" /></div>
            <p
              className="line-clamp-2 min-h-[38px] text-[13px] font-medium leading-[1.45] text-[var(--app-fg)]"
              style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              {inspiration || <UiText id="admin.mac00d2219c8e" />}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function MaterialAssetPreviewDetails({
  item,
  activeMediaIndex,
  onSelectMedia,
  onEdit,
  downloadBusy,
  onDownloadCurrent,
  onDownloadSeries,
}: {
  item: MaterialAsset;
  activeMediaIndex: number;
  onSelectMedia: (index: number) => void;
  onEdit: () => void;
  downloadBusy: "current" | "series" | null;
  onDownloadCurrent: () => void;
  onDownloadSeries: () => void;
}) {
  const { label: tLabel } = useUiLocale();
  const mediaItems = mediaItemsForAsset(item);
  const [downloadMenuOpen, setDownloadMenuOpen] = React.useState(false);
  const downloadMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!downloadMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!downloadMenuRef.current?.contains(event.target as Node)) setDownloadMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setDownloadMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [downloadMenuOpen]);

  const rows: Array<[string, string]> = [
    ["标题", item.title || "-"],
    ["ID", String(item.id)],
    ["分类", item.category || "未分类"],
    ["型号", item.modelName || "-"],
    ["状态", item.isSelected ? "已选中" : "未选中"],
    ["制作人", item.creatorName || "-"],
    ["大小", formatSize(item.sizeBytes) || "-"],
    ["上传时间", formatTime(item.createdAt)],
    ["下载次数", String(item.downloadCount || 0)],
    ["系列图张数", String(item.mediaCount || mediaItems.length || 1)],
    ["当前图片", mediaItems.length > 1 ? `第 ${activeMediaIndex + 1} 张` : "-"],
  ];

  if (item.mimeType) rows.push(["类型", item.mimeType]);
  if (item.selectedBy) {
    rows.push(["挑选用户", item.selectedBy.username || "-"]);
    rows.push(["挑选时间", formatTime(item.selectedBy.selectedAt)]);
  }
  if (Array.isArray(item.tags) && item.tags.length) {
    rows.push(["标签", item.tags.join(", ")]);
  }

  const downloads = Array.isArray(item.recentDownloads) ? item.recentDownloads.slice(0, 5) : [];

  return (
    <div className="space-y-4 text-[13px]">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="admin.m9713e97b9941" /></div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]"
            ><UiText id="admin.m051836569928" /></button>
            <div ref={downloadMenuRef} className="relative flex">
              <button
                type="button"
                disabled={downloadBusy !== null}
                onClick={onDownloadCurrent}
                className={[
                  "inline-flex items-center gap-1.5 rounded-l-lg bg-[var(--primary-bg)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--primary-fg)] transition hover:opacity-90",
                  mediaItems.length > 1 ? "border-r border-white/25" : "rounded-r-lg",
                  downloadBusy !== null ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
              >
                {downloadBusy === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}<UiText id="admin.m4673a2306165" /></button>
              {mediaItems.length > 1 ? (
                <>
                  <UiProps ids={{"aria-label":["admin.mf201eb4452ba"]}}><button
                    type="button"
                    disabled={downloadBusy !== null}
                    aria-label="admin.mf201eb4452ba"
                    aria-expanded={downloadMenuOpen}
                    onClick={() => setDownloadMenuOpen((value) => !value)}
                    className={[
                      "inline-flex items-center rounded-r-lg bg-[var(--primary-bg)] px-2 py-1.5 text-[var(--primary-fg)] transition hover:opacity-90",
                      downloadBusy !== null ? "cursor-not-allowed opacity-60" : "",
                    ].join(" ")}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button></UiProps>
                  {downloadMenuOpen ? (
                    <div className="app-dropdown-panel absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-[var(--shadow)]">
                      <button
                        type="button"
                        disabled={downloadBusy !== null}
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          onDownloadSeries();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {downloadBusy === "series" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {downloadBusy === "series" ? <UiText id="admin.m6e00190083d9" /> : <UiText id="admin.mc7c1faec0118" />}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-1 break-words text-[12px] leading-5 text-[var(--app-muted)]">{item.title || <UiText id="admin.me08240ff3cf2" values={{v0: String(item.id)}} />}</div>
      </div>
      {mediaItems.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {mediaItems.map((media, index) => {
            const active = index === activeMediaIndex;
            return (
            <button
              key={media.id}
              type="button"
              onClick={() => onSelectMedia(index)}
              className={[
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-[var(--panel-2)] transition",
                active ? "border-blue-500 ring-2 ring-blue-500/25" : "border-[var(--border)] hover:border-blue-400/70",
              ].join(" ")}
              title={tLabel(`查看第 ${index + 1} 张原图`)}
            >
              <ResilientImage candidates={previewCandidatesForMedia(media, 160)} alt="" className="h-full w-full object-cover" />
              <span className={["absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] text-white", active ? "bg-blue-500" : "bg-black/55"].join(" ")}>{index + 1}</span>
            </button>
            );
          })}
        </div>
      ) : null}
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-b-0">
            <span className="shrink-0 text-[var(--app-muted)]">{label}</span>
            <span className="min-w-0 break-words text-right text-[var(--app-fg)]">{value}</span>
          </div>
        ))}
      </div>
      {item.inspiration ? (
        <div className="rounded-xl border-l-2 border-indigo-500/70 bg-[var(--app-bg)]/80 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold leading-none text-indigo-600 dark:text-indigo-300">
            <Lightbulb className="h-3.5 w-3.5 shrink-0" /><UiText id="admin.m674a5c6c5653" /></div>
          <p
            className="whitespace-pre-wrap text-[13px] font-medium leading-[1.55] text-[var(--app-fg)]"
            style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}
          >
            {item.inspiration}
          </p>
        </div>
      ) : null}
      {downloads.length ? (
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="admin.m144da3490d50" /></div>
          {downloads.map((record) => (
            <div key={record.id} className="flex items-start justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate text-[var(--app-muted)]">{record.username}</span>
              <span className="shrink-0 text-[var(--app-fg)]">{formatTime(record.downloadedAt)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MaterialAssetEditModal({
  item,
  categories,
  models,
  busy,
  onClose,
  onSaved,
  onBusy,
  onError,
  onMessage,
}: {
  item: MaterialAsset;
  categories: string[];
  models: string[];
  busy: boolean;
  onClose: () => void;
  onSaved: (item: MaterialAsset) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  type MediaDraft = MaterialMediaItem & { file?: File };
  const [title, setTitle] = React.useState(item.title || "");
  const [category, setCategory] = React.useState(item.category || MATERIAL_ASSET_UNCATEGORIZED);
  const [modelName, setModelName] = React.useState(item.modelName || "");
  const [tags, setTags] = React.useState((item.tags || []).join(", "));
  const [inspiration, setInspiration] = React.useState(item.inspiration || "");
  const [media, setMedia] = React.useState<MediaDraft[]>(() => mediaItemsForAsset(item).map((row) => ({ ...row })));
  const [localError, setLocalError] = React.useState("");

  const moveMedia = React.useCallback((from: number, to: number) => {
    setMedia((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  }, []);

  const addFiles = React.useCallback((incoming: File[]) => {
    const imageFiles = incoming.filter(isImageUploadFile);
    if (imageFiles.length !== incoming.length) {
      setLocalError("系列图编辑仅支持图片");
      return;
    }
    setMedia((prev) => {
      const remaining = GROUP_MEDIA_LIMIT - prev.length;
      if (remaining <= 0) {
        setLocalError(`系列图最多 ${GROUP_MEDIA_LIMIT} 张`);
        return prev;
      }
      setLocalError("");
      return [
        ...prev,
        ...imageFiles.slice(0, remaining).map((file, index) => ({
          id: `new_${Date.now()}_${index}`,
          originalUrl: "",
          thumbnailUrl: "",
          previewUrl: "",
          mime: file.type || null,
          size: file.size,
          file,
          fileKey: `media_${Date.now()}_${index}_${file.name}`,
        })),
      ];
    });
  }, []);

  const save = React.useCallback(async () => {
    if (!title.trim()) {
      setLocalError("标题不能为空");
      return;
    }
    if (media.length < 1) {
      setLocalError("至少保留 1 张图片");
      return;
    }
    if (media.length > GROUP_MEDIA_LIMIT) {
      setLocalError(`系列图最多 ${GROUP_MEDIA_LIMIT} 张`);
      return;
    }
    setLocalError("");
    onBusy(true);
    onError("");
    onMessage("");
    try {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("category", category);
      form.set("modelName", modelName);
      form.set("tags", tags);
      form.set("inspiration", inspiration); // 空 = 删除灵感
      const payload = media.map((row, index) => {
        if (row.file) {
          const key = row.fileKey || `media_${index}_${row.file.name}`;
          form.append(key, row.file);
          return { id: row.id, fileKey: key };
        }
        return {
          id: row.id,
          originalUrl: row.originalUrl,
          thumbnailUrl: row.thumbnailUrl,
          previewUrl: row.previewUrl,
          mime: row.mime,
          size: row.size,
        };
      });
      form.set("media", JSON.stringify(payload));
      const res = await fetch(`/api/admin/material-assets/${item.id}`, { method: "PATCH", body: form });
      const json = (await res.json().catch(() => null)) as { item?: MaterialAsset; error?: string } | null;
      if (!res.ok || !json?.item) throw new Error(json?.error || "保存失败");
      onSaved(json.item);
      onMessage("素材已更新");
    } catch (err: any) {
      const message = String(err?.message || "保存失败");
      setLocalError(message);
      onError(message);
    } finally {
      onBusy(false);
    }
  }, [category, inspiration, item.id, media, modelName, onBusy, onError, onMessage, onSaved, tags, title]);

  return (
    <div className="fixed inset-0 z-[260] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="material-asset-edit-panel solid-panel-surface flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb01a30e4b06f" /></div>
            <div className="mt-0.5 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m3a430f9dc502" /></div>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.mc3405f8c7d9d" /></span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] outline-none focus:border-blue-500/50" />
            </label>
            <div>
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m515559957fd3" /></span>
              <div className="mt-1.5">
                <SuggestSelect value={category} onChange={setCategory} options={categories} />
              </div>
            </div>
            <div>
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m322408c53bed" /></span>
              <div className="mt-1.5">
                <UiProps ids={{"placeholder":["admin.m72d4c72d1d7b"]}}><SuggestSelect
                  value={modelName}
                  onChange={setModelName}
                  options={models}
                  placeholder="admin.m72d4c72d1d7b"
                  createLabel={(value) => `使用「${value}」`}
                  emptyHint="输入即可添加型号"
                  maxLength={80}
                /></UiProps>
              </div>
            </div>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m1d0fd5f9336d" /></span>
              <input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] outline-none focus:border-blue-500/50" />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m1fe8b5f67932" /></span>
            <UiProps ids={{"placeholder":["admin.m16e4efd4f419"]}}><textarea
              value={inspiration}
              onChange={(event) => setInspiration(event.target.value.slice(0, 2000))}
              rows={3}
              placeholder="admin.m16e4efd4f419"
              className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] leading-[1.6] outline-none focus:border-blue-500/50"
            /></UiProps>
          </label>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m779f05a21ba7" />{media.length}/{GROUP_MEDIA_LIMIT}</div>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]">
              <Plus className="h-3.5 w-3.5" /><UiText id="admin.md32605b3ccc7" /><input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {media.map((row, index) => {
              const selected = item.selectedMediaId === row.id;
              return (
                <div key={`${row.id}-${index}`} className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                  <div className="relative aspect-square bg-[var(--input-bg)]">
                    {row.file ? (
                      <FileThumbnail file={row.file} />
                    ) : (
                      <ResilientImage candidates={previewCandidatesForMedia(row, 300)} alt="" className="h-full w-full object-cover" />
                    )}
                    <div className="absolute left-1.5 top-1.5 flex gap-1">
                      <span className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">{index + 1}</span>
                      {index === 0 ? <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white"><UiText id="admin.mccbb5ee62b1a" /></span> : null}
                      {selected ? <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white"><UiText id="admin.m0ec309515453" /></span> : null}
                    </div>
                  </div>
                  <div className="space-y-1.5 p-2">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => moveMedia(index, 0)} disabled={index === 0} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"><UiText id="admin.m640e6a33eeda" /></button>
                      <button type="button" onClick={() => moveMedia(index, index - 1)} disabled={index === 0} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"><UiText id="admin.mf853a70b1204" /></button>
                      <button type="button" onClick={() => moveMedia(index, index + 1)} disabled={index === media.length - 1} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] disabled:opacity-40"><UiText id="admin.me75e8b4e5c97" /></button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <label className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]"><UiText id="admin.m131b13aa2659" /><input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file && isImageUploadFile(file)) {
                              setMedia((prev) => prev.map((item, i) => i === index ? { ...item, file, fileKey: `media_${Date.now()}_${file.name}`, mime: file.type || item.mime, size: file.size } : item));
                              setLocalError("");
                            } else if (file) {
                              setLocalError("只能替换为图片");
                            }
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (media.length <= 1) {
                            setLocalError("至少保留 1 张图片");
                            return;
                          }
                          setMedia((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="rounded border border-rose-400/30 px-1.5 py-0.5 text-[10px] text-rose-500"
                      ><UiText id="admin.m2f9daa828907" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {localError ? <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-400">{localError}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button type="button" disabled={busy} onClick={onClose} className="h-9 rounded-lg border border-[var(--border)] px-4 text-[13px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.m2cd0f3be8738" /></button>
          <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex h-9 min-w-[96px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-[13px] font-medium text-white transition hover:bg-blue-600 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}<UiText id="admin.ma3030bf8f16d" /></button>
        </div>
      </div>
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
      <div className="flex aspect-square items-center justify-center bg-[var(--panel-3)] text-[11px] text-[var(--app-muted)]"><UiText id="admin.m39932f24fe11" /></div>
    );
  }
  return <img src={url} alt="" className="aspect-square w-full object-cover" />;
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "amber" }) {
  const cls =
    tone === "amber"
      ? "border-amber-400/30 bg-amber-500/25 text-amber-200"
      : "border-white/15 bg-black/35 text-white/85";
  return (
    <span className={["rounded-md border px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm", cls].join(" ")}>
      {children}
    </span>
  );
}
