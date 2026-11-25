"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { X } from "lucide-react";
import { drawCanvasGenerationEffect } from "./canvas-generation-painter";

export function CanvasGenerationEffect({
  label,
  onCancel,
}: {
  label?: string;
  onCancel?: () => void;
}) {
  const { text } = useUiLocale();
  const progressLabel = label ?? text("workspaceFollowup.m3424dd5017ff");
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let width = 0,
      height = 0,
      elapsed = 900,
      last = 0,
      frame = 0;
    const paint = () => drawCanvasGenerationEffect(ctx, width, height, elapsed);
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || motion.matches) return;
      if (!last || now - last >= 1000 / 30) {
        elapsed += last ? Math.min(now - last, 100) : 0;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (!visible || document.hidden) return;
      paint();
      if (!motion.matches) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      // Layout dimensions stay stable while React Flow zooms the canvas.
      const nextWidth = canvas.clientWidth,
        nextHeight = canvas.clientHeight;
      if (!nextWidth || !nextHeight) return;
      width = nextWidth;
      height = nextHeight;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        1024 / Math.max(width, height),
      );
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      sync();
    };
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    observer?.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div
      data-canvas-generation-status
      className="canvas-generation-effect"
      role="status"
      aria-label={progressLabel}
    >
      <canvas
        ref={ref}
        className="canvas-generation-sweep"
        aria-hidden="true"
      />
      {onCancel && <UiProps ids={{"aria-label":["canvas.mea6aa5fbc2d9"],"title":["canvas.mea6aa5fbc2d9"]}}><button
        type="button"
        className="canvas-generation-cancel nodrag nopan"
        aria-label="canvas.mea6aa5fbc2d9"
        title="canvas.mea6aa5fbc2d9"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onCancel();
        }}
      >
        <X size={14} aria-hidden="true" />
      </button></UiProps>}
    </div>
  );
}
