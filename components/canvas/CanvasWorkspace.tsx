"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { CanvasAppearance } from "./CanvasAppearance";
import { CanvasTitleBar } from "./CanvasTitleBar";
import type CanvasLibraryPanelType from "./CanvasLibraryPanel";
import type CanvasWorkflowPanelType from "./CanvasWorkflowPanel";

const CanvasLibraryPanel = dynamic(() => import("./CanvasLibraryPanel"), { ssr: false });
const CanvasWorkflowPanel = dynamic(() => import("./CanvasWorkflowPanel"), { ssr: false });

// The editor and admin observer use one layout. Data/session ownership stays outside.
export function CanvasWorkspace({ ownerId, canvasId, titleBar, board, workflow, library, progress, busy }: {
  ownerId: number;
  canvasId: number;
  titleBar?: React.ComponentProps<typeof CanvasTitleBar>;
  board: React.ReactNode;
  workflow?: React.ComponentProps<typeof CanvasWorkflowPanelType>;
  library?: React.ComponentProps<typeof CanvasLibraryPanelType>;
  progress?: string;
  busy?: boolean;
}) {
  return <CanvasAppearance ownerId={ownerId} canvasId={canvasId}>
    {titleBar && <CanvasTitleBar key={canvasId} {...titleBar} />}
    <div className="relative min-w-0 flex-1">
      {board}
      {workflow && <CanvasWorkflowPanel {...workflow} />}
    </div>
    {progress && <div role="status" aria-live="polite" className="absolute bottom-24 left-1/2 z-[90] flex max-w-[80vw] -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] px-4 py-2 text-xs text-[var(--app-fg)] shadow-lg">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{progress}
    </div>}
    {library && <CanvasLibraryPanel key={`${ownerId}:${canvasId}`} {...library} />}
  </CanvasAppearance>;
}
