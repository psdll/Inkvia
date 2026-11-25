"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { Play } from "lucide-react";
import { ResilientImage } from "@/components/ui/resilient-image";

type HoverPreviewVideoProps = {
  src: string;
  posterSrc?: string | null;
  posterCandidates?: string[];
  className?: string;
  previewOnHover?: boolean;
  // 保留以兼容调用方；不再用它预加载视频（预加载是卡顿主因）。
  eager?: boolean;
  deferFallback?: boolean;
};

export function VideoBadge() {
  return (
    <span
      data-video-badge
      className="pointer-events-none absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/25 bg-black/30 text-white shadow-[0_1px_6px_rgba(0,0,0,0.28)] backdrop-blur-[2px]"
      aria-hidden="true"
    >
      <Play className="h-3 w-3 translate-x-px" fill="currentColor" strokeWidth={1.5} />
    </span>
  );
}

// 正常卡片只加载封面，悬停才播放。封面全部失败时，仅为可见卡片加载视频静帧。
export function HoverPreviewVideo({ src, posterSrc, posterCandidates = [], className, previewOnHover = true, eager = false, deferFallback = false }: HoverPreviewVideoProps) {
  const [active, setActive] = React.useState(false);
  const [posterFailed, setPosterFailed] = React.useState(false);
  const [fallbackVisible, setFallbackVisible] = React.useState(false);
  const [fallbackFailed, setFallbackFailed] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const candidates = Array.from(new Set([posterSrc, ...posterCandidates].filter((url): url is string => Boolean(url))));
  const posterKey = candidates.join("|");
  const showPoster = candidates.length > 0 && !posterFailed;

  const activate = React.useCallback(() => {
    if (previewOnHover) setActive(true);
  }, [previewOnHover]);
  const deactivate = React.useCallback(() => setActive(false), []);

  // 切换素材时重置封面失败标记，避免上一条的失败状态残留
  React.useEffect(() => { setPosterFailed(false); setFallbackFailed(false); }, [posterKey, src]);

  React.useEffect(() => {
    if (showPoster || !deferFallback) return;
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === "undefined") { setFallbackVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setFallbackVisible(entry.isIntersecting));
    observer.observe(container);
    return () => observer.disconnect();
  }, [showPoster, deferFallback, src]);

  React.useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    void video.play().catch(() => {});
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onMouseEnter={activate}
      onMouseLeave={deactivate}
      onPointerEnter={activate}
      onPointerLeave={deactivate}
      onFocus={activate}
      onBlur={deactivate}
    >
      {showPoster ? (
        <ResilientImage
          key={`${src}|${posterKey}`}
          candidates={candidates}
          alt=""
          className={className}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          warmOnLoad={false}
          // 重试和备用封面均失败后，才使用视频静帧。
          onError={() => setPosterFailed(true)}
        />
      ) : fallbackFailed ? (
        <div className="flex h-full items-center justify-center bg-[var(--panel-3)] text-xs text-[var(--app-muted)]"><UiText id="common.md46d5590bc09" /></div>
      ) : deferFallback && !fallbackVisible ? (
        <div className="h-full w-full bg-[var(--panel-3)]" />
      ) : (
        // 不自动播放；离开可视区域后卸载，避免整页视频同时加载。
        <video
          src={`${src.split("#")[0]}#t=0.1`}
          className={["bg-[var(--panel-3)]", className].filter(Boolean).join(" ")}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          onError={() => setFallbackFailed(true)}
        />
      )}

      {/* 与小红书卡片一致：右上角常驻轻量视频标识，不遮挡画面主体。 */}
      <VideoBadge />

      {/* 悬停才挂载 <video>，覆盖在封面之上播放；移开卸载，露出封面，无闪烁 */}
      {active ? (
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc || undefined}
          className={["absolute inset-0", className].filter(Boolean).join(" ")}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
        />
      ) : null}
    </div>
  );
}
