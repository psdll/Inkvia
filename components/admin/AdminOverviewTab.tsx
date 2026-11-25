"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";
import { formatUiDate, formatUiNumber } from "@/i18n/format";
import type { UiLocale } from "@/i18n/locale";
import { useSearchParams } from "next/navigation";
import { AccountUsageSection } from "@/components/settings/account-usage-section";

import * as React from "react";
import { useAdminPageSelection } from "@/components/admin/useAdminPageSelection";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { DesktopDirectoryLink } from "@/components/system/desktop-directory-link";
import { Activity, ChevronDown, Database, Film, Folder, FolderDown, HardDrive, Image as ImageIcon, Images, Package, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import type { AdminStoragePayload } from "@/lib/hooks/use-admin-storage";
import { adminDisplayName, fmtTime as formatOriginalTime } from "@/lib/admin-utils";
import { groupAdminStorageNodes } from "@/lib/admin-storage-groups";
import ModelReliabilityPanel from "@/components/admin/ModelReliabilityPanel";
import AdminActivityChart, { ACTIVITY_COLORS } from "./AdminActivityChart";
import AdminActivityTable from "./AdminActivityTable";
import activityStyles from "./admin-activity.module.css";

// ─── Local helpers (overview-only) ─────────────────────────────────────────

function bytes(n: number, locale: UiLocale = "zh-CN") {
  const v = Math.max(0, Number(n) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  const digits = i === 0 ? 0 : 1;
  const value = formatUiNumber(locale, x, { minimumFractionDigits: digits, maximumFractionDigits: digits }, () => x.toFixed(digits));
  return `${value} ${units[i]}`;
}

function pct(n: number, digits = 1) {
  return `${((Number(n) || 0) * 100).toFixed(digits)}%`;
}

function safeDiv(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function formatCount(n: number) {
  return Math.max(0, Number(n) || 0).toLocaleString("zh-CN");
}

type UploadTreeNode = NonNullable<AdminStoragePayload["uploadsTree"]>[number];
type ImportOrphanCandidate = {
  path: string;
  type: "image" | "video";
  sizeBytes: number;
  mtime: string;
  ageHours: number;
};
type ImportOrphanScanState = {
  cooldownHours: number;
  cutoff: string;
  scannedAt: string;
  importsRoot: string;
  totalCount: number;
  totalBytes: number;
  candidates: ImportOrphanCandidate[];
  deletedCount?: number;
  deletedBytes?: number;
  failed?: Array<{ path: string; error: string }>;
};

export type StorageCleanupResult =
  | {
      action: "cleanup_temp";
      days: number;
      deletedFiles: number;
      deletedBytes: number;
      removedDirs: number;
      at: number;
    }
  | {
      action: "cleanup_old_uploads";
      days: number;
      cutoff: string;
      deletedGenerations: number;
      deletedLogs: number;
      deletedLedgers: number;
      deletedLocalFiles: number;
      deletedOssObjects: number;
      deletedBytes: number;
      skippedSharedRefs: number;
      skippedProtectedRefs: number;
      ossErrorCount: number;
      at: number;
    }
  | {
      action: "cleanup_thumbnail_assets";
      days: number;
      cutoff: string;
      scannedFiles: number;
      protectedFiles: number;
      deletedCacheFiles: number;
      deletedOrphanFiles: number;
      deletedBytes: number;
      failedFiles: number;
      at: number;
    };

function storageSourceLabel(source?: "local" | "oss" | "mixed") {
  if (source === "oss") return "OSS";
  if (source === "mixed") return "本地 + OSS";
  return "本地";
}

function storageSourceBadgeClass(source?: "local" | "oss" | "mixed") {
  if (source === "oss") return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]";
  if (source === "mixed") return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]";
  return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]";
}

function analyticsTypeName(t: "image" | "video" | "face" | "other") {
  if (t === "image") return "图片";
  if (t === "video") return "视频";
  if (t === "face") return "人脸";
  return "其他";
}

function topEntries(map: Record<string, number> | null | undefined, limit = 8) {
  return Object.entries(map || {})
    .map(([label, value]) => ({ label, value: Math.max(0, Number(value) || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function sumModelTrendCounts(models: Record<string, number> | null | undefined) {
  return Object.values(models || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function getTopModelEntry(models: Record<string, number> | null | undefined) {
  return Object.entries(models || {})
    .map(([model, count]) => ({ model, count: Math.max(0, Number(count) || 0) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)[0] || null;
}

function formatMonthDayLabel(day: string) {
  const s = String(day || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(5, 7)}/${s.slice(8, 10)}`;
  return s;
}

function flattenUploadsTree(
  nodes: UploadTreeNode[],
  depth = 0,
  acc: Array<{ node: UploadTreeNode; depth: number; hasChildren: boolean }> = []
) {
  for (const node of nodes) {
    acc.push({ node, depth, hasChildren: node.children.length > 0 });
    if (node.children.length > 0) flattenUploadsTree(node.children, depth + 1, acc);
  }
  return acc;
}

type UploadDirTint = "sky" | "violet" | "emerald" | "indigo" | "amber" | "rose" | "slate";

const UPLOAD_DIR_TINTS: Record<UploadDirTint, { box: string; icon: string; bar: string }> = {
  sky: { box: "bg-sky-500/12", icon: "text-sky-500", bar: "bg-sky-500/80" },
  violet: { box: "bg-violet-500/12", icon: "text-violet-500", bar: "bg-violet-500/80" },
  emerald: { box: "bg-emerald-500/12", icon: "text-emerald-500", bar: "bg-emerald-500/80" },
  indigo: { box: "bg-indigo-500/12", icon: "text-indigo-500", bar: "bg-indigo-500/80" },
  amber: { box: "bg-amber-500/12", icon: "text-amber-500", bar: "bg-amber-500/80" },
  rose: { box: "bg-rose-500/12", icon: "text-rose-500", bar: "bg-rose-500/80" },
  slate: { box: "bg-[var(--panel-2)]", icon: "text-[var(--app-muted)]", bar: "bg-[var(--app-muted)]/50" },
};

// 按目录名关键词推断图标与配色 —— 新增业务目录无需改这里即可自动获得合适图标
function resolveUploadDirVisual(name: string): { Icon: React.ComponentType<{ className?: string }>; tint: UploadDirTint } {
  const n = name.toLowerCase();
  if (/video|film|movie|mp4/.test(n)) return { Icon: Film, tint: "violet" };
  if (/product|goods|sku/.test(n)) return { Icon: Package, tint: "emerald" };
  if (/material|asset|library|gallery/.test(n)) return { Icon: Images, tint: "indigo" };
  if (/preset|config|setting|template/.test(n)) return { Icon: SlidersHorizontal, tint: "amber" };
  if (/temp|tmp|cache|trash/.test(n)) return { Icon: Trash2, tint: "rose" };
  if (/import|incoming|inbox/.test(n)) return { Icon: FolderDown, tint: "slate" };
  if (/image|photo|pic|preview|poster|face|thumb|result|output|generation|gen/.test(n))
    return { Icon: ImageIcon, tint: "sky" };
  return { Icon: Folder, tint: "slate" };
}

// 常见目录名 → 中文名兜底字典。后端快照缺中文名（或缓存太旧仍是英文）时用它，标题不至于露出英文
const UPLOAD_DIR_CN_NAMES: Record<string, string> = {
  generation_previews: "图片预览生成",
  generation_posters: "海报生成",
  image_results: "图片结果",
  face_results: "换脸结果",
  video_results: "视频结果",
  products: "产品库",
  shared: "共享素材",
  image: "共享图片",
  video: "共享视频",
  private: "私有文件",
  material_library: "素材库",
  temp: "临时目录",
  presets: "预设文件",
  Agent_imports: "Agent 导入素材",
  Agent_image_results: "Agent 图片结果",
  Agent_video_results: "Agent 视频结果",
  Agent_audio_results: "Agent 音频结果",
  imports: "创作导入的素材",
  batch_imports: "批量导入的素材",
  "batch-image_results": "批量结果素材",
  canvas_voice_previews: "画布音色试听",
  _thumbs: "缩略图缓存",
  inspiration_assets: "灵感模板素材",
};

// 优先用后端给的中文名；后端缺失或回退成英文目录名时，用前端字典兜底成中文
function resolveUploadDirName(node: UploadTreeNode): string {
  if (node.name === "imports" || node.name === "batch_imports") {
    return UPLOAD_DIR_CN_NAMES[node.name];
  }
  if (node.label && node.label !== node.name) return node.label;
  return UPLOAD_DIR_CN_NAMES[node.name] || node.label || node.name;
}

function resolveUploadDirPurpose(node: UploadTreeNode): string {
  if (node.name === "imports") {
    return "存放创作工具上传、导入及输入快照素材";
  }
  return node.purpose || "—";
}

// 单块业务目录卡片：头部点清身份与体量，子目录默认折叠、底部按钮展开
function UploadDirCard({ node, maxBytes }: { node: UploadTreeNode; maxBytes: number }) {
  const { locale, label: uiLabel } = useUiLocale();
  const count = (value: number) => formatUiNumber(locale, value, undefined, () => formatCount(value));
  const name = resolveUploadDirName(node);
  const purpose = uiLabel(resolveUploadDirPurpose(node));
  const [open, setOpen] = React.useState(false);
  const { Icon, tint } = resolveUploadDirVisual(node.name);
  const tone = UPLOAD_DIR_TINTS[tint];
  const descendants = flattenUploadsTree(node.children);
  const hasChildren = descendants.length > 0;
  const barPct = maxBytes > 0 && node.bytes > 0 ? Math.max(3, Math.round((node.bytes / maxBytes) * 100)) : 0;

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 transition-colors hover:border-[var(--app-muted)]/40">
      <div className="flex items-center gap-2.5">
        <span className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone.box].join(" ")}>
          <Icon className={["h-4 w-4", tone.icon].join(" ")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold leading-tight text-[var(--app-fg)]">{name === node.name ? name : uiLabel(name)}</div>
          <div className="truncate font-mono text-[10px] leading-tight text-[var(--app-muted)]">{node.name}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12.5px] font-semibold tabular-nums text-[var(--app-fg)]">{bytes(node.bytes, locale)}</div>
          <div className="text-[10px] tabular-nums text-[var(--app-muted)]">{count(node.files)}<UiText id="admin.m8915e82b0e8f" /></div>
        </div>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <span className={["block h-full rounded-full", tone.bar].join(" ")} style={{ width: `${barPct}%` }} />
      </div>

      <p
        className="mt-2 line-clamp-2 min-h-[30px] text-[11px] leading-snug text-[var(--app-muted)]"
        title={purpose}
      >
        {purpose}
      </p>

      {hasChildren ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-2 flex h-6 items-center justify-center gap-1 rounded-md text-[10.5px] font-medium text-[var(--app-muted)] transition-colors hover:bg-[var(--panel-2)]/70 hover:text-[var(--app-fg)]"
        >
          <ChevronDown className={["h-3 w-3 transition-transform", open ? "rotate-180" : "rotate-0"].join(" ")} />
          {open ? <UiText id="admin.mafd4b783536b" /> : <UiText id="admin.m3581182b161f" values={{v0: count(descendants.length)}} />}
        </button>
      ) : (
        <div className="mt-2 flex h-6 items-center justify-center text-[10.5px] text-[var(--app-muted)]/50"><UiText id="admin.m5bda65f02f3a" /></div>
      )}

      {hasChildren && open && (
        <div className="mt-1.5 flex max-h-[156px] flex-col overflow-y-auto overscroll-contain rounded-lg bg-[var(--panel-2)]/40 p-1.5">
          {descendants.map(({ node: child, depth }) => {
            const childName = resolveUploadDirName(child);
            return (
              <div
                key={child.relativePath}
                className="flex h-6 shrink-0 items-center gap-1.5 rounded px-1.5 py-1 text-[11px] transition-colors hover:bg-[var(--panel-bg)]"
                style={{ paddingLeft: `${6 + depth * 12}px` }}
              >
                <Folder className="h-3 w-3 shrink-0 text-[var(--app-muted)]/70" />
                <span className="truncate text-[var(--app-fg)]">{childName === child.name ? childName : uiLabel(childName)}</span>
                {child.name !== childName && (
                  <span className="shrink-0 rounded border border-[var(--border)] px-1 font-mono text-[9px] leading-none text-[var(--app-muted)]">
                    {child.name}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--app-muted)]">
                  {count(child.files)} · {bytes(child.bytes, locale)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UploadsTreePanels({ nodes }: { nodes: UploadTreeNode[] }) {
  const { locale, label: uiLabel } = useUiLocale();
  const groups = groupAdminStorageNodes(nodes);
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const maxBytes = group.nodes.reduce((max, node) => Math.max(max, node.bytes), 0);
        return (
          <section
            key={group.key}
            className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]/20 p-3"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h4 className="text-[13px] font-semibold text-[var(--app-fg)]">{uiLabel(group.label)}</h4>
              <span className="text-[10.5px] text-[var(--app-muted)]">
                {formatUiNumber(locale, group.count, undefined, () => formatCount(group.count))}<UiText id="admin.m7955c9505f43" /></span>
              <span className="ml-auto text-[11px] font-semibold tabular-nums text-[var(--app-fg)]">
                {bytes(group.totalBytes, locale)}
              </span>
            </div>
            <div className="grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.nodes.map((node) => (
                <UploadDirCard key={node.relativePath} node={node} maxBytes={maxBytes} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────

export type AdminOverviewTabProps = {
  // Storage state (from useAdminStorage + parent wrapper)
  storage: AdminStoragePayload | null;
  storageLoading: boolean;
  storageErr: string | null;
  storageSaving: boolean;
  storageTotalGb: string;
  setStorageTotalGb: (v: string) => void;
  storageWarnPercent: string;
  setStorageWarnPercent: (v: string) => void;
  storageCriticalPercent: string;
  setStorageCriticalPercent: (v: string) => void;
  storageSaved: { totalGb: string; warn: string; critical: string };
  loadStorage: (options?: { force?: boolean }) => Promise<void>;
  saveStorageLimits: () => Promise<void>;
  // Retention
  retentionDays: string;
  setRetentionDays: (v: string) => void;
  retentionSaved: string;
  retentionLoading: boolean;
  retentionSaving: boolean;
  retentionErr: string | null;
  retentionLastPrunedAt: string | null;
  saveRetentionDays: () => Promise<void>;
  // Cleanup
  cleanupDays: string;
  setCleanupDays: (v: string) => void;
  cleanupBusy: "" | "temp" | "uploads" | "thumbnails";
  cleanupResult: StorageCleanupResult | null;
  // Actions
  onRequestStorageCleanup: (action: "cleanup_old_uploads" | "cleanup_temp" | "cleanup_thumbnail_assets", title: string) => void;
  onViewUser: (adminKey: string) => void;
};

const overviewPages = [
  { key: "runtime", label: "admin.overviewRuntime" },
  { key: "models", label: "admin.overviewModels" },
  { key: "users", label: "admin.overviewUsers" },
  { key: "storage", label: "admin.overviewStorage" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminOverviewTab({
  storage,
  storageLoading,
  storageErr,
  storageSaving,
  storageTotalGb, setStorageTotalGb,
  storageWarnPercent, setStorageWarnPercent,
  storageCriticalPercent, setStorageCriticalPercent,
  storageSaved,
  loadStorage,
  saveStorageLimits,
  retentionDays, setRetentionDays,
  retentionSaved,
  retentionLoading,
  retentionSaving,
  retentionErr,
  retentionLastPrunedAt,
  saveRetentionDays,
  cleanupDays, setCleanupDays,
  cleanupBusy,
  cleanupResult,
  onRequestStorageCleanup,
  onViewUser,
}: AdminOverviewTabProps) {
  const { label: tLabel } = useUiLocale();
  const desktopMode = useDesktopMode();
  const { text, locale, label: uiLabel, error: uiError } = useUiLocale();
  const fmtTime = (value: string | number | Date) => formatUiDate(locale, value, { dateStyle: "medium", timeStyle: "medium" }, () => formatOriginalTime(value));
  const count = (value: number) => formatUiNumber(locale, value, { maximumFractionDigits: 0 }, () => String(value));
  const storageCount = (value: number) => formatUiNumber(locale, Math.max(0, Number(value) || 0), undefined, () => formatCount(value));
  const runtimeLabel = text(desktopMode ? "admin.overviewLocal" : "admin.overviewRuntime");
  const storageLabel = text(desktopMode ? "admin.overviewLocalStorage" : "admin.overviewStorage");
  const deleteOldWorksLabel = desktopMode ? text("adminStorage.deleteOldWorks") : text("adminStorage.deleteAllUsersOldWorks");
  const pages = desktopMode
    ? [...overviewPages.filter(page => page.key !== "users"), { key: "usage", label: "admin.overviewUsage" } as const]
    : overviewPages;
  const requestedPage = useSearchParams()?.get("view");
  const [selectedPage, setActivePage] = useAdminPageSelection<typeof overviewPages[number]["key"] | "usage">("overview-page", "runtime");
  const activePage = (desktopMode && selectedPage === "users") || (!desktopMode && selectedPage === "usage")
    ? "runtime" : selectedPage;
  React.useEffect(() => {
    if (desktopMode && requestedPage === "usage") setActivePage("usage");
  }, [desktopMode, requestedPage, setActivePage]);
  const [importOrphans, setImportOrphans] = React.useState<ImportOrphanScanState | null>(null);
  const [importOrphanBusy, setImportOrphanBusy] = React.useState<"" | "scan" | "delete">("");
  const [importOrphanError, setImportOrphanError] = React.useState<string | null>(null);
  const cleanupDaysNumber = Number(cleanupDays);
  const cleanupDaysValid = Number.isInteger(cleanupDaysNumber)
    && cleanupDaysNumber >= 1
    && cleanupDaysNumber <= 365;

  const scanImportOrphans = React.useCallback(async () => {
    if (importOrphanBusy) return;
    setImportOrphanBusy("scan");
    setImportOrphanError(null);
    try {
      const res = await fetch("/api/admin/storage/import-orphans", { cache: "no-store" }).catch(() => null);
      if (!res) {
        setImportOrphanError("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.success) {
        setImportOrphanError(String(json?.error || "扫描 imports 未引用素材失败"));
        return;
      }
      setImportOrphans(json as ImportOrphanScanState);
    } finally {
      setImportOrphanBusy("");
    }
  }, [importOrphanBusy]);

  const deleteImportOrphans = React.useCallback(async () => {
    if (importOrphanBusy) return;
    const count = Math.max(0, Number(importOrphans?.totalCount || 0));
    if (!count) return;
    const ok = window.confirm(text("adminStorage.deleteImportOrphansConfirm", { v0: locale === "en" ? formatUiNumber(locale, count) : String(count) }));
    if (!ok) return;
    setImportOrphanBusy("delete");
    setImportOrphanError(null);
    try {
      const res = await fetch("/api/admin/storage/import-orphans", { method: "DELETE" }).catch(() => null);
      if (!res) {
        setImportOrphanError("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.success) {
        setImportOrphanError(String(json?.error || "删除 imports 未引用素材失败"));
        return;
      }
      setImportOrphans(json as ImportOrphanScanState);
      await loadStorage({ force: true }).catch(() => undefined);
    } finally {
      setImportOrphanBusy("");
    }
  }, [importOrphanBusy, importOrphans?.totalCount, loadStorage, locale, text]);

  // Derived storage values
  const storageTone =
    storage?.level === "critical"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/50 dark:bg-rose-500/10 dark:text-rose-200"
      : storage?.level === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200";
  void storageTone; // used by parent storage section

  const storageToneText =
    storage?.level === "critical"
      ? "text-rose-700 dark:text-rose-400"
      : storage?.level === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-emerald-700 dark:text-emerald-400";

  const storageBgColor =
    storage?.level === "critical" ? "bg-rose-500"
    : storage?.level === "warning" ? "bg-amber-500"
    : "bg-emerald-500";

  const diskMeasured = !desktopMode || storage?.diskTotalBytes != null;
  const storageLevelText = !diskMeasured ? "—" : storage?.level === "critical" ? "紧急" : storage?.level === "warning" ? "预警" : "正常";
  const freeSpace = diskMeasured ? bytes(storage?.freeBytes || 0) : "—";
  const storageAnalytics = storage?.analytics;
  const analyticsTotals = storageAnalytics?.totals;
  const capacityOwnership = storageAnalytics?.capacityOwnership;
  const capacitySharesTrusted = capacityOwnership == null || capacityOwnership.complete;
  const analyticsUsers = storageAnalytics?.users || [];

  const analyticsUserIndex = React.useMemo(() => {
    const map = new Map<string, (typeof analyticsUsers)[number]>();
    for (const item of analyticsUsers) {
      const key1 = `${item.adminKey || ""}|${item.userId || ""}|${item.authUserId ?? ""}`;
      const key2 = `${item.userId || ""}|${item.authUserId ?? ""}`;
      if (!map.has(key1)) map.set(key1, item);
      if (!map.has(key2)) map.set(key2, item);
    }
    return map;
  }, [analyticsUsers]);
  void analyticsUserIndex;

  const usersByGeneration = [...analyticsUsers].sort((a, b) => b.generationCount - a.generationCount);
  const usersByStorage = [...analyticsUsers].sort((a, b) => b.storageBytes - a.storageBytes);
  const behavior = storageAnalytics?.behavior;
  const alertItems = (behavior?.alertItems || []).filter(alert => !desktopMode || alert.title !== "用户容量归属率不足");
  const modelUsage = storageAnalytics?.modelUsage;
  const userMaterialRatio = storageAnalytics?.userMaterialRatio;
  const behaviorFunnel = behavior?.funnel || { upload: 0, submit: 0, success: 0, failed: 0, download: 0, delete: 0 };
  const behaviorFailureRate = behaviorFunnel.submit > 0 ? behaviorFunnel.failed / behaviorFunnel.submit : 0;
  const modelRatioItems = modelUsage?.globalModelRatio || [];
  const modelTrend = modelUsage?.modelTrend30 || [];
  const modelColorNames = Array.from(new Set([
    ...Array.from(new Set(modelTrend.flatMap(row => Object.keys(row.models)))).sort(),
    ...modelRatioItems.map(item => item.model).sort(),
  ]));
  const modelColor = (model: string) => ACTIVITY_COLORS[Math.max(0, modelColorNames.indexOf(model)) % ACTIVITY_COLORS.length];

  const modelTrendPoints = React.useMemo(
    () =>
      modelTrend.map((row) => {
        const total = sumModelTrendCounts(row.models);
        const topModel = getTopModelEntry(row.models);
        return {
          day: row.day,
          label: /^\d{4}-\d{2}-\d{2}$/.test(row.day)
            ? formatUiDate(locale, `${row.day}T00:00:00Z`, { month: "short", day: "numeric", timeZone: "UTC" }, () => formatMonthDayLabel(row.day))
            : row.day,
          total,
          topModel: topModel?.model || "暂无主力模型",
          topModelCount: topModel?.count || 0,
          models: row.models || {},
        };
      }),
    [modelTrend, locale]
  );


  const modelTrendSummary = React.useMemo(() => {
    if (!modelTrendPoints.length) return null;
    const total30 = modelTrendPoints.reduce((sum, row) => sum + row.total, 0);
    const recent7 = modelTrendPoints.slice(-7);
    const previous7 = modelTrendPoints.slice(-14, -7);
    const recent7Total = recent7.reduce((sum, row) => sum + row.total, 0);
    const previous7Total = previous7.reduce((sum, row) => sum + row.total, 0);
    const latest = modelTrendPoints[modelTrendPoints.length - 1];
    const peakDays = [...modelTrendPoints].sort((a, b) => b.total - a.total).slice(0, 3);
    const allModels: Record<string, number> = {};
    const recentModels: Record<string, number> = {};
    for (const row of modelTrendPoints) {
      for (const [model, count] of Object.entries(row.models || {})) {
        allModels[model] = (allModels[model] || 0) + (Number(count) || 0);
      }
    }
    for (const row of recent7) {
      for (const [model, count] of Object.entries(row.models || {})) {
        recentModels[model] = (recentModels[model] || 0) + (Number(count) || 0);
      }
    }
    let streakDirection: "up" | "down" | "flat" = "flat";
    let streakLength = 1;
    for (let i = recent7.length - 1; i > 0; i--) {
      const current = recent7[i]?.total || 0;
      const previous = recent7[i - 1]?.total || 0;
      const direction: "up" | "down" | "flat" = current > previous ? "up" : current < previous ? "down" : "flat";
      if (i === recent7.length - 1) streakDirection = direction;
      if (direction === streakDirection) streakLength += 1;
      else break;
    }
    return {
      total30,
      avgDaily: total30 / modelTrendPoints.length,
      recent7Total,
      previous7Total,
      trendDeltaRatio: previous7Total > 0 ? (recent7Total - previous7Total) / previous7Total : recent7Total > 0 ? 1 : 0,
      activeModelCount: Object.keys(allModels).length,
      latest,
      peakDay: peakDays[0],
      peakDays,
      recent7Streak: { direction: streakDirection, length: streakLength },
      recentTopModels: topEntries(recentModels, 4),
    };
  }, [modelTrendPoints]);

  const userModelRatioTop = modelUsage?.userModelRatioTop || [];
  const modelOutcomeItems = modelUsage?.modelOutcomeTop || [];
  const materialShareTop = userMaterialRatio?.userMaterialShareTop || [];
  const materialCountTop = userMaterialRatio?.userMaterialCountShareTop || [];
  const materialTypeRatio = userMaterialRatio?.materialByTypeRatio || [];

  return (
    <div className={`space-y-5 ${activityStyles.scope}`}>
      <div className={activityStyles.pageToolbar}>
        <UiProps ids={{"aria-label":["admin.m208357b7823a"]}}><div role="tablist" aria-label="admin.m208357b7823a" className={activityStyles.pageTabs}>
          {pages.map((page, index) => (
            <button key={page.key} type="button" role="tab" id={`admin-page-${page.key}`}
              aria-controls={`admin-panel-${page.key}`} aria-selected={activePage === page.key}
              tabIndex={activePage === page.key ? 0 : -1}
              onClick={() => setActivePage(page.key)}
              onKeyDown={(event) => {
                const nextIndex = event.key === "ArrowRight" ? (index + 1) % pages.length
                  : event.key === "ArrowLeft" ? (index + pages.length - 1) % pages.length
                  : event.key === "Home" ? 0 : event.key === "End" ? pages.length - 1 : null;
                if (nextIndex === null) return;
                event.preventDefault();
                setActivePage(pages[nextIndex].key);
                document.getElementById(`admin-page-${pages[nextIndex].key}`)?.focus();
              }}
            >{page.key === "runtime" ? runtimeLabel : page.key === "storage" ? storageLabel : text(page.label)}</button>
          ))}
        </div></UiProps>
        {storage?._cache?.storageSnapshotAt && <div className={activityStyles.snapshot}><UiText id="admin.m8b2fa118e255" />{new Date(storage._cache.storageSnapshotAt).toLocaleString(locale, { hour12: false })}</div>}
      </div>
      <section role="tabpanel" id="admin-panel-runtime" aria-labelledby="admin-page-runtime" hidden={activePage !== "runtime"} className="space-y-4">
      <div className={activityStyles.sectionHeading}><h2 id="admin-runtime-heading">{runtimeLabel}</h2><span>{desktopMode ? <UiText id="admin.m1ea1358480a0" /> : <UiText id="admin.m2fb4bf5e2b3c" />}</span></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.mbd4b9655f9fc" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{count(analyticsTotals?.totalGenerations || 0)}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mc6d9da93c0e5" />{count(analyticsTotals?.lifetimeGenerations || 0)}<UiText id="admin.m4bc2f7283ec5" />{pct(analyticsTotals?.successRate || 0)}
          </div>
        </div>
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]">{desktopMode ? <UiText id="admin.m04eba7211bf0" values={{v0: String(behavior?.days || 30)}} /> : <UiText id="admin.m89800e9459a3" />}</div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{count(desktopMode ? behaviorFunnel.failed : analyticsTotals?.activeUsers || 0)}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]">{desktopMode ? <UiText id="admin.mcc477f2b3cb4" values={{v0: String(behaviorFunnel.submit)}} /> : <><UiText id="admin.m573709e7a89f" />{analyticsTotals?.totalUsers || 0}</>}</div>
        </div>
        <div className={activityStyles.card}>
          <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m666f1c71e1e0" /></span>{diskMeasured && <span className={`text-xs ${storageToneText}`}>{desktopMode ? <UiText id="admin.m8d92f243b901" /> : ""}{uiLabel(storageLevelText)} · {storage?.usedPercent.toFixed(1) || 0}%</span>}</div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{bytes(storage?.usedBytes || 0)}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]">
            {desktopMode ? (diskMeasured ? <UiText id="admin.mde141e678381" values={{v0: String(bytes(storage?.diskTotalBytes || 0))}} /> : "") : <><UiText id="admin.m45f1dcf4edfc" />{bytes(storage?.totalLimitBytes || 0)} · </>}{uiLabel(storage?.storageScopeLabel) || <UiText id="admin.m43d525890546" />}
          </div>
        </div>
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m8e0aeec59b2d" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{freeSpace}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2bad60e444b0" />{count(storage?.totalFiles || 0)}</div>
        </div>
      </div>

      {/* Funnel + Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <div className={activityStyles.card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m797e0eaf4a13" />{behavior?.days || 30}<UiText id="admin.m903aa30c5033" /></h3>
            <span className="text-[12px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m53cda9d67ef0" />{pct(behaviorFailureRate)}</span>
          </div>
          <div className={activityStyles.funnelMetrics}>
            {[
              { label: "上传", value: behaviorFunnel.upload, color: "text-blue-400" },
              { label: "提交", value: behaviorFunnel.submit, color: "text-indigo-400" },
              { label: "成功", value: behaviorFunnel.success, color: "text-emerald-400" },
              { label: "失败", value: behaviorFunnel.failed, color: "text-rose-400" },
              { label: "下载", value: behaviorFunnel.download, color: "text-cyan-400" },
              { label: "删除", value: behaviorFunnel.delete, color: "text-amber-400" },
            ].map((item) => (
              <div key={item.label} className={activityStyles.funnelMetric}>
                <div className="text-[12px] text-slate-600 dark:text-[var(--app-muted)]">{uiLabel(item.label)}</div>
                <div className={`mt-1 text-[18px] font-semibold ${item.color}`}>{count(item.value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={activityStyles.card}>
          <h3 className="text-[15px] font-semibold text-[var(--app-fg)] mb-3"><UiText id="admin.me29677585ac0" /></h3>
          <div className="space-y-2.5">
            {alertItems.map((alert, idx) => (
              <div
                key={`alert_${idx}`}
                className={`rounded-lg border px-3 py-2 text-[12px] ${
                  alert.level === "critical"
                    ? "border-rose-300/50 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:text-rose-300"
                    : alert.level === "warning"
                      ? "border-amber-300/60 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:text-amber-300"
                      : "border-blue-300/60 bg-blue-500/10 text-blue-700 dark:border-blue-400/30 dark:text-blue-300"
                }`}
              >
                <div className="font-semibold">{uiLabel(alert.title)}</div>
                <div className="mt-1 opacity-90">{uiLabel(alert.detail)}</div>
              </div>
            ))}
            {!alertItems.length && (
              <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2f9f637115b8" /></div>
            )}
          </div>
        </div>
      </div>

      </section>
      <section role="tabpanel" id="admin-panel-models" aria-labelledby="admin-page-models" hidden={activePage !== "models"} className="space-y-4">
      <div className={activityStyles.sectionHeading}><h2 id="admin-models-heading"><UiText id="admin.m2761486c34e0" /></h2><span><UiText id="admin.m4ff5cc83b6f8" /></span></div>
      <ModelReliabilityPanel />

      {/* Model ratio + trend */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <div className={activityStyles.card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m68a2e05ab34f" /></h3>
            <span className="text-[12px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m52640ea17655" /></span>
          </div>
          <div className="max-h-96 overflow-auto"><UiProps ids={{"label":["admin.m68a2e05ab34f"]}}><AdminActivityTable
            label="admin.m68a2e05ab34f"
            columns={[{ key: "model", label: tLabel("模型") }, { key: "count", label: tLabel("调用"), numeric: true }, { key: "ratio", label: tLabel("占比"), numeric: true }]}
            rows={modelRatioItems.map((item) => ({ key: item.model, cells: {
              model: { value: item.model, color: modelColor(item.model) },
              count: { value: item.count },
              ratio: { value: item.ratio, display: pct(item.ratio), share: item.ratio, color: modelColor(item.model) },
            } }))}
          /></UiProps></div>
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4bb3c7a14269" /></div>
            <div className="max-h-96 overflow-auto"><UiProps ids={{"label":["admin.m4bb3c7a14269"]}}><AdminActivityTable
              label="admin.m4bb3c7a14269"
              columns={[{ key: "model", label: tLabel("模型") }, { key: "total", label: tLabel("调用"), numeric: true }, { key: "success", label: tLabel("成功"), numeric: true }, { key: "failed", label: tLabel("失败"), numeric: true }]}
              rows={modelOutcomeItems.map(item => ({ key: item.model, cells: {
                model: { value: item.model }, total: { value: item.totalCalls },
                success: { value: item.successRate, display: `${item.successCount}（${pct(item.successRate)}）` },
                failed: { value: item.failedRate, display: `${item.failedCount}（${pct(item.failedRate)}）` },
              } }))}
            /></UiProps></div>
          </div>
        </div>

        <div className={activityStyles.card}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m95a2a4e08cc5" /></h3>
              <div className="mt-1 text-[12px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m4e10343671ae" /></div>
            </div>
            {modelTrendSummary?.peakDay ? (
              <div className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-medium text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-500/12 dark:text-cyan-300"><UiText id="admin.mcd4fd6677c07" />{modelTrendSummary.peakDay.label}
              </div>
            ) : null}
          </div>

          {modelTrendSummary ? (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-3">
                  <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m807e3889a505" /></div>
                  <div className="mt-1 text-[20px] font-semibold text-[var(--app-fg)] tabular-nums">{formatCount(modelTrendSummary.recent7Total)}</div>
                  <div className="mt-1 text-[11px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m4d05f3594653" />{formatCount(modelTrendSummary.total30)}</div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-3">
                  <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m66ffbf8da3a7" /></div>
                  <div className={["mt-1 text-[20px] font-semibold tabular-nums", modelTrendSummary.trendDeltaRatio >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"].join(" ")}>
                    {modelTrendSummary.trendDeltaRatio >= 0 ? "+" : ""}{(modelTrendSummary.trendDeltaRatio * 100).toFixed(1)}%
                  </div>
                  <div className="mt-1 text-[11px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m69184b68b16f" />{modelTrendSummary.recent7Streak.direction === "up" ? <UiText id="admin.m14b581d363a8" values={{v0: String(modelTrendSummary.recent7Streak.length)}} /> : ""}
                    {modelTrendSummary.recent7Streak.direction === "down" ? <UiText id="admin.m83a7539fbe75" values={{v0: String(modelTrendSummary.recent7Streak.length)}} /> : ""}
                    {modelTrendSummary.recent7Streak.direction === "flat" ? <UiText id="admin.m1d9d01bcfe5b" /> : ""}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-3">
                  <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m30bda91df293" /></div>
                  <div className="mt-1 text-[14px] font-semibold text-[var(--app-fg)] truncate">{uiLabel(modelTrendSummary.latest.topModel)}</div>
                  <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">{formatCount(modelTrendSummary.latest.total)}<UiText id="admin.mf81526efce19" /></div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-3">
                  <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.me38b524c8c23" /></div>
                  <div className="mt-1 text-[20px] font-semibold text-[var(--app-fg)] tabular-nums">{formatCount(modelTrendSummary.activeModelCount)}</div>
                  <div className="mt-1 text-[11px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.mc71e1db68d7f" />{formatCount(Math.round(modelTrendSummary.avgDaily))}</div>
                </div>
              </div>

              <UiProps ids={{"title":["admin.m115e8ea3a3e5"]}}><AdminActivityChart
                title="admin.m115e8ea3a3e5"
                points={modelTrendPoints.map(row => ({ label: row.day, values: row.models }))}
                series={Array.from(new Set(modelTrendPoints.flatMap(row => Object.keys(row.models)))).sort().map(model => ({ key: model, label: model, color: modelColor(model) }))}
              /></UiProps>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/60 p-3">
                  <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="admin.m8f873780cb16" /></div>
                  <div className="mt-2 space-y-2">
                    {modelTrendSummary.peakDays.map((item, index) => (
                      <div key={`model_peak_day_${item.day}`} className="flex items-center justify-between gap-3 text-[12px]">
                        <div className="min-w-0">
                          <div className="text-[var(--app-fg)]">#{index + 1} {uiLabel(item.label)}</div>
                          <div className="text-[11px] text-slate-600 dark:text-[var(--app-muted)] truncate"><UiText id="admin.m39d06ea95ca7" />{item.topModelCount ? item.topModel : uiLabel(item.topModel)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-[var(--app-fg)] tabular-nums">{formatCount(item.total)}</div>
                          <div className="text-[11px] text-slate-600 dark:text-[var(--app-muted)]"><UiText id="admin.m0f18d238ec3f" />{pct(safeDiv(item.topModelCount, item.total || 1))}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/60 p-3">
                  <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="admin.m07a00d77ff4d" /></div>
                  <div className="mt-2 space-y-2">
                    {modelTrendSummary.recentTopModels.map((item) => {
                      const width = safeDiv(item.value, modelTrendSummary.recentTopModels[0]?.value || 1) * 100;
                      const ratio = safeDiv(item.value, modelTrendSummary.recent7Total || 1);
                      return (
                        <div key={`recent_model_share_${item.label}`} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="truncate text-[var(--app-fg)] max-w-[68%]">{uiLabel(item.label)}</span>
                            <span className="text-slate-600 dark:text-[var(--app-muted)]">{formatCount(item.value)} · {pct(ratio)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-200/90 dark:bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${Math.min(100, width)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {!modelTrendSummary.recentTopModels.length && <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m9a392c0901ae" /></div>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.m87e744ff49fb" /></div>
          )}
        </div>
      </div>

      </section>
      {!desktopMode && <section role="tabpanel" id="admin-panel-users" aria-labelledby="admin-page-users" hidden={activePage !== "users"} className="space-y-4">
      <div className={activityStyles.sectionHeading}><h2 id="admin-users-heading"><UiText id="admin.m58cc1fcd165e" /></h2><span><UiText id="admin.m9c325258cb83" /></span></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m392aef2932e5" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{pct(analyticsTotals?.top10GenerationShare || 0)}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mfeadce73e38d" />{pct(analyticsTotals?.longTailGenerationShare || 0)}</div>
        </div>
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.me6e2810dbe8c" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{bytes(analyticsTotals?.totalUserStorageBytes || 0)}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m155220e17805" />{pct(capacityOwnership?.coverage || 0)}
          </div>
        </div>
      </div>
      {/* User generation/storage rankings */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={activityStyles.card}>
          <div className={activityStyles.cardHeading}><h3><UiText id="admin.m094f2156b4d7" /></h3><span className="text-xs text-[var(--app-muted)]"><UiText id="admin.m0909522d9092" /></span></div>
          <UiProps ids={{"label":["admin.m094f2156b4d7"]}}><AdminActivityTable label="admin.m094f2156b4d7"
            columns={[{key:"user",label:tLabel("用户")},{key:"count",label:tLabel("产出数"),numeric:true},{key:"share",label:tLabel("占比"),numeric:true}]}
            rows={usersByGeneration.slice(0,8).map((user,index)=>({key:user.adminKey,cells:{
              user:{value:adminDisplayName(user),color:ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],action:()=>onViewUser(user.adminKey)},
              count:{value:user.generationCount},share:{value:user.generationShare,display:pct(user.generationShare),share:user.generationShare,color:"#0090ff"},
            }}))}/></UiProps>
        </div>
        <div className={activityStyles.card}>
          <div className={activityStyles.cardHeading}><h3><UiText id="admin.m7674bbc3fb9e" /></h3><span className="text-xs text-[var(--app-muted)]"><UiText id="admin.mf745510104cd" /></span></div>
          {!capacitySharesTrusted && <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><UiText id="admin.mea81a42d31de" />{pct(capacityOwnership?.coverage || 0)}<UiText id="admin.m7f0e5913fced" /></div>}
          <UiProps ids={{"label":["admin.m7674bbc3fb9e"]}}><AdminActivityTable label="admin.m7674bbc3fb9e"
            columns={[{key:"user",label:tLabel("用户")},{key:"bytes",label:tLabel("容量"),numeric:true},{key:"share",label:tLabel("占比"),numeric:true}]}
            rows={usersByStorage.slice(0,8).map(user=>({key:user.adminKey,cells:{
              user:{value:adminDisplayName(user),action:()=>onViewUser(user.adminKey)},bytes:{value:user.storageBytes,display:bytes(user.storageBytes)},
              share:{value:capacitySharesTrusted?user.storageShare:-1,display:capacitySharesTrusted?pct(user.storageShare):"—",share:capacitySharesTrusted?user.storageShare:undefined,color:"#8b5cf6"},
            }}))}/></UiProps>
        </div>
      </div>

      {/* User model ratio + material ratio */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={activityStyles.card}>
          <div className={activityStyles.cardHeading}><h3><UiText id="admin.mc8e7ede6029c" /></h3></div>
          <UiProps ids={{"label":["admin.mc8e7ede6029c"]}}><AdminActivityTable label="admin.mc8e7ede6029c"
            columns={[{key:"user",label:tLabel("用户")},{key:"model",label:tLabel("主用模型")},{key:"count",label:tLabel("总调用"),numeric:true},{key:"share",label:tLabel("主用占比"),numeric:true}]}
            rows={userModelRatioTop.slice(0,8).map(item=>({key:item.adminKey,cells:{
              user:{value:adminDisplayName(item),action:()=>onViewUser(item.adminKey)},model:{value:item.topModel},count:{value:item.totalCalls},
              share:{value:item.topModelRatio,display:pct(item.topModelRatio),share:item.topModelRatio,color:modelColor(item.topModel)},
            }}))}/></UiProps>
        </div>
        <div className={activityStyles.card}>
          <div className={activityStyles.cardHeading}><h3><UiText id="admin.m0115bdd4a9f1" /></h3></div>
          <UiProps ids={{"label":["admin.m26d3f1d03595"]}}><AdminActivityTable label="admin.m26d3f1d03595"
            columns={[{key:"user",label:tLabel("用户")},{key:"bytes",label:tLabel("素材容量"),numeric:true},{key:"share",label:tLabel("占比"),numeric:true}]}
            rows={materialShareTop.slice(0,6).map(item=>({key:item.adminKey,cells:{
              user:{value:adminDisplayName(item),action:()=>onViewUser(item.adminKey)},bytes:{value:item.bytes,display:bytes(item.bytes)},share:{value:item.ratio,display:pct(item.ratio),share:item.ratio,color:"#00bfa5"},
            }}))}/></UiProps>
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-xs text-[var(--app-muted)]"><UiText id="admin.m882d44cec06e" /></div>
            <UiProps ids={{"label":["admin.m1796e42ca1e2"]}}><AdminActivityTable label="admin.m1796e42ca1e2"
              columns={[{key:"user",label:tLabel("用户")},{key:"count",label:tLabel("素材数量"),numeric:true},{key:"share",label:tLabel("占比"),numeric:true}]}
              rows={materialCountTop.slice(0,4).map(item=>({key:item.adminKey,cells:{
                user:{value:adminDisplayName(item),action:()=>onViewUser(item.adminKey)},count:{value:item.count},share:{value:item.ratio,display:pct(item.ratio),share:item.ratio,color:"#9dce2c"},
              }}))}/></UiProps>
            <div className="mt-3 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m0d92bd1847c9" />{materialTypeRatio.map(item=>`${analyticsTypeName(item.type)} ${pct(item.bytesRatio)}`).join(" / ")}</div>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className={activityStyles.card}>
        <h3 className="text-[15px] font-semibold text-[var(--app-fg)] mb-3"><UiText id="admin.mf43e9e44896c" /></h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(storageAnalytics?.insights || []).map((insight, index) => (
            <div key={`insight_${index}`} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]/60 p-3 text-[12px] text-[var(--app-fg)]">
              {insight}
            </div>
          ))}
          {!(storageAnalytics?.insights || []).length && (
            <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m612fecf6b377" /></div>
          )}
        </div>
      </div>

      </section>}
      <section role="tabpanel" id="admin-panel-storage" aria-labelledby="admin-page-storage" hidden={activePage !== "storage"} className="space-y-4">
      <div className={activityStyles.sectionHeading}>
        <h2 id="admin-storage-heading">{storageLabel}</h2><span>{desktopMode ? <UiText id="admin.m9131eb232045" /> : <UiText id="admin.mcbe5a72b4e4a" />}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.mf0f4fa0c463d" /></div>
          <div className={`mt-1.5 text-[22px] font-semibold ${storageToneText}`}>{uiLabel(storageLevelText)}</div>
          <div className="mt-1 text-[12px] opacity-80">{diskMeasured ? <UiText id="admin.mc90daecc6459" values={{v0: formatUiNumber(locale, storage?.usedPercent || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, () => String(storage?.usedPercent.toFixed(1) || 0))}} /> : <UiText id="admin.mb42f7ff9814a" />}</div>
        </div>
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m8e0aeec59b2d" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{diskMeasured ? bytes(storage?.freeBytes || 0, locale) : "—"}</div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2bad60e444b0" />{count(storage?.totalFiles || 0)}</div>
        </div>
        <div className={activityStyles.card}>
          <div className="text-[13px] text-[var(--app-muted)]"><UiText id="admin.m135f23ec84ea" /></div>
          <div className="mt-1.5 text-[22px] font-semibold text-[var(--app-fg)]">{retentionDays}<UiText id="admin.m4ce3054e7c4d" /></div>
          <div className="mt-1 text-[12px] text-[var(--app-muted)] truncate"><UiText id="admin.me3e3ebc6204e" />{retentionLastPrunedAt ? fmtTime(retentionLastPrunedAt) : <UiText id="admin.mb336a174cd1f" />}</div>
        </div>
      </div>
      {/* Governance section */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4">
        <div className="min-w-0 space-y-4">
          {/* Storage limits */}
          <div id="overview-storage-limits" className={activityStyles.card}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2">
                  <HardDrive className="h-4 w-4" /> {desktopMode ? <UiText id="admin.m23dd55d76436" /> : <UiText id="admin.mee6b690b2a36" />}
                </h3>
                <p className="mt-1 text-[12px] text-[var(--app-muted)]">
                  {desktopMode ? <UiText id="admin.mb1c223cfe8ad" /> : uiLabel(storage?.storageScopeNote) || <UiText id="admin.m277cd58b0b1e" />}
                </p>
              </div>
              <button onClick={() => void loadStorage({ force: true })} className="text-[var(--app-muted)] hover:text-[var(--app-fg)]">
                <RefreshCw className={["h-4 w-4", storageLoading ? "animate-spin" : ""].join(" ")} />
              </button>
            </div>

            {diskMeasured && <div className="mb-5">
              <div className="h-3 rounded-full bg-[var(--panel-2)] overflow-hidden flex">
                <div className={`h-full ${storageBgColor} transition-all duration-500`} style={{ width: `${Math.min(100, storage?.usedPercent || 0)}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[12px] text-[var(--app-muted)]">
                <span>0</span>
                <span><UiText id="admin.mb56413a95e0d" />{storage?.warnPercent || 70}%</span>
                <span><UiText id="admin.m7c8f946b68e4" />{storage?.criticalPercent || 85}%</span>
                <span>100%</span>
              </div>
            </div>}

            {!desktopMode && <><div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="storage-total-gb" className="block text-[12px] text-[var(--app-muted)] mb-1"><UiText id="admin.m57d273a9b3e4" /></label>
                <input type="number" min={1} max={10240} step={1} id="storage-total-gb" value={storageTotalGb} onChange={(e) => setStorageTotalGb(e.target.value)} disabled={storageLoading} className="h-10 w-full px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label htmlFor="storage-warn-percent" className="block text-[12px] text-[var(--app-muted)] mb-1"><UiText id="admin.me9b3232de349" /></label>
                <input type="number" min={1} max={99} step={1} id="storage-warn-percent" value={storageWarnPercent} onChange={(e) => setStorageWarnPercent(e.target.value)} disabled={storageLoading} className="h-10 w-full px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
              <div>
                <label htmlFor="storage-critical-percent" className="block text-[12px] text-[var(--app-muted)] mb-1"><UiText id="admin.m1fad2c34cb4a" /></label>
                <input type="number" min={1} max={100} step={1} id="storage-critical-percent" value={storageCriticalPercent} onChange={(e) => setStorageCriticalPercent(e.target.value)} disabled={storageLoading} className="h-10 w-full px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[12px] text-rose-700 dark:text-rose-400">{storageErr ? uiError(storageErr) : ""}</div>
              <button
                type="button"
                onClick={() => void saveStorageLimits()}
                disabled={storageLoading || storageSaving || (storageTotalGb === storageSaved.totalGb && storageWarnPercent === storageSaved.warn && storageCriticalPercent === storageSaved.critical)}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
              >
                {storageSaving ? <UiText id="admin.mff509c9ba052" /> : <UiText id="admin.mdb8ae152e8dd" />}
              </button>
            </div></>}
            {desktopMode && storageErr && <div className="text-[12px] text-rose-700 dark:text-rose-400">{uiError(storageErr)}</div>}
          </div>

          {/* Cleanup */}
          <div id="overview-storage-cleanup" className={activityStyles.card}>
            <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2 mb-2">
              <FolderDown className="h-4 w-4" /> {desktopMode ? <UiText id="admin.ma11073af4bae" /> : <UiText id="admin.m252450f4754e" />}
            </h3>
            <p className="mb-3 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m15d29aafb278" /></p>
            <div className="mb-3 grid gap-2 lg:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <div className="text-[12px] font-semibold text-[var(--app-fg)]">{deleteOldWorksLabel}<UiText id="admin.md6072a6373c3" /></div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m431e4047369c" />{desktopMode ? <UiText id="admin.m8a94c4a1cdbd" /> : <UiText id="admin.m5e06b291b00e" />}<UiText id="admin.ma805e898e84f" /></p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <div className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mc0e347b355bc" /></div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m03de386a36e8" /></p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <div className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m0b4cd6fe4622" /></div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m6ca2b7d87345" /></p>
              </div>
            </div>
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mb-4">{desktopMode ? <UiText id="admin.mb465a2f11d61" /> : <UiText id="admin.m142356ea92c2" />}</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mf59407a7be12" /></label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(e.target.value)}
                  disabled={storageLoading || cleanupBusy !== ""}
                  className="h-9 w-[80px] px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <label className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.ma691d1287ac2" /></label>
              </div>
              <button
                type="button"
                onClick={() => onRequestStorageCleanup(
                  "cleanup_old_uploads",
                  desktopMode
                    ? text("adminStorage.deleteOldLocalConfirm", { v0: count(cleanupDaysNumber) })
                    : text("adminStorage.deleteOldWebConfirm", { v0: count(cleanupDaysNumber) }),
                )}
                disabled={storageLoading || cleanupBusy !== "" || !cleanupDaysValid}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-rose-600/90 text-white text-[13px] font-semibold hover:bg-rose-500 disabled:opacity-50 transition"
              >
                {cleanupBusy === "uploads" ? <UiText id="admin.m5e8e7af57abb" /> : deleteOldWorksLabel}
              </button>
              <button
                type="button"
                onClick={() => onRequestStorageCleanup("cleanup_temp", text("adminStorage.cleanupTempConfirm"))}
                disabled={storageLoading || cleanupBusy !== "" || !cleanupDaysValid}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
              >
                {cleanupBusy === "temp" ? <UiText id="admin.m248e8cfc2116" /> : <UiText id="admin.mc0e347b355bc" />}
              </button>
              <button
                type="button"
                onClick={() => onRequestStorageCleanup("cleanup_thumbnail_assets", text("adminStorage.cleanupThumbnailsConfirm"))}
                disabled={storageLoading || cleanupBusy !== "" || !cleanupDaysValid}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
              >
                {cleanupBusy === "thumbnails" ? <UiText id="admin.m248e8cfc2116" /> : <UiText id="admin.m0b4cd6fe4622" />}
              </button>
            </div>
            <p className={`mt-2 text-[11px] ${cleanupDaysValid ? "text-[var(--app-muted)]" : "text-amber-700 dark:text-amber-400"}`}>
              {cleanupDaysValid
                ? <UiText id="admin.m7053a0b25451" values={{v0: String(cleanupDaysNumber)}} />
                : <UiText id="admin.m6d1934509dd1" />}
            </p>
            {cleanupResult ? (
              <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mf693cfa3e681" /></div>
                    <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">
                      {cleanupResult.action === "cleanup_old_uploads"
                        ? deleteOldWorksLabel
                        : cleanupResult.action === "cleanup_thumbnail_assets"
                          ? <UiText id="admin.m0b4cd6fe4622" />
                          : <UiText id="admin.mc0e347b355bc" />}
                      {" · "}<UiText id="admin.mec420f113d6a" />{storageCount(cleanupResult.days)}<UiText id="admin.m5972982ce6bc" /></div>
                  </div>
                  <div className="text-[11px] text-[var(--app-muted)]">{fmtTime(cleanupResult.at)}</div>
                </div>

                {cleanupResult.action === "cleanup_old_uploads" ? (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ["生成记录", storageCount(cleanupResult.deletedGenerations)],
                        ["关联日志", storageCount(cleanupResult.deletedLogs)],
                        ["用量账单", storageCount(cleanupResult.deletedLedgers)],
                        ["本地文件", storageCount(cleanupResult.deletedLocalFiles)],
                        ["OSS 对象", storageCount(cleanupResult.deletedOssObjects)],
                        ["释放空间", bytes(cleanupResult.deletedBytes, locale)],
                        ["共享/非托管跳过", storageCount(cleanupResult.skippedSharedRefs)],
                        ["受保护资源跳过", storageCount(cleanupResult.skippedProtectedRefs)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
                          <div className="text-[10px] text-[var(--app-muted)]">{uiLabel(label)}</div>
                          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[var(--app-fg)]">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m368109e6a8d9" />{fmtTime(cleanupResult.cutoff)}<UiText id="admin.mee5426f63116" /></div>
                    {cleanupResult.ossErrorCount > 0 ? (
                      <div className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300"><UiText id="admin.md3b7851688ea" />{storageCount(cleanupResult.ossErrorCount)}<UiText id="admin.m8425703b7f14" /></div>
                    ) : null}
                  </>
                ) : cleanupResult.action === "cleanup_thumbnail_assets" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["缓存缩略图", storageCount(cleanupResult.deletedCacheFiles)],
                      ["孤立预览图", storageCount(cleanupResult.deletedOrphanFiles)],
                      ["受保护引用", storageCount(cleanupResult.protectedFiles)],
                      ["删除失败", storageCount(cleanupResult.failedFiles)],
                      ["释放空间", bytes(cleanupResult.deletedBytes, locale)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
                        <div className="text-[10px] text-[var(--app-muted)]">{uiLabel(label)}</div>
                        <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[var(--app-fg)]">{value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      ["临时文件", storageCount(cleanupResult.deletedFiles)],
                      ["空目录", storageCount(cleanupResult.removedDirs)],
                      ["释放空间", bytes(cleanupResult.deletedBytes, locale)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
                        <div className="text-[10px] text-[var(--app-muted)]">{uiLabel(label)}</div>
                        <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[var(--app-fg)]">{value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Retention policy */}
          <div className={activityStyles.card}>
            <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4" /> {desktopMode ? <UiText id="admin.m8e78b0b776bf" /> : <UiText id="admin.ma3eb515b807e" />}
            </h3>
            <p className="text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m684f9ae6bbdf" />{desktopMode ? <UiText id="admin.m8a94c4a1cdbd" /> : <UiText id="admin.m5e06b291b00e" />}<UiText id="admin.m60c4814f2f66" /></p>
            <p className="mb-4 mt-1 text-[12px] text-amber-700 dark:text-amber-400"><UiText id="admin.ma88d9578be89" /></p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[120px]">
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  disabled={retentionLoading}
                  className="h-9 w-full pl-3 pr-8 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m49da61ceeea2" /></span>
              </div>
              <button
                type="button"
                onClick={() => void saveRetentionDays()}
                disabled={retentionLoading || retentionSaving || String(retentionDays || "").trim() === String(retentionSaved || "").trim()}
                className="h-9 px-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
              >
                {retentionSaving ? <UiText id="admin.mff509c9ba052" /> : <UiText id="admin.ma3030bf8f16d" />}
              </button>
            </div>
            {retentionErr && <div className="mt-2 text-[12px] text-rose-500">{uiError(retentionErr)}</div>}
          </div>
        </div>

        {/* Storage detail */}
        <div className="min-w-0 space-y-4">
          <div className={activityStyles.card}>
            <h3 className="text-[14px] font-semibold text-[var(--app-fg)] mb-4"><UiText id="admin.mf0df39f67a29" /></h3>
            {desktopMode ? <div className="mb-3 flex min-w-0 items-center gap-2 text-[11px] text-[var(--app-muted)]">
              <div className="min-w-0 flex-1 truncate" title={storage?.uploadsRoot || ""}><UiText id="admin.m07fb0a3d7556" />{storage?.uploadsRoot || <UiText id="admin.m9ca53e07090f" />}</div>
              <DesktopDirectoryLink directory="data" />
            </div> : <div className="mb-3 truncate text-[11px] text-[var(--app-muted)]" title={storage?.uploadsRoot || ""}><UiText id="admin.m07fb0a3d7556" />{storage?.uploadsRoot || <UiText id="admin.m9ca53e07090f" />}
            </div>}
            <div className="space-y-3">
              {storage?.categories.slice(0, 5).map((c) => (
                <div key={c.folder} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="truncate text-[13px] text-[var(--app-muted)]">{c.label && c.label !== c.folder ? uiLabel(c.label) : c.folder}</div>
                      <span
                        className={["inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none", storageSourceBadgeClass(c.source)].join(" ")}
                        title={text("adminStorage.source", { v0: uiLabel(storageSourceLabel(c.source)) })}
                      >
                        {uiLabel(storageSourceLabel(c.source))}
                      </span>
                    </div>
                    <div
                      className="mt-1 truncate text-[11px] text-[var(--app-muted)]/85"
                      title={[
                        c.localPath ? text("adminStorage.localDirectory", { v0: c.localPath }) : "",
                        c.source !== "local" && c.ossPrefix ? text("adminStorage.ossPrefix", { v0: c.ossPrefix }) : "",
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    >
                      {c.source !== "local" && c.ossPrefix
                        ? `${c.localRelativePath || c.localPath || ""} | ${c.ossPrefix}`
                        : c.localRelativePath || c.localPath || <UiText id="admin.m567e8a3f1b7d" />}
                    </div>
                  </div>
                  <div className="shrink-0 text-[13px] font-semibold text-[var(--app-fg)]">{bytes(c.bytes, locale)}</div>
                </div>
              )) || <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m497c85690c4c" /></div>}
            </div>
          </div>
          {!desktopMode && <div className={activityStyles.card}>
            <h3 className="text-[14px] font-semibold text-[var(--app-fg)] mb-4"><UiText id="admin.m022a4af29e13" /></h3>
            <div className="space-y-3">
              {storage?.topUsers.slice(0, 5).map((u) => (
                <div key={u.adminKey || u.userId} className="flex items-center justify-between group">
                  <div className="min-w-0 flex items-center gap-2">
                    <div
                      className="h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={u.username ? { background: "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: "#fff" } : { background: "var(--panel-2)", color: "var(--app-muted)" }}
                    >
                      {u.username ? u.username.charAt(0).toUpperCase() : "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-[var(--app-fg)] truncate max-w-[110px]" title={adminDisplayName(u as any)}>{adminDisplayName(u as any)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-[13px] font-semibold text-[var(--app-fg)]">{count(u.generationCount)}<UiText id="admin.m624202088948" /></div>
                    <button
                      onClick={() => onViewUser(u.adminKey || (typeof u.authUserId === "number" ? `auth:${u.authUserId}` : `guest:${u.userId}`))}
                      className="opacity-0 group-hover:opacity-100 text-[11px] text-blue-700 hover:underline dark:text-blue-400"
                    ><UiText id="admin.mdb8db0530432" /></button>
                  </div>
                </div>
              )) || <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m497c85690c4c" /></div>}
            </div>
          </div>}
        </div>
      </div>

      <div className={activityStyles.card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
              <Trash2 className="h-4 w-4" /><UiText id="admin.m2553682db1d2" /></h3>
            <p className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.me3d9b2fdc1f1" /></p>
            {importOrphans ? (
              <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.ma604e785569d" />{fmtTime(importOrphans.scannedAt)}<UiText id="admin.m205c97b3a220" />{importOrphans.cooldownHours}<UiText id="admin.m25ebd8d7f105" />{fmtTime(importOrphans.cutoff)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void scanImportOrphans()}
              disabled={storageLoading || importOrphanBusy !== ""}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-4 text-[13px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:opacity-50"
            >
              <RefreshCw className={["h-4 w-4", importOrphanBusy === "scan" ? "animate-spin" : ""].join(" ")} />
              {importOrphanBusy === "scan" ? <UiText id="admin.m463fa583e0d3" /> : <UiText id="admin.mc2a291b64f6b" />}
            </button>
            <button
              type="button"
              onClick={() => void deleteImportOrphans()}
              disabled={storageLoading || importOrphanBusy !== "" || !importOrphans?.totalCount}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-600/90 px-4 text-[13px] font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {importOrphanBusy === "delete" ? <UiText id="admin.m5e8e7af57abb" /> : <UiText id="admin.m749f46073eec" />}
            </button>
          </div>
        </div>
        {importOrphanError ? (
          <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600">
            {uiError(importOrphanError)}
          </div>
        ) : null}
        {importOrphans ? (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/50 px-3 py-2">
                <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m2282a02387c3" /></div>
                <div className="mt-1 text-[18px] font-semibold text-[var(--app-fg)]">{storageCount(importOrphans.totalCount)}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/50 px-3 py-2">
                <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m66e738bffa2f" /></div>
                <div className="mt-1 text-[18px] font-semibold text-[var(--app-fg)]">{bytes(importOrphans.totalBytes, locale)}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/50 px-3 py-2">
                <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m9394f86f729c" /></div>
                <div className="mt-1 text-[18px] font-semibold text-[var(--app-fg)]">
                  {typeof importOrphans.deletedCount === "number" ? <UiText id="admin.mb0601260dd97" values={{v0: String(storageCount(importOrphans.deletedCount)), v1: String(bytes(importOrphans.deletedBytes || 0, locale))}} /> : <UiText id="admin.m231fe2204265" />}
                </div>
              </div>
            </div>
            {importOrphans.candidates.length ? (
              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                <div className="grid grid-cols-[minmax(0,1fr)_70px_90px_110px] gap-3 border-b border-[var(--border)] bg-[var(--panel-2)]/60 px-3 py-2 text-[11px] font-semibold text-[var(--app-muted)]">
                  <div><UiText id="admin.m77e1ea5c5688" /></div>
                  <div><UiText id="admin.mba40014ff496" /></div>
                  <div><UiText id="admin.m50db7447b966" /></div>
                  <div><UiText id="admin.m486735ad40ad" /></div>
                </div>
                {importOrphans.candidates.slice(0, 8).map((item) => (
                  <div key={item.path} className="grid grid-cols-[minmax(0,1fr)_70px_90px_110px] gap-3 border-b border-[var(--border)] px-3 py-2 text-[12px] last:border-b-0">
                    <div className="truncate font-mono text-[11px] text-[var(--app-muted)]" title={item.path}>{item.path}</div>
                    <div className="text-[var(--app-fg)]">{item.type === "video" ? <UiText id="admin.mc20f7618d330" /> : <UiText id="admin.md24c10d37db0" />}</div>
                    <div className="text-[var(--app-fg)]">{bytes(item.sizeBytes, locale)}</div>
                    <div className="text-[var(--app-muted)]">{storageCount(item.ageHours)}<UiText id="admin.m8f82ece04f3a" /></div>
                  </div>
                ))}
                {importOrphans.candidates.length > 8 ? (
                  <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m49f641a99114" /></div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] px-3 py-3 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mb7f9c0d70ebb" /></div>
            )}
            {importOrphans.failed?.length ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300"><UiText id="admin.ma6815db95ff5" />{storageCount(importOrphans.failed.length)}<UiText id="admin.m533b6c32869f" /></div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={activityStyles.card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m8f68cbb4013a" /></h3>
            <span className="rounded-md bg-[var(--panel-2)]/60 px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--app-muted)]">
              {count(storage?.uploadsTree?.length || 0)}<UiText id="admin.mf9d529eacdf3" /></span>
          </div>
          <div
            className="truncate rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/60 px-2.5 py-1 font-mono text-[11px] text-[var(--app-muted)]"
            title={storage?.uploadsRoot || ""}
          ><UiText id="admin.m07fb0a3d7556" />{storage?.uploadsRoot || <UiText id="admin.m9ca53e07090f" />}
          </div>
        </div>
        <div className="mt-4">
          {storage?.uploadsTree?.length ? (
            <UploadsTreePanels nodes={storage.uploadsTree} />
          ) : (
            <div className="rounded-lg border border-[var(--border)] p-6 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.ma48f9ad7cdae" /></div>
          )}
        </div>
      </div>
      </section>
      {desktopMode && activePage === "usage" && (
        <div role="tabpanel" id="admin-panel-usage" aria-labelledby="admin-page-usage">
          <AccountUsageSection />
        </div>
      )}
    </div>
  );
}
