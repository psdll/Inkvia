"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { MediaImage } from "@/components/ui/media-image";

export type MediaCompareLightboxProps = {
  open: boolean;
  srcs: string[];
  title?: string;
  onClose: () => void;
};

function inferKind(src: string): "image" | "video" {
  const s = src.toLowerCase();
  if (s.endsWith(".mp4") || s.endsWith(".webm") || s.endsWith(".mov") || s.endsWith(".m4v")) return "video";
  return "image";
}

export function MediaCompareLightbox({ open, srcs, title, onClose }: MediaCompareLightboxProps) {
  const { text } = useUiLocale();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const close = React.useCallback(() => {
    onClose();
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  const validSrcs = srcs.filter((s) => typeof s === "string" && s.length > 0);
  const count = validSrcs.length;

  const gridClass =
    count <= 2
      ? "grid grid-cols-1 lg:grid-cols-2 gap-px"
      : count === 3
        ? "grid grid-cols-1 lg:grid-cols-3 gap-px"
        : "grid grid-cols-2 lg:grid-cols-3 gap-px";

  const modal =
    open && count >= 2 ? (
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/60" onClick={close} />
        <div className="absolute inset-0 p-4 lg:p-6 flex items-center justify-center">
          <div className="relative w-full max-w-[1200px] max-h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-3rem)] rounded-[28px] border border-white/12 bg-white/[0.06] backdrop-blur-2xl ring-1 ring-white/8 shadow-[0_40px_120px_rgba(0,0,0,0.65)] overflow-hidden flex flex-col">
            <div className="h-[56px] px-5 flex items-center justify-between border-b border-white/10 bg-white/[0.04]">
              <div className="text-white/90 font-semibold text-sm truncate">
                {(title || text("createDynamic.m512152a793bf")) + ` (${count})`}
              </div>
              <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                type="button"
                onClick={close}
                className="h-10 w-10 rounded-2xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.10] hover:text-white transition flex items-center justify-center"
                aria-label="common.m3fd47edce45b"
              >
                <X className="h-5 w-5" />
              </button></UiProps>
            </div>
            <div className="flex-1 min-h-0 bg-black/30 overflow-y-auto">
              <div className="p-4">
                <div className={gridClass}>
                  {validSrcs.map((src, idx) => (
                    <div
                      key={`${idx}-${src}`}
                      className={[
                        "w-full h-[38dvh] lg:h-[60dvh] min-w-0 overflow-hidden flex items-center justify-center",
                        count === 2 ? (idx % 2 === 0 ? "lg:justify-end" : "lg:justify-start") : ""
                      ].join(" ")}
                    >
                      {inferKind(src) === "video" ? (
                        <AppVideoPlayer
                          src={src}
                          muted
                          playsInline
                          compact
                          className="h-full w-full object-contain"
                          containerClassName="h-full w-full max-h-full max-w-full"
                        />
                      ) : (
                        <MediaImage src={src} alt="" className="media-fit" loading="eager" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  if (!mounted) return null;
  return modal ? createPortal(modal, document.body) : null;
}
