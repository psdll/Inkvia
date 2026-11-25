"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowLeft, Expand, Loader2, Minimize2, RefreshCw } from "lucide-react";
import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";
import { CanvasWorkspace } from "@/components/canvas/CanvasWorkspace";
import { CanvasReadOnlyContext, CanvasObserverContext } from "@/components/canvas/CanvasReadOnlyContext";
import { loadAdminCanvas, peekAdminCanvas, type AdminCanvasDocument } from "@/lib/admin-canvas-cache";
import { CanvasBootstrapError } from "@/lib/canvas/bootstrap-client";
import { readCanvasViewportPreference, writeCanvasViewportPreference } from "@/lib/canvas/viewport-preference";
import type { CanvasViewport } from "@/lib/canvas/document";
import { compactCanvasAudioNodeSizes } from "@/lib/canvas/media-size";
import { detachWorkflowExecution, selectCanvasSubgraph } from "@/lib/canvas/transfer";
import type { WorkflowExportScope } from "@/components/canvas/CanvasWorkflowPanel";

const button = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-40";
const denyWrite = async () => { throw new Error("管理员查看模式不会修改用户画布"); };
const noop = () => {};

export default function UserCanvasViewer({ adminKey, canvasId, userName, onBack }: { adminKey: string; canvasId: number; userName: string; onBack: () => void }) {
  const { error: uiError } = useUiLocale();
  const [queryClient] = React.useState(() => new QueryClient());
  React.useEffect(() => () => queryClient.clear(), [queryClient]);
  const [snapshot, setSnapshot] = React.useState<AdminCanvasDocument | undefined>(() => peekAdminCanvas(adminKey, canvasId));
  const [loading, setLoading] = React.useState(!snapshot);
  const [error, setError] = React.useState("");
  const [full, setFull] = React.useState(true);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [workflowSelection, setWorkflowSelection] = React.useState<string[] | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ nodeId: string; requestId: number } | null>(null);
  const [progress, setProgress] = React.useState("");
  const workflowAnchorRef = React.useRef<HTMLButtonElement>(null);
  const sequence = React.useRef(0);
  const alive = React.useRef(true);
  const download = React.useRef<AbortController | null>(null);
  // Preferences and query caches belong to the observer, never the user's editor.
  const preferenceOwnerId = -Number(adminKey.split(":")[1]);
  const initial = React.useMemo(() => {
    if (!snapshot) return undefined;
    const document = compactCanvasAudioNodeSizes(snapshot.document);
    const viewport = readCanvasViewportPreference(window.localStorage, preferenceOwnerId, canvasId);
    return viewport ? { ...document, viewport } : document;
  }, [snapshot, preferenceOwnerId, canvasId]);
  const rememberViewport = React.useCallback((viewport: CanvasViewport) => {
    writeCanvasViewportPreference(window.localStorage, preferenceOwnerId, canvasId, viewport);
  }, [preferenceOwnerId, canvasId]);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; download.current?.abort(); }; }, []);
  const reload = React.useCallback(async (force = false) => {
    const request = ++sequence.current;
    setLoading(true); setError("");
    try {
      const next = await loadAdminCanvas(adminKey, canvasId, force);
      if (!alive.current || request !== sequence.current) return;
      setSnapshot(previous => previous?.revision === next.revision && previous.title === next.title ? previous : next);
    } catch (cause) {
      if (alive.current && request === sequence.current) {
        setError((cause as Error).message);
        if (cause instanceof CanvasBootstrapError && [401, 403, 404].includes(cause.status)) setSnapshot(undefined);
      }
    } finally { if (alive.current && request === sequence.current) setLoading(false); }
  }, [adminKey, canvasId]);
  React.useEffect(() => { void reload(); }, [reload]);
  const exportWorkflow = async (scope: WorkflowExportScope, format: "zip" | "library") => {
    if (format !== "zip") return denyWrite();
    if (!snapshot || download.current) return;
    const controller = new AbortController(); download.current = controller;
    try {
      const { createWorkflowArchive } = await import("@/lib/canvas/workflow-archive");
      const exported = detachWorkflowExecution(scope === "selected" ? selectCanvasSubgraph(snapshot.document, workflowSelection || []) : snapshot.document);
      const blob = await createWorkflowArchive(exported, message => { if (alive.current) setProgress(message); }, { signal: controller.signal, concurrency: 2 });
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `${(snapshot.title || "canvas").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.canvas.zip`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { download.current = null; if (alive.current) setProgress(""); }
  };
  return <QueryClientProvider client={queryClient}><CanvasObserverContext.Provider value={adminKey}><CanvasReadOnlyContext.Provider value>
    <div className={full ? "fixed inset-0 z-[110] flex flex-col bg-[var(--app-bg)]" : "flex h-full min-h-0 flex-col bg-[var(--app-bg)]"}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
        <button type="button" className={button} onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /><UiText id="admin.me9d5ca6c1406" /></button>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-muted)]">{userName}<UiText id="admin.m38fbd757f731" /></span>
        <button type="button" className={button} disabled={loading} onClick={() => void reload(true)}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /><UiText id="admin.maee887434131" /></button>
        <button type="button" className={button} onClick={() => setFull(value => !value)}>{full ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}{full ? <UiText id="admin.m0f1505b6ad3f" /> : <UiText id="admin.m22ea3f47fee8" />}</button>
      </div>
      {error && <p role="alert" className="px-4 py-2 text-sm text-[var(--error-fg)]">{uiError(error)}</p>}
      {snapshot && initial ? <CanvasWorkspace key={`${adminKey}:${canvasId}`} ownerId={preferenceOwnerId} canvasId={canvasId}
        titleBar={{ title: snapshot.title, onRename: noop, onArrange: noop, arrangeDisabled: true }}
        board={<SmartCanvasBoard readOnly canvasId={canvasId} editorSessionId="" preferenceOwnerId={preferenceOwnerId} initial={initial} onViewportCommit={rememberViewport} focusRequest={focusRequest} onBeforeServerRun={denyWrite} workflowAnchorRef={workflowAnchorRef} onOpenWorkflow={setWorkflowSelection} onCloseWorkflow={() => setWorkflowSelection(null)} workflowOpen={workflowSelection !== null} onToggleLibrary={() => setLibraryOpen(value => !value)} libraryOpen={libraryOpen} />}
        workflow={workflowSelection ? { anchorRef: workflowAnchorRef, totalCount: snapshot.document.nodes.length, selectedCount: workflowSelection.length, onClose: () => setWorkflowSelection(null), onExport: exportWorkflow, onImport: denyWrite } : undefined}
        library={libraryOpen ? { ownerId: preferenceOwnerId, canvasId, nodes: snapshot.document.nodes, onLocateNode: nodeId => setFocusRequest({ nodeId, requestId: Date.now() }), onClose: () => setLibraryOpen(false) } : undefined}
        progress={progress} busy={Boolean(progress)}
      /> : loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : null}
    </div>
  </CanvasReadOnlyContext.Provider></CanvasObserverContext.Provider></QueryClientProvider>;
}
