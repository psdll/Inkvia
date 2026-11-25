"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { InspirationGridSkeleton } from "@/components/home/home-loading";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { InspirationDetailFullscreen, type InspirationDetailViewItem } from "@/components/templates/inspiration-detail-fullscreen";
import { ResilientImage } from "@/components/ui/resilient-image";
import { VideoBadge } from "@/components/ui/hover-preview-video";
import { buildMediaPreviewCandidates, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import {
  commitVideoTemplateToStudio,
  prepareVideoTemplateForStudio,
  sanitizeVideoTemplatePrompt,
} from "@/lib/video-template-reuse";
import { writeEphemeralToolTemplate } from "@/lib/ephemeral-input-draft";

// 列表卡片只用这些字段(tags / description / prompt 推迟到详情才拉)
export type TemplateItem = {
  id: number;
  title: string;
  category?: string | null;
  toolType: "face" | "image" | "video";
  mediaType: "image" | "video";
  previewImagePath: string | null;
  previewVideoPath: string | null;
  createdAt?: string;
  // 详情字段(可选,兼容旧调用方)
  description?: string | null;
  prompt?: string;
  tags?: string[];
};

type TemplateDetailItem = {
  id: number;
  title: string;
  prompt: string;
  toolType: "face" | "image" | "video";
  mediaType: "image" | "video";
  description?: string | null;
  tags?: string[];
  createdAt: string;
  detail: {
    type: string;
    model: string | null;
    params: Record<string, any>;
    inputImages: string[];
    outputPaths: string[];
  };
};

type CategoryKey = string;

// 每批只取三行桌面卡片；屏外媒体等接近视口再加载。
const PAGE_SIZE = 18;
// 模版数超过这个阈值时才启用虚拟列表;再少时简单 grid 反而更快
const VIRTUALIZE_THRESHOLD = 80;

const DETAIL_CACHE_PREFIX = "inspiration_template_detail_v1_";
const LIST_CACHE_PREFIX = "inspiration_template_cards_v2_";
const LIST_CACHE_INVALIDATED_AT_KEY = "inspiration_template_cards_invalidated_at_v1";
const LIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const viewCache = new WeakMap<QueryClient, { category: CategoryKey; scrollTop: number }>();
const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const detailMemoryCache = new Map<number, TemplateDetailItem>();

type TemplatePageResult = {
  items: TemplateItem[];
  nextSkip: number | null;
  total: number;
  version: string;
  fetchedAt: number;
  categories: string[];
};

type TemplateInfiniteData = {
  pages: TemplatePageResult[];
  pageParams: number[];
};

type TemplateListCacheEntry = TemplateInfiniteData & {
  category: CategoryKey;
  total: number;
  version: string;
  nextSkip: number | null;
  fetchedAt: number;
};

function getTemplateQueryKey(category: CategoryKey) {
  return ["inspiration", "templates", category] as const;
}

function getListCacheKey(category: CategoryKey) {
  return `${LIST_CACHE_PREFIX}${category}`;
}

function readListCacheInvalidatedAt() {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, Number(window.localStorage.getItem(LIST_CACHE_INVALIDATED_AT_KEY)) || 0);
  } catch {
    return 0;
  }
}

function clearStoredListCaches() {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.localStorage).filter((key) => key.startsWith(LIST_CACHE_PREFIX)).forEach((key) => window.localStorage.removeItem(key));
  } catch {}
}

function normalizePage(raw: Partial<TemplatePageResult> | null | undefined): TemplatePageResult | null {
  if (!raw || !Array.isArray(raw.items)) return null;
  return {
    items: raw.items.map((item) => normalizeItem(item as TemplateItem)),
    nextSkip: typeof raw.nextSkip === "number" ? raw.nextSkip : null,
    total: Math.max(0, Number(raw.total) || 0),
    version: String(raw.version || ""),
    fetchedAt: Math.max(0, Number(raw.fetchedAt) || 0),
    categories: Array.isArray(raw.categories) ? raw.categories.filter((name): name is string => typeof name === "string" && Boolean(name)) : [],
  };
}

function readListCache(category: CategoryKey): TemplateListCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getListCacheKey(category));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TemplateListCacheEntry> | null;
    const pages = Array.isArray(parsed?.pages)
      ? parsed!.pages.map((page) => normalizePage(page)).filter((page): page is TemplatePageResult => Boolean(page))
      : [];
    if (!pages.length) return null;
    const pageParams =
      Array.isArray(parsed?.pageParams) && parsed!.pageParams.length === pages.length
        ? parsed!.pageParams.map((value) => Math.max(0, Number(value) || 0))
        : pages.map((_, index) => index * PAGE_SIZE);
    const firstPage = pages[0];
    const lastPage = pages[pages.length - 1];
    const fetchedAt = Math.max(0, Number(parsed?.fetchedAt) || Math.max(...pages.map((page) => page.fetchedAt || 0)));
    if (fetchedAt > 0 && fetchedAt < readListCacheInvalidatedAt()) return null;
    return {
      category,
      pages,
      pageParams,
      total: Math.max(0, Number(parsed?.total) || firstPage.total || 0),
      version: String(parsed?.version || firstPage.version || ""),
      nextSkip: typeof parsed?.nextSkip === "number" ? parsed.nextSkip : lastPage.nextSkip,
      fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeListCache(category: CategoryKey, data: TemplateInfiniteData) {
  if (typeof window === "undefined" || !data.pages.length) return;
  const lastPage = data.pages[data.pages.length - 1];
  const firstNetworkPage = data.pages.find((page) => page.version && page.version !== "ssr");
  if (!firstNetworkPage) return;
  const entry: TemplateListCacheEntry = {
    category,
    pages: data.pages,
    pageParams: data.pageParams,
    total: Math.max(0, Number(lastPage.total || firstNetworkPage.total) || 0),
    version: String(lastPage.version || firstNetworkPage.version || ""),
    nextSkip: typeof lastPage.nextSkip === "number" ? lastPage.nextSkip : null,
    fetchedAt: Math.max(...data.pages.map((page) => Number(page.fetchedAt) || 0)),
  };
  try {
    window.localStorage.setItem(getListCacheKey(category), JSON.stringify(entry));
  } catch {}
}

function toInfiniteData(entry: TemplateListCacheEntry): TemplateInfiniteData {
  return { pages: entry.pages, pageParams: entry.pageParams };
}

function isListCacheExpired(entry: TemplateListCacheEntry) {
  return Date.now() - entry.fetchedAt > LIST_CACHE_TTL_MS;
}

function readDetailCache(id: number): TemplateDetailItem | null {
  const mem = detailMemoryCache.get(id);
  if (mem) return mem;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${DETAIL_CACHE_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TemplateDetailItem;
    if (!parsed) return null;
    detailMemoryCache.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeDetailCache(id: number, data: TemplateDetailItem) {
  detailMemoryCache.set(id, data);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${DETAIL_CACHE_PREFIX}${id}`, JSON.stringify(data));
  } catch {}
}

function templateDetailOptions(templateId: number) {
  return {
    queryKey: ["inspiration", "detail", templateId],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/templates/${templateId}/detail`).catch(() => null);
      const json = (await res?.json().catch(() => null)) as any;
      if (!res || !res.ok || !json?.success || !json?.data) throw new Error("Template detail unavailable");
      const data = json.data as TemplateDetailItem;
      const normalized: TemplateDetailItem = {
        ...data,
        detail: {
          ...data.detail,
          inputImages: Array.isArray(data.detail?.inputImages) ? data.detail.inputImages.map((x) => normalizeMediaUrl(x)).filter(Boolean) : [],
          outputPaths: Array.isArray(data.detail?.outputPaths) ? data.detail.outputPaths.map((x) => normalizeMediaUrl(x)).filter(Boolean) : []
        }
      };
      writeDetailCache(templateId, normalized);
      return normalized;
    },
  };
}

function normalizeItem(it: TemplateItem): TemplateItem {
  return {
    ...it,
    previewImagePath: it.previewImagePath ? normalizeMediaUrl(it.previewImagePath) : null,
    previewVideoPath: it.previewVideoPath ? normalizeMediaUrl(it.previewVideoPath) : null,
  };
}

async function fetchTemplatePage({
  pageParam,
  signal,
  category,
}: {
  pageParam: number;
  signal?: AbortSignal;
  category?: CategoryKey;
}): Promise<TemplatePageResult> {
  const params = new URLSearchParams({
    mode: "card",
    take: String(PAGE_SIZE),
    skip: String(pageParam),
  });
  if (category) params.set("category", category);
  const url = `/api/templates?${params.toString()}`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`fetch templates failed: ${res.status}`);
  const json = (await res.json()) as { data?: TemplateItem[]; meta?: { total?: number; version?: string; categories?: string[] } };
  const list = Array.isArray(json?.data) ? json.data.map(normalizeItem) : [];
  const total = Number(json?.meta?.total || 0);
  const consumed = pageParam + list.length;
  const nextSkip = list.length === PAGE_SIZE && (!total || consumed < total) ? consumed : null;
  return {
    items: list,
    nextSkip,
    total,
    version: String(json?.meta?.version || `${total}:${list[0]?.id || 0}:${list[0]?.createdAt || ""}`),
    fetchedAt: Date.now(),
    categories: Array.isArray(json?.meta?.categories) ? json.meta.categories : [],
  };
}

export function InspirationDiscoverySection({
  initialItems = [],
  onInitialReady,
}: {
  initialItems?: TemplateItem[];
  onInitialReady?: () => void;
}) {
  const { text } = useUiLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, openLoginModal } = useAuth();
  const initialNormalized = React.useMemo(() => initialItems.map(normalizeItem), [initialItems]);

  const [activeCategory, setActiveCategory] = React.useState<CategoryKey>(() => viewCache.get(queryClient)?.category || "");
  const [categoryNames, setCategoryNames] = React.useState<string[]>([]);
  const categories = [{ key: "", label: text("workspaceFollowup.m5c55a67935af") }, ...categoryNames.map((name) => ({ key: name, label: name }))];
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const [scrollParent, setScrollParent] = React.useState<HTMLElement>();
  const [gridReady, setGridReady] = React.useState(false);
  const restoreScrollRef = React.useRef(viewCache.get(queryClient)?.scrollTop ?? null);
  useIsoLayoutEffect(() => {
    const parent = sectionRef.current?.parentElement;
    if (!parent) return;
    setScrollParent(parent);
    return () => { viewCache.set(queryClient, { category: activeCategory, scrollTop: parent.scrollTop }); };
  }, [activeCategory, queryClient]);

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<TemplateDetailItem | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [applied, setApplied] = React.useState(false);

  const hydrateCategoryCache = React.useCallback(
    (category: CategoryKey) => {
      if (queryClient.getQueryData(getTemplateQueryKey(category))) return null;
      const cached = readListCache(category);
      if (!cached || isListCacheExpired(cached)) return null;
      queryClient.setQueryData(getTemplateQueryKey(category), toInfiniteData(cached), { updatedAt: cached.fetchedAt || 0 });
      return cached;
    },
    [queryClient]
  );

  React.useEffect(() => {
    hydrateCategoryCache(activeCategory);
  }, [activeCategory, hydrateCategoryCache]);

  React.useEffect(() => {
    const invalidate = () => {
      clearStoredListCaches();
      void queryClient.invalidateQueries({ queryKey: ["inspiration", "templates"] });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LIST_CACHE_INVALIDATED_AT_KEY) invalidate();
    };
    window.addEventListener("inspiration-template-cards:invalidate", invalidate);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("inspiration-template-cards:invalidate", invalidate);
      window.removeEventListener("storage", onStorage);
    };
  }, [queryClient]);

  // 分类独立缓存；新鲜数据返回时直接显示，过期后后台更新。
  const isAllCategory = activeCategory === "";
  const infinite = useInfiniteQuery({
    queryKey: getTemplateQueryKey(activeCategory),
    queryFn: ({ pageParam, signal }) =>
      fetchTemplatePage({ pageParam: pageParam as number, signal, category: activeCategory }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextSkip,
    staleTime: 60 * 1000,
    gcTime: LIST_CACHE_TTL_MS,
    refetchOnMount: true,
    initialData:
      isAllCategory && initialNormalized.length
        ? {
            pages: [{
              items: initialNormalized,
              nextSkip: initialNormalized.length,
              total: initialNormalized.length,
              version: "ssr",
              fetchedAt: 0,
              categories: [],
            }],
            pageParams: [0],
          }
        : undefined,
    enabled: true,
  });

  React.useEffect(() => {
    if (!infinite.data?.pages?.length) return;
    writeListCache(activeCategory, infinite.data as TemplateInfiniteData);
  }, [activeCategory, infinite.data]);

  React.useEffect(() => {
    const page = infinite.data?.pages[0];
    if (!page || page.version === "ssr") return;
    setCategoryNames(page.categories);
    if (activeCategory && !page.categories.includes(activeCategory)) setActiveCategory("");
  }, [infinite.data, activeCategory]);

  const items: TemplateItem[] = React.useMemo(() => {
    if (!infinite.data) return [];
    return infinite.data.pages.flatMap((p) => p.items);
  }, [infinite.data]);

  const prefetchCategory = (category: CategoryKey) => {
    hydrateCategoryCache(category);
    void queryClient.prefetchInfiniteQuery({
      queryKey: getTemplateQueryKey(category),
      queryFn: ({ pageParam, signal }) => fetchTemplatePage({ pageParam, signal, category }),
      initialPageParam: 0,
      getNextPageParam: (lastPage: TemplatePageResult) => lastPage.nextSkip,
      staleTime: 60 * 1000,
    });
  };

  // 服务端已按自定义分类过滤,本地不再做二次 filter。
  const filteredItems = items;

  React.useEffect(() => {
    if (!infinite.isPending) onInitialReady?.();
  }, [infinite.isPending, onInitialReady]);

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && infinite.hasNextPage && !infinite.isFetchingNextPage) {
            void infinite.fetchNextPage();
          }
        }
      },
      { rootMargin: "400px 0px" }, // 提前 400px 触发,滚动到时已就绪
    );
    io.observe(node);
    return () => io.disconnect();
  }, [infinite]);

  // 原图较大,不再把整批原图预下载进内存 blob 池(低配机会卡)。
  // 展示用的原图由 <img loading="lazy"> 进视口时加载,Service Worker + immutable 头持久缓存,
  // 复访/回滚时直接命中缓存,不会重复"临时加载"。

  const detailViewItem = React.useMemo<InspirationDetailViewItem | null>(() => {
    if (!detailItem) return null;
    return detailItem;
  }, [detailItem]);

  const fetchTemplateDetail = React.useCallback(async (templateId: number) => {
    setApplied(false);
    const cached = readDetailCache(templateId);
    if (cached) {
      setDetailItem(cached);
      setDetailOpen(true);
    }
    const normalized = await queryClient.fetchQuery(templateDetailOptions(templateId)).catch(() => null);
    if (!normalized) return;
    setDetailItem(normalized);
    if (!cached) setDetailOpen(true);
  }, [queryClient]);

  const applyTemplate = React.useCallback(async (item: InspirationDetailViewItem) => {
    const userId = user?.id ? String(user.id) : "";
    if (!userId) {
      openLoginModal();
      return;
    }
    setApplying(true);
    setApplied(false);
    try {
      const p = item.detail?.params || {};
      const inputImages = Array.isArray(item.detail?.inputImages) ? item.detail.inputImages.filter(Boolean) : [];
      const prompt = String(item.prompt || "").trim();
      if (item.detail?.type === "face_swap") { return; } else if (item.detail?.type === "video_gen" || item.detail?.type === "video_generate") {
        const videoType = item.detail?.type === "video_generate" ? "video_generate" : "video_gen";
        const { payload } = await prepareVideoTemplateForStudio(userId, {
          id: item.id,
          type: videoType,
          prompt: sanitizeVideoTemplatePrompt(item.prompt),
          model: item.detail?.model,
          localPath: item.detail?.outputPaths?.[0] || null,
          inputImages,
          params: p
        }, { timeoutMs: 1000 });
        commitVideoTemplateToStudio(userId, payload);
        router.push("/studio?tool=video");
      } else {
        const model = String(p.model || item.detail?.model || "nano-banana-2");
        const isSeedream =
          model === "doubao-seedream-5.0-pro" || model === "doubao-seedream-5.0-lite" || model === "doubao-seedream-4.5" || model === "doubao-seedream-4.0";
        writeEphemeralToolTemplate("image", userId, {
          prompt,
          model,
          aspectRatio: String(p.aspectRatio || "1:1"),
          resolution: String(p.resolution || (isSeedream ? "2K" : "1K")),
          imagePaths: Array.isArray(p.imagePaths) ? p.imagePaths : inputImages
        });
        localStorage.setItem("studio_last_tool_v1", "image");
        router.push("/studio?tool=image");
      }
      setApplied(true);
      window.setTimeout(() => setApplied(false), 1200);
    } finally {
      setApplying(false);
    }
  }, [openLoginModal, router, user?.id]);

  const isInitialLoading = infinite.isLoading && !items.length;
  const useVirtualGrid = filteredItems.length > VIRTUALIZE_THRESHOLD;
  useIsoLayoutEffect(() => {
    if (!scrollParent || isInitialLoading || (useVirtualGrid && !gridReady)) return;
    if (restoreScrollRef.current === null) return;
    scrollParent.scrollTop = restoreScrollRef.current;
    restoreScrollRef.current = null;
  }, [scrollParent, isInitialLoading, useVirtualGrid, gridReady, items.length]);

  return (
    <section ref={sectionRef} className="relative z-10 px-12 pb-20">
      <InspirationDetailFullscreen
        open={detailOpen}
        item={detailViewItem}
        onClose={() => setDetailOpen(false)}
        onApplyTemplate={(it) => void applyTemplate(it)}
        applying={applying}
        applied={applied}
      />
      <div className="mb-3 text-[18px] font-semibold text-[var(--app-fg)]"><UiText id="home.m9e8fb2c8d433" /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            onPointerEnter={() => prefetchCategory(category.key)}
            onFocus={() => prefetchCategory(category.key)}
            onClick={() => {
              hydrateCategoryCache(category.key);
              restoreScrollRef.current = null;
              setActiveCategory(category.key);
            }}
            className={[
              "h-9 rounded-xl border px-3 text-[12px] font-medium transition",
              activeCategory === category.key
                ? "border-[var(--border-2)] bg-[var(--panel-3)] text-[var(--app-fg)]"
                : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:border-[var(--border-2)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            ].join(" ")}
          >
            {category.label}
          </button>
        ))}
      </div>

      {isInitialLoading ? (
        <InspirationGridSkeleton />
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-6 text-[13px] text-[var(--app-muted)]"><UiText id="home.mcff1f71c3895" /></div>
      ) : useVirtualGrid ? (
        <InspirationVirtualGrid
          key={activeCategory}
          scrollParent={scrollParent}
          onReady={setGridReady}
          items={filteredItems}
          onPickItem={(id) => void fetchTemplateDetail(id)}
          onReachEnd={() => {
            if (infinite.hasNextPage && !infinite.isFetchingNextPage) {
              void infinite.fetchNextPage();
            }
          }}
        />
      ) : (
        <InspirationSimpleGrid items={filteredItems} onPickItem={(id) => void fetchTemplateDetail(id)} />
      )}

      {/* 简单 grid 模式下用 IntersectionObserver 哨兵;虚拟 grid 走 onReachEnd 回调 */}
      {!useVirtualGrid && infinite.hasNextPage ? (
        <div ref={sentinelRef} className="mt-4 flex h-12 items-center justify-center text-[12px] text-[var(--app-muted)]">
          {infinite.isFetchingNextPage ? <UiText id="home.m58be224a15bb" /> : <UiText id="home.mb8e585cec5cf" />}
        </div>
      ) : null}
      {useVirtualGrid && infinite.isFetchingNextPage ? (
        <div className="mt-4 flex h-12 items-center justify-center text-[12px] text-[var(--app-muted)]"><UiText id="home.m58be224a15bb" /></div>
      ) : null}
    </section>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function InspirationCard({ item, index, onPick }: { item: TemplateItem; index: number; onPick: (id: number) => void }) {
  const queryClient = useQueryClient();
  const prepare = () => {
    void queryClient.prefetchQuery(templateDetailOptions(item.id));
  };
  const isVideo = item.mediaType === "video" && Boolean(item.previewVideoPath);
  const previewImageSrc = item.previewImagePath || "";
  const [hoverPreview, setHoverPreview] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const hoveringRef = React.useRef(false);
  const stopPreview = React.useCallback(() => {
    hoveringRef.current = false;
    videoRef.current?.pause();
    setHoverPreview(false);
  }, []);
  const cardRef = React.useRef<HTMLButtonElement | null>(null);
  const [mediaVisible, setMediaVisible] = React.useState(index < 6);
  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (typeof IntersectionObserver === "undefined") { setMediaVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setMediaVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  // 与素材库统一：网格卡片只用 600 档缩略图（卡片 ~250-300px × 高分屏 DPR 的甜点值）。
  // 不显式追加原图——buildMediaPreviewCandidates 对本地图自带"缩略图失败回原图"的兜底，
  // 显式加只会让网格容易掉进几 MB 的原图，拖垮首页滚动。详情/灯箱仍加载原图。
  const candidates = React.useMemo(() => {
    if (!previewImageSrc) return [] as string[];
    return buildMediaPreviewCandidates(previewImageSrc, { width: 600, height: 600, mode: "cover" });
  }, [previewImageSrc]);

  // 仅鼠标悬停时播放；清理同时取消尚未完成的播放，避免离开后延迟启动。
  React.useEffect(() => {
    if (!isVideo || !hoverPreview) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let visible = typeof IntersectionObserver === "undefined";
    const canPlay = () => !disposed && hoveringRef.current && visible && !document.hidden;
    const play = () => {
      if (!canPlay()) return;
      void video.play().then(() => { if (!canPlay()) video.pause(); }).catch(() => undefined);
    };
    const onVisibility = () => { if (document.hidden) stopPreview(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stopPreview);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
          if (canPlay()) {
            play();
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.25 },
    );
    io?.observe(video);
    if (!io) play();
    return () => {
      disposed = true;
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stopPreview);
      video.pause();
    };
  }, [isVideo, hoverPreview, item.previewVideoPath, stopPreview]);

  return (
    <button
      ref={cardRef}
      type="button"
      aria-label={item.title}
      onClick={() => { stopPreview(); onPick(item.id); }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        hoveringRef.current = true;
        setHoverPreview(true);
        prepare();
      }}
      onPointerLeave={stopPreview}
      onPointerCancel={stopPreview}
      onFocus={prepare}
      onBlur={stopPreview}
      className="relative block aspect-[4/5] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-left transition hover:border-[var(--primary-bg)]/40"
    >
      {isVideo && item.previewVideoPath && hoverPreview && isVideoMediaUrl(item.previewVideoPath) ? (
        <>
          <video
            ref={videoRef}
            src={item.previewVideoPath}
            poster={item.previewImagePath || undefined}
            className="block h-full w-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
          />
          <VideoBadge />
        </>
      ) : candidates.length && mediaVisible ? (
        <>
          <ResilientImage
            candidates={candidates}
            alt={item.title}
            className="block h-full w-full object-cover"
            loading={index < 6 ? "eager" : "lazy"}
            warmOnLoad={false}
            decoding="async"
            fetchPriority={index < 6 ? "high" : "auto"}
          />
          {isVideo ? (
            <VideoBadge />
          ) : null}
        </>
      ) : isVideo ? (
        <>
          <div className="flex h-full items-center justify-center text-xs text-[var(--app-muted)]"><UiText id="home.m1d7afca6e90f" /></div>
          <VideoBadge />
        </>
      ) : (
        <div className="h-full w-full bg-[var(--input-bg)]" />
      )}
    </button>
  );
}

function InspirationSimpleGrid({
  items,
  onPickItem,
}: {
  items: TemplateItem[];
  onPickItem: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-0.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {items.map((item, index) => (
        <InspirationCard key={item.id} item={item} index={index} onPick={onPickItem} />
      ))}
    </div>
  );
}

// 当模版数 > 80 时启用虚拟 grid。
//   * customScrollParent: 跟随首页实际滚动容器
//   * components={{ List, Item }}: 用自定义容器以兼容 Tailwind grid CSS
//   * lazy import: react-virtuoso 不进主 bundle,只有真有 80+ 模版时才加载
function InspirationVirtualGrid({
  items,
  onPickItem,
  onReachEnd,
  scrollParent,
  onReady,
}: {
  items: TemplateItem[];
  onPickItem: (id: number) => void;
  onReachEnd?: () => void;
  scrollParent?: HTMLElement;
  onReady?: (ready: boolean) => void;
}) {
  const [virtuoso, setVirtuoso] = React.useState<{
    VirtuosoGrid: any;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    import("react-virtuoso").then((mod) => {
      if (!cancelled) setVirtuoso({ VirtuosoGrid: mod.VirtuosoGrid });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // virtuoso List/Item 必须 forwardRef + 透传 style/dataset,否则 grid 会错位。
  // 用 useMemo 避免每次渲染都新建组件触发 virtuoso 完整重挂。
  const components = React.useMemo(() => {
    return {
      List: React.forwardRef<HTMLDivElement, any>(function VirtList(props, ref) {
        const { style, children, ...rest } = props;
        return (
          <div
            ref={ref}
            {...rest}
            style={style}
            className="grid grid-cols-2 gap-0.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          >
            {children}
          </div>
        );
      }),
      Item: ({ children, ...props }: any) => (
        <div {...props} className="min-w-0">
          {children}
        </div>
      ),
    };
  }, []);

  if (!virtuoso?.VirtuosoGrid) {
    return <InspirationSimpleGrid items={items} onPickItem={onPickItem} />;
  }

  const { VirtuosoGrid } = virtuoso;
  return (
    <VirtuosoGrid
      customScrollParent={scrollParent}
      useWindowScroll={!scrollParent}
      readyStateChanged={onReady}
      initialItemCount={PAGE_SIZE}
      data={items}
      overscan={600}
      endReached={onReachEnd}
      itemContent={(index: number, item: TemplateItem) => (
        <InspirationCard item={item} index={index} onPick={onPickItem} />
      )}
      components={components}
    />
  );
}
