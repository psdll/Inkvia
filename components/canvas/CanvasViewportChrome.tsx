"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { useCanvasAppearance } from "./CanvasAppearance";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { ChevronDown, Focus, Magnet, Map, Minus, Plus } from "lucide-react";
import { CanvasViewportRecovery } from "./CanvasViewportRecovery";
import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_STEP,
  parseCanvasZoomPercent,
  getCanvasDotGap,
  getCanvasViewportAnimationDuration,
} from "@/lib/canvas/visual-policy";

const ZOOM_DURATION_MS = 200;
const PRESET_DURATION_MS = 300;

function stopCanvasEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function CanvasViewportChrome({ onViewportCommit, hideRecoveryHint = false, raiseRecoveryHint = false, edgesHidden = false, snapToGrid = true, onToggleEdges, onToggleSnap }: {
  onViewportCommit?: (viewport: CanvasDocumentV2["viewport"]) => void;
  hideRecoveryHint?: boolean;
  raiseRecoveryHint?: boolean;
  edgesHidden?: boolean;
  snapToGrid?: boolean;
  onToggleEdges?: () => void;
  onToggleSnap?: () => void;
}) {
  const { value: appearance } = useCanvasAppearance();
  const flow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const viewportControlsRef = React.useRef<HTMLDivElement>(null);
  const zoomMenuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [minimapVisible, setMinimapVisible] = React.useState(false);
  const [editingPercent, setEditingPercent] = React.useState(false);
  const cancelPercentRef = React.useRef(false);
  const [percentDraft, setPercentDraft] = React.useState(() => String(Math.round(zoom * 100)));
  const gap = getCanvasDotGap(zoom);
  const percent = Math.round(zoom * 100);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (viewportControlsRef.current?.contains(event.target as globalThis.Node)) return;
      setMenuOpen(false);
    };
    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      window.requestAnimationFrame(() => zoomMenuTriggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleMenuKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleMenuKeyDown, true);
    };
  }, [menuOpen]);

  const commitViewportAfter = React.useCallback((operation: Promise<unknown>) => {
    void operation.then(() => onViewportCommit?.(flow.getViewport()));
  }, [flow, onViewportCommit]);

  const zoomDuration = React.useCallback((duration: number) => getCanvasViewportAnimationDuration(
    flow.getNodes().length, flow.getEdges().length,
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, duration,
  ), [flow]);

  const commitPercent = React.useCallback(() => {
    if (cancelPercentRef.current) {
      cancelPercentRef.current = false;
      setEditingPercent(false);
      setPercentDraft(String(Math.round(flow.getZoom() * 100)));
      return;
    }
    const next = parseCanvasZoomPercent(percentDraft, Math.round(flow.getZoom() * 100));
    setEditingPercent(false);
    setPercentDraft(String(next));
    commitViewportAfter(flow.zoomTo(next / 100, { duration: zoomDuration(ZOOM_DURATION_MS) }));
  }, [commitViewportAfter, flow, percentDraft, zoomDuration]);

  const zoomOut = React.useCallback(() => {
    commitViewportAfter(flow.zoomTo(Math.max(CANVAS_MIN_ZOOM, flow.getZoom() / CANVAS_ZOOM_STEP), { duration: 0 }));
  }, [commitViewportAfter, flow]);

  const zoomIn = React.useCallback(() => {
    // Each click starts from the live viewport. Animated steps used an
    // intermediate render value, so a quick second click lost most of a step.
    commitViewportAfter(flow.zoomTo(Math.min(CANVAS_MAX_ZOOM, flow.getZoom() * CANVAS_ZOOM_STEP), { duration: 0 }));
  }, [commitViewportAfter, flow]);

  const zoomPreset = React.useCallback((value: number) => {
    setMenuOpen(false);
    commitViewportAfter(flow.zoomTo(value, { duration: zoomDuration(PRESET_DURATION_MS) }));
  }, [commitViewportAfter, flow, zoomDuration]);

  const fitView = React.useCallback(() => {
    setMenuOpen(false);
    commitViewportAfter(flow.fitView({ padding: 0.12, duration: zoomDuration(PRESET_DURATION_MS) }));
  }, [commitViewportAfter, flow, zoomDuration]);

  return (
    <>
      {appearance.pattern !== "solid" && <Background
        variant={appearance.pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
        gap={appearance.pattern === "grid" ? 12 / zoom : gap}
        size={1}
        lineWidth={appearance.pattern === "grid" ? 0.6 : 1}
        color={appearance.pattern === "grid" ? "color-mix(in srgb, var(--canvas-bg-dot) 24%, transparent)" : "var(--canvas-bg-dot)"}
      />}
      <CanvasViewportRecovery onReturn={fitView} suppressed={hideRecoveryHint} raised={raiseRecoveryHint} />

      <Panel position="bottom-left" className="!bottom-3 !left-3 !m-0">
        <div
          ref={viewportControlsRef}
          data-canvas-viewport-controls
          className="relative flex items-center gap-1 rounded-xl border border-[var(--canvas-controls-border)] bg-[color-mix(in_srgb,var(--canvas-controls-bg)_65%,transparent)] p-1 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] backdrop-blur-md"
          onPointerDown={stopCanvasEvent}
          onDoubleClick={stopCanvasEvent}
          onWheel={stopCanvasEvent}
        >
          <UiProps ids={{"aria-label":["canvas.ma13155621432"]}}><button
            type="button"
            aria-label="canvas.ma13155621432"
            disabled={zoom <= CANVAS_MIN_ZOOM}
            onClick={zoomOut}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--canvas-controls-hover)] disabled:opacity-35"
          >
            <Minus className="h-4 w-4" />
          </button></UiProps>

          <label className="flex h-8 items-center rounded-lg px-1 hover:bg-[var(--canvas-controls-hover)] focus-within:bg-[var(--canvas-controls-active)]">
            <span className="sr-only"><UiText id="canvas.m8d21c0d6d9f2" /></span>
            <UiProps ids={{"aria-label":["canvas.m8d21c0d6d9f2"]}}><input
              aria-label="canvas.m8d21c0d6d9f2"
              inputMode="decimal"
              value={editingPercent ? percentDraft : String(percent)}
              onFocus={(event) => {
                setPercentDraft(event.currentTarget.value);
                setEditingPercent(true);
              }}
              onChange={(event) => setPercentDraft(event.target.value)}
              onBlur={commitPercent}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelPercentRef.current = true;
                  event.currentTarget.blur();
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="w-9 bg-transparent text-right text-[13px] tabular-nums outline-none"
            /></UiProps>
            <span className="pr-0.5 text-[13px]">%</span>
          </label>

          <UiProps ids={{"aria-label":["canvas.m21996b74f2de"]}}><button
            ref={zoomMenuTriggerRef}
            type="button"
            aria-label="canvas.m21996b74f2de"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-8 w-6 items-center justify-center rounded-lg text-[var(--canvas-controls-text-muted)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-controls-text)]"
          >
            <ChevronDown className="h-3 w-3" />
          </button></UiProps>

          <UiProps ids={{"aria-label":["canvas.mc6c87ee566a0"]}}><button
            type="button"
            aria-label="canvas.mc6c87ee566a0"
            disabled={zoom >= CANVAS_MAX_ZOOM}
            onClick={zoomIn}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--canvas-controls-hover)] disabled:opacity-35"
          >
            <Plus className="h-4 w-4" />
          </button></UiProps>

          <span className="mx-1 h-5 w-px bg-[var(--canvas-controls-border)]" aria-hidden="true" />

          <UiProps ids={{"aria-label":["canvas.m9cd6228c5bcc"]}}><button
            type="button"
            aria-label="canvas.m9cd6228c5bcc"
            onClick={fitView}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--canvas-controls-hover)]"
          >
            <Focus className="h-4 w-4" />
          </button></UiProps>

          <UiProps ids={{"aria-label":["canvas.mc1586a57bd25","canvas.mf5df91015c1a"]}}><button
            type="button"
            aria-label={minimapVisible ? "canvas.mc1586a57bd25" : "canvas.mf5df91015c1a"}
            aria-pressed={minimapVisible}
            onClick={() => setMinimapVisible((visible) => !visible)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--canvas-controls-hover)] ${minimapVisible ? "bg-[var(--canvas-controls-active)]" : ""}`}
          >
            <Map className="h-4 w-4" />
          </button></UiProps>

          <UiProps ids={{"label":["canvas.m55b0d7d2ecae","canvas.m7bc78092ebc9"]}}><ViewportToggle label={edgesHidden ? "canvas.m55b0d7d2ecae" : "canvas.m7bc78092ebc9"} pressed={edgesHidden} onClick={onToggleEdges}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M9.28 0a2.28 2.28 0 1 1-2.22 2.8h-4.5a1.52 1.52 0 1 0 0 3.03h6.42a2.57 2.57 0 0 1 0 5.14h-4.5a2.28 2.28 0 1 1 0-1.05h4.5a1.52 1.52 0 0 0 0-3.04H2.57a2.57 2.57 0 0 1 0-5.13h4.5C7.3.75 8.2 0 9.26 0m-7 9.22a1.23 1.23 0 1 0 0 2.45 1.23 1.23 0 0 0 0-2.45m7-8.17a1.22 1.22 0 1 0 0 2.45 1.22 1.22 0 0 0 0-2.45" fill="currentColor" transform="translate(2.225 1.64)" />
              {edgesHidden && <path d="m1 1 14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />}
            </svg>
          </ViewportToggle></UiProps>
          <UiProps ids={{"label":["canvas.m1596f75dfcf2"]}}><ViewportToggle label="canvas.m1596f75dfcf2" pressed={snapToGrid} onClick={onToggleSnap}>
            <span className="relative flex h-3.5 w-3.5 items-center justify-center">
              <Magnet className="h-3.5 w-3.5" />
              {!snapToGrid && <svg aria-hidden="true" className="absolute inset-0" width="14" height="14" viewBox="0 0 14 14"><path d="m1 1 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" /></svg>}
            </span>
          </ViewportToggle></UiProps>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+8px)] left-9 min-w-[180px] rounded-xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-1.5 text-[13px] shadow-[var(--canvas-shadow-menu)] backdrop-blur-2xl"
            >
              {[0.5, 1, 8].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitem"
                  onClick={() => zoomPreset(value)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 hover:bg-[var(--canvas-controls-hover)]"
                >
                  <span>{Math.round(value * 100)}%</span>
                  {Math.round(value * 100) === percent ? <span className="text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.mcb62ebd689ee" /></span> : null}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={fitView}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--canvas-controls-hover)]"
              >
                <Focus className="h-4 w-4" /><UiText id="canvas.ma2602e63c435" /></button>
            </div>
          ) : null}
        </div>
      </Panel>

      {minimapVisible ? (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          bgColor="var(--canvas-minimap-bg)"
          maskColor="var(--canvas-minimap-mask)"
          maskStrokeColor="var(--canvas-minimap-mask-stroke)"
          maskStrokeWidth={1}
          nodeColor="var(--canvas-minimap-node)"
          nodeStrokeColor="var(--canvas-node-border-selected)"
          nodeStrokeWidth={1}
          style={{ width: 150, height: 110 }}
          className="!bottom-3 !right-3 !m-0 !overflow-hidden !rounded-xl !border !border-[var(--canvas-controls-border)] !shadow-[var(--canvas-shadow-dropdown)]"
        />
      ) : null}
    </>
  );
}

function ViewportToggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick?: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}
    className="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--canvas-controls-icon)] transition-colors hover:bg-[var(--canvas-controls-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--canvas-controls-text)]">
    {children}
    <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] px-2 py-1 text-xs text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] group-hover:block group-focus-visible:block">
      {label}<span aria-hidden="true" className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)]" />
    </span>
  </button>;
}
