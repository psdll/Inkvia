"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminSessionExpiredError, notifyAdminSessionExpired } from "@/lib/client/admin-session-expired";

// 管理后台 storage 接口的响应载荷类型。
// 由本 hook 拥有，admin 各处（系统设置 OSS section、overview 容量展示等）从这里导入。
type AdminStorageDirNode = {
  name: string;
  relativePath: string;
  label: string;
  purpose: string;
  bytes: number;
  files: number;
  children: AdminStorageDirNode[];
};

export type AdminStoragePayload = {
  _cache?: { storageSnapshotAt?: string };
  level: "normal" | "warning" | "critical";
  uploadsRoot?: string;
  uploadsTree?: AdminStorageDirNode[];
  storageScopeLabel?: string;
  storageScopeNote?: string;
  usedPercent: number;
  warnPercent: number;
  criticalPercent: number;
  totalStorageGB: number;
  totalLimitBytes: number;
  usedBytes: number;
  freeBytes: number;
  diskTotalBytes?: number | null;
  totalFiles: number;
  retentionDays: number;
  lastPrunedAt: string | null;
  categories: {
    folder: string;
    label?: string;
    bytes: number;
    files: number;
    source?: "local" | "oss" | "mixed";
    localPath?: string | null;
    localRelativePath?: string | null;
    ossPrefix?: string | null;
  }[];
  topUsers: { adminKey?: string; userId: string; authUserId?: number | null; username?: string | null; generationCount: number; lastCreatedAt: string | null }[];
  analytics?: {
    capacityOwnership?: {
      attributedBytes: number;
      totalBytes: number;
      coverage: number;
      complete: boolean;
    };
    totals: {
      totalUsers: number;
      activeUsers: number;
      totalGenerations: number;
      lifetimeGenerations?: number;
      successGenerations: number;
      failedGenerations: number;
      successRate: number;
      avgGenerationPerActiveUser: number;
      top10GenerationShare: number;
      longTailGenerationShare: number;
      totalUserStorageBytes: number;
      unknownStorageCount: number;
    };
    users: {
      adminKey: string;
      userId: string;
      authUserId: number | null;
      username: string | null;
      generationCount: number;
      successCount: number;
      failedCount: number;
      generationShare: number;
      storageBytes: number;
      storageShare: number;
      avgBytesPerGeneration: number;
      lastCreatedAt: string | null;
      typeBreakdown: { image: number; video: number; face: number; other: number };
      trend7: number[];
    }[];
    daily30: { day: string; generationCount: number; storageBytes: number }[];
    typeDistribution: { type: "image" | "video" | "face" | "other"; generationCount: number; storageBytes: number }[];
    insights: string[];
    behavior?: {
      days: number;
      funnel: { upload: number; submit: number; success: number; failed: number; download: number; delete: number };
      dailyBehavior30: Array<{
        day: string;
        upload: number;
        submit: number;
        success: number;
        failed: number;
        download: number;
        delete: number;
        feedbackSubmit: number;
      }>;
      failureByType: { type: "image" | "video" | "face" | "other"; count: number }[];
      failureByReasonTop: { reason: string; count: number }[];
      alertItems: Array<{
        level: "info" | "warning" | "critical";
        title: string;
        detail: string;
        actionLabel?: string;
        actionTarget?: string;
      }>;
    };
    modelUsage?: {
      globalModelRatio: Array<{ model: string; count: number; ratio: number }>;
      modelOutcomeTop: Array<{
        model: string;
        totalCalls: number;
        successCount: number;
        failedCount: number;
        successRate: number;
        failedRate: number;
      }>;
      modelTrend30: Array<{ day: string; models: Record<string, number> }>;
      userModelRatioTop: Array<{
        adminKey: string;
        userId: string;
        authUserId: number | null;
        username: string | null;
        totalCalls: number;
        topModel: string;
        topModelCount: number;
        topModelRatio: number;
        modelBreakdown: Array<{ model: string; count: number; ratio: number }>;
      }>;
      userModelMix: Array<{
        adminKey: string;
        userId: string;
        authUserId: number | null;
        username: string | null;
        totalCalls: number;
        cells: Record<string, number>;
      }>;
    };
    userMaterialRatio?: {
      userMaterialShareTop: Array<{
        adminKey: string;
        userId: string;
        authUserId: number | null;
        username: string | null;
        bytes: number;
        ratio: number;
      }>;
      userMaterialCountShareTop: Array<{
        adminKey: string;
        userId: string;
        authUserId: number | null;
        username: string | null;
        count: number;
        ratio: number;
      }>;
      materialByTypeRatio: Array<{
        type: "image" | "video" | "face" | "other";
        count: number;
        countRatio: number;
        bytes: number;
        bytesRatio: number;
      }>;
    };
  };
};

export const ADMIN_STORAGE_QUERY_KEY = ["admin", "storage"] as const;
const ADMIN_STORAGE_STALE_TIME_MS = 30 * 1000;

async function fetchAdminStorage(options?: { force?: boolean }): Promise<AdminStoragePayload> {
  const params = new URLSearchParams();
  if (options?.force) params.set("force", "1");
  const url = params.size > 0 ? `/api/admin/storage?${params.toString()}` : "/api/admin/storage";
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) {
    notifyAdminSessionExpired();
    throw new AdminSessionExpiredError();
  }
  if (!res.ok) {
    const errJson = await res.json().catch(() => null) as any;
    throw new Error(String(errJson?.error || `读取失败 (${res.status})`));
  }
  return (await res.json()) as AdminStoragePayload;
}

/**
 * 集中管理 admin storage 接口数据 + 容量上限表单的 hook。
 *
 * 底层用 TanStack Query 做缓存：30s staleTime,切 tab 回来 instant 命中。
 * 公开 API（storage / loadStorage / saveStorageLimits 等）保持与旧版一致,
 * 调用方无需修改。
 */
export function useAdminStorage({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const queryResult = useQuery({
    queryKey: ADMIN_STORAGE_QUERY_KEY,
    queryFn: () => fetchAdminStorage(),
    enabled,
    staleTime: ADMIN_STORAGE_STALE_TIME_MS,
    retry: (count, error) => !(error instanceof AdminSessionExpiredError) && count < 3,
  });

  const storage = (queryResult.data as AdminStoragePayload | undefined) ?? null;
  const storageLoading = queryResult.isLoading || queryResult.isFetching;
  const errorMessage = queryResult.error instanceof Error ? queryResult.error.message : null;

  const [storageErr, setStorageErr] = useState<string | null>(null);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageTotalGb, setStorageTotalGb] = useState("10");
  const [storageWarnPercent, setStorageWarnPercent] = useState("70");
  const [storageCriticalPercent, setStorageCriticalPercent] = useState("85");
  const [storageSaved, setStorageSaved] = useState({ totalGb: "10", warn: "70", critical: "85" });

  // 拉到新 payload 时同步表单字段(保持旧 loadStorage 中的行为)
  useEffect(() => {
    if (!storage) return;
    const totalGb = String(Number(storage.totalStorageGB || 10));
    const warn = String(Math.max(1, Number(storage.warnPercent || 70) || 70));
    const critical = String(Math.max(2, Number(storage.criticalPercent || 85) || 85));
    setStorageTotalGb(totalGb);
    setStorageWarnPercent(warn);
    setStorageCriticalPercent(critical);
    setStorageSaved({ totalGb, warn, critical });
  }, [storage]);

  useEffect(() => {
    setStorageErr(errorMessage);
  }, [errorMessage]);

  const loadStorage = useCallback(async (options?: { force?: boolean }) => {
    setStorageErr(null);
    try {
      const result = await queryClient.fetchQuery({
        queryKey: ADMIN_STORAGE_QUERY_KEY,
        queryFn: () => fetchAdminStorage(options),
        staleTime: options?.force ? 0 : ADMIN_STORAGE_STALE_TIME_MS,
        retry: false,
      });
      return result;
    } catch (error) {
      setStorageErr(error instanceof Error ? error.message : "读取失败，请稍后重试");
      return null;
    }
  }, [queryClient]);

  const saveStorageLimits = useCallback(async () => {
    const total = Number(storageTotalGb);
    const warn = Math.floor(Number(storageWarnPercent));
    const critical = Math.floor(Number(storageCriticalPercent));
    if (!Number.isFinite(total) || total <= 0 || total > 10240) {
      setStorageErr("总容量需在 0-10240 GB 之间");
      return;
    }
    if (!Number.isFinite(warn) || warn < 1 || warn > 99) {
      setStorageErr("预警阈值需在 1-99 之间");
      return;
    }
    if (!Number.isFinite(critical) || critical <= warn || critical > 100) {
      setStorageErr("紧急阈值需大于预警阈值，且不超过 100");
      return;
    }
    setStorageErr(null);
    setStorageSaving(true);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_limits", totalStorageGB: total, warnPercent: warn, criticalPercent: critical }),
      }).catch(() => null);
      if (!res) {
        setStorageErr("网络错误");
        return;
      }
      if (res.status === 401) {
        notifyAdminSessionExpired();
        setStorageErr("管理员登录已过期，请重新登录");
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setStorageErr(String(json?.error || "保存失败"));
        return;
      }
      setStorageSaved({ totalGb: String(total), warn: String(warn), critical: String(critical) });
      await queryClient.invalidateQueries({ queryKey: ADMIN_STORAGE_QUERY_KEY });
    } finally {
      setStorageSaving(false);
    }
  }, [queryClient, storageCriticalPercent, storageTotalGb, storageWarnPercent]);

  return {
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
    loadStorage,
    saveStorageLimits,
  };
}
