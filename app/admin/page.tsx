"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";
import { formatUiDate } from "@/i18n/format";
import type { UiLocale } from "@/i18n/locale";


import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { LayoutDashboard, Users, Settings, Activity, AlertTriangle, BookOpen, ChartColumn, ChevronDown, Copy, Database, Download, FileImage, FileText, FolderDown, HardDrive, LogOut, Package2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, User, X } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { AutoHideScrollbar } from "@/components/ui/auto-hide-scrollbar";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import type { WorkDetailItem } from "@/components/works/work-detail-modal";
const WorkDetailModal = dynamic(() => import("@/components/works/work-detail-modal").then(m => m.WorkDetailModal));
import { getMediaUrlExtension, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { scheduleIdleBatches } from "@/lib/browser/idle-batches";
import type { FeedbackCenterPanelHandle } from "@/components/admin/FeedbackCenterPanel";
const loadFeedbackCenterPanel = () => import("@/components/admin/FeedbackCenterPanel");
const FeedbackCenterPanel = dynamic(() => loadFeedbackCenterPanel().then(m => m.FeedbackCenterPanelEntry), { loading: AdminFeedbackLoading });
import { type BuiltinPresetsSectionHandle } from "@/components/admin/BuiltinPresetsSection";
import type { StorageCleanupResult } from "@/components/admin/AdminOverviewTab";
const loadAdminOverviewTab = () => import("@/components/admin/AdminOverviewTab");
const AdminOverviewTab = dynamic(loadAdminOverviewTab, { loading: AdminOverviewLoading });
import UserPurgeModal from "@/components/admin/UserPurgeModal";
import UserListSidebar from "@/components/admin/UserListSidebar";
import { isHiddenDesktopAdminTab, useDesktopMode } from "@/components/system/desktop-mode";
import AdminConfirmModal from "@/components/admin/AdminConfirmModal";
import AdminTopHeader from "@/components/admin/AdminTopHeader";
import { AdminOverviewLoading, AdminMonitoringLoading, AdminSystemLoading, AdminFeedbackLoading, AdminLogsLoading, AdminUserDetailLoading } from "@/components/admin/admin-loading";
import type { AdminLogsPanelHandle } from "@/components/admin/AdminLogsPanel";
const loadAdminLogsPanel = () => import("@/components/admin/AdminLogsPanel");
const AdminLogsPanel = dynamic(() => loadAdminLogsPanel().then(m => m.AdminLogsPanelEntry), { loading: AdminLogsLoading });
const loadSettingsLogsPanel = () => import("@/components/settings/logs-panel");
const SettingsLogsPanel = dynamic(() => loadSettingsLogsPanel().then(m => m.SettingsLogsPanel), { loading: AdminLogsLoading });
import type { AdminMonitoringPanelHandle } from "@/components/admin/monitoring/AdminMonitoringPanel";
const loadAdminMonitoringPanel = () => import("@/components/admin/monitoring/AdminMonitoringPanel");
const AdminMonitoringPanel = dynamic(() => loadAdminMonitoringPanel().then(m => m.AdminMonitoringPanelEntry), { loading: AdminMonitoringLoading });
import { clearAuthUsersCache } from "@/lib/admin/auth-users-cache";
import { adminCanvasCache } from "@/lib/admin-canvas-cache";
import { getValidUserTab, writeUserPageLocation } from "@/lib/admin/user-page-location";
import UserDetailTabBar, { type UserDetailTab } from "@/components/admin/UserDetailTabBar";
import {
  SYSTEM_SETTING_NAV_ENTRIES,
  DESKTOP_SYSTEM_SETTING_NAV_ENTRIES,
  VALID_DESKTOP_SYSTEM_SECTION_KEYS,
  VALID_SYSTEM_SECTION_KEYS,
  type SystemSectionKey,
} from "@/components/admin/system-navigation";
import { useAdminStorage, type AdminStoragePayload, ADMIN_STORAGE_QUERY_KEY } from "@/lib/hooks/use-admin-storage";
import { useQueryClient } from "@tanstack/react-query";
import UserExportModal, { type ExportOptions, type ExportProgressState } from "@/components/admin/UserExportModal";
import ImportProgressModal, { type ImportProgressState } from "@/components/admin/ImportProgressModal";
import type { ImportAccountOptions, ImportNeedsInput } from "@/lib/admin/user-migration-contracts";
import type { ModelFailurePeriod } from "@/lib/admin-model-failure";
import type { AdminUserStorageSummary } from "@/lib/admin-user-storage-summary";
import type { PromptPresetDto } from "@/lib/prompt-presets/contracts";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";
import { publishGenerationDeleted } from "@/lib/generation-deletion-events";
import {
  applyAssetSourceFilterSearchParams,
  type AssetSourceFilterValue,
} from "@/lib/assets/source-filter";
import {
  AdminUserWorksCache,
  AdminWorksRequestGate,
  mergeAdminWorks,
  appendAdminWorksPage,
  buildAdminWorksChangesQuery,
  canStartAdminWorksPolling,
  parseAdminWorksCursor,
  type AdminWorksCursor,
} from "@/components/admin/admin-user-works-state";

function AdminPanelLoading() {
  return <AdminUserDetailLoading />;
}

const loadAdminSystemTab = () => import("@/components/admin/AdminSystemTab");
const loadUserAnalysisPanel = () => import("@/components/admin/UserAnalysisPanel");
const loadUserBillingPanel = () => import("@/components/admin/UserBillingPanel");
const loadUserCanvasesPanel = () => import("@/components/admin/UserCanvasesPanel");
const loadUserWorksPanel = () => import("@/components/admin/UserWorksPanel");
const loadUserMaterialAssetsPanel = () => import("@/components/admin/UserMaterialAssetsPanel");
const loadUserPresetsPanel = () => import("@/components/admin/UserPresetsPanel");
const loadUserRoleSkillsPanel = () => import("@/components/admin/UserRoleSkillsPanel");

const AdminSystemTab = dynamic(loadAdminSystemTab, { loading: AdminSystemLoading });
const UserAnalysisPanel = dynamic(loadUserAnalysisPanel, { loading: AdminPanelLoading });
const UserBillingPanel = dynamic(loadUserBillingPanel, { loading: AdminPanelLoading });
const UserCanvasesPanel = dynamic(loadUserCanvasesPanel, { loading: AdminPanelLoading });
const UserWorksPanel = dynamic(loadUserWorksPanel, { loading: AdminPanelLoading });
const UserMaterialAssetsPanel = dynamic(loadUserMaterialAssetsPanel, { loading: AdminPanelLoading });
const UserPresetsPanel = dynamic(loadUserPresetsPanel, { loading: AdminPanelLoading });
const UserRoleSkillsPanel = dynamic(loadUserRoleSkillsPanel, { loading: AdminPanelLoading });

type MainTab = "overview" | "monitoring" | "users" | "feedback_center" | "system" | "audit_logs";

type AdminUserItem = {
  adminKey: string;
  userId: string;
  username: string | null;
  generationCount: number;
  lastCreatedAt: string | null;
  summaryUpdatedAt?: string | null;
  authUserId?: number | null;
  linkedUserIds?: string[];
  deviceCount?: number;
};

type Generation = {
  id: number;
  userId: string;
  type: string;
  source: string;
  prompt: string;
  model: string | null;
  status: string;
  externalProvider: string | null;
  externalTaskId: string | null;
  errorMsg: string | null;
  localPath: string | null;
  createdAt: string;
  updatedAt?: string | null;
  finishedAt: string | null;
  params?: Record<string, any> | null;
  inputMaterials?: string[];
  outputPaths?: string[];
};

type AdminUserPayload = {
  analysisDetailsIncluded?: boolean;
  scopeKey?: string;
  userId: string;
  authUserId?: number | null;
  presetDeletedCount: number;
  linkedUserIds?: string[];
  account?: {
    requestedUserId: string;
    authUserId?: number | null;
    username?: string | null;
    registeredAt?: string | null;
    updatedAt?: string | null;
    linkedUserIds?: string[];
    deviceCount: number;
    firstGenerationAt?: string | null;
    lastGenerationAt?: string | null;
    lastFinishedAt?: string | null;
    activeDays: number;
    totalGenerationRecords: number;
    generatedRecords: number;
    importRecords: number;
    logRecords: number;
    feedbackRecords: number;
    privateLibraryItems: number;
    privateLibraryBytes: number;
    billingRecords: number;
    billingAmount: number;
    agentConversations: number;
    agentMessages: number;
    agentRuns: number;
    agentInputTokens: number;
    agentOutputTokens: number;
    agentAvgLatencyMs: number;
    activeMemories: number;
    totalMemories: number;
  };
  counts: { byType: Record<string, number>; byStatus: Record<string, number> };
  analytics?: {
    bySource: Record<string, number>;
    byModel: Record<string, number>;
    modelFailurePeriods?: ModelFailurePeriod[];
    preferenceFlows?: Array<{ model: string; taskType: string; aspectRatio: string; resolution: string; value: number }>;
    params: {
      aspectRatio: Record<string, number>;
      resolution: Record<string, number>;
      taskType: Record<string, number>;
      speed: Record<string, number>;
      version: Record<string, number>;
    };
    totals: { uploads: number; outputs: number; failed: number; successRate: number };
    logs?: {
      total: number;
      byCategory: Record<string, number>;
      byLevel: Record<string, number>;
      dailyByCategory?: Record<string, Record<string, number>>;
    };
    billing?: {
      trendPeriods?: import("@/lib/admin/billing-trend").BillingTrendPeriod[] | null;
      totalRecords: number;
      totalAmount: number;
      currency: string;
      byCostStatus: Record<string, number>;
      amountByCostStatus: Record<string, number>;
      byModule: Record<string, number>;
      amountByModule: Record<string, number>;
    };
    agent?: {
      totalConversations: number;
      totalMessages: number;
      totalRuns: number;
      totalMemories: number;
      activeMemories: number;
      inputTokens: number;
      outputTokens: number;
      avgLatencyMs: number;
      conversationsByStatus: Record<string, number>;
      runsByStatus: Record<string, number>;
      runsByModel: Record<string, number>;
      runsByPurpose: Record<string, number>;
    };
    daily14?: Record<string, number>;
    recentActivities: {
      id: number;
      category: string;
      action: string;
      level: string;
      message: string;
      createdAt: string;
      metadata?: Record<string, any> | null;
    }[];
  };
  files: { totalReferenced: number; totalBytes: number };
  storage?: AdminUserStorageSummary;
  materialAssets?: {
    categories?: Array<{ key: string; label: string; count: number }>;
    current: Array<{
      id: number;
      category: string | null;
      title: string;
      imageUrl: string;
      thumbnailUrl: string | null;
      previewUrl?: string | null;
      sizeBytes?: number | null;
      creatorName?: string | null;
      selectedByUserId?: number | null;
      selectedByUsername?: string | null;
      selectedAt?: string | null;
      createdAt?: string | null;
      downloadCount?: number;
    }>;
    archived?: Array<{
      id: number;
      category: string | null;
      title: string;
      imageUrl: string;
      thumbnailUrl: string | null;
      previewUrl?: string | null;
      sizeBytes?: number | null;
      creatorName?: string | null;
      selectedByUserId?: number | null;
      selectedByUsername?: string | null;
      selectedAt?: string | null;
      createdAt?: string | null;
      downloadCount?: number;
    }>;
    events: Array<{
      id: number;
      assetId: number;
      userId?: number | null;
      username: string;
      action: string;
      reason?: string | null;
      operatorUsername?: string | null;
      occurredAt?: string | null;
      asset?: {
        id: number;
        category: string | null;
        title: string;
        imageUrl: string;
        thumbnailUrl: string | null;
        previewUrl?: string | null;
        creatorName?: string | null;
        isDeleted?: boolean;
        isSelected?: boolean;
        selectedByUserId?: number | null;
        selectedByUsername?: string | null;
      } | null;
    }>;
    stats: { currentSelected: number; selects: number; cancelRequests: number; releases: number; archived?: number; eventTotal?: number };
    pagination?: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean };
    archivedPagination?: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean; loaded?: boolean };
    eventsPagination?: { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean; loaded?: boolean; action?: string; allTotal?: number };
  };
  pagination?: { page: number; pageSize: number; nextCursor?: string | null; total: number | null; totalPages: number; hasMore: boolean; kind: string };
  syncCursor?: AdminWorksCursor;
  generations: Generation[];
  feedbacks?: {
    id: number;
    createdAt: string;
    level: string;
    userId: string;
    username: string | null;
    feedbackType: string;
    content: string;
    attachments: string[];
  }[];
  presets: PromptPresetDto[];
  roleSkills: RoleSkillDetail[];
};

function mergeAdminUserAnalysisPayload(summary: AdminUserPayload, details: AdminUserPayload): AdminUserPayload {
  return {
    ...summary,
    account: { ...summary.account, ...details.account } as AdminUserPayload["account"],
    counts: details.counts || summary.counts,
    analytics: { ...summary.analytics, ...details.analytics } as AdminUserPayload["analytics"],
    files: details.files || summary.files,
    storage: details.storage || summary.storage,
    presets: details.presets,
    presetDeletedCount: details.presetDeletedCount,
    analysisDetailsIncluded: true,
  };
}

const ADMIN_USER_PAYLOAD_CACHE_TTL_MS = 5 * 60 * 1000;
const ADMIN_PREFETCH_TTL_MS = 30 * 1000;
const ADMIN_PREFETCH_IDLE_DELAY_MS = 1500;
const adminUserPayloadCache = new Map<string, { payload: AdminUserPayload; cachedAt: number }>();
function cacheAdminUserPayload(key: string, entry: { payload: AdminUserPayload; cachedAt: number }) {
  adminUserPayloadCache.delete(key);
  for (const [oldKey, old] of adminUserPayloadCache) {
    if (Date.now() - old.cachedAt >= ADMIN_USER_PAYLOAD_CACHE_TTL_MS) adminUserPayloadCache.delete(oldKey);
  }
  adminUserPayloadCache.set(key, entry);
  while (adminUserPayloadCache.size > 30) adminUserPayloadCache.delete(adminUserPayloadCache.keys().next().value!);
}
const adminUserWorksCache = new AdminUserWorksCache<AdminUserPayload>({
  ttlMs: ADMIN_USER_PAYLOAD_CACHE_TTL_MS,
  maxUsers: 10,
  maxItems: 240,
});
const ADMIN_LIVE_POLL_MS = 5000;
const ADMIN_LIVE_POLL_BACKOFF_MAX_MS = 30000;
const IMPORT_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
const IMPORT_UPLOAD_RETRIES = 3;
const IMPORT_UPLOAD_RETRY_DELAY_MS = 750;

function getAdminUserPayloadCacheKey({
  userId,
  authUserId,
  tab,
  typeFilter,
  page,
  pageSize,
  archivedOpen,
  archivedPage,
  archivedPageSize,
  eventsOpen,
  eventsPage,
  eventsPageSize,
  eventsAction,
  materialCategory,
  materialSelectedFrom,
  materialSelectedTo,
}: {
  userId: string;
  authUserId?: number | null;
  tab: string;
  typeFilter: string;
  page: number;
  pageSize: number;
  archivedOpen?: boolean;
  archivedPage?: number;
  archivedPageSize?: number;
  eventsOpen?: boolean;
  eventsPage?: number;
  eventsPageSize?: number;
  eventsAction?: string;
  materialCategory?: string;
  materialSelectedFrom?: string;
  materialSelectedTo?: string;
}) {
  return [
    `user:${userId}`,
    `auth:${typeof authUserId === "number" ? authUserId : ""}`,
    `tab:${tab}`,
    `type:${typeFilter}`,
    `page:${page}`,
    `size:${pageSize}`,
    archivedOpen ? "archived:1" : "archived:0",
    `archivedPage:${archivedPage || 1}`,
    `archivedSize:${archivedPageSize || 50}`,
    eventsOpen ? "events:1" : "events:0",
    `eventsPage:${eventsPage || 1}`,
    `eventsSize:${eventsPageSize || 20}`,
    `eventsAction:${eventsAction || "all"}`,
    `materialCategory:${materialCategory || "all"}`,
    `materialFrom:${materialSelectedFrom || ""}`,
    `materialTo:${materialSelectedTo || ""}`,
  ].join("|");
}

function getAdminUserPayloadCacheTab(tab: string) {
  if (tab === "works") return "works";
  if (tab === "materials") return "materials";
  if (tab === "presets") return "presets";
  if (tab === "skills") return "skills";
  return "profile";
}

function clearAdminUserPayloadCacheForUser(userId?: string | null) {
  adminUserWorksCache.clear();
  if (!userId) {
    adminUserPayloadCache.clear();
    return;
  }
  const prefix = `user:${userId}|`;
  for (const key of Array.from(adminUserPayloadCache.keys())) {
    if (key.startsWith(prefix)) adminUserPayloadCache.delete(key);
  }
}

function getLatestWorksCursor(items: Generation[]) {
  let updatedAt: string | null = null;
  let id = 0;
  let bestTime = 0;
  for (const item of items) {
    const iso = String(item.updatedAt || item.finishedAt || item.createdAt || "").trim();
    const t = new Date(iso || 0).getTime();
    if (!iso || Number.isNaN(t)) continue;
    if (t > bestTime || (t === bestTime && Number(item.id || 0) > id)) {
      bestTime = t;
      updatedAt = iso;
      id = Number(item.id || 0);
    }
  }
  return updatedAt ? { updatedAt, id } : null;
}

function getLatestUsersSummaryCursor(items: AdminUserItem[]) {
  let best = "";
  let bestTime = 0;
  for (const item of items) {
    // 与后端 summary-changes 的过滤口径一致：优先 summaryUpdatedAt，回退 lastCreatedAt。
    const iso = String(item.summaryUpdatedAt || item.lastCreatedAt || "").trim();
    const t = new Date(iso || 0).getTime();
    if (!iso || Number.isNaN(t)) continue;
    if (t > bestTime) {
      bestTime = t;
      best = iso;
    }
  }
  return best || null;
}

function mergeGenerationsById(current: Generation[], incoming: Generation[]) {
  return mergeAdminWorks(current, incoming, 40);
}

function sameStringList(a?: string[] | null, b?: string[] | null) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function sameAdminUserSummary(a: AdminUserItem, b: AdminUserItem) {
  return (
    a.adminKey === b.adminKey &&
    a.userId === b.userId &&
    a.authUserId === b.authUserId &&
    a.username === b.username &&
    a.generationCount === b.generationCount &&
    a.lastCreatedAt === b.lastCreatedAt &&
    a.summaryUpdatedAt === b.summaryUpdatedAt &&
    sameStringList(a.linkedUserIds, b.linkedUserIds)
  );
}

function mergeUsersByAdminKey(current: AdminUserItem[], incoming: AdminUserItem[]) {
  if (!incoming.length) return current;
  const map = new Map<string, AdminUserItem>();
  const order = current.map((item) => item.adminKey);
  for (const item of current) map.set(item.adminKey, item);
  let changed = false;
  for (const item of incoming) {
    const prev = map.get(item.adminKey);
    const next = { ...(prev || ({} as AdminUserItem)), ...item };
    if (!prev || !sameAdminUserSummary(prev, next)) changed = true;
    if (!prev) order.push(item.adminKey);
    map.set(item.adminKey, next);
  }
  if (!changed) return current;
  return order.map((key) => map.get(key)).filter(Boolean) as AdminUserItem[];
}

async function fetchAdminUsers(page = 1, q = "", selected = "", signal?: AbortSignal) {
  if (signal?.aborted) return { items: [] as AdminUserItem[], selected: null, summaryCursor: null, hasMore: false, ok: false };
  const url = new URL("/api/admin/users", window.location.origin);
  url.searchParams.set("limit", "50");
  url.searchParams.set("page", String(page));
  url.searchParams.set("q", q);
  if (selected) url.searchParams.set("selected", selected);
  // The caller ignores stale results; network aborts also reject inspector-owned clones.
  const response = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
  const json = response?.ok ? await response.json().catch(() => null) : null;
  return { items: (json?.items || []) as AdminUserItem[], selected: json?.selected as AdminUserItem | null,
    summaryCursor: json?.summaryCursor || null, hasMore: Boolean(json?.hasMore), ok: Boolean(json) };
}


type FeedbackCenterItem = {
  id: number;
  createdAt: string;
  userId: string;
  username: string | null;
  level: string;
  feedbackType: string;
  content: string;
  attachments: string[];
  adminReply?: string | null;
  repliedAt?: string | null;
  repliedBy?: string | null;
  replyStatus?: string;
};

type AdminActionNotice = {
  type: "success" | "error";
  title: string;
  message: string;
  at: number;
};

function fmtTime(s: string | null, locale: UiLocale) {
  if (!s) return "--";
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return "--";
  if (locale === "en") return formatUiDate(locale, t, { dateStyle: "medium", timeStyle: "medium" });
  const yyyy = t.getFullYear();
  const month = t.getMonth() + 1;
  const day = t.getDate();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  return `${yyyy}年${month}月${day}日 ${hh}:${mm}:${ss}`;
}

function dayKeyLocal(s: string) {
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildLastNDaysSeries(gens: Generation[], days: number) {
  const n = Math.max(1, Math.floor(days));
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));

  const map = new Map<string, number>();
  for (const g of gens) {
    const k = dayKeyLocal(g.createdAt);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }

  const out: { key: string; label: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({
      key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      value: map.get(key) || 0
    });
  }

  return { start, end, points: out };
}

function buildLastNDaysSeriesFromMap(mapInput: Record<string, number> | null | undefined, days: number) {
  const n = Math.max(1, Math.floor(days));
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  const map = mapInput || {};
  const out: { key: string; label: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, value: Math.max(0, Number(map[key]) || 0) });
  }
  return { start, end, points: out };
}

function adminDisplayName(user: { username?: string | null; userId?: string | null }) {
  const username = String(user.username || "").trim();
  if (username) return username;
  return "";
}

function topEntries(map: Record<string, number> | null | undefined, limit = 8) {
  return Object.entries(map || {})
    .map(([label, value]) => ({ label, value: Math.max(0, Number(value) || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function isImagePath(p: string | null | undefined) {
  const s = normalizeMediaUrl(p).toLowerCase();
  const base = s.split("?")[0]?.split("#")[0] || "";
  return base.endsWith(".png") || base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".webp") || base.endsWith(".gif");
}

function typeLabel(t: string) {
  if (t === "face_swap") return "人脸";
  if (t === "image_edit") return "图片";
  if (t === "video_gen" || t === "video_generate") return "视频";
  if (t === "audio_gen") return "音频";
  return t || "未知";
}

function isVideoPath(p: string | null | undefined) {
  return isVideoMediaUrl(p);
}

function sanitizePromptText(prompt: string | null | undefined) {
  const raw = String(prompt || "");
  if (!raw.trim()) return "";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^(aspect|resolution|provider|model|n_frames|aspect_ratio)\s*:/i.test(t)) return false;
    return true;
  });
  return filtered.join("\n").trim();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

function buildParamsJson(g: Generation) {
  const combined: Record<string, any> = {
    id: g.id,
    userId: g.userId,
    type: g.type,
    status: g.status,
    createdAt: g.createdAt,
    finishedAt: g.finishedAt ?? null,
    model: g.model ?? null,
    externalTaskId: g.externalTaskId ?? null,
    prompt: sanitizePromptText(g.prompt) || null,
    params: g.params ?? null,
    inputImages: Array.isArray(g.inputMaterials) ? g.inputMaterials : [],
    outputPaths: Array.isArray(g.outputPaths) ? g.outputPaths : []
  };
  return JSON.stringify(combined, null, 2);
}

function buildDownloadTargets(g: Generation, all: Generation[]) {
  const fromItem = Array.isArray(g.outputPaths) ? g.outputPaths.map((x) => normalizeMediaUrl(x)).filter(Boolean) : [];
  if (fromItem.length > 1) return Array.from(new Set(fromItem));
  const groupId = String(g.externalTaskId || "").trim();
  if (groupId) {
    const sameGroup = all
      .filter((x) => x.type === g.type && String(x.externalTaskId || "").trim() === groupId)
      .flatMap((x) => (Array.isArray(x.outputPaths) && x.outputPaths.length ? x.outputPaths : [x.localPath || ""]))
      .map((x) => normalizeMediaUrl(x))
      .filter(Boolean);
    if (sameGroup.length > 1) return Array.from(new Set(sameGroup));
  }
  const single = normalizeMediaUrl(g.localPath || "");
  return single ? [single] : [];
}

function buildInputDownloadTargets(paths: string[]) {
  return Array.from(
    new Set(
      (Array.isArray(paths) ? paths : [])
        .map((x) => normalizeMediaUrl(x))
        .filter(Boolean)
    )
  );
}

function triggerDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "";
  a.rel = "noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildDownloadFilename(prefix: string, id: number | string, idx: number, url: string) {
  return `${prefix}_${id}_${idx + 1}.${getMediaUrlExtension(url, "bin")}`;
}

function generationModeLabel(g: Generation) {
  const p = g.params || {};
  if (g.type === "import") return "上传素材";
  const taskType = String(p.taskType || "").trim();
  if (taskType) return taskType;
  if (g.type === "face_swap") {
    const mode = String(p.mode || "swap").trim();
    if (mode === "defect") return "添加瑕疵";
    if (mode === "swap_defect") return "换脸并添加瑕疵";
    return "人脸替换";
  }
  if (g.type === "image_edit") {
    const count = Array.isArray(g.inputMaterials) ? g.inputMaterials.length : 0;
    return count > 0 ? "图生图/图片编辑" : "文生图";
  }
  return g.type || "制作结果";
}

function getAssetPreviewGridClass(count: number) {
  if (count <= 1) return "flex justify-center";
  if (count === 2) return "grid grid-cols-2 gap-3";
  if (count === 3) return "grid grid-cols-3 gap-2";
  if (count === 4) return "grid grid-cols-2 gap-2";
  return "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2";
}

function getAssetPreviewCardClass(count: number, kind: "image" | "video") {
  if (count <= 1) {
    return kind === "video"
      ? "block w-full max-w-[420px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)]"
      : "block w-full max-w-[360px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)]";
  }
  if (count === 2) return "block w-full rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)]";
  return "block rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)]";
}

function getAssetPreviewMediaClass(count: number, kind: "image" | "video") {
  if (count <= 1) return kind === "video" ? "w-full h-[360px] object-contain bg-black" : "w-full h-[320px] object-contain";
  if (count === 2) return kind === "video" ? "w-full h-[260px] object-contain bg-black" : "w-full h-[240px] object-contain";
  return kind === "video" ? "w-full aspect-video object-contain bg-black" : "w-full aspect-square object-cover";
}

function getAdminWorkModeInfo(g: Generation | null) {
  if (!g) return { uploadTitle: "输入素材", modeLabel: "-", requirement: "-", acceptedTypes: "-", emptyText: "无上传素材记录" };
  const p = (g.params || {}) as Record<string, any>;
  if (g.type === "video_gen" || g.type === "video_generate") {
    return {
      uploadTitle: "参考素材",
      modeLabel: "视频生成",
      requirement: "按模型模式决定素材数量",
      acceptedTypes: "图片/视频/音频",
      emptyText: "该模式可能无需上传参考素材，或当前没有保留可直接展示的素材记录"
    };
  }
  if (g.type === "face_swap") {
    const mode = String(p.mode || "swap").trim();
    if (mode === "defect" || mode === "swap_defect") {
      return {
        uploadTitle: "输入素材",
        modeLabel: mode === "defect" ? "添加瑕疵" : "换脸并添加瑕疵",
        requirement: "至少需要 1 张图片",
        acceptedTypes: "仅图片",
        emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
      };
    }
    return {
      uploadTitle: "输入素材",
      modeLabel: "人脸替换",
      requirement: "需要参考脸和目标底图各 1 张",
      acceptedTypes: "仅图片",
      emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
    };
  }
  if (g.type === "image_edit") {
    const imageCount = Array.isArray(g.inputMaterials) ? g.inputMaterials.length : 0;
    return {
      uploadTitle: "输入素材",
      modeLabel: imageCount > 0 ? "图生图/图片编辑" : "文生图",
      requirement: imageCount > 0 ? `需要 ${imageCount} 张参考图片` : "无需上传参考图片",
      acceptedTypes: imageCount > 0 ? "仅图片" : "无需参考图片",
      emptyText: imageCount > 0 ? "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录" : "该模式为文生图，无需上传参考图片"
    };
  }
  return { uploadTitle: "输入素材", modeLabel: "-", requirement: "-", acceptedTypes: "-", emptyText: "无上传素材记录" };
}

const ADMIN_PARAM_LABEL_MAP: Record<string, string> = {
  type: "类型",
  inputMode: "输入模式",
  model: "模型",
  outputSize: "输出尺寸",
  similarity: "相似度",
  intensity: "强度",
  aspectRatio: "宽高比",
  aspect_ratio: "宽高比",
  resolution: "分辨率",
  duration: "时长",
  nFrames: "帧数",
  imageCount: "输入数量",
  imagePaths: "输入图片URL",
  inputPublicUrls: "输入图片URL",
  image_urls: "输入图片URL",
  mediaPath: "输入素材URL",
  inputUrl: "输入素材URL",
  inputPreviewUrl: "输入预览公网URL",
  outputPath: "输出结果URL",
  outputPaths: "输出结果URL",
  output_images: "输出结果URL",
  resultUrls: "输出结果URL",
  taskType: "任务类型",
  externalTaskId: "任务ID",
  "seedream.outputMode": "出图模式",
  "seedream.outputCount": "组图张数",
  "seedream.sequential": "顺序生成",
  "seedream.webSearch": "联网搜索"
};

const ADMIN_HIDDEN_PARAM_KEYS = new Set([
  "imagepaths",
  "inputpaths",
  "localinputpath",
  "mediapath",
  "facepath",
  "targetpath",
  "sourcepath",
  "filepath",
  "fileurls",
  "outputpath"
]);

function shouldHideAdminParamPath(path: string) {
  const raw = String(path || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const tail = lower.split(".").pop() || lower;
  if (ADMIN_HIDDEN_PARAM_KEYS.has(tail)) return true;
  if (tail.endsWith("path") && tail !== "outputpaths") return true;
  return false;
}

function adminFormatLabel(path: string) {
  if (ADMIN_PARAM_LABEL_MAP[path]) return ADMIN_PARAM_LABEL_MAP[path];
  const raw = path.split(".").pop() || path;
  return ADMIN_PARAM_LABEL_MAP[raw] || raw;
}

function adminFormatValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const primitive = v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x));
    if (primitive) return v.map((x) => String(x)).join("、");
    return JSON.stringify(v);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function adminCollectParamEntries(
  value: any,
  path: string,
  push: (label: string, value: string) => void
) {
  if (shouldHideAdminParamPath(path)) return;
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const s = adminFormatValue(value);
    if (s) push(adminFormatLabel(path), s);
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return;
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      adminCollectParamEntries((value as any)[key], next, push);
    }
    return;
  }
  const s = adminFormatValue(value);
  if (s) push(adminFormatLabel(path), s);
}

function buildGenerationParamEntries(g: Generation) {
  const p = g.params || {};
  const inputCount = Array.isArray(g.inputMaterials) ? g.inputMaterials.length : 0;
  const outputUrls = Array.from(
    new Set((Array.isArray(g.outputPaths) ? g.outputPaths : []).map((x) => normalizeMediaUrl(x)).filter(Boolean))
  );
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: any) => {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (!s) return;
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ label, value: s });
  };
  push("类型", g.type === "import" ? "上传素材" : typeLabel(g.type));
  push("使用模式", generationModeLabel(g));
  push("素材要求", g.type === "face_swap" ? "至少 1 张图片" : g.type === "image_edit" ? (inputCount > 0 ? `需要 ${inputCount} 张参考图片` : "无需上传参考图片") : "-");
  push("素材类型", g.type === "video_gen" || g.type === "video_generate" ? "图片/视频/音频" : "仅图片");
  push("模型", g.model || p.model);
  push("输出尺寸", p.outputSize);
  push("相似度", p.similarity);
  push("强度", p.intensity);
  push("宽高比", p.aspectRatio || p.aspect_ratio);
  push("分辨率", p.resolution);
  push("时长", p.duration);
  push("输入数量", p.imageCount || inputCount);
  push("任务ID", g.externalTaskId);
  push("输出图片URL", outputUrls.join("、"));
  adminCollectParamEntries(p, "", push);
  return out;
}


const VALID_MAIN_TABS = new Set(["overview", "monitoring", "users", "feedback_center", "system", "audit_logs"]);

function getValidMainTab(params: { get: (key: string) => string | null } | null | undefined, desktopMode = false): MainTab {
  const tabRaw = params?.get("tab") || "";
  if (desktopMode && isHiddenDesktopAdminTab(tabRaw)) return "overview";
  return VALID_MAIN_TABS.has(tabRaw) ? (tabRaw as MainTab) : "overview";
}

function getValidSystemSection(params: { get: (key: string) => string | null } | null | undefined, desktopMode = false): SystemSectionKey | null {
  const sectionRaw = params?.get("section") || "";
  const validSections = desktopMode ? VALID_DESKTOP_SYSTEM_SECTION_KEYS : VALID_SYSTEM_SECTION_KEYS;
  return validSections.has(sectionRaw as SystemSectionKey) ? (sectionRaw as SystemSectionKey) : null;
}

export default function AdminPage() {
  const { label: uiLabel, locale } = useUiLocale();
  const desktopMode = useDesktopMode();
  const searchParams = useSearchParams();
  const defaultSystemSection = desktopMode ? DESKTOP_SYSTEM_SETTING_NAV_ENTRIES[0].items[0].key : "account";
  const initialMainTab = getValidMainTab(searchParams, desktopMode);
  const initialSystemSection = getValidSystemSection(searchParams, desktopMode);
  const [systemSectionActive, setSystemSectionActive] = React.useState<SystemSectionKey>(initialSystemSection || defaultSystemSection);
  const [mainTab, setMainTab] = React.useState<MainTab>(initialMainTab);
  const visitedSystemRef = React.useRef(initialMainTab === "system");
  if (mainTab === "system") visitedSystemRef.current = true;

  // 从 ?tab=&section= 恢复:子页(如 /admin/materials)按"返回"时会带这俩参数过来,
  // 让管理员页直接落到上次的 tab+section,而不是默认的 overview/account。
  // 用 effect 而不是 useState 初始值,避免 server / client 渲染时 searchParams 不一致导致的 hydration mismatch。
  // 用 ref 标记只在 mount 时跑一次:之后切 tab 是用户主动行为,不应被 URL 覆盖。
  const didReadInitialUrlRef = React.useRef(false);
  React.useEffect(() => {
    const tabRaw = getValidMainTab(searchParams, desktopMode);
    const sectionRaw = getValidSystemSection(searchParams, desktopMode);
    if (desktopMode && isHiddenDesktopAdminTab(searchParams?.get("tab"))) {
      setMainTab("overview");
      window.history.replaceState(null, "", "/admin");
      return;
    }
    const requestedSection = searchParams?.get("section") as SystemSectionKey | undefined;
    if (desktopMode && tabRaw === "system" && requestedSection && VALID_SYSTEM_SECTION_KEYS.has(requestedSection) && !sectionRaw) {
      setMainTab("system");
      setSystemSectionActive(defaultSystemSection);
      window.history.replaceState(null, "", `/admin?tab=system&section=${defaultSystemSection}`);
      return;
    }
    // 携带 prefill* 指令的导航 = "显式跳转"，即便是后续 router.push 也应消费 URL。
    // 例如从"调用流水→配置单价"跳到价格规则编辑器时会带 prefillModel / prefillProvider / prefillModule。
    const hasExplicitIntent = !!(
      searchParams?.get("prefillModel") ||
      searchParams?.get("prefillProvider") ||
      searchParams?.get("prefillModule") ||
      (desktopMode && searchParams?.get("view") === "usage")
    );
    if (didReadInitialUrlRef.current && !hasExplicitIntent) return;
    didReadInitialUrlRef.current = true;
    setMainTab(tabRaw);
    setTab(getValidUserTab(searchParams));
    if (!desktopMode) setActiveUser(searchParams?.get("user") || "");
    if (sectionRaw) {
      setSystemSectionActive(sectionRaw);
    }
  }, [defaultSystemSection, desktopMode, searchParams]);
  const [q, setQ] = React.useState("");
  const [directoryQuery, setDirectoryQuery] = React.useState("");
  const [directoryPage, setDirectoryPage] = React.useState(1);
  const [directoryHasMore, setDirectoryHasMore] = React.useState(false);
  const [directoryLoading, setDirectoryLoading] = React.useState(true);
  const [directoryError, setDirectoryError] = React.useState(false);
  const directoryRequestRef = React.useRef<AbortController | null>(null);
  const directoryScopeRef = React.useRef("");
  const retainedActiveUser = React.useRef<AdminUserItem | null>(null);
  React.useEffect(() => {
    if (q.trim() === directoryQuery) return;
    const timer = window.setTimeout(() => { setDirectoryQuery(q.trim()); setDirectoryPage(1); }, 200);
    return () => window.clearTimeout(timer);
  }, [q, directoryQuery]);
  const [users, setUsers] = React.useState<AdminUserItem[]>([]);
  const [activeUser, setActiveUser] = React.useState<string>(() => desktopMode ? "" : searchParams?.get("user") || "");
  const [userNavCollapsed, setUserNavCollapsed] = React.useState(false);
  React.useEffect(() => {
    if (desktopMode) return;
    try {
      setUserNavCollapsed(localStorage.getItem("admin_user_nav_collapsed_v1") === "1");
    } catch {}
  }, [desktopMode]);
  const toggleUserNav = React.useCallback(() => {
    setUserNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("admin_user_nav_collapsed_v1", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  const [tab, setTab] = React.useState<UserDetailTab>(() => getValidUserTab(searchParams));
  const [billingDateRange, setBillingDateRange] = React.useState<{ userKey: string; dateFrom: string; dateTo: string } | null>(null);
  React.useEffect(() => {
    if (mainTab !== "users") return;
    const params = new URLSearchParams(window.location.search);
    // 主栏目切换由 selectMainTab 更新；此处只同步用户页面的位置。
    if (params.get("tab") !== "users") return;
    writeUserPageLocation(params, tab, activeUser);
    const next = `/admin?${params.toString()}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [mainTab, tab, activeUser]);
  const [worksTypeFilter, setWorksTypeFilter] = React.useState<"all" | "face_swap" | "image_edit" | "video" | "audio" | "import">("all");
  const [worksCleanupUser, setWorksCleanupUser] = React.useState<string | null>(null);
  React.useEffect(() => { setWorksCleanupUser(null); }, [activeUser, mainTab, tab]);
  const [worksSourceFilter, setWorksSourceFilter] = React.useState<AssetSourceFilterValue>("creation");
  const [worksDateFrom, setWorksDateFrom] = React.useState("");
  const [worksDateTo, setWorksDateTo] = React.useState("");
  const [materialPage, setMaterialPage] = React.useState(1);
  const [materialPageSize, setMaterialPageSize] = React.useState(50);
  const [materialArchivedOpen, setMaterialArchivedOpen] = React.useState(false);
  const [materialArchivedPage, setMaterialArchivedPage] = React.useState(1);
  const [materialArchivedPageSize, setMaterialArchivedPageSize] = React.useState(50);
  const [materialEventsOpen, setMaterialEventsOpen] = React.useState(false);
  const [materialEventsPage, setMaterialEventsPage] = React.useState(1);
  const [materialEventsPageSize, setMaterialEventsPageSize] = React.useState(20);
  const [materialEventsAction, setMaterialEventsAction] = React.useState<"all" | "select" | "cancel_request" | "release">("all");
  const [materialCategory, setMaterialCategory] = React.useState("all");
  const [materialSelectedFrom, setMaterialSelectedFrom] = React.useState("");
  const [materialSelectedTo, setMaterialSelectedTo] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [userLoadError, setUserLoadError] = React.useState(false);
  const [payload, setPayload] = React.useState<AdminUserPayload | null>(null);
  const [analysisDetailsLoading, setAnalysisDetailsLoading] = React.useState(false);
  const [analysisDetailsError, setAnalysisDetailsError] = React.useState(false);
  const loadUserSeqRef = React.useRef(0);
  const profileAbortRef = React.useRef<AbortController | null>(null);
  const worksPageRequestGateRef = React.useRef(new AdminWorksRequestGate());
  const analysisDetailAbortRef = React.useRef<AbortController | null>(null);
  const worksLoadRequestGateRef = React.useRef(new AdminWorksRequestGate());
  const worksChangesRequestGateRef = React.useRef(new AdminWorksRequestGate());
  const materialSilentReloadRef = React.useRef(false);
  const materialScrollTopRef = React.useRef<number | null>(null);
  const worksCursorRef = React.useRef<AdminWorksCursor | null>(null);
  const [loadedWorksScopeKey, setLoadedWorksScopeKey] = React.useState<string | null>(null);
  const usersSummaryCursorRef = React.useRef<string | null>(null);
  const [purgingPresets] = React.useState(false);
  const systemContentScrollRef = React.useRef<HTMLDivElement | null>(null);
  const settingsContentScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [retentionDays, setRetentionDays] = React.useState("15");
  const [retentionSaved, setRetentionSaved] = React.useState("15");
  const [retentionLoading, setRetentionLoading] = React.useState(false);
  const [retentionSaving, setRetentionSaving] = React.useState(false);
  const [retentionErr, setRetentionErr] = React.useState<string | null>(null);
  const [retentionLastPrunedAt, setRetentionLastPrunedAt] = React.useState<string | null>(null);
  const retentionLoadedAtRef = React.useRef(0);
  const retentionLoadPromiseRef = React.useRef<Promise<void> | null>(null);
  const {
    storage,
    storageLoading,
    storageErr,
    storageSaving,
    storageTotalGb,
    setStorageTotalGb,
    storageWarnPercent,
    setStorageWarnPercent,
    storageCriticalPercent,
    setStorageCriticalPercent,
    storageSaved,
    setStorageErr,
    loadStorage: loadStorageRaw,
    saveStorageLimits,
  } = useAdminStorage({ enabled: mainTab === "overview" });

  // 在管理员做了破坏性操作后,把所有 admin 范围内的 react-query 缓存作废,
  // 确保下次切回各个 tab 看到的是最新数据,而不是 30s staleTime 内的陈旧数据。
  const queryClient = useQueryClient();
  const invalidateAdminCaches = React.useCallback(() => {
    adminCanvasCache.clear();
    void queryClient.invalidateQueries({ queryKey: ADMIN_STORAGE_QUERY_KEY });
    // ["admin"] 前缀的所有 query 一起失效 —— 未来加新 admin query 不需要再回来改这里
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  }, [queryClient]);
  const [cleanupDays, setCleanupDays] = React.useState("0");
  const [cleanupBusy, setCleanupBusy] = React.useState<"" | "temp" | "uploads" | "thumbnails">("");
  const [storageCleanupResult, setStorageCleanupResult] = React.useState<StorageCleanupResult | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<
    | null
    | { type: "delete_user"; userId: string; authUserId?: number | null; adminKey?: string }
    | { type: "delete_generation"; id: number; generationType?: string }
    | { type: "bulk_delete_imports"; userId: string; authUserId?: number | null; count: number }
    | { type: "bulk_delete_generations"; ids: number[] }
    | { type: "delete_feedback"; id: number }
    | { type: "delete_preset"; adminKey: string; userId: string; presetId: string; presetName: string; expectedRevision: number }
    | { type: "purge_presets"; adminKey: string; userId: string }
    | { type: "delete_builtin_preset"; presetId: string; presetName: string; expectedRevision: number }
    | { type: "cleanup_storage"; action: "cleanup_old_uploads" | "cleanup_temp" | "cleanup_thumbnail_assets"; title: string }
    | { type: "release_material_asset"; assetId: number }
  >(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [adminActionNotice, setAdminActionNotice] = React.useState<AdminActionNotice | null>(null);
  const [entryActionBusy, setEntryActionBusy] = React.useState<"" | "purge" | "delete_user">("");
  const [dangerMenuOpen, setDangerMenuOpen] = React.useState(false);
  const dangerMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [worksBulkDeleteResetSeq, setWorksBulkDeleteResetSeq] = React.useState(0);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<Generation | null>(null);
  const [detailZoomOpen, setDetailZoomOpen] = React.useState(false);
  const [detailZoomSrc, setDetailZoomSrc] = React.useState<string | null>(null);
  const [detailZoomKind, setDetailZoomKind] = React.useState<"image" | "video">("image");
  const [purgeModalOpen, setPurgeModalOpen] = React.useState(false);

  React.useEffect(() => {
    setConfirmError(null);
  }, [confirmAction]);

  React.useEffect(() => {
    if (!dangerMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (dangerMenuRef.current?.contains(event.target as Node)) return;
      setDangerMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDangerMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dangerMenuOpen]);

  React.useEffect(() => {
    if (!adminActionNotice) return;
    const timer = window.setTimeout(() => setAdminActionNotice(null), adminActionNotice.type === "error" ? 8000 : 1000);
    return () => window.clearTimeout(timer);
  }, [adminActionNotice]);

  const notifyAdminAction = React.useCallback((notice: Omit<AdminActionNotice, "at">) => {
    setAdminActionNotice({ ...notice, at: Date.now() });
  }, []);
  const feedbackPanelRef = React.useRef<FeedbackCenterPanelHandle>(null);
  const logsPanelRef = React.useRef<AdminLogsPanelHandle>(null);
  const monitoringPanelRef = React.useRef<AdminMonitoringPanelHandle>(null);
  const builtinPresetsRef = React.useRef<BuiltinPresetsSectionHandle>(null);
  // 全局软刷新：通过给"自管理 fetch 的子面板"挂 key 来强制重挂载，触发其内部 useEffect 重新拉数据。
  // 这是无侵入式做法：不用把所有面板都改成 forwardRef + imperativeHandle。
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [userOrderRefreshKey, setUserOrderRefreshKey] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [inspirationBusyById, setInspirationBusyById] = React.useState<Record<number, boolean>>({});
  const [inspirationMessage, setInspirationMessage] = React.useState<string | null>(null);
  // 导出/导入
  const [exportLoadingKey, setExportLoadingKey] = React.useState<string | null>(null);
  const [exportModalUser, setExportModalUser] = React.useState<AdminUserItem | null>(null);
  const [exportProgress, setExportProgress] = React.useState<ExportProgressState | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = React.useState<ImportProgressState | null>(null);
  const activeUserItem = users.find((u) => u.adminKey === activeUser) || (retainedActiveUser.current?.adminKey === activeUser ? retainedActiveUser.current : null);
  if (activeUserItem) retainedActiveUser.current = activeUserItem;
  const activeUserId = activeUserItem?.userId || "";
  const activeAuthUserId = typeof activeUserItem?.authUserId === "number" ? activeUserItem.authUserId : null;
  React.useEffect(() => {
    analysisDetailAbortRef.current?.abort();
    analysisDetailAbortRef.current = null;
    setAnalysisDetailsLoading(false);
    setAnalysisDetailsError(false);
    setDangerMenuOpen(false);
    profileAbortRef.current?.abort();
    worksPageRequestGateRef.current.cancel();
    worksLoadRequestGateRef.current.cancel();
    worksChangesRequestGateRef.current.cancel();
    worksCursorRef.current = null;
    setLoadedWorksScopeKey(null);
    setPayload(null);
    setDetailOpen(false);
    setDetailItem(null);
    setDetailZoomOpen(false);
    setDetailZoomSrc(null);
    setWorksBulkDeleteResetSeq((value) => value + 1);
  }, [activeUser, worksSourceFilter, worksTypeFilter, worksDateFrom, worksDateTo]);
  const setMaterialStateSilently = React.useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: React.SetStateAction<T>) => {
    const scroller = systemContentScrollRef.current;
    materialScrollTopRef.current = scroller ? scroller.scrollTop : null;
    materialSilentReloadRef.current = true;
    setter(value);
  }, [systemContentScrollRef]);
  const setMaterialPageSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialPage, value), [setMaterialStateSilently]);
  const setMaterialPageSizeSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialPageSize, value), [setMaterialStateSilently]);
  const setMaterialArchivedOpenSilently = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => setMaterialStateSilently(setMaterialArchivedOpen, value), [setMaterialStateSilently]);
  const setMaterialArchivedPageSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialArchivedPage, value), [setMaterialStateSilently]);
  const setMaterialArchivedPageSizeSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialArchivedPageSize, value), [setMaterialStateSilently]);
  const setMaterialEventsOpenSilently = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => setMaterialStateSilently(setMaterialEventsOpen, value), [setMaterialStateSilently]);
  const setMaterialEventsPageSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialEventsPage, value), [setMaterialStateSilently]);
  const setMaterialEventsPageSizeSilently = React.useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => setMaterialStateSilently(setMaterialEventsPageSize, value), [setMaterialStateSilently]);
  const setMaterialEventsActionSilently = React.useCallback<React.Dispatch<React.SetStateAction<"all" | "select" | "cancel_request" | "release">>>((value) => setMaterialStateSilently(setMaterialEventsAction, value), [setMaterialStateSilently]);
  const setMaterialCategorySilently = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => setMaterialStateSilently(setMaterialCategory, value), [setMaterialStateSilently]);
  const setMaterialSelectedFromSilently = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => setMaterialStateSilently(setMaterialSelectedFrom, value), [setMaterialStateSilently]);
  const setMaterialSelectedToSilently = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => setMaterialStateSilently(setMaterialSelectedTo, value), [setMaterialStateSilently]);
  const withEntryActionBusy = React.useCallback(async (type: "purge" | "delete_user", task: () => void) => {
    if (entryActionBusy) return;
    setEntryActionBusy(type);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    task();
    setEntryActionBusy("");
  }, [entryActionBusy]);

  const handleExportUser = React.useCallback(async (item: AdminUserItem, opts: ExportOptions & { archiveMode: "portable" | "data" }) => {
    setExportLoadingKey(item.adminKey);
    // 显示进度视图（仍保持 exportModalUser 以便模态框继续渲染）
    setExportProgress({ stage: "query", progress: 5, message: "正在创建导出任务..." });

    const mapStage = (stage: string | null | undefined): ExportProgressState["stage"] => {
      if (stage === "collect") return "collect";
      if (stage === "pack") return "pack";
      if (stage === "done") return "download";
      return "query";
    };
    const stageMessage = (stage: string | null | undefined, progress: number) => {
      switch (stage) {
        case "collect":
          return "正在收集文件...";
        case "pack":
          return `正在打包压缩... ${progress}%`;
        case "done":
          return "下载已开始";
        default:
          return "正在查询数据库...";
      }
    };
    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

    try {
      // 1) 入队异步导出任务（立即返回 jobId，不在一个请求里同步打包）
      const startRes = await fetch("/api/admin/user/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          authUserId: typeof item.authUserId === "number" ? item.authUserId : undefined,
          ...opts,
        }),
      }).catch(() => null);

      if (!startRes || !startRes.ok) {
        const errJson = await startRes?.json().catch(() => null);
        setExportProgress(null);
        setExportModalUser(null);
        alert(String(errJson?.error || "创建导出任务失败，请重试"));
        return;
      }
      const { jobId } = (await startRes.json().catch(() => ({}))) as { jobId?: string };
      if (!jobId) {
        setExportProgress(null);
        setExportModalUser(null);
        alert(uiLabel("创建导出任务失败，请重试"));
        return;
      }

      // 2) 轮询真实进度。大体积用户可能需要数小时，避免用 20 分钟前端超时误报失败。
      const deadline = Date.now() + 24 * 60 * 60 * 1000;
      let downloadUrl: string | null = null;
      while (Date.now() < deadline) {
        await sleep(1500);
        const sres = await fetch(
          `/api/admin/user/export/status?jobId=${encodeURIComponent(jobId)}`,
        ).catch(() => null);
        if (!sres || !sres.ok) continue;
        const s = (await sres.json().catch(() => null)) as {
          status: string;
          progress: number;
          stage: string | null;
          error: string | null;
          downloadUrl: string | null;
        } | null;
        if (!s) continue;
        if (s.status === "error") {
          setExportProgress(null);
          setExportModalUser(null);
          alert(String(s.error || "导出失败，请重试"));
          return;
        }
        setExportProgress({
          stage: mapStage(s.stage),
          progress: Math.max(5, Math.min(99, s.progress || 0)),
          message: stageMessage(s.stage, s.progress || 0),
        });
        if (s.status === "done" && s.downloadUrl) {
          downloadUrl = s.downloadUrl;
          break;
        }
      }

      if (!downloadUrl) {
        setExportProgress(null);
        setExportModalUser(null);
        alert(uiLabel("导出超时，请稍后重试"));
        return;
      }

      // 3) 浏览器原生流式下载（响应直接落盘，不经过 JS 内存，标签页零内存压力）
      setExportProgress({ stage: "download", progress: 100, message: "下载已开始" });
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = "";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();

      // 1.5 秒后关闭模态框
      window.setTimeout(() => {
        setExportProgress(null);
        setExportModalUser(null);
      }, 1500);
    } catch {
      setExportProgress(null);
      alert(uiLabel("导出失败，请重试"));
    } finally {
      setExportLoadingKey(null);
    }
  }, []);

  const importAccountOptionsRef = React.useRef<{ jobId: string; options: ImportAccountOptions } | null>(null);
  const monitorUserImportJob = React.useCallback(async (jobId: string) => {
    const stageMessage = (stage: ImportProgressState["stage"], progress: number) => {
      switch (stage) {
        case "upload": return "正在上传 ZIP...";
        case "parse": return "正在解析 ZIP...";
        case "read": return "正在读取数据文件...";
        case "check": return "正在校验文件内容与导入清单...";
        case "files":
        case "presets": return `正在还原文件... ${progress}%`;
        case "db_user": return "正在合并账号信息...";
        case "db_gen": return "正在写入资产记录...";
        case "db_other": return "正在写入账单与素材数据...";
        case "db_agent": return "正在写入 Agent 数据...";
        case "db_logs": return "正在写入日志...";
        case "seq": return "正在重置数据库序列...";
        case "done": return "导入完成";
        default: return "正在导入...";
      }
    };
    const deadline = Date.now() + 24 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1500));
      const response = await fetch(`/api/admin/user/import/status?jobId=${encodeURIComponent(jobId)}`).catch(() => null);
      if (!response?.ok) continue;
      const json = await response.json().catch(() => null) as {
        status?: string;
        stage?: ImportProgressState["stage"];
        progress?: number;
        error?: string | null;
        stats?: Record<string, number> | null;
        conflicts?: string[];
        needsInput?: ImportNeedsInput;
        warnings?: string[];
      } | null;
      if (!json) continue;
      if (json.status === "error" || json.status === "cancelled") {
        setImportProgress({
          stage: "error",
          message: String(json.error || "导入失败"),
          progress: 0,
          error: true,
          jobId: json.status === "error" ? jobId : undefined,
          conflicts: json.conflicts || [],
          needsInput: json.needsInput,
        });
        return;
      }

      const stage = json.stage || "parse";
      const progress = Math.max(1, Math.min(100, Number(json.progress || 0)));
      setImportProgress({
        stage,
        message: stageMessage(stage, progress),
        progress,
        jobId,
        stats: json.stats || undefined,
        success: json.status === "done",
        warnings: json.warnings || [],
      });
      if (json.status === "done") {
        importAccountOptionsRef.current = null;
        clearAdminUserPayloadCacheForUser();
        void loadStorage({ force: true });
        setUsers((await fetchAdminUsers()).items);
        return;
      }
    }
    setImportProgress({ stage: "error", message: "导入超时，请稍后查看任务状态", progress: 0, error: true });
  }, []);

  const handleRetryUserImport = React.useCallback(async (jobId: string, options: ImportAccountOptions) => {
    const previous = importAccountOptionsRef.current?.jobId === jobId ? importAccountOptionsRef.current.options : {};
    const combined = { ...previous, ...options };
    importAccountOptionsRef.current = { jobId, options: combined };
    setImportProgress({ stage: "parse", message: "正在使用已上传文件重试...", progress: 3, jobId });
    let retryNeedsInput: ImportNeedsInput | undefined;
    try {
      const response = await fetch("/api/admin/user/import/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, ...combined }),
      });
      const json = await response.json().catch(() => ({})) as { error?: string; needsInput?: ImportNeedsInput };
      retryNeedsInput = json.needsInput;
      if (!response.ok) throw new Error(String(json.error || "重试失败"));
      await monitorUserImportJob(jobId);
    } catch (error) {
      setImportProgress({
        stage: "error",
        message: error instanceof Error ? error.message : "重试失败",
        progress: 0,
        error: true,
        jobId,
        needsInput: retryNeedsInput,
      });
    }
  }, [monitorUserImportJob]);

  const handleEnterpriseImportFile = React.useCallback(async (file: File) => {
    importAccountOptionsRef.current = null;
    setImportProgress({ stage: "upload", message: "正在上传 ZIP...", progress: 1 });

    try {
      type UploadSession = {
        uploadId: string;
        receivedBytes: number;
        maxImportBytes: number;
        jobId?: string;
      };
      const uploadStorageKey = `admin-user-import:${file.name}:${file.size}:${file.lastModified}`;
      const postUpload = async (body: Record<string, unknown>) => {
        const response = await fetch("/api/admin/user/import/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await response.json().catch(() => ({})) as UploadSession & { error?: string; jobId?: string };
        if (!response.ok) throw new Error(String(json.error || "上传失败"));
        return json;
      };
      const initUpload = (uploadId?: string | null) => postUpload({
        action: "init",
        fileName: file.name,
        fileSize: file.size,
        uploadId: uploadId || undefined,
      });

      let session = await initUpload(window.localStorage.getItem(uploadStorageKey));
      window.localStorage.setItem(uploadStorageKey, session.uploadId);
      if (file.size > session.maxImportBytes) throw new Error("导入包超过服务器配置上限");
      let offset = Number(session.receivedBytes || 0);

      while (!session.jobId && offset < file.size) {
        const end = Math.min(file.size, offset + IMPORT_UPLOAD_CHUNK_BYTES);
        const chunk = file.slice(offset, end);
        let completed = false;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < IMPORT_UPLOAD_RETRIES && !completed; attempt++) {
          try {
            const response = await fetch("/api/admin/user/import/upload", {
              method: "PUT",
              headers: {
                "Content-Type": "application/octet-stream",
                "x-upload-id": session.uploadId,
                "x-upload-offset": String(offset),
              },
              body: chunk,
            });
            const json = await response.json().catch(() => ({})) as { receivedBytes?: number; error?: string };
            if (!response.ok) throw new Error(String(json.error || "上传分片失败"));
            offset = Number(json.receivedBytes);
            completed = true;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("上传分片失败");
            try {
              session = await initUpload(session.uploadId);
              if (session.receivedBytes > offset) {
                offset = session.receivedBytes;
                completed = true;
              }
            } catch (reconcileError) {
              lastError = reconcileError instanceof Error ? reconcileError : lastError;
            }
            if (!completed && attempt + 1 < IMPORT_UPLOAD_RETRIES) {
              await new Promise((resolveDelay) => window.setTimeout(resolveDelay, IMPORT_UPLOAD_RETRY_DELAY_MS * (attempt + 1)));
            }
          }
        }
        if (!completed) throw lastError || new Error("网络错误，上传失败");
        const pct = Math.max(1, Math.min(20, Math.round((offset / file.size) * 20)));
        setImportProgress({
          stage: "upload",
          message: `正在上传 ZIP... ${Math.round((offset / file.size) * 100)}%`,
          progress: pct,
        });
      }

      const uploadResult = session.jobId
        ? { jobId: session.jobId }
        : await postUpload({ action: "complete", uploadId: session.uploadId });
      if (!uploadResult.jobId) throw new Error("上传完成但未创建导入任务");
      window.localStorage.removeItem(uploadStorageKey);

      setImportProgress({ stage: "parse", message: "上传完成，正在解析 ZIP...", progress: 21 });
      await monitorUserImportJob(uploadResult.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "导入过程中发生错误";
      setImportProgress({ stage: "error", message, progress: 0, error: true });
    }
  }, [monitorUserImportJob]);

  const usersLoadedAtRef = React.useRef(0);
  const usersLoadPromiseRef = React.useRef<Promise<void> | null>(null);

  const activeUserRef = React.useRef(activeUser);
  activeUserRef.current = activeUser;
  const loadUsers = React.useCallback(async () => {
    directoryRequestRef.current?.abort();
    const controller = new AbortController();
    directoryRequestRef.current = controller;
    setDirectoryLoading(true); setDirectoryError(false);
    try {
      const { items, selected, summaryCursor, hasMore, ok } = await fetchAdminUsers(directoryPage, directoryQuery, activeUserRef.current, controller.signal);
      if (controller.signal.aborted) return;
      if (!ok) { setDirectoryError(true); return; }
      if (desktopMode) retainedActiveUser.current = null;
      if (selected) retainedActiveUser.current = selected;
      setDirectoryHasMore(hasMore);
      directoryScopeRef.current = `${directoryQuery}|${directoryPage}`;
      setUsers(items);
      usersSummaryCursorRef.current = summaryCursor;
      setActiveUser((current) => {
        if (desktopMode) return items[0]?.adminKey || "";
        if (current && (items.some((item) => item.adminKey === current) || retainedActiveUser.current?.adminKey === current)) return current;
        return items[0]?.adminKey || "";
      });
      usersLoadedAtRef.current = Date.now();
    } finally {
      if (!controller.signal.aborted) { setDirectoryLoading(false); }
    }
  }, [desktopMode, directoryPage, directoryQuery]);

  const ensureUsersLoaded = React.useCallback(() => {
    if (directoryScopeRef.current === `${directoryQuery}|${directoryPage}` && Date.now() - usersLoadedAtRef.current < ADMIN_PREFETCH_TTL_MS) {
      return Promise.resolve();
    }
    if (usersLoadPromiseRef.current && directoryScopeRef.current === `${directoryQuery}|${directoryPage}`) return usersLoadPromiseRef.current;
    const request = loadUsers().finally(() => {
      if (usersLoadPromiseRef.current === request) usersLoadPromiseRef.current = null;
    });
    usersLoadPromiseRef.current = request;
    return request;
  }, [loadUsers, directoryPage, directoryQuery]);

  const loadUserAnalysisDetails = React.useCallback(async ({
    adminKey,
    basePayload,
    cacheKey,
    requestSeq,
    force,
  }: {
    adminKey: string;
    basePayload: AdminUserPayload;
    cacheKey: string;
    requestSeq: number;
    force?: boolean;
  }) => {
    analysisDetailAbortRef.current?.abort();
    const controller = new AbortController();
    analysisDetailAbortRef.current = controller;
    setAnalysisDetailsLoading(true);
    setAnalysisDetailsError(false);
    try {
      const detailsUrl = new URL("/api/admin/user", window.location.origin);
      detailsUrl.searchParams.set("adminKey", adminKey);
      detailsUrl.searchParams.set("section", "analysis");
      detailsUrl.searchParams.set("page", "1");
      detailsUrl.searchParams.set("pageSize", "60");
      const res = await fetch(detailsUrl.toString(), {
        ...(force ? { cache: "no-store" as const } : {}),
      }).catch((error) => {
        if (controller.signal.aborted) return null;
        throw error;
      });
      if (!res || !res.ok) {
        if (!controller.signal.aborted && requestSeq === loadUserSeqRef.current) setAnalysisDetailsError(true);
        return;
      }
      const details = (await res.json().catch(() => null)) as AdminUserPayload | null;
      if (!details || controller.signal.aborted) return;
      if (requestSeq !== loadUserSeqRef.current) return;
      const merged = mergeAdminUserAnalysisPayload(basePayload, details);
      setPayload(merged);
      cacheAdminUserPayload(cacheKey, { payload: merged, cachedAt: Date.now() });
    } catch {
      if (!controller.signal.aborted && requestSeq === loadUserSeqRef.current) setAnalysisDetailsError(true);
    } finally {
      if (analysisDetailAbortRef.current === controller) analysisDetailAbortRef.current = null;
      if (requestSeq === loadUserSeqRef.current) setAnalysisDetailsLoading(false);
    }
  }, []);

  const loadUser = React.useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    if (!activeUserId) return;
    profileAbortRef.current?.abort();
    worksLoadRequestGateRef.current.cancel();
    worksChangesRequestGateRef.current.cancel();
    worksPageRequestGateRef.current.cancel();
    setUserLoadError(false);
    if (["canvases", "billing"].includes(tab)) {
      ++loadUserSeqRef.current;
      analysisDetailAbortRef.current?.abort();
      setLoading(false);
      return;
    }
    const requestSeq = ++loadUserSeqRef.current;
    analysisDetailAbortRef.current?.abort();
    analysisDetailAbortRef.current = null;
    setAnalysisDetailsLoading(false);
    setAnalysisDetailsError(false);
    const kind = tab === "works" ? (worksTypeFilter === "import" ? "all" : "generated") : "all";
    const effectivePage = tab === "materials" ? materialPage : 1;
    const effectivePageSize = tab === "works" ? 40 : tab === "materials" ? materialPageSize : 60;
    const worksScopeKey = `${activeUser}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`;
    const cacheTab = getAdminUserPayloadCacheTab(tab);
    const cacheKey = getAdminUserPayloadCacheKey({
      userId: activeUserId,
      authUserId: activeAuthUserId,
      tab: cacheTab,
      typeFilter: cacheTab === "works" ? `${worksTypeFilter}|${worksSourceFilter}` : "all",
      page: effectivePage,
      pageSize: effectivePageSize,
      archivedOpen: cacheTab === "materials" ? materialArchivedOpen : false,
      archivedPage: cacheTab === "materials" ? materialArchivedPage : 1,
      archivedPageSize: cacheTab === "materials" ? materialArchivedPageSize : 50,
      eventsOpen: cacheTab === "materials" ? materialEventsOpen : false,
      eventsPage: cacheTab === "materials" ? materialEventsPage : 1,
      eventsPageSize: cacheTab === "materials" ? materialEventsPageSize : 20,
      eventsAction: cacheTab === "materials" ? materialEventsAction : "all",
      materialCategory: cacheTab === "materials" ? materialCategory : "all",
      materialSelectedFrom: cacheTab === "materials" ? materialSelectedFrom : "",
      materialSelectedTo: cacheTab === "materials" ? materialSelectedTo : "",
    });
    const cachedWorks = tab === "works" ? adminUserWorksCache.get(worksScopeKey) : null;
    const cached = tab === "works" ? cachedWorks : adminUserPayloadCache.get(cacheKey);
    const canUseCache = !options?.force;
    // background：顶部"刷新"用，后台重拉但不触发 loading（保持当前内容显示，不白闪）
    const shouldShowLoading = options?.background ? false : !(canUseCache && cached);

    if (canUseCache && cached) {
      setLoading(false);
      setPayload(cached.payload);
      if (cachedWorks) {
        worksCursorRef.current = cachedWorks.cursor;
        setLoadedWorksScopeKey(worksScopeKey);
      }
      if (Date.now() - cached.cachedAt < (tab === "works" || tab === "skills" ? ADMIN_USER_PAYLOAD_CACHE_TTL_MS : 30_000)) {
        if (tab === "analysis" && !cached.payload.analysisDetailsIncluded) {
          void loadUserAnalysisDetails({
            adminKey: activeUser,
            basePayload: cached.payload,
            cacheKey,
            requestSeq,
            force: options?.force,
          });
        }
        return;
      }
    }

    if (shouldShowLoading) setLoading(true);
    const worksRequest = tab === "works" ? worksLoadRequestGateRef.current.begin(worksScopeKey) : null;
    const profileController = new AbortController();
    profileAbortRef.current = profileController;
    try {
      const url = new URL(tab === "works" ? "/api/admin/user/works" : "/api/admin/user", window.location.origin);
      if (tab === "works") {
        url.searchParams.set("adminKey", activeUser);
      } else {
        url.searchParams.set("adminKey", activeUser);
      }
      if (tab !== "works") url.searchParams.set("take", "200");
      if (tab === "analysis") url.searchParams.set("section", "profile");
      else if (tab === "materials") url.searchParams.set("section", "materials");
      else if (tab === "presets") url.searchParams.set("section", "presets");
      else if (tab === "skills") url.searchParams.set("section", "skills");
      else url.searchParams.set("section", "profile");
      url.searchParams.set("kind", kind);
      if (tab === "works") {
        url.searchParams.set("view", "cards");
        url.searchParams.set("typeFilter", worksTypeFilter);
        applyAssetSourceFilterSearchParams(url.searchParams, worksSourceFilter);
        url.searchParams.set("limit", String(effectivePageSize));
      }
      if (tab === "works") {
        if (worksDateFrom) url.searchParams.set("from", new Date(`${worksDateFrom}T00:00:00`).toISOString());
        if (worksDateTo) url.searchParams.set("to", new Date(`${worksDateTo}T23:59:59.999`).toISOString());
      }
      url.searchParams.set("page", String(effectivePage));
      url.searchParams.set("pageSize", String(effectivePageSize));
      if (tab === "materials") {
        url.searchParams.set("materialPage", String(materialPage));
        url.searchParams.set("materialPageSize", String(materialPageSize));
        url.searchParams.set("materialArchivedPage", String(materialArchivedPage));
        url.searchParams.set("materialArchivedPageSize", String(materialArchivedPageSize));
        if (materialArchivedOpen) url.searchParams.set("includeArchivedMaterials", "1");
        url.searchParams.set("materialEventPage", String(materialEventsPage));
        url.searchParams.set("materialEventPageSize", String(materialEventsPageSize));
        url.searchParams.set("materialEventAction", materialEventsAction);
        if (materialEventsOpen) url.searchParams.set("includeMaterialEvents", "1");
        if (materialCategory !== "all") url.searchParams.set("materialCategory", materialCategory);
        if (materialSelectedFrom) url.searchParams.set("materialSelectedFrom", materialSelectedFrom);
        if (materialSelectedTo) url.searchParams.set("materialSelectedTo", materialSelectedTo);
      }
      const res = await fetch(url.toString(), {
        ...(options?.force ? { cache: "no-store" as const } : {}),
        // Browsing uses the request gate to discard superseded results;
        // keep fetch response clones owned by browser inspectors intact.
      }).catch(() => null);
      if (!res || !res.ok) {
        if (requestSeq === loadUserSeqRef.current && !profileController.signal.aborted) setUserLoadError(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!json) { if (requestSeq === loadUserSeqRef.current) setUserLoadError(true); return; }
      const nextPayload = json as AdminUserPayload;
      if (worksRequest) {
        if (!worksLoadRequestGateRef.current.accepts(worksRequest, `${String(json?.scopeKey || "")}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`)) return;
      } else if (requestSeq !== loadUserSeqRef.current) {
        return;
      }
      setPayload(nextPayload);
      if (tab === "works") {
        const nextCursor = nextPayload.syncCursor || getLatestWorksCursor(Array.isArray(nextPayload.generations) ? nextPayload.generations : []);
        if (nextCursor) {
          worksCursorRef.current = nextCursor;
          setLoadedWorksScopeKey(worksScopeKey);
          adminUserWorksCache.set(worksScopeKey, nextPayload, nextCursor);
        }
      } else {
        cacheAdminUserPayload(cacheKey, { payload: nextPayload, cachedAt: Date.now() });
        if (tab === "analysis" && !nextPayload.analysisDetailsIncluded) {
          void loadUserAnalysisDetails({
            adminKey: activeUser,
            basePayload: nextPayload,
            cacheKey,
            requestSeq,
            force: options?.force,
          });
        }
      }
    } finally {
      const isCurrent = worksRequest
        ? worksLoadRequestGateRef.current.accepts(worksRequest, worksRequest.scopeKey)
        : requestSeq === loadUserSeqRef.current;
      if (shouldShowLoading && isCurrent) setLoading(false);
    }
  }, [activeAuthUserId, activeUser, activeUserId, loadUserAnalysisDetails, materialArchivedOpen, materialArchivedPage, materialArchivedPageSize, materialCategory, materialEventsAction, materialEventsOpen, materialEventsPage, materialEventsPageSize, materialPage, materialPageSize, materialSelectedFrom, materialSelectedTo, tab, worksSourceFilter, worksTypeFilter, worksDateFrom, worksDateTo]);

  const releaseUserMaterialAsset = React.useCallback(async (assetId: number) => {
    if (!assetId) return;
    const res = await fetch(`/api/admin/material-assets/${assetId}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "管理员在用户挑选素材页重新上架" })
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as any;
    if (!res || !res.ok) {
      const message = String(json?.error || "重新上架素材失败");
      notifyAdminAction({ type: "error", title: "上架失败", message });
      throw new Error(message);
    }
    invalidateAdminCaches();
    clearAdminUserPayloadCacheForUser(activeUserId);
    await Promise.all([loadUser({ force: true, background: true }), loadUsers()]);
    notifyAdminAction({ type: "success", title: "已重新上架", message: `素材 #${assetId} 已释放，可重新挑选` });
  }, [activeUserId, invalidateAdminCaches, loadUser, loadUsers, notifyAdminAction]);

  React.useEffect(() => {
    if (mainTab !== "users") return;
    void ensureUsersLoaded();
  }, [ensureUsersLoaded, mainTab]);


  React.useEffect(() => {
    if (mainTab !== "users") return;
    const background = tab === "materials" && materialSilentReloadRef.current;
    materialSilentReloadRef.current = false;
    void loadUser(background ? { background: true } : undefined);
    return () => {
      ++loadUserSeqRef.current;
      profileAbortRef.current?.abort();
      analysisDetailAbortRef.current?.abort();
      worksLoadRequestGateRef.current.cancel();
      worksPageRequestGateRef.current.cancel();
      worksChangesRequestGateRef.current.cancel();
    };
  }, [loadUser, mainTab, tab]);

  React.useLayoutEffect(() => {
    if (tab !== "materials") return;
    const top = materialScrollTopRef.current;
    if (typeof top !== "number") return;
    materialScrollTopRef.current = null;
    const scroller = systemContentScrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = top;
    window.requestAnimationFrame(() => {
      scroller.scrollTop = top;
    });
  }, [payload, tab]);

  const loadMoreWorks = React.useCallback(async (targetPage: number) => {
    if (!activeUserId || mainTab !== "users" || tab !== "works") return false;
    const pagination = payload?.pagination;
    const pageCursor = targetPage === 1 ? "" : String(pagination?.nextCursor || "");
    if (targetPage !== 1 && targetPage !== (pagination?.page || 1) + 1) return false;
    if (targetPage < 1 || (targetPage > (pagination?.page || 1) && !pagination?.hasMore)) return true;

    const worksScopeKey = `${activeUser}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`;
    if (loadedWorksScopeKey !== worksScopeKey || payload?.scopeKey !== activeUser) return false;

    const kind = worksTypeFilter === "import" ? "all" : "generated";
    const url = new URL("/api/admin/user/works", window.location.origin);
    url.searchParams.set("adminKey", activeUser);
    url.searchParams.set("kind", kind);
    url.searchParams.set("view", "cards");
        url.searchParams.set("typeFilter", worksTypeFilter);
    applyAssetSourceFilterSearchParams(url.searchParams, worksSourceFilter);
    url.searchParams.set("limit", String(pagination?.pageSize || 40));
    if (worksDateFrom) url.searchParams.set("from", new Date(`${worksDateFrom}T00:00:00`).toISOString());
    if (worksDateTo) url.searchParams.set("to", new Date(`${worksDateTo}T23:59:59.999`).toISOString());
    url.searchParams.set("page", String(targetPage));
    if (pageCursor) url.searchParams.set("cursor", pageCursor);
    const request = worksPageRequestGateRef.current.begin(worksScopeKey);
    const res = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return false;
    const json = (await res.json().catch(() => null)) as AdminUserPayload | null;
    if (!json || !worksPageRequestGateRef.current.accepts(request, `${String(json.scopeKey)}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`)) return false;

    setPayload((prev) => {
      if (!prev || loadedWorksScopeKey !== worksScopeKey || prev.scopeKey !== activeUser) return prev;
      if (!worksPageRequestGateRef.current.accepts(request, worksScopeKey)) return prev;
      const nextPayload = {
        ...prev, ...json,
        syncCursor: worksCursorRef.current || json.syncCursor || prev.syncCursor,
        generations: targetPage === 1 ? json.generations || [] : appendAdminWorksPage(prev.generations, json.generations || []),
        pagination: json.pagination ? { ...json.pagination, page: targetPage } : prev.pagination,
      } as AdminUserPayload;
      const syncCursor = worksCursorRef.current || prev.syncCursor;
      if (syncCursor) adminUserWorksCache.set(worksScopeKey, nextPayload, syncCursor);
      return nextPayload;
    });
    return true;
  }, [activeUser, activeUserId, loadedWorksScopeKey, mainTab, payload, tab, worksSourceFilter, worksTypeFilter, worksDateFrom, worksDateTo]);

  const refreshWorksChanges = React.useCallback(async () => {
    if (!activeUserId || mainTab !== "users" || tab !== "works" || (payload?.pagination?.page || 1) !== 1 || worksDateFrom || worksDateTo) return false;
    const cursor = worksCursorRef.current;
    const cursorQuery = buildAdminWorksChangesQuery(cursor);
    if (!cursorQuery) return false;
    const kind = worksTypeFilter === "import" ? "all" : "generated";
    const worksScopeKey = `${activeUser}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`;
    if (loadedWorksScopeKey !== worksScopeKey || payload?.scopeKey !== activeUser) return false;
    const request = worksChangesRequestGateRef.current.begin(worksScopeKey);
    const url = new URL("/api/admin/user/works/changes", window.location.origin);
    url.searchParams.set("adminKey", activeUser);
    url.searchParams.set("kind", kind);
    url.searchParams.set("view", "cards");
        url.searchParams.set("typeFilter", worksTypeFilter);
    applyAssetSourceFilterSearchParams(url.searchParams, worksSourceFilter);
    url.searchParams.set("limit", "120");
    cursorQuery.forEach((value, key) => url.searchParams.set(key, value));
    const res = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return false;
    const json = (await res.json().catch(() => null)) as any;
    if (!worksChangesRequestGateRef.current.accepts(request, `${String(json?.scopeKey || "")}|${worksTypeFilter}|${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`)) return false;
    const incoming = Array.isArray(json?.generations) ? (json.generations as Generation[]) : [];
    const deletedIds = new Set(
      (Array.isArray(json?.deletedIds) ? json.deletedIds : [])
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isFinite(id)),
    );
    const nextCursor = parseAdminWorksCursor(json?.nextCursor);
    if (nextCursor) worksCursorRef.current = nextCursor;
    if (!incoming.length && !deletedIds.size) {
      if (nextCursor && payload) adminUserWorksCache.set(worksScopeKey, { ...payload, syncCursor: nextCursor }, nextCursor);
      return true;
    }

    // Insertions/deletions change the page boundary. Refetch the bounded page and
    // its cursor together so the next page cannot skip cards dropped from page one.
    const currentIds = new Set((payload?.generations || []).map(item => item.id));
    if (incoming.some(item => !currentIds.has(item.id)) || deletedIds.size) {
      setDetailItem(prev => prev && deletedIds.has(prev.id) ? null : prev);
      return loadMoreWorks(1);
    }

    setPayload((prev) => {
      if (!prev || loadedWorksScopeKey !== worksScopeKey || prev.scopeKey !== activeUser) return prev;
      const existingIds = new Set((Array.isArray(prev.generations) ? prev.generations : []).map((item) => Number(item.id)));
      const retained = (Array.isArray(prev.generations) ? prev.generations : []).filter((item) => !deletedIds.has(Number(item.id)));
      const nextGenerations = mergeGenerationsById(retained, incoming);
      const addedCount = incoming.reduce((count, item) => count + (existingIds.has(Number(item.id)) ? 0 : 1), 0);
      const removedCount = (Array.isArray(prev.generations) ? prev.generations : []).reduce(
        (count, item) => count + (deletedIds.has(Number(item.id)) ? 1 : 0),
        0,
      );
      const nextPayload = {
        ...prev,
        syncCursor: nextCursor || prev.syncCursor,
        generations: nextGenerations,
        pagination: prev.pagination
          ? {
              ...prev.pagination,
              total: typeof prev.pagination.total === "number"
                ? Math.max(0, prev.pagination.total + addedCount - removedCount)
                : null,
            }
          : prev.pagination
      } as AdminUserPayload;
      const cacheCursor = nextCursor || prev.syncCursor;
      if (cacheCursor) adminUserWorksCache.set(worksScopeKey, nextPayload, cacheCursor);
      return nextPayload;
    });
    setDetailItem((prev) => {
      if (!prev) return prev;
      if (deletedIds.has(Number(prev.id))) return null;
      return prev; // Preview updates must not overwrite already hydrated task details.
    });
    return true;
  }, [activeUser, activeUserId, loadedWorksScopeKey, loadMoreWorks, mainTab, payload, tab, worksSourceFilter, worksTypeFilter, worksDateFrom, worksDateTo]);

  React.useEffect(() => {
    const changed = () => {
      clearAdminUserPayloadCacheForUser();
      if (mainTab === "users" && tab === "skills") void loadUser({ force: true, background: true });
    };
    window.addEventListener("role-skills:changed", changed);
    return () => window.removeEventListener("role-skills:changed", changed);
  }, [mainTab, tab, loadUser]);

  const refreshUsersSummary = React.useCallback(async () => {
    const cursor = usersSummaryCursorRef.current;
    const directoryScope = directoryScopeRef.current;
    const url = new URL("/api/admin/users/summary-changes", window.location.origin);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return false;
    const json = (await res.json().catch(() => null)) as any;
    if (directoryScopeRef.current !== directoryScope || usersSummaryCursorRef.current !== cursor) return false;
    const incoming = Array.isArray(json?.items) ? (json.items as AdminUserItem[]) : [];
    const deletedAdminKeys = new Set(
      Array.isArray(json?.deletedAdminKeys) ? json.deletedAdminKeys.map(String) : [],
    );
    const nextCursor = typeof json?.nextCursor === "string" ? json.nextCursor : null;
    if (nextCursor) usersSummaryCursorRef.current = nextCursor;
    if (incoming.length || deletedAdminKeys.size) {
      setUsers((prev) => mergeUsersByAdminKey(
        prev.filter((item) => !deletedAdminKeys.has(item.adminKey)),
        incoming.filter(item => prev.some(existing => existing.adminKey === item.adminKey)),
      ));
    }
    return true;
  }, []);

  React.useEffect(() => {
    if (
      mainTab !== "users" ||
      tab !== "works" ||
      !activeUserId ||
      !canStartAdminWorksPolling({
        activeAdminKey: activeUser,
        typeFilter: worksTypeFilter,
        sourceFilter: `${worksSourceFilter}|${worksDateFrom}|${worksDateTo}`,
        loadedScopeKey: loadedWorksScopeKey,
        payloadScopeKey: payload?.scopeKey,
        cursor: payload?.syncCursor ? worksCursorRef.current : null,
      })
    ) return;
    let disposed = false;
    let inFlight = false;
    let delayMs = ADMIN_LIVE_POLL_MS;
    let timer: number | null = null;

    const tick = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = window.setTimeout(tick, ADMIN_LIVE_POLL_MS);
        return;
      }
      if (inFlight) {
        timer = window.setTimeout(tick, delayMs);
        return;
      }
      inFlight = true;
      try {
        const ok = await refreshWorksChanges();
        delayMs = ok ? ADMIN_LIVE_POLL_MS : Math.min(ADMIN_LIVE_POLL_BACKOFF_MAX_MS, delayMs * 2);
      } catch {
        delayMs = Math.min(ADMIN_LIVE_POLL_BACKOFF_MAX_MS, delayMs * 2);
      } finally {
        inFlight = false;
        if (!disposed) timer = window.setTimeout(tick, delayMs);
      }
    };

    timer = window.setTimeout(tick, ADMIN_LIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(tick, 50);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [activeUser, activeUserId, loadedWorksScopeKey, mainTab, payload?.scopeKey, payload?.syncCursor, refreshWorksChanges, tab, worksSourceFilter, worksTypeFilter, worksDateFrom, worksDateTo]);

  React.useEffect(() => {
    if (desktopMode || mainTab !== "users") return;
    let disposed = false;
    let inFlight = false;
    let delayMs = ADMIN_LIVE_POLL_MS;
    let timer: number | null = null;

    const tick = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = window.setTimeout(tick, ADMIN_LIVE_POLL_MS);
        return;
      }
      if (inFlight) {
        timer = window.setTimeout(tick, delayMs);
        return;
      }
      inFlight = true;
      try {
        const ok = await refreshUsersSummary();
        delayMs = ok ? ADMIN_LIVE_POLL_MS : Math.min(ADMIN_LIVE_POLL_BACKOFF_MAX_MS, delayMs * 2);
      } catch {
        delayMs = Math.min(ADMIN_LIVE_POLL_BACKOFF_MAX_MS, delayMs * 2);
      } finally {
        inFlight = false;
        if (!disposed) timer = window.setTimeout(tick, delayMs);
      }
    };

    timer = window.setTimeout(tick, ADMIN_LIVE_POLL_MS);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [desktopMode, mainTab, refreshUsersSummary]);

  React.useEffect(() => {
    setMaterialPage(1);
    setMaterialArchivedOpen(false);
    setMaterialArchivedPage(1);
    setMaterialEventsOpen(false);
    setMaterialEventsPage(1);
    setMaterialEventsAction("all");
  }, [activeUser, tab]);




  // 包装 hook 的 loadStorage：在拉到 storage 数据的同时，把 retention 字段同步到父级
  // （retention 暂未抽离，与 storage 仍共享同一个接口返回值）
  const loadStorage = React.useCallback(async (options?: { force?: boolean }) => {
    const json = await loadStorageRaw(options);
    if (json?.lastPrunedAt) setRetentionLastPrunedAt(String(json.lastPrunedAt));
    if (json?.retentionDays) {
      const next = String(Math.max(1, Number(json.retentionDays) || 1));
      setRetentionDays(next);
      setRetentionSaved(next);
    }
  }, [loadStorageRaw]);

  React.useEffect(() => {
    if (mainTab !== "overview") return;
    void loadStorage();
  }, [loadStorage, mainTab]);

  // 全局软刷新：根据当前主 tab 派发对应的重新加载。
  // - overview：重拉存储/统计快照
  // - users：清掉前端 user payload 缓存 + 强制重拉 user 列表和详情
  // - feedback_center：调用面板暴露的 refresh()
  // - system 的一键升级区使用页面内“检查版本”，顶部全局刷新不触发该区，避免改变升级页位置或状态
  const refreshCurrent = React.useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    // 最短旋转时长：保证顶部"刷新"按钮在任何 tab 都明显转一下（数据秒回也能看到反馈）
    const minSpin = new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const work = (async () => {
        if (mainTab === "overview") {
          await loadStorage({ force: true });
        } else if (mainTab === "users") {
          invalidateAdminCaches();
          // 后台重拉列表与详情，不触发面板 loading（保持当前内容，不白闪/跳动）
          await Promise.all([loadUsers(), loadUser({ force: true, background: true })]);
          setUserOrderRefreshKey((key) => key + 1);
        } else if (mainTab === "feedback_center") {
          await (feedbackPanelRef.current?.refresh() ?? Promise.resolve());
        } else if (mainTab === "audit_logs") {
          await (logsPanelRef.current?.refresh() ?? Promise.resolve());
        } else if (mainTab === "monitoring") {
          await (monitoringPanelRef.current?.refresh() ?? Promise.resolve());
        } else if (mainTab === "system") {
          setRefreshKey((n) => n + 1);
        }
      })();
      await Promise.all([work, minSpin]);
    } finally {
      setRefreshing(false);
    }
  }, [
    mainTab,
    refreshing,
    loadStorage,
    loadUsers,
    loadUser,
    invalidateAdminCaches,
    systemSectionActive,
  ]);

  const loadRetentionSettings = React.useCallback((options?: { force?: boolean }) => {
    if (!options?.force && Date.now() - retentionLoadedAtRef.current < ADMIN_PREFETCH_TTL_MS) {
      return Promise.resolve();
    }
    if (retentionLoadPromiseRef.current) return retentionLoadPromiseRef.current;
    setRetentionErr(null);
    setRetentionLoading(true);
    const request = (async () => {
      try {
        const res = await fetch("/api/admin/settings/data-retention", { cache: "no-store" }).catch(() => null);
        if (!res) {
          setRetentionErr("网络错误");
          return;
        }
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          setRetentionErr(String(json?.error || "读取失败"));
          return;
        }
        const days = String(Math.max(1, Number(json?.days || 15) || 15));
        setRetentionDays(days);
        setRetentionSaved(days);
        setRetentionLastPrunedAt(json?.lastPrunedAt ? String(json.lastPrunedAt) : null);
        retentionLoadedAtRef.current = Date.now();
      } finally {
        setRetentionLoading(false);
      }
    })();
    const trackedRequest = request.finally(() => {
      if (retentionLoadPromiseRef.current === trackedRequest) retentionLoadPromiseRef.current = null;
    });
    retentionLoadPromiseRef.current = trackedRequest;
    return trackedRequest;
  }, []);

  React.useEffect(() => {
    if (mainTab !== "overview") return;
    void loadRetentionSettings();
  }, [loadRetentionSettings, mainTab]);

  const prefetchMainTab = React.useCallback((nextTab: MainTab) => {
    if (desktopMode && isHiddenDesktopAdminTab(nextTab)) return;
    if (nextTab === "monitoring") void loadAdminMonitoringPanel();
    if (nextTab === "audit_logs") void (desktopMode ? loadSettingsLogsPanel() : loadAdminLogsPanel());
    if (nextTab === "feedback_center") void loadFeedbackCenterPanel();
    if (nextTab === "users") {
      void loadUserAnalysisPanel();
      void ensureUsersLoaded();
      return;
    }
    if (nextTab === "overview") {
      void loadAdminOverviewTab();
      void loadStorage();
      void loadRetentionSettings();
      return;
    }
    if (nextTab === "system") {
      void loadAdminSystemTab().then(({ preloadAdminSystemSection }) => {
        preloadAdminSystemSection(systemSectionActive);
      });
      return;
    }
  }, [desktopMode, ensureUsersLoaded, loadRetentionSettings, loadStorage, systemSectionActive]);

  const prefetchUserDetailTab = React.useCallback((nextTab: UserDetailTab) => {
    if (nextTab === "analysis") void loadUserAnalysisPanel();
    else if (nextTab === "billing") void loadUserBillingPanel();
    else if (nextTab === "canvases") void loadUserCanvasesPanel();
    else if (nextTab === "works") void loadUserWorksPanel();
    else if (nextTab === "materials") void loadUserMaterialAssetsPanel();
    else if (nextTab === "presets") void loadUserPresetsPanel();
    else if (nextTab === "skills") void loadUserRoleSkillsPanel();
  }, []);

  const prefetchFrequentAdminTabs = React.useCallback(() => {
    prefetchMainTab("users");
    prefetchMainTab("system");
  }, [prefetchMainTab]);

  React.useEffect(() => {
    // 设置页只加载当前分区；保留顶部导航的意图预取。
    if (mainTab === "system") return;
    let cancelIdle: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      cancelIdle = scheduleIdleBatches(1, prefetchFrequentAdminTabs, { batchSize: 1 });
    }, ADMIN_PREFETCH_IDLE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      cancelIdle?.();
    };
  }, [mainTab, prefetchFrequentAdminTabs]);

  const saveRetentionDays = React.useCallback(async () => {
    const n = Math.floor(Number(retentionDays));
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      setRetentionErr("请输入 1-365 的整数天数");
      return;
    }
    setRetentionErr(null);
    setRetentionSaving(true);
    try {
      const res = await fetch("/api/admin/settings/data-retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: n })
      }).catch(() => null);
      if (!res) {
        setRetentionErr("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setRetentionErr(String(json?.error || "保存失败"));
        return;
      }
      const next = String(Math.max(1, Number(json?.days || n) || n));
      setRetentionDays(next);
      setRetentionSaved(next);
      retentionLoadedAtRef.current = Date.now();
      await loadStorage({ force: true });
    } finally {
      setRetentionSaving(false);
    }
  }, [loadStorage, retentionDays]);

  const replaceAdminUrl = React.useCallback(
    (nextTab: MainTab, nextSection?: SystemSectionKey) => {
      const params = new URLSearchParams();
      if (nextTab !== "overview") params.set("tab", nextTab);
      if (nextTab === "system") params.set("section", nextSection || systemSectionActive);
      if (nextTab === "users") {
        writeUserPageLocation(params, tab, activeUser);
      }
      const query = params.toString();
      // Let Next synchronize its canonical URL instead of forwarding internal history markers.
      window.history.replaceState(null, "", query ? `/admin?${query}` : "/admin");
    },
    [systemSectionActive, tab, activeUser]
  );

  const selectMainTab = React.useCallback(
    (nextTab: MainTab) => {
      setMainTab(nextTab);
      replaceAdminUrl(nextTab);
    },
    [replaceAdminUrl]
  );

  const selectSystemSection = React.useCallback((key: SystemSectionKey) => {
    setSystemSectionActive(key);
    replaceAdminUrl("system", key);
    settingsContentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [replaceAdminUrl]);

  const filteredUsersBase = users;

  const gens = payload?.generations || [];
  const imports = React.useMemo(() => gens.filter((g) => g.type === "import"), [gens]);
  const generated = React.useMemo(() => gens.filter((g) => g.type !== "import"), [gens]);
  const currentFilterTotal = Math.max(0, Number(payload?.pagination?.total || 0));
  const worksItems = React.useMemo(() => {
    if (worksTypeFilter === "import") {
      return imports;
    }
    // Cursor pages already arrive in display order; appending must not move viewed cards.
    const groups = new Map<string, Generation>();
    for (const g of generated) {
      const taskId = String(g.externalTaskId || "").trim();
      const key = taskId ? `${g.type}:${taskId}` : `id:${g.id}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          ...g,
          outputPaths: Array.isArray(g.outputPaths) ? [...g.outputPaths] : []
        });
        continue;
      }
      const mergedOutputs = Array.from(
        new Set(
          [
            ...(Array.isArray(existing.outputPaths) ? existing.outputPaths : []),
            ...(Array.isArray(g.outputPaths) ? g.outputPaths : []),
            g.localPath || ""
          ]
            .map((x) => normalizeMediaUrl(x))
            .filter(Boolean)
        )
      );
      const existingTs = new Date(String(existing.finishedAt || existing.createdAt || 0)).getTime();
      const currentTs = new Date(String(g.finishedAt || g.createdAt || 0)).getTime();
      const newer = currentTs >= existingTs ? g : existing;
      groups.set(key, {
        ...newer,
        outputPaths: mergedOutputs
      });
    }
    return Array.from(groups.values());
  }, [generated, imports, worksTypeFilter]);
  const filteredWorksItems = worksItems;
  const isWorksSearching = false;
  const userPresets = Array.isArray(payload?.presets) ? payload.presets : [];
  const userRoleSkills = Array.isArray(payload?.roleSkills) ? payload.roleSkills : [];
  const presetTotalCount = userPresets.filter(
    (preset) => preset.source === "custom",
  ).length;
  const deletedPresetCount = Math.max(0, Number(payload?.presetDeletedCount) || 0);

  const statusItems = React.useMemo(() => {
    const map = payload?.counts?.byStatus || {};
    const entries = Object.entries(map)
      .map(([k, v]) => ({ label: k || "--", value: Math.max(0, Number(v) || 0) }))
      .sort((a, b) => b.value - a.value);
    const palette = ["#6366f1", "#22c55e", "#f97316", "#ef4444", "#06b6d4", "#a855f7", "#eab308"];
    return entries.map((it, idx) => ({ ...it, color: palette[idx % palette.length] }));
  }, [payload?.counts?.byStatus]);

  const typeItems = React.useMemo(() => {
    const map = payload?.counts?.byType || {};
    return Object.entries(map)
      .map(([k, v]) => ({ label: k || "--", value: Math.max(0, Number(v) || 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [payload?.counts?.byType]);

  const sourceItems = React.useMemo(() => topEntries(payload?.analytics?.bySource, 8), [payload?.analytics?.bySource]);
  const agentConversationStatusItems = React.useMemo(() => topEntries(payload?.analytics?.agent?.conversationsByStatus, 8), [payload?.analytics?.agent?.conversationsByStatus]);
  const agentRunStatusItems = React.useMemo(() => topEntries(payload?.analytics?.agent?.runsByStatus, 8), [payload?.analytics?.agent?.runsByStatus]);
  const agentRunModelItems = React.useMemo(() => topEntries(payload?.analytics?.agent?.runsByModel, 8), [payload?.analytics?.agent?.runsByModel]);
  const agentRunPurposeItems = React.useMemo(() => topEntries(payload?.analytics?.agent?.runsByPurpose, 8), [payload?.analytics?.agent?.runsByPurpose]);
  const recentActivities = payload?.analytics?.recentActivities || [];
  const totals = payload?.analytics?.totals || { uploads: imports.length, outputs: generated.filter((x) => x.status === "success").length, failed: generated.filter((x) => x.status === "failed").length, successRate: 0 };
  const pagination = payload?.pagination || { page: 1, pageSize: 20, total: gens.length, totalPages: 1, hasMore: false, kind: "all" };
  const generatedSuccessCount = generated.filter((x) => x.status === "success").length;
  const generatedFailedCount = generated.filter((x) => x.status === "failed").length;
  const generatedFailureRate = generated.length ? Math.round((generatedFailedCount / generated.length) * 100) : 0;
  const totalSuccessCount = Math.max(0, Number(totals.outputs || 0));
  const totalFailedCount = Math.max(0, Number(totals.failed || 0));
  const totalGeneratedTaskCount = totalSuccessCount + totalFailedCount;
  const totalFailureRate = totalGeneratedTaskCount > 0 ? Math.round((totalFailedCount / totalGeneratedTaskCount) * 100) : 0;
  const countByStatusTotal = Object.values(payload?.counts?.byStatus || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const totalRecordCount = Math.max(
    0,
    Number(payload?.account?.totalGenerationRecords || 0),
    countByStatusTotal,
    Number(pagination.total || 0)
  );
  const last14 = React.useMemo(() => {
    const m = payload?.analytics?.daily14;
    if (m && Object.keys(m).length) return buildLastNDaysSeriesFromMap(m, 14);
    return buildLastNDaysSeries(gens, 14);
  }, [gens, payload?.analytics?.daily14]);

  const detailInputPaths = React.useMemo(() => {
    if (!detailItem) return [] as string[];
    const raw = detailItem.type === "import" ? [detailItem.localPath] : detailItem.inputMaterials || [];
    const normalized = raw
      .map((x) => String(x || "").trim())
      .filter((x) => x && (x.startsWith("/") || /^https?:\/\//i.test(x)));
    return Array.from(new Set(normalized));
  }, [detailItem]);

  const detailOutputPaths = React.useMemo(() => {
    if (!detailItem || detailItem.type === "import") return [] as string[];
    const fromItem = Array.isArray(detailItem.outputPaths)
      ? detailItem.outputPaths.map((x) => normalizeMediaUrl(x)).filter(Boolean)
      : [];
    if (fromItem.length) return Array.from(new Set(fromItem));
    const groupId = String(detailItem.externalTaskId || "").trim();
    if (groupId) {
      const sameGroup = gens
        .filter((x) => x.type === detailItem.type && String(x.externalTaskId || "").trim() === groupId)
        .map((x) => normalizeMediaUrl(x.localPath || ""))
        .filter(Boolean);
      if (sameGroup.length) return Array.from(new Set(sameGroup));
    }
    const p = normalizeMediaUrl(detailItem.localPath || "");
    return p ? [p] : [];
  }, [detailItem, gens]);

  const detailParamEntries = React.useMemo(() => {
    if (!detailItem) return [] as { label: string; value: string }[];
    return buildGenerationParamEntries(detailItem);
  }, [detailItem]);
  const detailModeInfo = React.useMemo(() => getAdminWorkModeInfo(detailItem), [detailItem]);
  const [detailLoadError, setDetailLoadError] = React.useState(false);
  const [detailAttempt, setDetailAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!detailOpen || !detailItem || (detailItem as any).detailsLoaded !== false) return;
    const controller = new AbortController();
    const id = detailItem.id;
    setDetailLoadError(false);
    void fetch(`/api/admin/user/works?adminKey=${encodeURIComponent(activeUser)}&detailId=${id}`, { cache: "no-store" })
      .then(async (res) => { if (!res.ok) throw new Error("detail"); return res.json(); })
      .then((data) => {
        if (!controller.signal.aborted && data.scopeKey === activeUser && data.item?.id === id) setDetailItem(data.item);
      }).catch(() => { if (!controller.signal.aborted) setDetailLoadError(true); });
    return () => controller.abort();
  }, [activeUser, detailOpen, detailItem?.id, (detailItem as any)?.detailsLoaded, detailAttempt]);
  const detailModalItem = React.useMemo(() => {
    if (!detailItem) return null;
    return {
      ...detailItem,
      inputImages: detailInputPaths,
      outputPaths: detailOutputPaths
    } as WorkDetailItem;
  }, [detailInputPaths, detailItem, detailOutputPaths]);

  const openDetailZoom = React.useCallback((src: string) => {
    const url = normalizeMediaUrl(src || "");
    if (!url) return;
    setDetailZoomSrc(url);
    setDetailZoomKind(isVideoPath(url) ? "video" : "image");
    setDetailZoomOpen(true);
  }, []);

  const downloadGeneration = React.useCallback((g: Generation) => {
    const targets = buildDownloadTargets(g, gens);
    if (!targets.length) return;
    if (targets.length === 1) {
      triggerDownload(targets[0]);
      return;
    }
    targets.forEach((url, idx) => {
      window.setTimeout(() => triggerDownload(url, buildDownloadFilename("admin_work", g.id, idx, url)), idx * 120);
    });
  }, [gens]);

  const downloadInputMaterials = React.useCallback((paths: string[], generationId?: number | null) => {
    const targets = buildInputDownloadTargets(paths);
    if (!targets.length) return;
    if (targets.length === 1) {
      triggerDownload(targets[0]);
      return;
    }
    targets.forEach((url, idx) => {
      window.setTimeout(() => triggerDownload(url, buildDownloadFilename("admin_input", generationId || "material", idx, url)), idx * 120);
    });
  }, []);

  const storageAnalytics = storage?.analytics;
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
  const rankedUsers = React.useMemo(() => {
    const findAnalyticsUser = (u: AdminUserItem) => {
      const key1 = `${u.adminKey || ""}|${u.userId || ""}|${u.authUserId ?? ""}`;
      const key2 = `${u.userId || ""}|${u.authUserId ?? ""}`;
      return analyticsUserIndex.get(key1) || analyticsUserIndex.get(key2) || null;
    };
    return filteredUsersBase
      .map((u) => {
        const analyticsUser = findAnalyticsUser(u);
        const successCount = Math.max(0, Number(analyticsUser?.successCount || 0));
        const failedCount = Math.max(0, Number(analyticsUser?.failedCount || 0));
        const total = Math.max(0, successCount + failedCount);
        const failureRate = total > 0 ? Math.round((failedCount / total) * 100) : 0;
        const trend7 = Array.isArray(analyticsUser?.trend7) ? analyticsUser!.trend7.map((n) => Math.max(0, Number(n) || 0)) : [];
        const recent7Total = trend7.reduce((s, x) => s + x, 0);
        const last3 = trend7.slice(-3);
        const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;
        const riskLevel: "high" | "medium" | "low" = failureRate >= 35 ? "high" : failureRate >= 20 ? "medium" : "low";
        const summary = [
          `近7天产出 ${recent7Total} 条`,
          `成功率 ${successRate}%（失败 ${failedCount}）`,
          `近3天趋势 ${last3.length ? last3.join(" / ") : "0 / 0 / 0"}`
        ];
        return { ...u, analyticsUser, failureRate, successRate, riskLevel, summary, recent7Total };
      })
      .sort((a, b) => {
        // 主排序：最近活跃时间倒序（最新使用的排在最上面）；无时间戳的统一沉到底部
        const ta = a.lastCreatedAt ? new Date(a.lastCreatedAt).getTime() : 0;
        const tb = b.lastCreatedAt ? new Date(b.lastCreatedAt).getTime() : 0;
        if (ta !== tb) return tb - ta;
        // 次序兜底：风险等级、失败率、产出数、adminKey
        const riskRank = { high: 0, medium: 1, low: 2 } as const;
        const ra = riskRank[a.riskLevel];
        const rb = riskRank[b.riskLevel];
        if (ra !== rb) return ra - rb;
        if (b.failureRate !== a.failureRate) return b.failureRate - a.failureRate;
        if (b.generationCount !== a.generationCount) return b.generationCount - a.generationCount;
        return String(a.adminKey).localeCompare(String(b.adminKey));
      });
  }, [analyticsUserIndex, filteredUsersBase]);

  const runStorageCleanup = React.useCallback(
    async (action: "cleanup_temp" | "cleanup_old_uploads" | "cleanup_thumbnail_assets", adminPassword?: string): Promise<boolean> => {
      if (cleanupBusy) return false;
      const days = Number(cleanupDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        const message = "请先设置 1-365 天的保留期限；0 表示未设置";
        setStorageErr(message);
        setConfirmError(message);
        return false;
      }
      setCleanupBusy(action === "cleanup_temp" ? "temp" : action === "cleanup_thumbnail_assets" ? "thumbnails" : "uploads");
      setStorageErr(null);
      setStorageCleanupResult(null);
      try {
        const res = await fetch("/api/admin/storage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            days,
            ...(action !== "cleanup_temp" ? { adminPassword: adminPassword || "" } : {}),
          })
        }).catch(() => null);
        if (!res) {
          const message = "网络错误";
          setStorageErr(message);
          setConfirmError(message);
          return false;
        }
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const message = String(json?.error || "执行清理失败");
          setStorageErr(message);
          setConfirmError(message);
          return false;
        }
        const at = Date.now();
        if (action === "cleanup_temp") {
          setStorageCleanupResult({
            action,
            days: Number(json?.days || days),
            deletedFiles: Number(json?.deletedFiles || 0),
            deletedBytes: Number(json?.deletedBytes || 0),
            removedDirs: Number(json?.removedDirs || 0),
            at,
          });
        } else if (action === "cleanup_old_uploads") {
          setStorageCleanupResult({
            action,
            days: Number(json?.days || days),
            cutoff: String(json?.cutoff || new Date(at - days * 24 * 60 * 60 * 1000).toISOString()),
            deletedGenerations: Number(json?.deletedGenerations || 0),
            deletedLogs: Number(json?.deletedLogs || 0),
            deletedLedgers: Number(json?.deletedLedgers || 0),
            deletedLocalFiles: Number(json?.deletedLocalFiles || 0),
            deletedOssObjects: Number(json?.deletedOssObjects || 0),
            deletedBytes: Number(json?.deletedBytes || 0),
            skippedSharedRefs: Number(json?.skippedSharedRefs || 0),
            skippedProtectedRefs: Number(json?.skippedProtectedRefs || 0),
            ossErrorCount: Number(json?.ossErrorCount || 0),
            at,
          });
        } else {
          setStorageCleanupResult({
            action,
            days: Number(json?.days || days),
            cutoff: String(json?.cutoff || new Date(at - days * 24 * 60 * 60 * 1000).toISOString()),
            scannedFiles: Number(json?.scannedFiles || 0),
            protectedFiles: Number(json?.protectedFiles || 0),
            deletedCacheFiles: Number(json?.deletedCacheFiles || 0),
            deletedOrphanFiles: Number(json?.deletedOrphanFiles || 0),
            deletedBytes: Number(json?.deletedBytes || 0),
            failedFiles: Number(json?.failedFiles || 0),
            at,
          });
        }
        clearAdminUserPayloadCacheForUser();
        await loadStorage();
        await loadUsers();
        setWorksTypeFilter("all");
        return true;
      } finally {
        setCleanupBusy("");
      }
    },
    [cleanupBusy, cleanupDays, loadStorage, loadUser, loadUsers]
  );

  const runConfirmAction = React.useCallback(async (adminPassword?: string) => {
    if (!confirmAction) return;
    setConfirmError(null);
    setConfirmBusy(true);
    try {
      if (confirmAction.type === "delete_user") {
        const res = await fetch("/api/admin/user/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: confirmAction.userId,
            authUserId: confirmAction.authUserId ?? null,
            adminPassword: adminPassword || ""
          })
        }).catch(() => null);
        if (!res || !res.ok) {
          const json = await res?.json().catch(() => null);
          const message = String(json?.error || "删除用户失败");
          setConfirmError(message);
          notifyAdminAction({ type: "error", title: "删除失败", message });
          return;
        }
        clearAdminUserPayloadCacheForUser(confirmAction.userId);
        clearAuthUsersCache(); // 删除用户后让系统设置「账号与用户名分配」面板下次进入拉取最新数据
        if (activeUser === (confirmAction.adminKey || "")) setActiveUser("");
        setPayload(null);
        await loadUsers();
        await loadUser({ force: true });
        invalidateAdminCaches();
        notifyAdminAction({ type: "success", title: "删除成功", message: `用户 ${confirmAction.userId} 已删除` });
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "delete_generation") {
        const res = await fetch("/api/admin/generation/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: confirmAction.id })
        }).catch(() => null);
        const json = await res?.json().catch(() => null);
        if (!res || !res.ok) {
          const message = String(json?.error || "删除记录失败");
          setConfirmError(message);
          notifyAdminAction({ type: "error", title: "删除失败", message });
          return;
        }
        publishGenerationDeleted(json?.deletedGenerationIds || [confirmAction.id]);
        clearAdminUserPayloadCacheForUser(activeUserItem?.userId);
        clearAuthUsersCache();
        await loadUser({ force: true });
        if (Number(detailItem?.id) === Number(confirmAction.id)) {
          setDetailOpen(false);
          setDetailItem(null);
        }
        invalidateAdminCaches();
        notifyAdminAction({ type: "success", title: "删除成功", message: `记录 #${confirmAction.id} 已删除` });
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "bulk_delete_generations") {
        const ids = Array.from(new Set(confirmAction.ids.filter((n) => Number.isFinite(n))));
        if (ids.length === 0) {
          setConfirmAction(null);
          return;
        }
        const res = await fetch("/api/admin/generation/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids })
        }).catch(() => null);
        const json = await res?.json().catch(() => null);
        if (!res || !res.ok) {
          const message = String(json?.error || "批量删除失败");
          setConfirmError(message);
          notifyAdminAction({ type: "error", title: "删除失败", message });
          return;
        }
        publishGenerationDeleted(json?.deletedGenerationIds || ids);
        clearAdminUserPayloadCacheForUser(activeUserItem?.userId);
        clearAuthUsersCache();
        await loadUser({ force: true });
        setWorksBulkDeleteResetSeq((s) => s + 1);
        invalidateAdminCaches();
        const deletedCount = Number(json?.deletedGenerations || 0);
        const skippedReferenced = Number(json?.referencedSkipCount || 0);
        const failedDeletes = Number(json?.failedDeletes || 0) +
          (Array.isArray(json?.failedOssKeysPreview) ? json.failedOssKeysPreview.length : 0);
        setConfirmAction(null);
        notifyAdminAction({
          type: failedDeletes > 0 ? "error" : "success",
          title: failedDeletes > 0 ? "部分删除失败" : "删除成功",
          message: [
            `已删除 ${deletedCount} 条记录`,
            skippedReferenced > 0 ? `${skippedReferenced} 项仍被引用，已保留` : "",
            failedDeletes > 0 ? `${failedDeletes} 项删除失败，请检查后重试` : ""
          ].filter(Boolean).join("；")
        });
        return;
      }
      if (confirmAction.type === "bulk_delete_imports") {
        const res = await fetch("/api/admin/user/purge-data", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: confirmAction.userId,
            authUserId: confirmAction.authUserId ?? null,
            purgeGenerations: true,
            generationTypes: ["import"],
            // "导入未引用的素材" tab 上的批量删除，按字面只清孤儿 import，
            // 不能把还在被资产引用的上传素材删掉
            onlyUnreferencedImports: true,
            purgeLogs: false
          })
        }).catch(() => null);
        if (!res || !res.ok) {
          const json = await res?.json().catch(() => null);
          const message = String(json?.error || "批量删除失败");
          setConfirmError(message);
          notifyAdminAction({ type: "error", title: "删除失败", message });
          return;
        }
        const json = await res.json().catch(() => null);
        clearAdminUserPayloadCacheForUser(confirmAction.userId);
        clearAuthUsersCache();
        setWorksTypeFilter("all");
        invalidateAdminCaches();
        const deletedCount = Number(json?.result?.generations || 0);
        const skippedReferenced = Number(json?.debug?.referencedSkipCount || 0);
        const failedDeletes = Array.isArray(json?.debug?.failedOssKeysPreview)
          ? json.debug.failedOssKeysPreview.length
          : 0;
        setConfirmAction(null);
        notifyAdminAction({
          type: failedDeletes > 0 ? "error" : "success",
          title: failedDeletes > 0 ? "部分删除失败" : "删除成功",
          message: [
            `已删除 ${deletedCount} 条记录`,
            skippedReferenced > 0 ? `${skippedReferenced} 项仍被引用，已保留` : "",
            failedDeletes > 0 ? `${failedDeletes} 项删除失败，请检查后重试` : ""
          ].filter(Boolean).join("；")
        });
        return;
      }
      if (confirmAction.type === "delete_feedback") {
        const res = await fetch("/api/admin/feedback", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: confirmAction.id })
        }).catch(() => null);
        if (!res || !res.ok) {
          const json = await res?.json().catch(() => null);
          notifyAdminAction({ type: "error", title: "删除失败", message: String(json?.error || "删除反馈失败") });
          return;
        }
        clearAdminUserPayloadCacheForUser(activeUserItem?.userId);
        await Promise.all([loadUser({ force: true }), feedbackPanelRef.current?.refresh() ?? Promise.resolve()]);
        invalidateAdminCaches();
        notifyAdminAction({ type: "success", title: "删除成功", message: `反馈 #${confirmAction.id} 已删除` });
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "purge_presets") {
        const res = await fetch("/api/admin/user/presets/purge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ adminKey: confirmAction.adminKey })
        }).catch(() => null);
        if (!res || !res.ok) return;
        clearAdminUserPayloadCacheForUser(confirmAction.userId);
        await loadUser({ force: true });
        invalidateAdminCaches();
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "delete_preset") {
        const res = await fetch("/api/admin/user/presets/delete-item", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            adminKey: confirmAction.adminKey,
            presetId: confirmAction.presetId,
            expectedRevision: confirmAction.expectedRevision
          })
        }).catch(() => null);
        if (!res || !res.ok) return;
        clearAdminUserPayloadCacheForUser(confirmAction.userId);
        await loadUser({ force: true });
        invalidateAdminCaches();
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "delete_builtin_preset") {
        const res = await fetch("/api/admin/presets", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: confirmAction.presetId,
            expectedRevision: confirmAction.expectedRevision
          })
        }).catch(() => null);
        if (!res || !res.ok) return;
        await builtinPresetsRef.current?.refresh();
        invalidateAdminCaches();
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "cleanup_storage") {
        const cleaned = await runStorageCleanup(confirmAction.action, adminPassword);
        if (!cleaned) return;
        invalidateAdminCaches();
        setConfirmAction(null);
        return;
      }
      if (confirmAction.type === "release_material_asset") {
        try {
          await releaseUserMaterialAsset(confirmAction.assetId);
          setConfirmAction(null);
        } catch (error) {
          setConfirmError(error instanceof Error ? error.message : "重新上架失败");
        }
        return;
      }
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmAction, activeUser, activeUserItem?.userId, detailItem?.id, loadUser, loadUsers, runStorageCleanup, invalidateAdminCaches, notifyAdminAction, releaseUserMaterialAsset]);

  const pushGenerationToInspiration = React.useCallback(async (generationId: number) => {
    if (desktopMode) return;
    if (!Number.isFinite(generationId) || generationId <= 0) return;
    if (inspirationBusyById[generationId]) return;
    setInspirationMessage(null);
    setInspirationBusyById((prev) => ({ ...prev, [generationId]: true }));
    try {
      const res = await fetch("/api/admin/settings/inspiration-templates/from-generation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generationId })
      }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as any;
      if (!res || !res.ok || !json?.success) {
        setInspirationMessage(String(json?.error || "上传到灵感失败"));
        return;
      }
      setInspirationMessage(`资产 #${generationId} 已上传到灵感模板`);
    } finally {
      setInspirationBusyById((prev) => ({ ...prev, [generationId]: false }));
    }
  }, [desktopMode, inspirationBusyById]);

  return (
    <AtomicPageReveal>
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--workspace-page-bg)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.03] to-transparent dark:hidden" />
      {detailOpen && <WorkDetailModal
        open={detailOpen && !!detailModalItem}
        item={detailModalItem}
        detailsLoading={(detailItem as any)?.detailsLoaded === false && !detailLoadError}
        detailsError={detailLoadError ? "任务详情加载失败" : null}
        onRetryDetails={() => setDetailAttempt((n) => n + 1)}
        onClose={() => setDetailOpen(false)}
        onDownloadInput={(detailItem as any)?.detailsLoaded === false ? undefined : (it) => downloadInputMaterials(Array.isArray(it.inputImages) ? it.inputImages : [], it.id)}
        onDownloadOutput={(detailItem as any)?.detailsLoaded === false ? undefined : (it) => {
          const targets = Array.from(new Set((Array.isArray(it.outputPaths) ? it.outputPaths : []).map((x) => normalizeMediaUrl(x)).filter(Boolean)));
          if (!targets.length) return;
          if (targets.length === 1) {
            triggerDownload(targets[0]);
            return;
          }
          targets.forEach((url, idx) => {
            window.setTimeout(() => triggerDownload(url, buildDownloadFilename("admin_work", it.id, idx, url)), idx * 120);
          });
        }}
        onApplyTemplate={
          !desktopMode && detailModalItem?.status === "success" && (detailItem as any)?.detailsLoaded !== false
            ? (it) => void pushGenerationToInspiration(it.id)
            : undefined
        }
        onDelete={(it) => setConfirmAction({ type: "delete_generation", id: it.id, generationType: it.type })}
        applying={!!detailModalItem && Boolean(inspirationBusyById[detailModalItem.id])}
        applyLabel="传灵感"
        applyingLabel="上传中..."
        appliedLabel="已上传"
        deleteLabel="删除"
        inlineActions
      />}
      <MediaLightbox
        open={detailZoomOpen}
        src={detailZoomSrc}
        kind={detailZoomKind}
        title=""
        onClose={() => setDetailZoomOpen(false)}
      />
      <AdminConfirmModal
        action={
          (
            confirmAction?.type === "purge_presets"
              ? {
                  ...confirmAction,
                  userId: `${confirmAction.userId}（将删除用户自定义提示词和个人内置隐藏记录，并恢复当前全局内置提示词）`,
                }
              : confirmAction
          ) as unknown as React.ComponentProps<typeof AdminConfirmModal>["action"]
        }
        busy={confirmBusy}
        error={confirmError}
        onCancel={() => {
          setConfirmError(null);
          setConfirmAction(null);
        }}
        onConfirm={(adminPassword) => void runConfirmAction(adminPassword)}
        onPasswordInput={() => setConfirmError(null)}
      />
      {adminActionNotice ? (
        <div
          className="fixed left-1/2 top-1/2 z-[150] w-[360px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)] p-4 shadow-[var(--shadow)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div
                className={[
                  "text-[14px] font-semibold",
                  adminActionNotice.type === "success" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                ].join(" ")}
              >
                {adminActionNotice.title}
              </div>
              <div className="mt-1 break-words text-[12px] leading-5 text-[var(--app-muted)]">{adminActionNotice.message}</div>
              <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m2bfff9580494" />{fmtTime(new Date(adminActionNotice.at).toISOString(), locale)}</div>
            </div>
            <UiProps ids={{"aria-label":["admin.md301bc125833"]}}><button
              type="button"
              onClick={() => setAdminActionNotice(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
              aria-label="admin.md301bc125833"
            >
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
        </div>
      ) : null}
      
      <div
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-5 lg:px-[var(--admin-page-pad)] lg:py-6"
        style={
          {
            ["--admin-page-pad" as any]: "clamp(16px, 2.4vw, 40px)",
          } as React.CSSProperties
        }
      >
        <AdminTopHeader active={mainTab} onSelect={selectMainTab} onPrefetch={prefetchMainTab} onRefresh={refreshCurrent} refreshing={refreshing} />
        <div
          className={[
            "w-full min-w-0 min-h-0 flex-1 space-y-4 overflow-x-hidden",
            desktopMode ? "" : mainTab === "users"
              ? "pt-[96px] md:pt-[76px]"
              : mainTab === "system"
                ? "pt-[116px] md:pt-[96px] xl:pt-[76px]"
                : "pt-[116px] md:pt-[96px]",
            mainTab === "system" || mainTab === "users" ? "overflow-hidden" : "overflow-y-auto"
          ].join(" ")}
        >

          {/* Overview Tab */}
          {mainTab === "overview" && (
            !storage ? (storageErr ? <div role="alert" className="rounded-2xl border border-[var(--border)] p-5 text-sm">{storageErr}<button className="ml-3 underline" onClick={() => void loadStorage({force:true})}><UiText id="admin.mb8784c8dd563" /></button></div> : <AdminOverviewLoading />) : <AdminOverviewTab
              storage={storage}
              storageLoading={storageLoading}
              storageErr={storageErr}
              storageSaving={storageSaving}
              storageTotalGb={storageTotalGb}
              setStorageTotalGb={setStorageTotalGb}
              storageWarnPercent={storageWarnPercent}
              setStorageWarnPercent={setStorageWarnPercent}
              storageCriticalPercent={storageCriticalPercent}
              setStorageCriticalPercent={setStorageCriticalPercent}
              storageSaved={storageSaved}
              loadStorage={loadStorage}
              saveStorageLimits={saveStorageLimits}
              retentionDays={retentionDays}
              setRetentionDays={setRetentionDays}
              retentionSaved={retentionSaved}
              retentionLoading={retentionLoading}
              retentionSaving={retentionSaving}
              retentionErr={retentionErr}
              retentionLastPrunedAt={retentionLastPrunedAt}
              saveRetentionDays={saveRetentionDays}
              cleanupDays={cleanupDays}
              setCleanupDays={setCleanupDays}
              cleanupBusy={cleanupBusy}
              cleanupResult={storageCleanupResult}
              onRequestStorageCleanup={(action, title) => setConfirmAction({ type: "cleanup_storage", action, title })}
              onViewUser={(adminKey) => { setActiveUser(adminKey); selectMainTab("users"); }}
            />
          )}

          {!desktopMode && mainTab === "monitoring" && (
            <AdminMonitoringPanel panelRef={monitoringPanelRef} />
          )}


          {!desktopMode && mainTab === "feedback_center" && (
            <FeedbackCenterPanel
              panelRef={feedbackPanelRef}
              openDetailZoom={openDetailZoom}
              onRequestDeleteFeedback={(id) => setConfirmAction({ type: "delete_feedback", id })}
              onReplied={loadUser}
            />
          )}

          {mainTab === "audit_logs" && (
            <div className="w-full min-h-0">
              {desktopMode ? <SettingsLogsPanel panelRef={logsPanelRef} /> : <>
                <div className="mb-3 flex justify-end"><a href="/admin/activity" className="text-sm text-[var(--app-muted)] hover:text-[var(--app-fg)]"><UiText id="admin.mbc065abcec85" /></a></div>
                <AdminLogsPanel panelRef={logsPanelRef} />
              </>}
            </div>
          )}

          {/* Users Tab */}
          {mainTab === "users" && (
            <div className="h-full min-h-0">
            <div
              className="h-full min-h-0 w-full min-w-0"
              style={
                {
                  ["--admin-fixed-nav-offset" as any]: "0px",
                  ["--user-nav-width" as any]: "230px",
                  ["--user-nav-gap" as any]: "16px",
                } as React.CSSProperties
              }
            >
              {!desktopMode && <UserListSidebar
                q={q}
                setQ={setQ}
                users={rankedUsers}
                activeUser={activeUser}
                setActiveUser={setActiveUser}
                onRequestDelete={(u) => setConfirmAction({ type: "delete_user", userId: u.userId, authUserId: u.authUserId ?? null, adminKey: u.adminKey })}
                onRequestExport={(u) => setExportModalUser(u)}
                exportLoadingKey={exportLoadingKey}
                onRequestImport={() => importInputRef.current?.click()}
                collapsed={userNavCollapsed}
                onToggleCollapsed={toggleUserNav}
                orderRefreshSignal={userOrderRefreshKey}
                pagination={{ page: directoryPage, hasMore: directoryHasMore, loading: directoryLoading, error: directoryError, onPage: setDirectoryPage, onRetry: () => void loadUsers() }}
              />}

              <section
                className={[
                  "flex h-full min-h-0 min-w-0 w-full flex-col gap-3 overflow-hidden",
                  desktopMode || userNavCollapsed
                    ? ""
                    : "xl:[margin-left:calc(var(--user-nav-width)_+_var(--user-nav-gap))] xl:w-[calc(100%_-_var(--user-nav-width)_-_var(--user-nav-gap))]",
                ].join(" ")}
              >
                <UserDetailTabBar
                  active={tab}
                  onSelect={setTab}
                  onPrefetch={prefetchUserDetailTab}
                  actions={<>
                    {desktopMode && <button
                      type="button"
                      disabled={!activeUserItem || exportLoadingKey === activeUserItem.adminKey}
                      onClick={() => setExportModalUser(activeUserItem)}
                      className="flex h-[42px] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-[15px] text-[12.5px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
                    >
                      {exportLoadingKey ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}<UiText id="admin.me86dd4d004c1" /></button>}
                    <div ref={dangerMenuRef} className="relative">
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={dangerMenuOpen}
                        disabled={!activeUserItem || !!entryActionBusy}
                        onClick={() => setDangerMenuOpen((open) => !open)}
                        className="flex h-[42px] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-[15px] text-[12.5px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
                      >
                        {entryActionBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}<UiText id="admin.m4445a8378e2b" /><ChevronDown className={["h-3.5 w-3.5 transition-transform", dangerMenuOpen ? "rotate-180" : ""].join(" ")} />
                      </button>
                      {dangerMenuOpen ? (
                        <div role="menu" className="app-dropdown-panel absolute right-0 top-[48px] z-50 w-[246px] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-[var(--shadow-2)]">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setDangerMenuOpen(false);
                              void withEntryActionBusy("purge", () => setPurgeModalOpen(true));
                            }}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-[var(--panel-2)]"
                          >
                            <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <span>
                              <span className="block text-[12px] font-medium text-[var(--app-fg)]"><UiText id="admin.m7af52659812f" /></span>
                              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--app-muted)]"><UiText id="admin.ma337428e9974" /></span>
                            </span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              if (!activeUserItem) return;
                              setDangerMenuOpen(false);
                              void withEntryActionBusy("delete_user", () => {
                                setConfirmAction({
                                  type: "delete_user",
                                  userId: activeUserItem.userId,
                                  authUserId: activeUserItem.authUserId ?? null,
                                  adminKey: activeUserItem.adminKey
                                });
                              });
                            }}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-rose-500/10"
                          >
                            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                            <span>
                              <span className="block text-[12px] font-medium text-rose-500"><UiText id="admin.mea8af89a5cd3" /></span>
                              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--app-muted)]"><UiText id="admin.m69716b2bb5ee" /></span>
                            </span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </>}
                />

                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  ref={systemContentScrollRef}
                  id="admin-user-content"
                  className={[
                    "min-h-0 min-w-0 flex-1 overflow-y-auto rounded-3xl border border-[var(--border-2)] bg-[var(--panel-bg)]/94 shadow-sm",
                    tab === "canvases" ? "auto-hide-scroll-area" : "",
                    (tab === "works" || tab === "canvases") ? "p-0" : "p-4 sm:p-5",
                  ].join(" ")}
                >
                  {tab === "canvases" && activeUserItem ? (
                    <UserCanvasesPanel key={activeUserItem.adminKey} adminKey={activeUserItem.adminKey} userName={activeUserItem.username || activeUserItem.userId} />
                  ) : tab === "billing" && activeUserItem ? <UserBillingPanel key={activeUser} user={activeUserItem} initialRange={billingDateRange?.userKey === activeUser ? billingDateRange : undefined} />
                  : loading || (directoryLoading && !activeUserItem) ? (
                    <AdminUserDetailLoading />
                  ) : desktopMode && directoryError && !activeUserItem ? (
                    <div role="alert" className="p-5 text-sm"><UiText id="admin.m6b23c961b8d1" /><button className="ml-3 underline" onClick={() => void loadUsers()}><UiText id="admin.mb8784c8dd563" /></button></div>
                  ) : userLoadError ? (
                    <div role="alert" className="p-5 text-sm"><UiText id="admin.m6b23c961b8d1" /><button className="ml-3 underline" onClick={() => void loadUser({ force: true })}><UiText id="admin.mb8784c8dd563" /></button></div>
                  ) : !payload ? (
                    <div className="py-10 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.m497c85690c4c" /></div>
                  ) : (
                    <>
                      {tab === "analysis" && (
                        <UserAnalysisPanel
                          account={payload.account}
                          overview={{
                            totalRecordCount,
                            totalSuccessCount,
                            totalFailedCount,
                            uploads: totals.uploads,
                            outputs: totals.outputs,
                            successRate: totals.successRate,
                            totalFailureRate,
                            recent14Total: last14.points.reduce((s, p) => s + (p.value || 0), 0),
                          }}
                          statusItems={statusItems}
                          typeItems={typeItems}
                          last14={last14}
                          sourceItems={sourceItems}
                          modelFailurePeriods={payload.analytics?.modelFailurePeriods || []}
                          billingTrendPeriods={payload.analytics?.billing?.trendPeriods}
                          onViewBill={(range) => { setBillingDateRange({ ...range, userKey: activeUser }); setTab("billing"); }}
                          preferenceFlows={payload.analytics?.preferenceFlows || []}
                          logDailyByCategory={payload.analytics?.logs?.dailyByCategory || {}}
                          agentConversationStatusItems={agentConversationStatusItems}
                          agentRunStatusItems={agentRunStatusItems}
                          agentRunModelItems={agentRunModelItems}
                          agentRunPurposeItems={agentRunPurposeItems}
                          recentActivities={recentActivities}
                           files={payload.files || { totalReferenced: 0, totalBytes: 0 }}
                          storage={payload.storage}
                          presetTotalCount={presetTotalCount}
                          presetDeletedCount={deletedPresetCount}
                          detailsLoading={analysisDetailsLoading}
                          detailsError={analysisDetailsError}
                        />
                      )}

                      {tab === "works" && (
                        <UserWorksPanel
                          key={activeUser}
                          dateFrom={worksDateFrom} dateTo={worksDateTo}
                          setDateFrom={setWorksDateFrom} setDateTo={setWorksDateTo}
                          typeFilter={worksTypeFilter}
                          cleanupMode={worksTypeFilter === "import" && worksCleanupUser === activeUser}
                          onOpenUnreferencedImports={() => {
                            setWorksCleanupUser(activeUser);
                            setWorksTypeFilter("import");
                          }}
                          setTypeFilter={(filter) => {
                            setWorksCleanupUser(null);
                            setWorksTypeFilter(filter);
                          }}
                          sourceFilter={worksSourceFilter}
                          setSourceFilter={setWorksSourceFilter}
                          items={payload.generations}
                          filteredItems={filteredWorksItems}
                          isSearching={isWorksSearching}
                          currentFilterTotal={currentFilterTotal}
                          hasMore={Boolean(payload.pagination?.hasMore)}
                          currentPage={Math.max(1, Number(payload.pagination?.page || 1))}
                          onLoadPage={loadMoreWorks}
                          inspirationMessage={inspirationMessage}
                          inspirationBusyById={inspirationBusyById}
                          activeUser={activeUserItem}
                          onPushToInspiration={desktopMode ? undefined : (id) => void pushGenerationToInspiration(id)}
                          onDetail={(g) => { setDetailItem(g as Generation); setDetailOpen(true); }}
                          onRequestDeleteGeneration={(id, generationType) => setConfirmAction({ type: "delete_generation", id, generationType })}
                          onRequestBulkDeleteImports={(count) => {
                            if (!activeUserItem) return;
                            setConfirmAction({ type: "bulk_delete_imports", userId: activeUserItem.userId, authUserId: activeUserItem.authUserId ?? null, count });
                          }}
                          onRequestBulkDeleteGenerations={(ids) => {
                            if (ids.length === 0) return;
                            setConfirmAction({ type: "bulk_delete_generations", ids });
                          }}
                          bulkDeleteResetSignal={worksBulkDeleteResetSeq}
                        />
                      )}

                      {tab === "materials" && (
                        <UserMaterialAssetsPanel
                          data={payload.materialAssets}
                          categoryFilter={materialCategory}
                          setCategoryFilter={setMaterialCategorySilently}
                          selectedFrom={materialSelectedFrom}
                          setSelectedFrom={setMaterialSelectedFromSilently}
                          selectedTo={materialSelectedTo}
                          setSelectedTo={setMaterialSelectedToSilently}
                          pageSize={materialPageSize}
                          setPageSize={setMaterialPageSizeSilently}
                          setPage={setMaterialPageSilently}
                          archivedOpen={materialArchivedOpen}
                          setArchivedOpen={setMaterialArchivedOpenSilently}
                          archivedPageSize={materialArchivedPageSize}
                          setArchivedPageSize={setMaterialArchivedPageSizeSilently}
                          setArchivedPage={setMaterialArchivedPageSilently}
                          eventsOpen={materialEventsOpen}
                          setEventsOpen={setMaterialEventsOpenSilently}
                          eventsPageSize={materialEventsPageSize}
                          setEventsPageSize={setMaterialEventsPageSizeSilently}
                          setEventsPage={setMaterialEventsPageSilently}
                          eventsAction={materialEventsAction}
                          setEventsAction={setMaterialEventsActionSilently}
                          onReleaseAsset={(assetId) => setConfirmAction({ type: "release_material_asset", assetId })}
                        />
                      )}

                      {tab === "presets" && (
                        <UserPresetsPanel
                          presets={userPresets}
                          onRequestDelete={(preset) => {
                            if (activeUserItem) setConfirmAction({
                              type: "delete_preset",
                              adminKey: activeUserItem.adminKey,
                              userId: activeUserItem.userId,
                              presetId: preset.id,
                              presetName: preset.name,
                              expectedRevision: preset.revision,
                            });
                          }}
                        />
                      )}

                      {tab === "skills" && (
                        <UserRoleSkillsPanel skills={userRoleSkills} username={payload?.account?.username || activeUserItem?.username} />
                      )}
                    </>
                  )}
                </div>
                {tab === "canvases" && <AutoHideScrollbar scrollRef={systemContentScrollRef} />}
                </div>
              </section>
            </div>
            {/* 清理用户数据弹窗 */}
            <UserPurgeModal
              open={purgeModalOpen}
              user={activeUserItem}
              onClose={() => setPurgeModalOpen(false)}
            />
            </div>
          )}

          {/* 导入/导出辅助元素（在所有 tab 下均可用） */}
          {/* 隐藏 file input，用于导入 ZIP */}
          {!desktopMode && <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleEnterpriseImportFile(f);
              e.target.value = "";
            }}
          />}
          {/* 导入进度模态框 */}
          {!desktopMode && importProgress && (
            <ImportProgressModal
              state={importProgress}
              onClose={() => { importAccountOptionsRef.current = null; setImportProgress(null); }}
              onRetry={(jobId, options) => void handleRetryUserImport(jobId, options)}
            />
          )}
          {/* 导出选项 / 进度模态框 */}
          {exportModalUser && (
            <UserExportModal
              username={exportModalUser.username}
              userId={exportModalUser.userId}
              registered={typeof exportModalUser.authUserId === "number"}
              progressState={exportProgress}
              onClose={() => {
                if (exportProgress && exportProgress.progress < 100) return; // 导出中不允许关闭
                setExportModalUser(null);
                setExportProgress(null);
              }}
              onExport={(opts) => void handleExportUser(exportModalUser, opts)}
            />
          )}

          {/* Keep visited settings in memory until the admin page closes. */}
          {visitedSystemRef.current && (
            <div className={mainTab === "system" ? "contents" : "hidden"} aria-hidden={mainTab === "system" ? undefined : true}>
              <AdminSystemTab
                active={mainTab === "system"}
                refreshSignal={refreshKey}
                navEntries={SYSTEM_SETTING_NAV_ENTRIES}
                activeSection={systemSectionActive}
                onSelectSection={selectSystemSection}
                contentScrollRef={settingsContentScrollRef}
                builtinPresetsRef={builtinPresetsRef}
                onRequestDeleteBuiltinPreset={(_compatibilityScope, presetId, presetName) => {
                  const expectedRevision = builtinPresetsRef.current?.getRevision(presetId);
                  if (expectedRevision === undefined) return;
                  setConfirmAction({
                    type: "delete_builtin_preset",
                    presetId,
                    presetName,
                    expectedRevision,
                  });
                }}
              />
            </div>
          )}
        </div>
      </div>

    </main>
    </AtomicPageReveal>
  );
}
