"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";

type ResilientImageProps = {
  candidates: string[];
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  fetchPriority?: "high" | "low" | "auto";
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  hideUntilLoaded?: boolean;
  // 默认走内存 blob 热点池(缩略图小,命中收益高)。展示原图等大文件时传 false:
  // 只用 URL + 浏览器/SW 持久缓存,避免把几十张原图 blob 长期压在渲染进程内存里。
  cacheInMemory?: boolean;
  warmOnLoad?: boolean;
};

const resolvedImageCandidateCache = new Map<string, string>();
type CachedImage = { objectUrl: string; sourceUrl: string; bytes: number; decodedBytes: number; viewed: boolean; image?: HTMLImageElement };
const resolvedImageObjectUrlCache = new Map<string, CachedImage>();
const resilientImageWarmInFlight = new Map<string, { promise: Promise<string | null>; signal?: AbortSignal }>();
// Compressed file size alone does not reflect decoded image memory (width * height * 4).
const RESILIENT_IMAGE_MEMORY_CACHE_LIMIT = 128;
const MAX_CACHED_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_DECODED_BYTES = 96 * 1024 * 1024;
const MAX_PROTECTED_DECODED_BYTES = MAX_CACHED_DECODED_BYTES * 0.75;
const MAX_SINGLE_BLOB_BYTES = 4 * 1024 * 1024;
const MAX_SINGLE_DECODED_BYTES = 16 * 1024 * 1024;
let cachedBlobBytes = 0;
let cachedDecodedBytes = 0;
const DEFAULT_WARM_BATCH_LIMIT = 80;
const DEFAULT_WARM_BATCH_SIZE = 6;
const DEFAULT_WARM_BATCH_DELAY_MS = 80;

function normalizeCandidates(candidates: string[]) {
  return Array.from(new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean)));
}

function rememberCandidate(cacheKey: string, sourceUrl: string) {
  resolvedImageCandidateCache.delete(cacheKey);
  resolvedImageCandidateCache.set(cacheKey, sourceUrl);
  if (resolvedImageCandidateCache.size > 2048) resolvedImageCandidateCache.delete(resolvedImageCandidateCache.keys().next().value!);
}

function forgetObjectUrl(cacheKey: string) {
  const existing = resolvedImageObjectUrlCache.get(cacheKey);
  if (!existing) return;
  cachedBlobBytes -= existing.bytes;
  cachedDecodedBytes -= existing.decodedBytes;
  resolvedImageObjectUrlCache.delete(cacheKey);
  if (existing.image) existing.image.removeAttribute("src");
  else URL.revokeObjectURL(existing.objectUrl);
}

function getCachedImage(cacheKey: string) {
  const cached = resolvedImageObjectUrlCache.get(cacheKey);
  if (cached) {
    resolvedImageObjectUrlCache.delete(cacheKey);
    resolvedImageObjectUrlCache.set(cacheKey, cached);
  }
  return cached;
}

function rememberObjectUrl(cacheKey: string, sourceUrl: string, objectUrl: string, bytes: number, decodedBytes: number, image?: HTMLImageElement, viewed = false) {
  forgetObjectUrl(cacheKey);
  resolvedImageObjectUrlCache.set(cacheKey, { objectUrl, sourceUrl, bytes, decodedBytes, image, viewed });
  cachedBlobBytes += bytes;
  cachedDecodedBytes += decodedBytes;
  rememberCandidate(cacheKey, sourceUrl);
  while (resolvedImageObjectUrlCache.size > RESILIENT_IMAGE_MEMORY_CACHE_LIMIT
    || cachedBlobBytes > MAX_CACHED_BLOB_BYTES || cachedDecodedBytes > MAX_CACHED_DECODED_BYTES) {
    // Protect recently viewed pictures, but leave room for upcoming images so
    // a full viewed cache cannot immediately evict every new preload.
    const entries = [...resolvedImageObjectUrlCache];
    const protectedBytes = entries.reduce((sum, [, entry]) => sum + (entry.viewed ? entry.decodedBytes : 0), 0);
    const evictViewed = protectedBytes > MAX_PROTECTED_DECODED_BYTES;
    const oldest = entries.find(([, entry]) => entry.viewed === evictViewed)?.[0]
      ?? resolvedImageObjectUrlCache.keys().next().value;
    if (oldest === undefined) break;
    forgetObjectUrl(oldest);
  }
}

function decodeObjectUrl(objectUrl: string, signal?: AbortSignal) {
  return new Promise<number>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("image warm aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
      img.src = "";
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("image warm aborted", "AbortError"));
    };
    img.onload = () => {
      const decodedBytes = (img.naturalWidth || 600) * (img.naturalHeight || 600) * 4;
      cleanup();
      resolve(decodedBytes);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("image decode failed"));
    };
    img.decoding = "async";
    signal?.addEventListener("abort", onAbort, { once: true });
    img.src = objectUrl;
  });
}

// Remember successful sources separately from decoded pixels. Evicting a large
// decoded image must not send a previously viewed thumbnail back through a queue;
// the browser can restore that source from its own HTTP cache.
export function hasLoadedResilientImageCandidates(candidates: string[]) {
  return resolvedImageCandidateCache.has(normalizeCandidates(candidates).join("|"));
}

// Cancel a native image request without rejecting fetch response clones owned by
// browser extensions. Keep the loaded element under the same decoded-memory cap.
function loadCancelableImage(sourceUrl: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const image = document.createElement("img");
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      if (!loaded) image.removeAttribute("src");
      resolve(loaded ? image : null);
    };
    const onAbort = () => finish(false);
    // A stalled thumbnail must not monopolize one of the six preview slots.
    const timeout = window.setTimeout(() => finish(false), 15000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.decoding = "async";
    signal.addEventListener("abort", onAbort, { once: true });
    image.src = sourceUrl;
  });
}

export async function warmResilientImageCandidates(
  candidates: string[],
  options?: { signal?: AbortSignal; priority?: "visible" | "prefetch" },
) {
  if (typeof window === "undefined") return null;
  const normalizedCandidates = normalizeCandidates(candidates);
  // Inline and browser-owned URLs already live in the browser. Fetching them
  // wastes work and can violate connect-src even though img-src allows them.
  if (normalizedCandidates[0] && /^(data|blob):/i.test(normalizedCandidates[0])) return null;
  const cacheKey = normalizedCandidates.join("|");
  if (!cacheKey) return null;
  const cached = getCachedImage(cacheKey);
  if (cached) {
    if (options?.priority === "visible") cached.viewed = true;
    return cached.objectUrl;
  }
  const inFlight = resilientImageWarmInFlight.get(cacheKey);
  if (inFlight && !inFlight.signal?.aborted) return inFlight.promise;

  const warming = (async () => {
    for (const candidate of normalizedCandidates) {
      try {
        if (options?.signal?.aborted) return null;
        if (options?.signal) {
          const image = await loadCancelableImage(candidate, options.signal);
          if (!image) continue;
          const decodedBytes = image.naturalWidth * image.naturalHeight * 4;
          if (options.signal.aborted || decodedBytes > MAX_SINGLE_DECODED_BYTES) {
            image.removeAttribute("src");
            return null;
          }
          rememberObjectUrl(cacheKey, candidate, candidate, 0, decodedBytes, image, options.priority === "visible");
          return candidate;
        }
        const res = await fetch(candidate, { cache: "force-cache", signal: options?.signal });
        if (!res.ok) continue;
        if (Number(res.headers?.get("content-length") || 0) > MAX_SINGLE_BLOB_BYTES) return null;
        const blob = await res.blob();
        if (blob.size > MAX_SINGLE_BLOB_BYTES) return null;
        if (options?.signal?.aborted) return null;
        if (!String(blob.type || "").startsWith("image/")) continue;
        const objectUrl = URL.createObjectURL(blob);
        let decodedBytes: number;
        try {
          decodedBytes = await decodeObjectUrl(objectUrl, options?.signal);
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return null;
          continue;
        }
        if (options?.signal?.aborted || decodedBytes > MAX_SINGLE_DECODED_BYTES) {
          URL.revokeObjectURL(objectUrl);
          return null;
        }
        rememberObjectUrl(cacheKey, candidate, objectUrl, blob.size, decodedBytes, undefined, options?.priority === "visible");
        return objectUrl;
      } catch (error) {
        if (options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return null;
        continue;
      }
    }
    return null;
  })();
  resilientImageWarmInFlight.set(cacheKey, { promise: warming, signal: options?.signal });

  try {
    return await warming;
  } finally {
    if (resilientImageWarmInFlight.get(cacheKey)?.promise === warming) {
      resilientImageWarmInFlight.delete(cacheKey);
    }
  }
}

function hasWarmCache(candidates: string[]) {
  const cacheKey = normalizeCandidates(candidates).join("|");
  return Boolean(cacheKey && resolvedImageObjectUrlCache.has(cacheKey));
}

function scheduleWarmTask(task: () => void, delayMs: number) {
  if (typeof window === "undefined") return 0;
  const win = window as typeof window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    return win.requestIdleCallback(() => task(), { timeout: Math.max(250, delayMs * 4) });
  }
  return window.setTimeout(task, delayMs);
}

function cancelWarmTask(handle: number) {
  if (typeof window === "undefined" || !handle) return;
  const win = window as typeof window & {
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.cancelIdleCallback === "function") {
    win.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

export function warmResilientImageCandidatesBatch(
  candidateGroups: string[][],
  options?: { limit?: number; batchSize?: number; delayMs?: number }
) {
  if (typeof window === "undefined") return () => {};
  const limit = Math.max(1, Math.floor(Number(options?.limit) || DEFAULT_WARM_BATCH_LIMIT));
  const batchSize = Math.max(1, Math.floor(Number(options?.batchSize) || DEFAULT_WARM_BATCH_SIZE));
  const delayMs = Math.max(16, Math.floor(Number(options?.delayMs) || DEFAULT_WARM_BATCH_DELAY_MS));
  const groups = candidateGroups
    .map((group) => normalizeCandidates(group))
    .filter((group) => group.length > 0 && !hasWarmCache(group))
    .slice(0, limit);

  const controller = new AbortController();
  let cancelled = false;
  let handle = 0;
  let index = 0;

  const run = () => {
    if (cancelled) return;
    const batch = groups.slice(index, index + batchSize);
    index += batch.length;
    if (!batch.length) return;
    void Promise.allSettled(batch.map((group) => warmResilientImageCandidates(group, { signal: controller.signal }))).finally(() => {
      if (!cancelled && index < groups.length) {
        handle = scheduleWarmTask(run, delayMs);
      }
    });
  };

  handle = scheduleWarmTask(run, delayMs);
  return () => {
    cancelled = true;
    controller.abort();
    cancelWarmTask(handle);
  };
}

function withRetryToken(src: string, retry: number) {
  if (!src || retry <= 0) return src;
  if (/^(data|blob):/i.test(src)) return src;
  try {
    const parsed = new URL(src, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    parsed.searchParams.set("_r", String(retry));
    if (src.startsWith("http://") || src.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const joiner = src.includes("?") ? "&" : "?";
    return `${src}${joiner}_r=${retry}`;
  }
}

export function ResilientImage({
  candidates,
  alt,
  className,
  style,
  draggable = false,
  loading = "eager",
  decoding = "async",
  fetchPriority = "high",
  onLoad,
  onError,
  hideUntilLoaded = false,
  cacheInMemory = true,
  warmOnLoad = true,
}: ResilientImageProps) {
  const candidatesSignature = candidates.map((item) => String(item || "").trim()).join("|");
  const normalizedCandidates = React.useMemo(
    () => normalizeCandidates(candidates),
    [candidatesSignature]
  );
  const cacheKey = normalizedCandidates.join("|");
  // Adopt a warm blob only when this media is first displayed. Warming must not
  // change an already decoded img.src on an unrelated selection/toolbar render.
  const initialObjectUrl = React.useMemo(
    () => cacheInMemory && cacheKey ? getCachedImage(cacheKey)?.objectUrl || "" : "",
    [cacheInMemory, cacheKey]
  );
  const [failedObjectUrl, setFailedObjectUrl] = React.useState("");
  const cachedObjectUrl = initialObjectUrl !== failedObjectUrl ? initialObjectUrl : "";
  const cachedSrc = cacheKey ? resolvedImageCandidateCache.get(cacheKey) || "" : "";
  const cachedIndex = cachedSrc ? Math.max(0, normalizedCandidates.indexOf(cachedSrc)) : 0;
  const [candidateIndex, setCandidateIndex] = React.useState(cachedIndex);
  const [retry, setRetry] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [loadedSrc, setLoadedSrc] = React.useState("");
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  // 原生 loading="lazy" 在大网格里有时不会为「已进入视口」的图触发加载（白屏，hover 引发重绘才出来）。
  // 用 IntersectionObserver 兜底：进入视口（含 800px 提前量）就把该图升级为 eager，确保可靠加载；
  // src 不变、eager 图行为不变，仅把原生 lazy 漏触发的那些补上。
  const [forceEager, setForceEager] = React.useState(false);

  React.useEffect(() => {
    const nextCachedSrc = cacheKey ? resolvedImageCandidateCache.get(cacheKey) || "" : "";
    const nextCandidates = cacheKey ? cacheKey.split("|") : [];
    setCandidateIndex(nextCachedSrc ? Math.max(0, nextCandidates.indexOf(nextCachedSrc)) : 0);
    setRetry(0);
    setFailed(false);
  }, [cacheKey]);

  React.useEffect(() => {
    if (loading !== "lazy" || forceEager) return;
    const el = imgRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setForceEager(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setForceEager(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, forceEager]);

  const current = normalizedCandidates[candidateIndex] || "";
  const src = cachedObjectUrl || withRetryToken(current, retry);
  const attachImage = React.useCallback((image: HTMLImageElement | null) => {
    imgRef.current = image;
    // A memory-cache hit may already be complete when the node is attached.
    // Reveal it before paint instead of waiting for a later load-event render.
    if (hideUntilLoaded && image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
  }, [hideUntilLoaded, src]);

  React.useEffect(() => {
    if (!cacheInMemory || fetchPriority !== "high") return;
    const cached = getCachedImage(cacheKey);
    if (cached) cached.viewed = true;
  }, [cacheInMemory, cacheKey, fetchPriority]);

  if (!current || failed) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-[var(--app-muted)]"><UiText id="common.meb465abeb00e" /></div>;
  }

  return (
    <img
      ref={attachImage}
      src={src}
      alt={alt}
      style={style}
      className={[className, hideUntilLoaded && loadedSrc !== src ? "invisible" : ""].filter(Boolean).join(" ")}
      draggable={draggable}
      loading={forceEager ? "eager" : loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onLoad={(event) => {
        if (hideUntilLoaded) setLoadedSrc(src);
        if (cacheKey && current) {
          rememberCandidate(cacheKey, current);
          if (cacheInMemory && warmOnLoad && !cachedObjectUrl) {
            void warmResilientImageCandidates(normalizedCandidates, { priority: fetchPriority === "high" ? "visible" : "prefetch" });
          }
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        if (hideUntilLoaded) setLoadedSrc("");
        if (cachedObjectUrl) {
          setFailedObjectUrl(cachedObjectUrl);
          if (resolvedImageObjectUrlCache.get(cacheKey)?.objectUrl === cachedObjectUrl) {
            forgetObjectUrl(cacheKey);
          }
          // A native warm cache already uses the source URL; force a real retry.
          if (!cachedObjectUrl.startsWith("blob:")) setRetry(1);
          return;
        }
        if (retry < 1 && !/^(data|blob):/i.test(current)) {
          setRetry((prev) => prev + 1);
          return;
        }
        if (candidateIndex < normalizedCandidates.length - 1) {
          setCandidateIndex((prev) => prev + 1);
          setRetry(0);
          return;
        }
        resolvedImageCandidateCache.delete(cacheKey);
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
