"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaOriginalCandidates } from "@/lib/media-url";

export type MediaLightboxProps = {
  open: boolean;
  src: string | null;
  kind: "image" | "video" | "audio";
  title?: string;
  details?: React.ReactNode;
  layout?: "content" | "material-detail" | "floating";
  dimBackdrop?: boolean;
  onClose: () => void;
  /** 系列图上一张/下一张；提供后会在图片两侧显示切换箭头（仅悬停可见），并支持左右方向键 */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 系列图页码，如 "3/6"；提供后在图片右上角悬停显示 */
  counter?: string;
  /** 让页码常驻显示；默认沿用悬停显示 */
  counterAlwaysVisible?: boolean;
  /** 系列图底部圆点指示器 */
  dots?: { count: number; activeIndex: number; compact?: boolean };
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function MediaLightboxDots({
  count,
  activeIndex,
  compact = false,
}: {
  count: number;
  activeIndex: number;
  compact?: boolean;
}) {
  if (count <= 1) return null;
  return (
    <div
      className={[
        "pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center justify-center gap-1 rounded-full bg-black/15 px-1.5 py-1 backdrop-blur-[2px]",
        compact ? "bottom-3 gap-0.5 px-1 py-0.5" : "",
      ].join(" ")}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={[
            "block rounded-full transition-all duration-200",
            compact ? "h-1 w-1" : "h-1.5 w-1.5",
            index === activeIndex
              ? "bg-white opacity-100"
              : "bg-white/50 opacity-75",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

export function MediaLightbox({
  open,
  src,
  kind,
  title,
  details,
  layout = "content",
  dimBackdrop = true,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  counter,
  counterAlwaysVisible = false,
  dots,
}: MediaLightboxProps) {
  const [mounted, setMounted] = React.useState(false);
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [panning, setPanning] = React.useState(false);
  const [entered, setEntered] = React.useState(false);
  const [imageReady, setImageReady] = React.useState(kind !== "image");
  const [videoAspectRatio, setVideoAspectRatio] = React.useState(3 / 4);
  const panRef = React.useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  const imgWrapRef = React.useRef<HTMLDivElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const backdropPointerDown = React.useRef(false);
  const displayCandidates = React.useMemo(() => {
    if (!src) return null;
    return kind === "image" ? buildMediaOriginalCandidates(src) : [];
  }, [kind, src]);
  const displaySrc = kind === "image" ? displayCandidates?.[0] || null : src;
  const displayCandidatesKey = displayCandidates?.join("|") || "";

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const resetTransform = React.useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setPanning(false);
    panRef.current = null;
  }, []);

  const close = React.useCallback(() => {
    resetTransform();
    onCloseRef.current();
  }, [resetTransform]);

  React.useEffect(() => {
    if (!open) return;
    resetTransform();
    setEntered(false);
    const enterTimer = window.requestAnimationFrame(() => setEntered(true));
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );
    const currentPaddingRight =
      Number.parseFloat(
        window.getComputedStyle(document.body).paddingRight || "0",
      ) || 0;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(enterTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open, close, resetTransform]);

  React.useEffect(() => {
    if (!open) return;
    resetTransform();
  }, [kind, open, resetTransform, src]);

  // 系列图：左右方向键切换上一张/下一张
  React.useEffect(() => {
    if (!open || (!onPrev && !onNext)) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onPrev, onNext, hasPrev, hasNext]);

  React.useEffect(() => {
    setImageReady(kind !== "image");
  }, [displayCandidatesKey, kind, open]);

  React.useEffect(() => {
    setVideoAspectRatio(3 / 4);
  }, [displaySrc, open]);

  React.useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      if (!panning || !panRef.current) return;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      setTx(panRef.current.tx + dx);
      setTy(panRef.current.ty + dy);
    };
    const onUp = () => {
      if (!panning) return;
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [open, panning]);

  const onWheel = (e: React.WheelEvent) => {
    if (kind !== "image") return;
    e.preventDefault();
    const wrap = imgWrapRef.current;
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2 - tx;
    const py = e.clientY - rect.top - rect.height / 2 - ty;

    const nextScale = clamp(scale * (e.deltaY > 0 ? 0.9 : 1.1), 1, 6);
    if (nextScale === 1) {
      setScale(1);
      setTx(0);
      setTy(0);
      setPanning(false);
      panRef.current = null;
      return;
    }
    const ratio = nextScale / scale;
    const nextTx = tx - px * (ratio - 1);
    const nextTy = ty - py * (ratio - 1);
    setScale(nextScale);
    setTx(nextTx);
    setTy(nextTy);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (kind !== "image") return;
    if (scale <= 1) return;
    e.preventDefault();
    setPanning(true);
    panRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (kind !== "image") return;
    e.preventDefault();
    resetTransform();
  };

  const stepZoom = React.useCallback(
    (direction: "in" | "out") => {
      if (kind !== "image") return;
      const factor = direction === "in" ? 1.25 : 0.8;
      const nextScale = clamp(scale * factor, 1, 6);
      setScale(nextScale);
      if (nextScale === 1) {
        setTx(0);
        setTy(0);
        setPanning(false);
        panRef.current = null;
      }
    },
    [kind, scale],
  );

  const hasTransform = scale !== 1 || tx !== 0 || ty !== 0;
  const isMaterialDetailLayout =
    layout === "material-detail" && Boolean(details);
  const isFloatingLayout = layout === "floating";
  const isWideMaterialVideo =
    isMaterialDetailLayout && kind === "video" && videoAspectRatio >= 4 / 3;

  const modal =
    open && displaySrc ? (
      <div
        className="fixed inset-0 z-[220]"
        data-wheel-lock="true"
        role="dialog"
        aria-modal="true"
      >
        <div
          className={[
            // 媒体查看器行业标准：近乎不透明的深色遮罩，让背景基本消失、媒体成为唯一焦点（参考 Google Photos / PhotoSwipe）
            "pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out",
            isFloatingLayout
              ? "bg-black/35"
              : dimBackdrop
                ? "bg-black/85"
                : "bg-transparent",
            entered ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />
        <div
          data-media-lightbox-backdrop
          className="absolute inset-0 flex items-center justify-center p-4 lg:p-6"
          onPointerDown={(event) => { backdropPointerDown.current = event.target === event.currentTarget; }}
          onPointerCancel={() => { backdropPointerDown.current = false; }}
          onClick={(event) => {
            if (event.target === event.currentTarget && backdropPointerDown.current) close();
            backdropPointerDown.current = false;
          }}
        >
          <div
            className={[
              // 遮罩两主题统一为深色（沉浸式看图的行业标准）。浅色卡片必须接近实色，否则深色文字坐在深遮罩上看不清；深色卡片用用户实测的 20% 薄叠层
              "relative overflow-hidden rounded-[28px] border border-[var(--border)] shadow-[var(--shadow)] transition-all duration-200 ease-out will-change-transform",
              isFloatingLayout
                ? "bg-[var(--panel-bg)]"
                : "bg-[rgba(242,242,247,0.95)] dark:bg-[#262626]",
              entered
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-2 scale-[0.985] opacity-0",
               isFloatingLayout
                 ? "flex h-[min(76dvh,720px)] w-[calc(100dvw-2rem)] max-w-[880px] flex-col"
                 : isMaterialDetailLayout
                  ? [
                      "w-full max-w-[calc(100dvw-2rem)] max-h-[calc(100dvh-2rem)] flex flex-col md:inline-block md:w-auto md:max-w-[calc(100dvw-3rem)]",
                      isWideMaterialVideo
                        ? "md:h-[72vh] md:max-h-[680px]"
                        : "md:h-[86vh] md:max-h-[820px]",
                    ].join(" ")
                  : kind === "video"
                    ? "w-auto flex flex-col max-w-[calc(100dvw-2rem)] lg:max-w-[calc(100dvw-3rem)] max-h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-3rem)]"
                    : "w-auto flex flex-col max-w-[calc(100dvw-2rem)] lg:max-w-[calc(100dvw-3rem)] max-h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-3rem)]",
            ].join(" ")}
            style={
              isMaterialDetailLayout && kind === "video"
                ? ({ "--media-aspect": videoAspectRatio } as React.CSSProperties)
                : undefined
            }
          >
            <div
              className={[
                "z-20 flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-transparent px-5",
                isMaterialDetailLayout ? "absolute inset-x-0 top-0" : "relative",
              ].join(" ")}
            >
              <div className="min-w-0 text-[var(--app-fg)] font-semibold text-sm truncate">
                {title || ""}
              </div>
              <div className="flex items-center gap-2">
                {kind === "image" ? (
                  <>
                    <div className="hidden sm:block text-xs text-[var(--app-muted)]"><UiText id="common.mfebea6514aab" /></div>
                    <UiProps ids={{"aria-label":["common.m290f68030501"]}}><button
                      type="button"
                      onClick={() => stepZoom("out")}
                      className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                      aria-label="common.m290f68030501"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"aria-label":["common.m80f8fbcfa011"]}}><button
                      type="button"
                      onClick={() => stepZoom("in")}
                      className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                      aria-label="common.m80f8fbcfa011"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"aria-label":["common.mddde08946298"]}}><button
                      type="button"
                      onClick={resetTransform}
                      className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                      aria-label="common.mddde08946298"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button></UiProps>
                  </>
                ) : null}
                <div className="min-w-[44px] text-center text-xs text-[var(--app-muted)]">
                  {kind === "image" ? `${Math.round(scale * 100)}%` : ""}
                </div>
                <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                  type="button"
                  onClick={close}
                  className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                  aria-label="common.m3fd47edce45b"
                >
                  <X className="h-3.5 w-3.5" />
                </button></UiProps>
              </div>
            </div>
            <div
              className={[
                "flex-1 min-h-0",
                isMaterialDetailLayout ? "pt-[56px]" : "",
                isFloatingLayout
                  ? "flex overflow-hidden"
                  : isMaterialDetailLayout
                    ? "flex flex-col overflow-hidden md:h-full md:w-fit md:self-start md:flex-row"
                    : details
                      ? "flex flex-col lg:flex-row"
                      : "",
              ].join(" ")}
            >
              {/* 图片区底衬：浅色给实色（配 95% 白卡片）；深色透明，透出薄叠层 + 深色遮罩。视频保持黑底 */}
              <div
                className={[
                  "group relative min-h-0 min-w-0 flex-1 overflow-hidden",
                  isMaterialDetailLayout
                    ? kind === "video"
                      ? "md:h-full md:aspect-[var(--media-aspect)] md:flex-none"
                      : "md:h-full md:aspect-[3/4] md:flex-none"
                    : "",
                  kind === "video"
                    ? "bg-black"
                    : isFloatingLayout
                      ? "bg-[var(--input-bg)]"
                      : "bg-[#e4e4ec] dark:bg-[#262626]",
                ].join(" ")}
              >
                {counter ? (
                  <div
                    className={[
                      "pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium leading-none text-white backdrop-blur-sm transition-opacity duration-150",
                      counterAlwaysVisible
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    ].join(" ")}
                  >
                    {counter}
                  </div>
                ) : null}
                {onPrev && hasPrev ? (
                  <UiProps ids={{"aria-label":["common.mbcf200709dbc"]}}><button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onPrev}
                    aria-label="common.mbcf200709dbc"
                    className="absolute left-4 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition duration-150 hover:bg-black/50 group-hover:opacity-100"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button></UiProps>
                ) : null}
                {onNext && hasNext ? (
                  <UiProps ids={{"aria-label":["common.mdcd4eb027369"]}}><button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onNext}
                    aria-label="common.mdcd4eb027369"
                    className="absolute right-4 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition duration-150 hover:bg-black/50 group-hover:opacity-100"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button></UiProps>
                ) : null}
                {kind === "audio" ? (
                  <div className="flex min-h-48 w-full items-center justify-center bg-[var(--panel-bg)] p-8">
                    <UiProps ids={{"aria-label":["common.mccbe7ed106ce"]}}><audio src={displaySrc} controls preload="metadata" className="w-full min-w-64" aria-label="common.mccbe7ed106ce" /></UiProps>
                  </div>
                ) : kind === "video" ? (
                  <div
                    className={[
                      "flex items-center justify-center p-2 lg:p-3",
                      isFloatingLayout ? "h-full w-full" : "",
                    ].join(" ")}
                  >
                    <AppVideoPlayer
                      src={displaySrc}
                      autoPlay
                      className={[
                        "block h-full w-full object-contain bg-black",
                        isFloatingLayout
                          ? "h-full w-full max-h-full max-w-full"
                          : "max-h-[calc(100dvh-6.5rem)] max-w-[calc(100dvw-2.5rem)] lg:max-h-[calc(100dvh-8rem)] lg:max-w-[calc(100dvw-4rem)]",
                      ].join(" ")}
                      containerClassName={[
                        isMaterialDetailLayout ? "h-full w-full" : "",
                        isFloatingLayout ? "h-full w-full" : "",
                      ].join(" ")}
                      playsInline
                      onNaturalSize={({ ratio }) => {
                        if (Number.isFinite(ratio) && ratio > 0) setVideoAspectRatio(ratio);
                      }}
                    />
                  </div>
                ) : (
                  <div
                    ref={imgWrapRef}
                    className={[
                      "h-full w-full flex items-center justify-center select-none",
                      isMaterialDetailLayout ? "" : "p-4",
                      scale > 1 ? "cursor-grab" : "cursor-zoom-in",
                    ].join(" ")}
                    onWheel={onWheel}
                    onMouseDown={onMouseDown}
                    onDoubleClick={onDoubleClick}
                  >
                    {!imageReady ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-[var(--input-bg)]/92">
                        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--app-fg)]" />
                      </div>
                    ) : null}
                    <div
                      className={[
                        isMaterialDetailLayout || isFloatingLayout
                          ? "h-full w-full"
                          : "",
                        panning ? "cursor-grabbing" : "",
                      ].join(" ")}
                      style={{
                        transform: hasTransform
                          ? `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`
                          : undefined,
                        opacity: imageReady ? 1 : 0,
                        transition: imageReady
                          ? "opacity 180ms ease-out"
                          : "none",
                      }}
                    >
                      <ResilientImage
                        candidates={displayCandidates || []}
                        alt=""
                        className={[
                          "pointer-events-none object-contain",
                          isMaterialDetailLayout || isFloatingLayout
                            ? "h-full w-full"
                            : "max-h-[calc(100dvh-9rem)] max-w-full",
                        ].join(" ")}
                        draggable={false}
                        loading="eager"
                        fetchPriority="high"
                        cacheInMemory={false}
                        onLoad={() => setImageReady(true)}
                        onError={() => setImageReady(true)}
                      />
                    </div>
                  </div>
                )}
                {dots && dots.count > 1 ? (
                  <MediaLightboxDots
                    count={dots.count}
                    activeIndex={dots.activeIndex}
                    compact={dots.compact}
                  />
                ) : null}
              </div>
              {details ? (
                <aside
                  className={[
                    "max-h-[32dvh] overflow-auto border-t border-[var(--border)] bg-transparent dark:bg-[#262626] p-4",
                    isMaterialDetailLayout
                      ? "md:h-full md:max-h-none md:w-[300px] md:shrink-0 md:border-l md:border-t-0"
                      : "lg:max-h-[calc(100dvh-8rem)] lg:w-[280px] lg:border-l lg:border-t-0",
                  ].join(" ")}
                >
                  {details}
                </aside>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    ) : null;

  if (!mounted) return null;
  return modal ? createPortal(modal, document.body) : null;
}
