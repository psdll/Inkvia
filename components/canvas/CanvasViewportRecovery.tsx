"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { Panel, useStore } from "@xyflow/react";
import { X } from "lucide-react";
import { getCanvasViewportContent } from "@/lib/canvas/viewport-content";

export function CanvasViewportRecovery({ onReturn, suppressed = false, raised = false }: {
  onReturn: () => void;
  suppressed?: boolean;
  raised?: boolean;
}) {
  const content = useStore(getCanvasViewportContent);
  const [ready, setReady] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (content !== "outside") {
      setReady(false);
      setDismissed(false);
      return;
    }
    // Avoid flashing during a quick pan across a gap between nodes.
    const timer = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(timer);
  }, [content]);

  if (content !== "outside" || !ready || dismissed || suppressed) return null;

  return (
    <Panel
      position="bottom-center"
      data-canvas-viewport-recovery
      style={{ left: "50vw" }}
      className={`nodrag nopan nowheel ${raised ? "!bottom-[124px]" : "!bottom-[72px]"} !m-0 flex h-14 max-w-[calc(100%-24px)] items-center gap-3 whitespace-nowrap rounded-2xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] px-4 text-[13px] font-medium text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)]`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <span role="status"><UiText id="canvas.m2adb7f840c8b" /></span>
      <button type="button" onClick={onReturn} className="h-8 shrink-0 rounded-lg bg-[var(--canvas-controls-active)] px-3 transition-colors hover:bg-[var(--canvas-controls-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--canvas-controls-text)]"><UiText id="canvas.mebd7c6a33eb4" /></button>
      <UiProps ids={{"aria-label":["canvas.m960e42c96f97"],"title":["canvas.md301bc125833"]}}><button type="button" aria-label="canvas.m960e42c96f97" title="canvas.md301bc125833" onClick={() => setDismissed(true)} className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--canvas-controls-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--canvas-controls-text)]"><X className="h-5 w-5" /></button></UiProps>
    </Panel>
  );
}
