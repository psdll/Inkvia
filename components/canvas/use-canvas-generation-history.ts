"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { subscribeGenerationDeleted, isKnownDeletedGenerationId } from "@/lib/generation-deletion-events";
import type { CanvasHistoryKind, CanvasHistoryPage, CanvasHistoryDetail, CanvasHistoryCounts } from "@/lib/assets/canvas-history";

import { canvasObserverUrl } from "./CanvasReadOnlyContext";

export type HistoryFilter = { adminKey?: string; owner: number | "guest"; canvasId: number | null; kind: CanvasHistoryKind; order: "asc" | "desc" };
const cacheRoot = "canvas-generation-history-v2";
const freshness = 30_000;
const gcTime = 15 * 60_000;
const sessionPrefix = "canvas-history-page-v2:";

function saveSessionPage(filter: HistoryFilter, page: CanvasHistoryPage, savedAt: number) {
  if (filter.adminKey || page.items.length > 60) return;
  try {
    const key = `${sessionPrefix}${filter.owner}:${filter.canvasId}:${filter.kind}:${filter.order}`;
    const value = JSON.stringify({ page, savedAt });
    if (value.length >= 128_000) return;
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith(sessionPrefix))
      .sort((a, b) => (readSessionPage(a)?.savedAt || 0) - (readSessionPage(b)?.savedAt || 0));
    if (!keys.includes(key)) while (keys.length >= 12) sessionStorage.removeItem(keys.shift()!);
    sessionStorage.setItem(key, value);
  } catch {}
}

function readSessionPage(key: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (value && Date.now() - value.savedAt < gcTime && Array.isArray(value.page?.items) && value.page.items.length <= 60) return value as { page: CanvasHistoryPage; savedAt: number };
  } catch {}
  return undefined;
}

function historyUrl(filter: HistoryFilter, cursor?: string | null, count = false) {
  const params = new URLSearchParams({ view: "canvas-history", type: filter.kind, order: filter.order, take: "60" });
  if (filter.canvasId !== null) params.set("canvasId", String(filter.canvasId));
  if (cursor) params.set("cursor", cursor);
  if (count) params.set("count", "1");
  return canvasObserverUrl(`/api/assets?${params}`, filter.adminKey);
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "加载失败，请重试");
  return payload;
}

function pageOptions(filter: HistoryFilter) {
  const sessionKey = `${sessionPrefix}${filter.owner}:${filter.canvasId}:${filter.kind}:${filter.order}`;
  return {
    queryKey: [cacheRoot, filter.owner, "pages", filter.canvasId, filter.kind, filter.order] as const,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => readJson<CanvasHistoryPage>(historyUrl(filter, pageParam), signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page: CanvasHistoryPage) => page.hasMore ? page.nextCursor : undefined,
    initialData: () => { const saved = filter.adminKey ? undefined : readSessionPage(sessionKey); return saved ? { pages: [saved.page], pageParams: [null as string | null] } : undefined; },
    initialDataUpdatedAt: () => filter.adminKey ? undefined : readSessionPage(sessionKey)?.savedAt,
    // Reopening a deep list must not refetch every previously visited page.
    // Only the head is revalidated below; old pages keep their scroll position.
    staleTime: Infinity, gcTime, refetchOnWindowFocus: false, refetchOnMount: false,
  };
}

export function prefetchCanvasGenerationHistory(client: QueryClient, owner: number | "guest") {
  if (owner === "guest") return;
  void client.prefetchInfiniteQuery(pageOptions({ owner, canvasId: null, kind: "image", order: "desc" }));
}

export function invalidateCanvasGenerationHistory(client: QueryClient, owner: number | "guest") {
  try { Object.keys(sessionStorage).filter(key => key.startsWith(`${sessionPrefix}${owner}:`)).forEach(key => sessionStorage.removeItem(key)); } catch {}
  // Revalidate the head on opening; never refetch every visited history page.
  return client.invalidateQueries({ queryKey: [cacheRoot, owner], refetchType: "none" });
}

export function useCanvasGenerationHistory(filter: HistoryFilter, open: boolean, currentCanvasId?: number) {
  const { text } = useUiLocale();
  const client = useQueryClient();
  const options = pageOptions(filter);
  const feed = useInfiniteQuery({
    ...options, enabled: open && filter.owner !== "guest",
    // Keep the visible gallery until the requested scope is ready. Never carry
    // another account's data across an owner change.
    placeholderData: (previous, query) => query?.queryKey[1] === filter.owner ? previous : undefined,
  });
  const counts = useQuery({
    queryKey: [cacheRoot, filter.owner, "counts", filter.canvasId],
    queryFn: ({ signal }) => readJson<CanvasHistoryCounts>(historyUrl(filter, null, true), signal),
    enabled: open && filter.owner !== "guest", staleTime: freshness, gcTime,
    placeholderData: (previous, query) => query?.queryKey[1] === filter.owner ? previous : undefined,
  });
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState("");
  const [pendingHead, setPendingHead] = React.useState<{ key: string; page: CanvasHistoryPage } | null>(null);
  const filterKey = JSON.stringify(options.queryKey);
  const displayedKey = React.useRef(filterKey);
  React.useLayoutEffect(() => {
    if (!feed.isPlaceholderData) displayedKey.current = filterKey;
  }, [feed.isPlaceholderData, filterKey]);
  const refresh = React.useCallback(async (apply = true) => {
    setRefreshing(true); setRefreshError("");
    try {
      // Separate query key deduplicates head requests without walking tail pages.
      const page = await client.fetchQuery({ queryKey: [...options.queryKey, "head"], queryFn: ({ signal }) => readJson<CanvasHistoryPage>(historyUrl(filter), signal), staleTime: 0, gcTime });
      const previous = client.getQueryData<InfiniteData<CanvasHistoryPage, string | null>>(options.queryKey);
      const changed = previous?.pages[0]?.items.map(item => item.id).join() !== page.items.map(item => item.id).join();
      if (!apply && previous?.pages[0]?.items.length && changed) {
        setPendingHead({ key: JSON.stringify(options.queryKey), page });
        await client.invalidateQueries({ queryKey: [cacheRoot, filter.owner, "counts"] });
        return;
      }
      setPendingHead(null);
      client.setQueryData<InfiniteData<CanvasHistoryPage, string | null>>(options.queryKey, old => {
        const same = old?.pages[0]?.items.map(item => item.id).join() === page.items.map(item => item.id).join();
        return same && old ? { ...old, pages: [page, ...old.pages.slice(1)] } : { pages: [page], pageParams: [null] };
      });
      await client.invalidateQueries({ queryKey: [cacheRoot, filter.owner, "counts"] });
    } catch (error) { setRefreshError(error instanceof Error ? error.message : text("workspaceFollowup.m6106f0a12583")); }
    finally { setRefreshing(false); }
  }, [client, filter.adminKey, filter.owner, filter.canvasId, filter.kind, filter.order]); // primitive scope boundaries

  React.useEffect(() => {
    if (!open) return;
    const state = client.getQueryState(options.queryKey);
    if (state?.data && (state.isInvalidated || Date.now() - state.dataUpdatedAt > freshness)) void refresh(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !client.isFetching({ queryKey: options.queryKey })) void refresh(false);
    }, freshness);
    return () => window.clearInterval(timer);
  }, [open, filter.adminKey, filter.owner, filter.canvasId, filter.kind, filter.order, client, refresh, feed.isStale]);

  React.useEffect(() => {
    if (!filter.adminKey) prefetchCanvasGenerationHistory(client, filter.owner);
  }, [client, filter.adminKey, filter.owner]);

  const hasPage = Boolean(feed.data) && !feed.isPlaceholderData;
  React.useEffect(() => {
    if (filter.adminKey || !open || filter.owner === "guest" || !hasPage) return;
    let stopped = false;
    // Warm only first pages, sequentially after the visible list is ready.
    // Query keys share in-flight requests with an actual tab switch.
    void (async () => {
      const scopes = currentCanvasId === undefined ? [null] : [null, currentCanvasId];
      for (const canvasId of scopes) for (const kind of ["image", "video", "audio"] as const) {
        if (stopped) return;
        const target = { owner: filter.owner, canvasId, kind, order: filter.order };
        const config = pageOptions(target);
        await client.prefetchInfiniteQuery(config);
        if (stopped) return;
        const state = client.getQueryState<InfiniteData<CanvasHistoryPage>>(config.queryKey);
        const page = state?.data?.pages[0];
        if (page) saveSessionPage(target, page, state!.dataUpdatedAt);
      }
    })();
    return () => { stopped = true; };
  }, [client, open, filter.adminKey, filter.owner, filter.order, currentCanvasId, hasPage]);

  React.useEffect(() => {
    const page = feed.data?.pages[0];
    if (!page || feed.isPlaceholderData) return;
    // Persist only a small first page. Never serialize media blobs or an
    // unbounded visited history into synchronous browser storage.
    const timer = window.setTimeout(() => {
      saveSessionPage(filter, page, feed.dataUpdatedAt);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [feed.data, feed.dataUpdatedAt, feed.isPlaceholderData, filter.adminKey, filter.owner, filter.canvasId, filter.kind, filter.order]);

  React.useEffect(() => {
    const remove = (ids: number[]) => {
      const deleted = new Set(ids);
      client.setQueriesData<InfiniteData<CanvasHistoryPage, string | null>>({ queryKey: [cacheRoot, filter.owner, "pages"], predicate: query => query.queryKey.length === 6 }, old => old && ({ ...old, pages: old.pages.map(page => ({ ...page, items: page.items.filter(item => !deleted.has(item.id)) })) }));
      ids.forEach(id => client.removeQueries({ queryKey: [cacheRoot, filter.owner, "detail", id] }));
      try { Object.keys(sessionStorage).filter(key => key.startsWith(`${sessionPrefix}${filter.owner}:`)).forEach(key => sessionStorage.removeItem(key)); } catch {}
      void client.invalidateQueries({ queryKey: [cacheRoot, filter.owner, "counts"] });
    };
    const stopDeleted = subscribeGenerationDeleted(remove);
    return stopDeleted;
  }, [client, filter.adminKey, filter.owner]);

  const items = React.useMemo(() => {
    const seen = new Set<number>();
    return (feed.data?.pages || []).flatMap(page => page.items).filter(item => {
      if (seen.has(item.id) || isKnownDeletedGenerationId(item.id)) return false;
      seen.add(item.id); return true;
    });
  }, [feed.data]);
  const applyUpdates = () => {
    if (pendingHead?.key !== filterKey) return;
    client.setQueryData(options.queryKey, { pages: [pendingHead.page], pageParams: [null] });
    setPendingHead(null);
  };
  return { ...feed, items, counts, displayKey: feed.isPlaceholderData ? displayedKey.current : filterKey, refreshing, refreshError, refresh, hasUpdates: pendingHead?.key === filterKey, applyUpdates };
}

function detailOptions(owner: number | "guest", id: number | null, adminKey?: string) {
  return {
    queryKey: [cacheRoot, owner, "detail", id] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await readJson<{ item: CanvasHistoryDetail }>(canvasObserverUrl(`/api/assets/${id}?view=canvas-history`, adminKey), signal)).item,
    staleTime: 5 * 60_000, gcTime,
  };
}

export function prefetchCanvasHistoryDetail(client: QueryClient, owner: number | "guest", id: number, adminKey?: string) {
  if (owner !== "guest") void client.prefetchQuery(detailOptions(owner, id, adminKey));
}

export function useCanvasHistoryDetail(owner: number | "guest", id: number | null, open: boolean, adminKey?: string) {
  return useQuery({ ...detailOptions(owner, id, adminKey), enabled: open && owner !== "guest" && id !== null });
}
