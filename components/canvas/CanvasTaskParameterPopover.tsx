"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CANVAS_TASK_POPOVER_DISMISS_EVENT } from "@/lib/canvas/task-popover-events";
import { CanvasPanelHiddenContext } from "./canvas-runtime-context";

type CanvasTaskParameterPopoverProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  maxHeight?: number;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "auto";
  className?: string;
};

export function CanvasTaskParameterPopover({
  open,
  anchorRef,
  onClose,
  children,
  width = 360,
  maxHeight = 500,
  align = "start",
  side = "auto",
  className = "",
}: CanvasTaskParameterPopoverProps) {
  const hidden = React.useContext(CanvasPanelHiddenContext);
  React.useEffect(() => { if (hidden && open) onClose(); }, [hidden, open, onClose]);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const lastPosition = React.useRef<string>("");
  const [style, setStyle] = React.useState<React.CSSProperties>({
    position: "fixed",
    left: 12,
    top: 12,
    width,
    maxHeight,
    visibility: "hidden",
    zIndex: "var(--canvas-layer-popover)",
  });

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 8;
    const placeAbove = side !== "bottom";
    const left = align === "center"
      ? rect.left + rect.width / 2 - width / 2
      : align === "end"
        ? rect.right - width
        : rect.left;

    const positionKey = `${left}:${placeAbove ? viewportHeight - rect.top + gap : rect.bottom + gap}:${placeAbove}:${width}:${maxHeight}`;
    if (lastPosition.current === positionKey) return;
    lastPosition.current = positionKey;
    setStyle(placeAbove
      ? {
          position: "fixed",
          left,
          bottom: viewportHeight - rect.top + gap,
          width,
          maxHeight,
          zIndex: "var(--canvas-layer-popover)",
        }
      : {
          position: "fixed",
          left,
          top: rect.bottom + gap,
          width,
          maxHeight,
          zIndex: "var(--canvas-layer-popover)",
        });
  }, [align, anchorRef, maxHeight, side, width]);

  React.useLayoutEffect(() => {
    if (!open || hidden) return;
    updatePosition();
    // Node resizing moves the panel via transforms without resizing the trigger.
    let frame = 0;
    const followAnchor = () => {
      updatePosition();
      frame = window.requestAnimationFrame(followAnchor);
    };
    frame = window.requestAnimationFrame(followAnchor);
    const observer = typeof ResizeObserver === "undefined" || !anchorRef.current
      ? null
      : new ResizeObserver(updatePosition);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [hidden, open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      const element = target instanceof Element ? target : null;
      if (!target || anchorRef.current?.contains(target) || panelRef.current?.contains(target) || element?.closest("[data-frosted-select-menu]")) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-frosted-select-menu]")) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      window.requestAnimationFrame(() => anchorRef.current?.focus());
    };
    const handleCanvasViewportMove = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, handleCanvasViewportMove);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, handleCanvasViewportMove);
    };
  }, [anchorRef, onClose, open]);

  if (!open || hidden || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      data-canvas-task-parameter-portal
      className={`canvas-task-parameter-popover overflow-x-hidden overflow-y-auto ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
