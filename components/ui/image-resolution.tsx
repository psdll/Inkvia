"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { buildMediaOriginalUrl, buildMediaProxyUrl } from "@/lib/media-url";

export type ImageDimensions = { width: number; height: number };

export function readImageDimensions(value: unknown): ImageDimensions | null {
  if (!value || typeof value !== "object") return null;
  const { width, height } = value as Partial<ImageDimensions>;
  return typeof width === "number" && typeof height === "number" && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export function ImageResolution({
  src,
  dimensions,
  className = "",
  style,
}: {
  src: string;
  dimensions?: ImageDimensions | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { text } = useUiLocale();
  const original = buildMediaOriginalUrl(src);
  const known = readImageDimensions(dimensions);
  const knownWidth = known?.width;
  const knownHeight = known?.height;
  const [loaded, setLoaded] = React.useState<{ src: string; dimensions: ImageDimensions } | null>(null);

  React.useEffect(() => {
    if (!original || (knownWidth && knownHeight)) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    const proxy = buildMediaProxyUrl(original);
    image.onload = () => {
      const size = readImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      if (!cancelled && size) setLoaded({ src: original, dimensions: size });
    };
    let usingProxy = proxy !== original;
    image.onerror = () => {
      if (cancelled || !usingProxy) return;
      usingProxy = false;
      image.src = original;
    };
    // Read the original independently: a resized preview cannot supply its resolution.
    image.src = proxy;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [original, knownWidth, knownHeight]);

  const size = known || (loaded?.src === original ? loaded.dimensions : null);
  if (!size) return null;
  return (
    <span
      data-image-resolution
      aria-label={text("createDynamic.m33ac80f26a98", { width: size.width, height: size.height })}
      className={`pointer-events-none whitespace-nowrap text-[11px] leading-4 tabular-nums text-[var(--app-muted)] ${className}`}
      style={style}
    >
      {size.width} × {size.height}
    </span>
  );
}
