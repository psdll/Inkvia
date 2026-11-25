"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaImage } from "@/components/ui/media-image";
import { useLogger } from "@/hooks/use-logger";

export type TemplateCardData = {
  id: number;
  title: string;
  description: string | null;
  toolType: "face" | "image" | "video";
  mediaType: "image" | "video";
  previewImagePath: string | null;
  previewVideoPath: string | null;
  tags: string[];
};

function getUseHref(toolType: TemplateCardData["toolType"], id: number) {

  if (toolType === "video") return `/video?templateId=${id}`;
  return `/image?templateId=${id}`;
}

export function TemplateCard({
  data,
  variant = "default",
}: {
  data: TemplateCardData;
  variant?: "default" | "featured" | "compact";
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const isVideo = data.mediaType === "video" && !!data.previewVideoPath;
  const [isHovering, setIsHovering] = React.useState(false);
  const [naturalAspect, setNaturalAspect] = React.useState<number | null>(null);
  const { logAction } = useLogger();

  const handleUseTemplate = () => {
    logAction("template_use", `用户使用了模板「${data.title}」`, {
      templateId: data.id,
      title: data.title,
      toolType: data.toolType,
      mediaType: data.mediaType,
    });
  };

  const onEnter = () => {
    setIsHovering(true);
  };

  const onLeave = () => {
    setIsHovering(false);
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {}
  };

  React.useEffect(() => {
    if (!isHovering) return;
    const el = videoRef.current;
    if (!el) return;
    const p = el.play();
    if (p && typeof (p as any).catch === "function") (p as any).catch(() => {});
  }, [isHovering]);

  React.useEffect(() => {
    let cancelled = false;
    const src = data.previewImagePath || (isVideo ? data.previewVideoPath : null);
    if (!src) {
      setNaturalAspect(null);
      return;
    }

    if (isVideo && !data.previewImagePath) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = src;
      v.onloadedmetadata = () => {
        if (cancelled) return;
        const w = v.videoWidth || 16;
        const h = v.videoHeight || 9;
        const next = w / h;
        if (Number.isFinite(next) && next > 0.2 && next < 5) setNaturalAspect(next);
      };
      v.onerror = () => {
        if (cancelled) return;
        setNaturalAspect(null);
      };
    } else {
      const img = new window.Image();
      img.src = src;
      img.onload = () => {
        if (cancelled) return;
        const w = (img as any).naturalWidth || img.width || 16;
        const h = (img as any).naturalHeight || img.height || 9;
        const next = w / h;
        if (Number.isFinite(next) && next > 0.2 && next < 5) setNaturalAspect(next);
      };
      img.onerror = () => {
        if (cancelled) return;
        setNaturalAspect(null);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [data.previewImagePath, data.previewVideoPath, isVideo]);

  // 根据 variant 确定样式
  const isCompact = variant === "compact";
  const isFeatured = variant === "featured";

  const cardRadius = isCompact ? "rounded-none" : isFeatured ? "rounded-[26px]" : "rounded-[22px]";
  const aspectClass = isCompact ? "" : isFeatured ? "aspect-[16/10]" : "aspect-[3/4]";

  return (
    <Card
      className={[
        "group overflow-hidden bg-[var(--panel-bg)] card-hover-smooth",
        isCompact ? "" : "border border-[var(--border)] hover:border-[var(--border-2)]",
        cardRadius,
      ].join(" ")}
    >
      <div
        className={["relative overflow-hidden", aspectClass].join(" ")}
        style={naturalAspect ? { aspectRatio: naturalAspect } : undefined}
      >
        {isVideo ? (
          <div className="absolute inset-0" onMouseEnter={onEnter} onMouseLeave={onLeave}>
            {isHovering ? (
              <video
                ref={videoRef}
                src={data.previewVideoPath!}
                poster={data.previewImagePath || undefined}
                preload="metadata"
                muted
                loop
                playsInline
                className="h-full w-full object-cover"
              />
            ) : data.previewImagePath ? (
              <MediaImage
                src={data.previewImagePath}
                alt={data.title}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                previewSize={{ width: 360, height: 360 }}
              />
            ) : (
              <div className="absolute inset-0 bg-[var(--panel-2)]" />
            )}
          </div>
        ) : data.previewImagePath ? (
          <MediaImage
            src={data.previewImagePath}
            alt={data.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            previewSize={{ width: 360, height: 360 }}
          />
        ) : (
          <div className="absolute inset-0 bg-[var(--panel-2)] flex items-center justify-center">
            <span className="text-[10px] text-[var(--app-muted)]">NO PREVIEW</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-100" />

        {/* 标签 - compact 模式只显示2个且更小 */}
        <div className={`absolute ${isCompact ? "top-1.5 left-1.5" : "top-3 left-3"} flex flex-wrap gap-1`}>
          {data.tags.slice(0, isCompact ? 2 : 4).map((t) => (
            <span
              key={t}
              className={[
                "rounded-full bg-black/40 border border-white/10 text-zinc-200 backdrop-blur",
                isCompact ? "text-[9px] px-1.5 py-0" : "text-[11px] px-2 py-0.5",
              ].join(" ")}
            >
              {t}
            </span>
          ))}
        </div>

        {/* 视频播放图标 */}
        {isVideo && (
          <div
            className={[
              "absolute rounded-full bg-black/40 border border-white/10 flex items-center justify-center backdrop-blur",
              isCompact ? "top-1.5 right-1.5 h-6 w-6" : "top-3 right-3 h-9 w-9",
            ].join(" ")}
          >
            <Play className={isCompact ? "h-3 w-3 text-zinc-100" : "h-4 w-4 text-zinc-100"} />
          </div>
        )}

        {/* 底部标题 */}
        <div className={`absolute inset-x-0 bottom-0 ${isCompact ? "p-2" : "p-4"}`}>
          <div className={`font-semibold text-zinc-100 line-clamp-1 ${isCompact ? "text-[11px]" : "text-sm"}`}>
            {data.title}
          </div>
          {!isCompact && (
            <div className="mt-1 text-xs text-zinc-300/80 line-clamp-2">{data.description || ""}</div>
          )}
        </div>

        {/* Hover 操作 */}
        {data.toolType !== "face" ? (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
          <div className={`absolute inset-x-0 bottom-0 ${isCompact ? "p-2" : "p-4"} flex items-center gap-1.5`}>
            <Link href={getUseHref(data.toolType, data.id)} className="flex-1" onClick={handleUseTemplate}>
              <Button className={`w-full ${isCompact ? "h-7 text-xs" : ""}`}><UiText id="common.mcdfd0b34e491" /></Button>
            </Link>
            {!isCompact && (
              <UiProps ids={{"aria-label":["common.mc771248e511f"]}}><Link
                href={getUseHref(data.toolType, data.id)}
                aria-label="common.mc771248e511f"
                className="flex-shrink-0"
                onClick={handleUseTemplate}
              >
                <Button variant="secondary" className="h-10 w-10 p-0">
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link></UiProps>
            )}
          </div>
        </div>
        ) : null}
      </div>
    </Card>
  );
}
