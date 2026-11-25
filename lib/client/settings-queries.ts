"use client";

import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { fetchJsonOnce } from "./inflight-json";

export type ProfileStats = {
  totalGenerations: number;
  totalAttempts: number;
  successRate: number;
  recent7Count: number;
  lastCreatedAt: string | null;
  userCreatedAt: string | null;
};

type SettingsEntry = { canUploadMaterial: boolean; hasMaterialInspirations: boolean };
export type TrendPoint = { day: string; label: string; total: number; models: Record<string, number> };
export type ModelUsageItem = {
  model: string; total: number; last30: number; last7: number; success: number; failed: number;
  categories: Record<string, number>; lastUsedAt: string | null;
};
export type ModelUsagePayload = {
  summary: { total: number; last30: number; last7: number; activeModels30: number; topModel30: string | null };
  palette: Record<string, string>;
  models: ModelUsageItem[];
  categoryTotals: Array<{ category: string; count: number }>;
  trend30: TrendPoint[];
  trend7: TrendPoint[];
};

const cacheOptions = { staleTime: 30_000, gcTime: 5 * 60_000 };

export type MonthlySpendingPayload = {
  month: string;
  totalAmount: string;
  pendingCount: number;
  daily: Array<{ day: string; amount: string }>;
};

export function monthlySpendingOptions(userId?: number | string) {
  const scope = String(userId || "");
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  return queryOptions({
    ...cacheOptions,
    queryKey: ["settings", scope, "monthly-spending", month],
    enabled: Boolean(scope),
    queryFn: async () => {
      const { ok, json } = await fetchJsonOnce<MonthlySpendingPayload>("/api/settings/monthly-spending", scope);
      if (!ok || !json) throw new Error("消费统计加载失败");
      return json;
    },
  });
}

export function settingsEntryOptions(userId?: number | string) {
  const scope = String(userId || "");
  return queryOptions({
    ...cacheOptions,
    queryKey: ["settings", scope, "entry"],
    enabled: Boolean(scope),
    retry: false,
    queryFn: async () => {
      const { ok, json } = await fetchJsonOnce<SettingsEntry>("/api/settings/entry", scope);
      if (!ok || !json) throw new Error("设置入口加载失败");
      return json;
    },
  });
}

export function profileStatsOptions(userId?: number | string) {
  const scope = String(userId || "");
  return queryOptions({
    ...cacheOptions,
    queryKey: ["settings", scope, "profile"],
    enabled: Boolean(scope),
    queryFn: async () => {
      const { ok, json } = await fetchJsonOnce<{ stats?: ProfileStats }>("/api/auth/me/stats", scope);
      if (!ok || !json?.stats) throw new Error("账号统计加载失败");
      return json.stats;
    },
  });
}

export function modelUsageOptions(userId?: number | string) {
  const scope = String(userId || "");
  return queryOptions({
    ...cacheOptions,
    queryKey: ["settings", scope, "model-usage"],
    enabled: Boolean(scope),
    queryFn: async () => {
      const { ok, json } = await fetchJsonOnce<ModelUsagePayload>("/api/settings/model-usage", scope);
      if (!ok || !json) throw new Error("模型统计加载失败");
      return json;
    },
  });
}

export async function warmSettingsEntry(client: QueryClient, userId?: number | string) {
  if (!userId) return;
  await Promise.all([
    client.prefetchQuery(profileStatsOptions(userId)),
    client.prefetchQuery(settingsEntryOptions(userId)),
  ]);
}
