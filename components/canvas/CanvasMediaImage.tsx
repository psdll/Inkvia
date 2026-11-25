"use client";
import { UiProps, UiText } from "@/i18n/ui";

import * as React from "react";
import { useNodeId, useStore } from "@xyflow/react";
import type { MediaImageProps } from "@/components/ui/media-image";
import { buildCanvasImageCandidates } from "@/lib/canvas/media-url";
import { canvasImageTier } from "@/lib/canvas/render-runtime";
import { CanvasRuntimeContext, useCanvasInteracting } from "./canvas-runtime-context";

type CanvasMediaImageProps = MediaImageProps & {
  onOriginalLoad?: React.ReactEventHandler<HTMLImageElement>;
  prefetch?: boolean;
  /** CSS pixels in a panel that stays the same size as the canvas zooms. */
  screenPreviewSize?: number;
  /** Fixed thumbnail tier for the simplified canvas node. */
  thumbnailSize?: 100;
};

/** Canvas-local decode queue. Keep the previous decoded tier visible while upgrading. */
export function CanvasMediaImage({ src, alt = "", previewSize, original, className, onLoad, onOriginalLoad, onError, fallback, onClick, prefetch = false, screenPreviewSize, thumbnailSize, cacheInMemory: _cacheInMemory, loading: _loading, decoding: _decoding, ...props }: CanvasMediaImageProps) {
  const runtime = React.useContext(CanvasRuntimeContext);
  const interacting = useCanvasInteracting();
  const nodeId = useNodeId();
  const selected = useStore(state => !screenPreviewSize && Boolean(nodeId && state.nodeLookup.get(nodeId)?.selected));
  const owner = React.useId();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // Subscribe to the resolution tier, not every fractional zoom value.
  // Most wheel frames scale the existing pixels without changing the requested image.
  const tier = useStore(state => {
    if (thumbnailSize) return thumbnailSize;
    if (original) return "original";
    if (screenPreviewSize) return canvasImageTier(screenPreviewSize * dpr, 1, 1, false, false);
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    return canvasImageTier(node?.measured.width ?? 350, state.transform[2], dpr, Boolean(node?.selected), previewSize?.width === 400);
  });
  const queue = screenPreviewSize ? runtime?.referenceImages : prefetch ? runtime?.prefetchImages : runtime?.images;
  // Newly visible nodes get small pixels while moving, then upgrade after settling.
  const loadTier = interacting && !screenPreviewSize && !original ? Math.min(typeof tier === "number" ? tier : 200, 200) : tier;
  const candidates = React.useMemo(() => buildCanvasImageCandidates(src, loadTier, previewSize?.mode), [src, loadTier, previewSize?.mode]);
  const [visible, setVisible] = React.useState<{ source: string; url: string; original: boolean } | null>(() => {
    if (src.startsWith("blob:")) return { source: src, url: src, original: true };
    const cached = candidates.find(candidate => runtime?.decoded.get(candidate.url)) ?? runtime?.previews?.get(src);
    return cached ? { source: src, ...cached } : null;
  });
  const visibleRef = React.useRef(visible);
  const failedSource = React.useRef<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const errorCallback = React.useRef(onError);
  errorCallback.current = onError;
  React.useEffect(() => {
    failedSource.current = null;
    setFailed(false);
  }, [src]);
  React.useEffect(() => {
    let cancelled = false;
    let cancelActive: (() => void) | undefined;
    const cachePreview = (candidate: typeof candidates[number], image?: HTMLImageElement) => {
      // Full-resolution images belong to the mounted <img>, not the offscreen pool.
      if (candidate.original || typeof loadTier !== "number" || loadTier > 800) return;
      if (image) runtime?.decoded.set(candidate.url, image);
      if (!screenPreviewSize) runtime?.previews?.set(src, candidate);
    };
    const show = (candidate: typeof candidates[number]) => {
      setFailed(false);
      const next = { source: src, ...candidate };
      cachePreview(candidate);
      visibleRef.current = next;
      setVisible(next);
    };
    const prepare = async () => {
      let failedImage: HTMLImageElement | undefined;
      for (const candidate of candidates) {
        if (cancelled) return;
        // Offscreen warming never downloads originals. Visible media can retry
        // its original fallback at rest if a thumbnail is unavailable.
        if (candidate.original && (prefetch || (interacting && !screenPreviewSize && !original))) return;
        const { url } = candidate;
        const cached = runtime?.decoded.get(url);
        if (cached) { show(candidate); return; }
        const image = new Image();
        image.decoding = "async";
        failedImage = image;
        try {
          await new Promise<void>((resolve, reject) => {
            let finished = false;
            const finish = (error?: unknown) => {
              if (finished) return;
              finished = true;
              clearTimeout(timeout);
              image.onload = null;
              image.onerror = null;
              cancelActive = undefined;
              if (error) { image.src = ""; reject(error); } else resolve();
            };
            const timeout = setTimeout(() => finish(new Error("Canvas image timed out")), 15000);
            cancelActive = () => finish(new Error("Canvas image no longer visible"));
            image.onload = () => {
              image.onload = null;
              void (image.decode ? image.decode() : Promise.resolve()).then(() => finish(), finish);
            };
            image.onerror = () => finish(new Error("Canvas image failed"));
            image.src = url;
          });
          if (cancelled) return;
          cachePreview(candidate, image);
          show(candidate);
          return;
        } catch { /* Preserve the existing preview and try the authenticated fallback. */ }
      }
      if (!cancelled && failedImage && failedSource.current !== src) {
        // A failed quality upgrade must not erase pixels that already decoded.
        // Only keep the same media (or its still-visible local upload preview).
        if (visibleRef.current && (visibleRef.current.source === src || visibleRef.current.source.startsWith("blob:"))) return;
        failedSource.current = src;
        setFailed(true);
        setVisible(null);
        const nativeEvent = new Event("error");
        errorCallback.current?.({
          nativeEvent, currentTarget: failedImage, target: failedImage, type: "error",
          bubbles: false, cancelable: false, defaultPrevented: false, eventPhase: 2,
          isTrusted: false, timeStamp: nativeEvent.timeStamp, preventDefault() {}, stopPropagation() {},
          isDefaultPrevented: () => false, isPropagationStopped: () => false, persist() {},
        });
      }
    };
    // Keep already visible pixels stable during gestures; only new nodes need work.
    if (interacting && !screenPreviewSize && visibleRef.current?.source === src) return;
    if (src) {
      // The canvas already decoded this picture: reuse it without another resize request.
      const cached = candidates.find(candidate => runtime?.decoded.get(candidate.url))
        ?? (screenPreviewSize ? runtime?.previews?.get(src) : undefined);
      if (src.startsWith("blob:")) show({ url: src, original: true });
      else if (cached) show(cached);
      else if (queue) queue.add(owner, prepare, selected ? 2 : prefetch ? -1 : 1);
      else void prepare();
    }
    return () => { cancelled = true; queue?.cancel(owner); cancelActive?.(); };
  }, [candidates, owner, runtime, queue, selected, src, prefetch, screenPreviewSize, interacting, original, loadTier]);
  // Upload completion changes the URL, but it is still the same picture. Keep its
  // local pixels on screen until the server preview has finished decoding.
  if (!visible || (visible.source !== src && !visible.source.startsWith("blob:"))) return <div className={className} style={{ background: "var(--canvas-media-placeholder, var(--canvas-node-bg))" }} data-canvas-image-loading={!failed || undefined} data-canvas-image-failed={failed || undefined}>{fallback ?? <UiProps ids={{"aria-label":["canvas.m572993f5820a"]}}><span role="img" aria-label={failed ? "canvas.m572993f5820a" : alt}>{failed ? <UiText id="canvas.m572993f5820a" /> : null}</span></UiProps>}</div>;
  const image = <img {...props} src={visible.url} alt={alt} className={className} draggable={props.draggable ?? false} loading="eager" decoding="async" onLoad={event => {
    onLoad?.(event);
    if (visible.original) onOriginalLoad?.(event);
  }} onError={onError} />;
  return onClick ? <div className="contents" onClick={onClick}>{image}</div> : image;
}
