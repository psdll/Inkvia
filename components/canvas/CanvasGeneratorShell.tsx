"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { PromptEditorPortal } from "@/components/ui/prompt-editor-portal";
import { CanvasPanelHiddenContext, CanvasRuntimeContext } from "./canvas-runtime-context";

const PANEL_MODE_EVENT = "canvas-generator-panel-mode-change";
const panelModes = new Map<string, boolean>();

function canAnimatePanel(element: HTMLElement | null) {
  return typeof element?.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function useExpandedPanelMode() {
  const runtime = React.useContext(CanvasRuntimeContext);
  const key = `canvas_generator_expanded_v1_${runtime?.owner ?? "guest"}`;
  const subscribe = React.useCallback((notify: () => void) => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key !== null && event.key !== key) return;
        panelModes.delete(key);
      }
      notify();
    };
    window.addEventListener(PANEL_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PANEL_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);
  const snapshot = React.useCallback(() => {
    if (panelModes.has(key)) return panelModes.get(key)!;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) return stored === "true";
    } catch { /* Keep the mode for this session if storage is unavailable. */ }
    return panelModes.get(key) ?? false;
  }, [key]);
  const expanded = React.useSyncExternalStore(subscribe, snapshot, () => false);
  const setExpanded = React.useCallback((value: boolean) => {
    panelModes.set(key, value);
    try { window.localStorage.setItem(key, String(value)); } catch { /* Session fallback above. */ }
    window.dispatchEvent(new Event(PANEL_MODE_EVENT));
  }, [key]);
  return [expanded, setExpanded] as const;
}

export const CANVAS_GENERATOR_COLLAPSED_WIDTH = 660;
export const CANVAS_GENERATOR_COMPACT_MIN_WIDTH = 420;
export const CANVAS_GENERATOR_COMPACT_MAX_WIDTH = 430;

type CanvasGeneratorShellProps = {
  nodeId: string;
  title: string;
  children: React.ReactNode | ((expanded: boolean) => React.ReactNode);
};

export function CanvasGeneratorShell({ nodeId, title, children }: CanvasGeneratorShellProps) {
  const { text } = useUiLocale();
  const hidden = React.useContext(CanvasPanelHiddenContext);
  const [expanded, setExpanded] = useExpandedPanelMode();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [inlineHost, setInlineHost] = React.useState<HTMLDivElement | null>(null);
  const [dialogHost, setDialogHost] = React.useState<HTMLDivElement | null>(null);
  const [dialogSize, setDialogSize] = React.useState({ width: 800, height: 600 });
  const expandButtonRef = React.useRef<HTMLButtonElement>(null);
  const resizeCleanup = React.useRef<(() => void) | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const [inlineHeight, setInlineHeight] = React.useState<number>();
  const motion = React.useRef<Animation | null>(null);
  const backdropMotion = React.useRef<Animation | null>(null);
  const closing = React.useRef(false);
  const openDialog = () => {
    setInlineHeight(inlineHost?.offsetHeight);
    setDialogOpen(true);
  };
  const closeDialog = React.useCallback(() => {
    if (closing.current) return;
    resizeCleanup.current?.();
    const element = dialogRef.current;
    // Capture an interrupted entry before cancelling it; never scale editor contents.
    const current = element ? window.getComputedStyle(element) : null;
    const transform = current?.transform || "none";
    const opacity = current?.opacity || "1";
    const backdropOpacity = backdropRef.current ? window.getComputedStyle(backdropRef.current).opacity || "1" : "1";
    motion.current?.cancel();
    backdropMotion.current?.cancel();
    const finish = () => {
      closing.current = false;
      setDialogOpen(false);
      setInlineHeight(undefined);
      requestAnimationFrame(() => expandButtonRef.current?.focus({ preventScroll: true }));
    };
    if (!element || !canAnimatePanel(element)) { finish(); return; }
    closing.current = true;
    const animation = element.animate([{ transform, opacity }, { transform: "translateY(8px)", opacity: 0 }], { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" });
    motion.current = animation;
    backdropMotion.current = backdropRef.current?.animate([{ opacity: backdropOpacity }, { opacity: 0 }], { duration: 160, fill: "both" }) ?? null;
    animation.onfinish = finish;
  }, []);
  React.useEffect(() => () => { resizeCleanup.current?.(); motion.current?.cancel(); backdropMotion.current?.cancel(); }, []);
  React.useLayoutEffect(() => {
    if (!dialogOpen || !dialogHost || !dialogRef.current) return;
    const element = dialogRef.current;
    if (!canAnimatePanel(element)) return;
    motion.current = element.animate([
      { transform: "translateY(8px)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    backdropMotion.current = backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }) ?? null;
    return () => { motion.current?.cancel(); backdropMotion.current?.cancel(); };
  }, [dialogOpen, dialogHost]);
  React.useEffect(() => {
    if (dialogOpen && dialogHost) expandButtonRef.current?.focus({ preventScroll: true });
  }, [dialogOpen, dialogHost]);
  const beginResize = (direction: string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current?.();
    const start = { x: event.clientX, y: event.clientY, width: dialogHost?.offsetWidth || dialogSize.width, height: dialogHost?.offsetHeight || dialogSize.height };
    const pointerId = event.pointerId;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = direction.includes("e") ? 1 : direction.includes("w") ? -1 : 0;
      const dy = direction.includes("s") ? 1 : direction.includes("n") ? -1 : 0;
      setDialogSize({
        width: Math.min(window.innerWidth - 32, Math.max(660, start.width + (next.clientX - start.x) * dx * 2)),
        height: Math.min(window.innerHeight - 32, Math.max(360, start.height + (next.clientY - start.y) * dy * 2)),
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      resizeCleanup.current = null;
    };
    resizeCleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
  };
  const stopCanvasEvent = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <>
    <div ref={setInlineHost} style={{ height: inlineHeight }} />
    {dialogOpen && inlineHost && createPortal(
      <div data-canvas-generator-dialog className="fixed inset-0 z-[1000] flex items-center justify-center" onPointerDown={stopCanvasEvent} onClick={stopCanvasEvent} onWheel={stopCanvasEvent} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && !document.querySelector("[data-prompt-asset-menu-portal],[data-role-skill-slash-menu-portal],[data-canvas-creative-dialog]")) {
          event.preventDefault();
          closeDialog();
        }
      }}>
        <div ref={backdropRef} className="absolute inset-0 bg-[var(--overlay)]" onClick={(event) => {
          event.stopPropagation();
          closeDialog();
        }} />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={text("workspaceFollowup.mfed4393ff393", { v0: title })} className="relative" style={{ transformOrigin: "top left", width: dialogSize.width, height: dialogSize.height, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 32px)" }}>
          <div ref={setDialogHost} className="h-full" />
          {["n", "ne", "e", "se", "s", "sw", "w", "nw"].map(direction => <div key={direction} aria-hidden="true" data-canvas-generator-resize={direction} className="canvas-generator-resize-handle" onPointerDown={event => beginResize(direction, event)} />)}
        </div>
      </div>, document.body)}
    <PromptEditorPortal target={dialogOpen ? dialogHost : inlineHost}>
    <div
      data-canvas-generator-panel={nodeId}
      data-canvas-generator-expanded={expanded || undefined}
      role="region"
      aria-label={text("workspaceFollowup.m05ea366739fe", { v0: title })}
      aria-hidden={hidden && !dialogOpen || undefined}
      className={`canvas-generator-shell nodrag${expanded || dialogOpen ? " canvas-generator-shell--expanded" : ""}${dialogOpen ? " canvas-generator-dialog" : ""}`}
      style={{ visibility: hidden && !dialogOpen ? "hidden" : undefined, pointerEvents: hidden && !dialogOpen ? "none" : undefined }}
      onPointerDown={stopCanvasEvent}
      onClick={stopCanvasEvent}
      onContextMenu={stopCanvasEvent}
    >
      <UiProps ids={{"aria-label":["canvas.mf05b5d3088c2","canvas.m1da317f22768"]}}><button
        ref={expandButtonRef}
        type="button"
        aria-label={dialogOpen ? "canvas.mf05b5d3088c2" : "canvas.m1da317f22768"}
        onClick={() => dialogOpen ? closeDialog() : openDialog()}
        className="canvas-generator-expand-button"
      >
        {dialogOpen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button></UiProps>
      {!dialogOpen && <UiProps ids={{"aria-label":["canvas.mbf1a752bc737","canvas.mbcbce775231d"]}}><button
        type="button"
        aria-label={expanded ? "canvas.mbf1a752bc737" : "canvas.mbcbce775231d"}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="canvas-generator-corner-button"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d={expanded ? "M12 4H4v8" : "M4 12h8V4"} stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button></UiProps>}
      {typeof children === "function" ? children(expanded || dialogOpen) : children}
    </div>
    </PromptEditorPortal>
    </>
  );
}
