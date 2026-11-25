"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Play, Video } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import { createVideoPosterScheduler } from "@/lib/browser/video-poster-scheduler";
import { normalizeMediaUrl } from "@/lib/media-url";

const POSTER_CACHE_LIMIT = 48;
const POSTER_EXTRACTION_CONCURRENCY = 3;
const POSTER_EXTRACTION_TIMEOUT_MS = 4_000;
const posterPromiseCache = new Map<string, { promise: Promise<string | null>; poster?: string }>();
const schedulePosterExtraction = createVideoPosterScheduler(POSTER_EXTRACTION_CONCURRENCY);

function getPreviewFrameTime(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0.1) return 0;
  const safeEnd = Math.max(0, duration - 0.05);
  return Math.min(safeEnd, Math.max(0.35, duration * 0.08, Math.min(1, duration / 2)));
}

function seekToPreviewFrame(video: HTMLVideoElement) {
  const targetTime = getPreviewFrameTime(video.duration);
  if (targetTime <= 0 || Math.abs(video.currentTime - targetTime) < 0.05) return;
  try {
    video.currentTime = targetTime;
  } catch {}
}

function canvasToDataUrl(canvas: HTMLCanvasElement, type: string) {
  return new Promise<string | null>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => reject(reader.error || new Error("poster read failed"));
      reader.readAsDataURL(blob);
    }, type, 0.76);
  });
}

async function captureVideoFrame(video: HTMLVideoElement) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.seeking) return null;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const maxEdge = 360;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  // A seeked event can precede drawable pixels, even with HAVE_ENOUGH_DATA.
  // Reject a transparent canvas, but keep legitimate opaque black video frames.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasPixels = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      hasPixels = true;
      break;
    }
  }
  if (!hasPixels) return null;
  try {
    const webp = await canvasToDataUrl(canvas, "image/webp");
    if (webp) return webp;
  } catch {
    // Fall back to JPEG when WebP encoding is unavailable.
  }
  return canvasToDataUrl(canvas, "image/jpeg");
}

function extractVideoPoster(videoSrc: string) {
  return new Promise<string | null>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let timeoutId: number | null = null;
    let frameId: number | null = null;
    let capturing = false;

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const finish = (poster: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(poster);
    };
    const capture = () => {
      if (settled || capturing || frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (settled) return;
        capturing = true;
        void captureVideoFrame(video)
          .then((poster) => {
            capturing = false;
            if (poster) finish(poster);
            else capture();
          })
          .catch(() => finish(null));
      });
    };
    const captureWhenReady = () => {
      const targetTime = getPreviewFrameTime(video.duration);
      if (targetTime <= 0 || (!video.seeking && Math.abs(video.currentTime - targetTime) < 0.05)) {
        capture();
        return;
      }
      seekToPreviewFrame(video);
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadeddata = captureWhenReady;
    video.onseeked = capture;
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => seekToPreviewFrame(video);
    timeoutId = window.setTimeout(() => finish(null), POSTER_EXTRACTION_TIMEOUT_MS);
    video.src = videoSrc;
    video.load();
  });
}

function queueVideoPoster(videoSrc: string) {
  const cached = posterPromiseCache.get(videoSrc);
  if (cached) return cached.promise;

  const pending = schedulePosterExtraction(() => extractVideoPoster(videoSrc));
  const entry = { promise: pending, poster: undefined as string | undefined };
  posterPromiseCache.set(videoSrc, entry);
  void pending.then((poster) => {
    if (poster) entry.poster = poster;
    else if (posterPromiseCache.get(videoSrc) === entry) posterPromiseCache.delete(videoSrc);
  });
  if (posterPromiseCache.size > POSTER_CACHE_LIMIT) {
    const oldest = posterPromiseCache.keys().next().value as string | undefined;
    if (oldest && oldest !== videoSrc) posterPromiseCache.delete(oldest);
  }
  return pending;
}

export type VideoPosterPreviewProps = {
  videoSrc: string;
  posterSrc?: string | null;
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
  showPlayIcon?: boolean;
  background?: "panel" | "player";
};

export function VideoPosterPreview({
  videoSrc,
  posterSrc,
  alt: altProp,
  className,
  fit = "cover",
  showPlayIcon = true,
  background = "panel",
}: VideoPosterPreviewProps) {
  const { text } = useUiLocale();
  const alt = altProp ?? text("createDynamic.m05608cc41def");
  const normalizedVideoSrc = React.useMemo(() => normalizeMediaUrl(videoSrc), [videoSrc]);
  const normalizedPosterSrc = React.useMemo(() => normalizeMediaUrl(posterSrc || ""), [posterSrc]);
  const [generatedPoster, setGeneratedPoster] = React.useState<{ source: string; poster: string | null } | null>(null);
  const [posterFailed, setPosterFailed] = React.useState(false);
  const [nearViewport, setNearViewport] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setNearViewport(Boolean(entry?.isIntersecting));
    }, { rootMargin: "240px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    setPosterFailed(false);
  }, [normalizedPosterSrc, normalizedVideoSrc]);

  React.useEffect(() => {
    if (!nearViewport || normalizedPosterSrc || !normalizedVideoSrc) return;
    let cancelled = false;
    void queueVideoPoster(normalizedVideoSrc).then((poster) => {
      if (cancelled) return;
      setGeneratedPoster({ source: normalizedVideoSrc, poster });
      setPosterFailed(!poster);
    });
    return () => {
      cancelled = true;
    };
  }, [nearViewport, normalizedPosterSrc, normalizedVideoSrc]);

  const resolvedPoster = normalizedPosterSrc || posterPromiseCache.get(normalizedVideoSrc)?.poster
    || (generatedPoster?.source === normalizedVideoSrc ? generatedPoster.poster : null);
  return (
    <div
      ref={rootRef}
      data-video-poster-preview
      className={[
        "relative flex items-center justify-center overflow-hidden",
        background === "player" ? "bg-black" : "bg-[var(--panel-2)]",
        className || "",
      ].join(" ")}
    >
      {resolvedPoster ? (
        <MediaImage
          src={resolvedPoster}
          alt={alt}
          className={fit === "contain" ? "h-full w-full object-contain" : "h-full w-full object-cover"}
          previewSize={{ width: 360, height: 360, mode: "cover" }}
        />
      ) : posterFailed && nearViewport && normalizedVideoSrc ? (
        <video
          data-video-poster-fallback
          src={normalizedVideoSrc}
          className={fit === "contain" ? "h-full w-full object-contain" : "h-full w-full object-cover"}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          onLoadedMetadata={(event) => seekToPreviewFrame(event.currentTarget)}
        />
      ) : (
        <Video className="h-5 w-5 text-[var(--app-muted)]" aria-hidden="true" />
      )}
      {showPlayIcon ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
        <Play className="ml-0.5 h-3.5 w-3.5 text-white" fill="currentColor" aria-hidden="true" />
      </div> : null}
    </div>
  );
}
