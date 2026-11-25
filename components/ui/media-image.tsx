"use client";

import * as React from "react";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaOriginalCandidates, buildMediaPreviewCandidates, normalizeMediaUrl } from "@/lib/media-url";

/**
 * 全站统一的图片展示组件。
 *
 * 设计目标：
 * 1. 任何展示素材的地方都用这个组件——不要再写裸 <img>（除非是 favicon、icon 等静态资源）。
 * 2. 自动走 ResilientImage 的 L1 内存缓存 + 失败回退候选链。
 * 3. 默认 loading="lazy" + decoding="async"，渲染体验更稳。
 * 4. 接受单一 src，内部用 buildMediaPreviewCandidates 拆出 3 档候选 URL。
 *
 * 用法：
 *   <MediaImage src={item.url} alt="" className="..." />
 *   <MediaImage src={item.url} previewSize={{ width: 360, height: 360 }} />
 *   <MediaImage src={item.url} loading="eager" fetchPriority="high" />（首屏关键图）
 */
export type MediaImageProps = {
  src: string;
  alt?: string;
  className?: string;
  draggable?: boolean;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  fetchPriority?: "high" | "low" | "auto";
  /** OSS 实时缩略参数（仅对 OSS 外链生效；本地 /uploads/ 路径忽略） */
  previewSize?: { width?: number; height?: number; mode?: "cover" | "contain" };
  original?: boolean;
  cacheInMemory?: boolean;
  /** src 为空时渲染的占位内容 */
  fallback?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  /** 透传到内部 img 元素，常用于读 naturalWidth/Height */
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
};

export function MediaImage({
  src,
  alt = "",
  className,
  draggable = false,
  loading = "lazy",
  decoding = "async",
  fetchPriority = "auto",
  previewSize,
  original = false,
  cacheInMemory = true,
  fallback = null,
  onClick,
  onLoad,
  onError,
}: MediaImageProps) {
  const normalized = React.useMemo(() => normalizeMediaUrl(src), [src]);
  const candidates = React.useMemo(() => {
    if (!normalized) return [] as string[];
    if (original || /\.gif(?:[?#]|$)/i.test(normalized) || normalized.startsWith("data:image/gif")) {
      return buildMediaOriginalCandidates(normalized);
    }
    return buildMediaPreviewCandidates(normalized, previewSize);
  }, [normalized, original, previewSize?.width, previewSize?.height, previewSize?.mode]);

  if (!candidates.length) {
    if (!fallback) return null;
    return <>{fallback}</>;
  }

  const image = (
    <ResilientImage
      candidates={candidates}
      alt={alt}
      className={className}
      draggable={draggable}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onLoad={onLoad}
      onError={onError}
      cacheInMemory={cacheInMemory}
    />
  );

  if (!onClick) return image;
  return (
    <div onClick={onClick} className="contents">
      {image}
    </div>
  );
}
