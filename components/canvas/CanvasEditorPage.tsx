"use client";

import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import type { CanvasArrangeOptions } from "@/lib/canvas/arrangement";
import dynamic from "next/dynamic";
import { CloudAlert, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { useCanvasLibraryPreviewWarmup } from "@/components/canvas/use-canvas-library-preview-warmup";
import { useCanvasLibraryCacheWarmup } from "@/components/canvas/canvas-library-cache";
import { CanvasSessionExpiredModal } from "@/components/canvas/CanvasSessionExpiredModal";
import CanvasAgentWindow, { CanvasAgentLauncher } from "@/components/creative-agent/CanvasAgentWindow";
import { getCreativeAgentSelection } from "@/lib/creative-agent/canvas-selection";
import { getReferencePreview } from "@/components/creative-agent/reference-preview";
import { CanvasWorkspace } from "@/components/canvas/CanvasWorkspace";
import type { WorkflowExportScope, WorkflowImportMode } from "@/components/canvas/CanvasWorkflowPanel";
import { useCanvasMiniMaxVoiceWarmup } from "@/components/canvas/use-canvas-minimax-voices";
import type { CreativeAgentBoardBridge, CreativeAgentCanvasContext, CreativeAgentSelection } from "@/lib/creative-agent/contracts";
import { mergeCreativeAgentCanvasDocuments } from "@/lib/creative-agent/canvas-history";
import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { loadCanvasBootstrap } from "@/lib/canvas/bootstrap-client";
import { loadCanvasForEntry } from "@/lib/client/canvas-entry";
import { createCanvasDocumentMutation, diffCanvasDocumentsToOperations } from "@/lib/canvas/document-diff";
import { createCanvasDraftJournal, createIndexedDbCanvasDraftDriver } from "@/lib/canvas/draft-store";
import { CanvasMutationHttpError, submitCanvasDocumentChange } from "@/lib/canvas/mutation-client";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/operations";
import { pruneCanvasDeletedGenerations } from "@/lib/generation-deletion";
import { getKnownDeletedGenerationIds, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { rebaseCanvasOperations } from "@/lib/canvas/rebase";
import { claimCanvasTabIdentity } from "@/lib/canvas/tab-identity";
import { claimCanvasEditorSession } from "@/lib/canvas/editor-session";
import { collectCanvasImportRefs } from "@/lib/canvas/import-refs";
import type { CanvasUndoMediaRef } from "@/lib/canvas/undo-media";
import { uploadCanvasMedia } from "@/lib/canvas/media-upload-client";
import { removeCanvasMissingMediaNodes } from "@/lib/canvas/missing-media";
import { compactCanvasAudioNodeSizes } from "@/lib/canvas/media-size";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateCanvasGenerationHistory } from "./use-canvas-generation-history";
import { applyCanvasBrowserTitle, DEFAULT_CANVAS_TITLE, normalizeCanvasTitle } from "@/lib/canvas/title";
import { readCanvasViewportPreference, writeCanvasViewportPreference } from "@/lib/canvas/viewport-preference";
import { appendCanvasDocument, selectCanvasSubgraph, detachWorkflowExecution } from "@/lib/canvas/transfer";
import { createWorkflowArchive, readWorkflowFile } from "@/lib/canvas/workflow-archive";
import {
  mergeCanvasDocuments,
  resolveCanvasMergeConflicts,
  type CanvasMergeDecision,
  type CanvasMergeResult,
} from "@/lib/canvas/merge";


const CanvasAgentPanel = dynamic(() => import("@/components/creative-agent/CanvasAgentPanel"), { ssr: false });

const loadSmartCanvasBoard = () => import("@/components/canvas/SmartCanvasBoard");

const SmartCanvasBoard = dynamic(loadSmartCanvasBoard, {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[var(--app-muted)]"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type ConflictState = { result: CanvasMergeResult; remote: CanvasDocumentV2; remoteRevision: string; incremental?: boolean };

function sameDocument(left: CanvasDocumentV2, right: CanvasDocumentV2) {
  // Compare the fields the mutation protocol persists, not JSON/property or render order.
  return diffCanvasDocumentsToOperations(left, right).length === 0;
}

function reportCanvasIncrement(name: "canvas_rebase_auto_total" | "canvas_rebase_manual_total" | "canvas_idb_failure_total") {
  void fetch("/api/canvas/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ increments: [{ name, value: 1 }] }),
  }).catch(() => undefined);
}

function createCanvasUndoSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default function CanvasEditorPage({ canvasId }: { canvasId: number }) {
  const { error: uiError } = useUiLocale();
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const queryClient = useQueryClient();
  const authUserId = user?.id;
  const [title, setTitle] = React.useState(DEFAULT_CANVAS_TITLE);
  const titleRef = React.useRef(title);
  const arrangeActionRef = React.useRef<((options: CanvasArrangeOptions) => void) | null>(null);
  const [arrangePreviewActive, setArrangePreviewActive] = React.useState(false);
  const [document, setDocument] = React.useState<CanvasDocumentV2 | null>(null);
  const [hasSettledInitialLoad, setHasSettledInitialLoad] = React.useState(false);
  const [editorVersion, setEditorVersion] = React.useState(0);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState("");
  const [conflict, setConflict] = React.useState<ConflictState | null>(null);
  const [sessionExpired, setSessionExpired] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [agentEnabled, setAgentEnabled] = React.useState(false);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [agentRunning, setAgentRunning] = React.useState(false);
  const [agentDockWidth, setAgentDockWidth] = React.useState(0);
  const [agentSelection, setAgentSelection] = React.useState<CreativeAgentSelection>({ nodeIds: [], edgeIds: [], references: [] });
  const agentBridgeRef = React.useRef<CreativeAgentBoardBridge | null>(null);
  const desktopBoardBridgeRef = React.useRef<CreativeAgentBoardBridge | null>(null);
  const canvasHostRef = React.useRef<HTMLDivElement>(null);
  const agentSyncingRef = React.useRef(false);
  const agentConflictRef = React.useRef(false);
  const agentRefreshRef = React.useRef<Promise<void>>(Promise.resolve());
  React.useEffect(() => {
    if (authLoading || !authUserId) return;
    let disposed = false;
    setAgentEnabled(false);
    setAgentOpen(false);
    setAgentRunning(false);
    void fetch("/api/creative-agent/capabilities").then(async response => {
      const capabilities = response.ok ? await response.json() : null;
      if (disposed || capabilities?.enabled !== true) return;
      setAgentEnabled(true);
      if (["open", "1"].includes(new URLSearchParams(window.location.search).get("agent") || "")) {
        setLibraryOpen(false);
        setAgentOpen(true);
      }
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [authLoading, authUserId, canvasId]);
  const [liveNodes, setLiveNodes] = React.useState<CanvasDocumentV2["nodes"] | null>(null);
  // Optional panel warmups must not compete with the first canvas frame.
  const [warmupsReady, setWarmupsReady] = React.useState(false);
  React.useEffect(() => {
    if (!hasSettledInitialLoad || !document) return;
    const timer = window.setTimeout(() => setWarmupsReady(true), 1500);
    return () => window.clearTimeout(timer);
  }, [hasSettledInitialLoad, Boolean(document)]);
  useCanvasMiniMaxVoiceWarmup(Boolean(warmupsReady && authUserId && document?.nodes.some(node => node.data.kind === "audioTask")));
  useCanvasLibraryPreviewWarmup(warmupsReady ? liveNodes ?? document?.nodes : null);
  useCanvasLibraryCacheWarmup(authUserId, Boolean(warmupsReady && document));
  const [focusRequest, setFocusRequest] = React.useState<{ nodeId: string; requestId: number } | null>(null);
  const workflowAnchorRef = React.useRef<HTMLButtonElement>(null);
  const workflowRunningRef = React.useRef(false);
  const [workflowBusy, setWorkflowBusy] = React.useState(false);
  const [workflowProgress, setWorkflowProgress] = React.useState("");
  React.useEffect(() => {
    if (workflowBusy || !workflowProgress) return;
    const timer = window.setTimeout(() => setWorkflowProgress(""), 6000);
    return () => window.clearTimeout(timer);
  }, [workflowBusy, workflowProgress]);
  const runWorkflowTransfer = React.useCallback(async (action: () => Promise<void>, success: string) => {
    if (workflowRunningRef.current) throw new Error("已有工作流正在处理，请稍候");
    workflowRunningRef.current = true;
    setWorkflowBusy(true);
    setWorkflowProgress("正在准备工作流");
    try { await action(); setWorkflowProgress(success); }
    catch (error) { setWorkflowProgress(String((error as Error)?.message || error)); throw error; }
    finally { workflowRunningRef.current = false; setWorkflowBusy(false); }
  }, []);
  const [workflowSelection, setWorkflowSelection] = React.useState<string[] | null>(null);
  const [decisions, setDecisions] = React.useState<Record<string, CanvasMergeDecision>>({});
  const baseRef = React.useRef<CanvasDocumentV2 | null>(null);
  const baseTitleRef = React.useRef(DEFAULT_CANVAS_TITLE);
  const revisionRef = React.useRef("1");
  const clientSequenceRef = React.useRef(0);
  const currentRef = React.useRef<CanvasDocumentV2 | null>(null);
  const pendingRef = React.useRef<CanvasDocumentV2 | null>(null);
  const savingRef = React.useRef(false);
  const saveErrorRef = React.useRef("");
  const saveTimer = React.useRef<number | undefined>(undefined);
  const journalRef = React.useRef<ReturnType<typeof createCanvasDraftJournal> | null>(null);
  const drainRef = React.useRef<() => Promise<void>>(async () => undefined);
  const conflictDraftIdsRef = React.useRef<string[]>([]);
  const undoSessionIdRef = React.useRef(createCanvasUndoSessionId());
  const undoHeldRefsRef = React.useRef<CanvasUndoMediaRef[]>([]);
  const undoCurrentRefsRef = React.useRef<CanvasUndoMediaRef[]>([]);
  const undoRefsSignatureRef = React.useRef("");
  const undoSyncRef = React.useRef<Promise<boolean>>(Promise.resolve(true));
  const editorSessionIdRef = React.useRef("");
  const sessionExpiredRef = React.useRef(false);

  const restoreStoredViewport = React.useCallback((candidate: CanvasDocumentV2) => {
    if (!authUserId) return candidate;
    const viewport = readCanvasViewportPreference(window.localStorage, authUserId, canvasId);
    return viewport ? { ...candidate, viewport } : candidate;
  }, [authUserId, canvasId]);

  const expireEditorSession = React.useCallback(() => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    pendingRef.current = null;
    setSessionExpired(true);
    setHasSettledInitialLoad(true);
  }, []);

  React.useEffect(() => { titleRef.current = title; }, [title]);
  React.useEffect(() => { currentRef.current = document; }, [document]);
  React.useEffect(() => {
    const previousTitle = window.document.title;
    return () => { window.document.title = previousTitle; };
  }, []);
  React.useEffect(() => {
    const browserDocument = window.document;
    const syncTitle = () => {
      if (browserDocument.title !== title) applyCanvasBrowserTitle(title, browserDocument);
    };
    syncTitle();
    // Route metadata can commit after canvas bootstrap and replace the title node.
    const observer = new MutationObserver(syncTitle);
    observer.observe(browserDocument.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  React.useEffect(() => {
    if (authLoading || !user) return;
    void loadSmartCanvasBoard();
  }, [authLoading, user]);


  const firstDocumentMarked = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!document || firstDocumentMarked.current === canvasId) return;
    performance.mark(`canvas:${canvasId}:document-commit`);
    const frame = requestAnimationFrame(() => { firstDocumentMarked.current = canvasId; performance.mark(`canvas:${canvasId}:first-frame-opportunity`); });
    return () => cancelAnimationFrame(frame);
  }, [canvasId, document]);
  const syncUndoMediaRefs = React.useCallback((
    heldRefs: CanvasUndoMediaRef[],
    currentRefs: CanvasUndoMediaRef[],
    force = false,
  ) => {
    undoHeldRefsRef.current = heldRefs;
    undoCurrentRefsRef.current = currentRefs;
    const signature = JSON.stringify([heldRefs, currentRefs]);
    if (!force && undoRefsSignatureRef.current === signature) return undoSyncRef.current;
    undoRefsSignatureRef.current = signature;
    const request = undoSyncRef.current
      .catch(() => false)
      .then(async () => {
        const response = await fetch(`/api/canvas/${canvasId}/undo-media-holds`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            undoSessionId: undoSessionIdRef.current,
            refs: undoHeldRefsRef.current,
            currentRefs: undoCurrentRefsRef.current,
          }),
        });
        return response.ok;
      })
      .catch(() => false);
    undoSyncRef.current = request;
    return request;
  }, [canvasId]);

  React.useEffect(() => {
    if (!authUserId) return;
    const timer = window.setInterval(() => {
      void syncUndoMediaRefs(undoHeldRefsRef.current, undoCurrentRefsRef.current, true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [authUserId, syncUndoMediaRefs]);

  React.useEffect(() => {
    if (!authUserId) return;
    const release = () => {
      void fetch(`/api/canvas/${canvasId}/undo-media-holds`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          undoSessionId: undoSessionIdRef.current,
          currentRefs: undoCurrentRefsRef.current,
        }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [authUserId, canvasId]);

  React.useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    let releaseTab: () => void = () => undefined;
    let releaseEditorSession: () => void = () => undefined;
    sessionExpiredRef.current = false;
    setSessionExpired(false);
    // Reading is independent of claiming this tab's editing lease. Editing still
    // waits for both, and local drafts are recovered before exposing the board.
    const bootstrap = loadCanvasForEntry(authUserId, canvasId);
    void bootstrap.catch(() => undefined);
    void claimCanvasTabIdentity()
      .then(async (identity) => {
        if (cancelled) {
          identity.release();
          return;
        }
        releaseTab = identity.release;
        const journal = createCanvasDraftJournal({
          driver: createIndexedDbCanvasDraftDriver(),
          scope: { authUserId, canvasId, tabId: identity.tabId },
        });
        const pendingDrafts = journal.pending();
        void pendingDrafts.catch(() => undefined);
        const editorSession = await claimCanvasEditorSession({
          authUserId,
          canvasId,
          sessionId: identity.tabId,
          onExpired: expireEditorSession,
        });
        if (cancelled) {
          editorSession.release();
          return;
        }
        editorSessionIdRef.current = editorSession.sessionId;
        releaseEditorSession = editorSession.release;
        const loaded = await bootstrap;
        performance.mark(`canvas:${canvasId}:detail-ready`);
        if (cancelled || sessionExpiredRef.current) return;
        journalRef.current = journal;
        const pending = await pendingDrafts;
        clientSequenceRef.current = pending.reduce((maximum, item) => Math.max(maximum, item.clientSequence + 1), 0);
        const loadedTitle = normalizeCanvasTitle(loaded.title);
        const serverDocument = compactCanvasAudioNodeSizes(loaded.document);
        const recoveredDocument = pending.length ? await journal.recover(serverDocument) : serverDocument;
        const loadedDocument = restoreStoredViewport(recoveredDocument);
        setTitle(loadedTitle);
        titleRef.current = loadedTitle;
        baseTitleRef.current = loadedTitle;
        revisionRef.current = loaded.revision;
        baseRef.current = serverDocument;
        currentRef.current = loadedDocument;
        performance.mark(`canvas:${canvasId}:document-ready`);
        setDocument(loadedDocument);
        if (pending.length) {
          pendingRef.current = loadedDocument;
          setSaveState("idle");
          window.setTimeout(() => { void drainRef.current(); }, 0);
        } else {
          setSaveState("saved");
        }
        setHasSettledInitialLoad(true);
      })
      .catch((reason) => { if (!cancelled) { setError(String(reason?.message || reason)); setSaveState("error"); setHasSettledInitialLoad(true); } });
    return () => {
      cancelled = true;
      editorSessionIdRef.current = "";
      releaseEditorSession();
      releaseTab();
    };
  }, [authUserId, canvasId, expireEditorSession, restoreStoredViewport]);

  React.useEffect(() => {
    if (!authLoading && !user) setHasSettledInitialLoad(true);
  }, [authLoading, user]);

  const drainSaveQueue = React.useCallback(async () => {
    if (sessionExpiredRef.current) return;
    while (savingRef.current || agentSyncingRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    if (sessionExpiredRef.current || agentConflictRef.current) return;
    savingRef.current = true;
    saveErrorRef.current = "";
    let inFlightDocument: CanvasDocumentV2 | null = null;
    try {
      while (pendingRef.current) {
        if (sessionExpiredRef.current) break;
        const next = pendingRef.current;
        inFlightDocument = next;
        const requestedTitle = titleRef.current;
        pendingRef.current = null;
        const base = baseRef.current;
        const journal = journalRef.current;
        if (!journal) throw new Error("IndexedDB draft journal is unavailable");
        if (base && sameDocument(base, next) && baseTitleRef.current === requestedTitle && !(await journal.pending()).length) {
          inFlightDocument = null;
          setSaveState("saved");
          continue;
        }
        const nextImportRefs = collectCanvasImportRefs(next);
        const removedImportRefs = base
          ? Array.from(collectCanvasImportRefs(base)).filter((ref) => !nextImportRefs.has(ref))
          : [];
        setSaveState("saving");
        setError("");
        try {
          if (base) {
            const saved = await submitCanvasDocumentChange({
              canvasId,
              baseRevision: revisionRef.current,
              clientSequence: clientSequenceRef.current,
              before: base,
              after: next,
              journal,
              sessionId: editorSessionIdRef.current,
            });
            revisionRef.current = saved.revision;
            clientSequenceRef.current = saved.clientSequence;
            baseRef.current = saved.document;
          }
        } catch (reason) {
          if (reason instanceof CanvasMutationHttpError && reason.code === "CANVAS_SESSION_EXPIRED") {
            expireEditorSession();
            break;
          }
          if (reason instanceof CanvasMutationHttpError && reason.status === 429) {
            pendingRef.current = next;
            setSaveState("saving");
            saveErrorRef.current = "服务繁忙，本地草稿已安全保存，正在自动重试";
            setError(saveErrorRef.current);
            const retryAfterMs = typeof reason.details?.retryAfterMs === "number"
              ? Math.min(Math.max(reason.details.retryAfterMs, 250), 60_000)
              : 1_000;
            window.setTimeout(() => { void drainRef.current(); }, retryAfterMs);
            break;
          }
          if (reason instanceof CanvasMutationHttpError && reason.code === "CANVAS_REVISION_CONFLICT" && base) {
            const remote = await loadCanvasBootstrap(canvasId);
            const localOperations = createCanvasDocumentMutation(base, next, `rebase:${clientSequenceRef.current}`).operations;
            const missing = Array.isArray(reason.details?.missingMutations)
              ? reason.details.missingMutations.flatMap((item): CanvasOperation[] => {
                  if (!item || typeof item !== "object") return [];
                  const operations = (item as { operations?: unknown }).operations;
                  return Array.isArray(operations) ? operations as CanvasOperation[] : [];
                })
              : [];
            const rebased = rebaseCanvasOperations(localOperations, missing);
            const failedMutationId = typeof reason.details?.clientMutationId === "string"
              ? reason.details.clientMutationId
              : null;
            const hasMoreRemoteMutations = reason.details?.hasMore === true;
            if (agentBridgeRef.current) {
              // The Agent can commit while an autosave is in flight. Merge its
              // acknowledged document with every edit now visible in the Board.
              agentBridgeRef.current.flush();
              window.clearTimeout(saveTimer.current);
              saveTimer.current = undefined;
              const merged = mergeCreativeAgentCanvasDocuments(base, currentRef.current ?? next, remote.document);
              if (merged.conflicts.length) {
                conflictDraftIdsRef.current = failedMutationId ? [failedMutationId] : [];
                agentConflictRef.current = true;
                setConflict({ result: merged, remote: remote.document, remoteRevision: remote.revision, incremental: true });
                setDecisions(Object.fromEntries(merged.conflicts.map(item => [item.key, "local"])));
                setSaveState("conflict");
                saveErrorRef.current = "画布存在保存冲突，请先处理冲突";
                break;
              }
              if (failedMutationId) await journal.acknowledge(failedMutationId);
              agentBridgeRef.current.applyRemote(merged.document);
              revisionRef.current = remote.revision;
              baseRef.current = remote.document;
              currentRef.current = merged.document;
              setDocument(merged.document);
              pendingRef.current = merged.document;
              continue;
            }
            if (!hasMoreRemoteMutations && rebased.conflicts.length === 0) {
              reportCanvasIncrement("canvas_rebase_auto_total");
              if (failedMutationId) await journal.acknowledge(failedMutationId);
              const resolved = applyCanvasOperations(remote.document, rebased.operations);
              revisionRef.current = remote.revision;
              baseRef.current = remote.document;
              currentRef.current = resolved;
              setDocument(resolved);
              setEditorVersion((value) => value + 1);
              pendingRef.current = resolved;
              continue;
            }
            const result = mergeCanvasDocuments(base, next, remote.document);
            reportCanvasIncrement("canvas_rebase_manual_total");
            conflictDraftIdsRef.current = failedMutationId ? [failedMutationId] : [];
            setConflict({ result, remote: remote.document, remoteRevision: remote.revision });
            setDecisions(Object.fromEntries(result.conflicts.map((item) => [item.key, "local"])));
            setSaveState("conflict");
            saveErrorRef.current = "画布存在保存冲突，请先处理冲突";
            break;
          }
          throw reason;
        }
        if (baseTitleRef.current !== requestedTitle) {
          const metadataResponse = await fetch(`/api/canvas/${canvasId}/metadata`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "X-Canvas-Session-Id": editorSessionIdRef.current,
            },
            body: JSON.stringify({ title: requestedTitle }),
          });
          const metadata = await metadataResponse.json().catch(() => null);
          if (metadataResponse.status === 409 && metadata?.code === "CANVAS_SESSION_EXPIRED") {
            expireEditorSession();
            break;
          }
          if (!metadataResponse.ok || !metadata?.success) throw new Error(metadata?.error || "Title save failed");
        }
        baseTitleRef.current = requestedTitle;
        if (removedImportRefs.length) {
          const latestRefs = collectCanvasImportRefs(currentRef.current);
          const refs = removedImportRefs.filter((ref) => !latestRefs.has(ref));
          if (refs.length) {
            const undoProtectionReady = await undoSyncRef.current.catch(() => false);
            if (undoProtectionReady) {
              await fetch("/api/canvas/media/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refs }),
              }).catch(() => null);
            }
          }
        }
        inFlightDocument = null;
        setSaveState("saved");
      }
    } catch (reason) {
      if (sessionExpiredRef.current) return;
      if (inFlightDocument && !pendingRef.current) pendingRef.current = inFlightDocument;
      if (String((reason as Error)?.message || reason).includes("IndexedDB")) reportCanvasIncrement("canvas_idb_failure_total");
      saveErrorRef.current = String((reason as Error)?.message || reason);
      setError(saveErrorRef.current);
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }, [canvasId, expireEditorSession]);
  drainRef.current = drainSaveQueue;

  const refreshAfterServerRun = React.useCallback(async () => {
    if (sessionExpiredRef.current) return;
    const remote = await loadCanvasBootstrap(canvasId);
    const remoteDocument = restoreStoredViewport(compactCanvasAudioNodeSizes(remote.document));
    const base = baseRef.current;
    const current = currentRef.current;
    if (!base || !current || sameDocument(base, current)) {
      revisionRef.current = remote.revision;
      baseRef.current = remoteDocument;
      currentRef.current = remoteDocument;
      pendingRef.current = null;
      setDocument(remoteDocument);
      setEditorVersion((value) => value + 1);
      setSaveState("saved");
      return;
    }
    const merged = mergeCanvasDocuments(base, current, remoteDocument);
    if (merged.conflicts.length) {
      setConflict({ result: merged, remote: remoteDocument, remoteRevision: remote.revision });
      setDecisions(Object.fromEntries(merged.conflicts.map((item) => [item.key, "local"])));
      setSaveState("conflict");
      return;
    }
    revisionRef.current = remote.revision;
    baseRef.current = remoteDocument;
    currentRef.current = merged.document;
    pendingRef.current = merged.document;
    setDocument(merged.document);
    setEditorVersion((value) => value + 1);
    window.setTimeout(() => { void drainRef.current(); }, 0);
  }, [canvasId, restoreStoredViewport]);

  const queueSave = React.useCallback((next: CanvasDocumentV2, immediate = false) => {
    if (sessionExpiredRef.current) return;
    if (authUserId) writeCanvasViewportPreference(window.localStorage, authUserId, canvasId, next.viewport);
    const previous = currentRef.current;
    currentRef.current = next;
    // Camera preferences are local. Keep any pending edit, but avoid restarting
    // shared saves and feeding the whole document back through board hydration.
    if (!immediate && previous?.nodes === next.nodes && previous.edges === next.edges
      && previous.settings.snapToGrid === next.settings.snapToGrid && previous.settings.gridSize === next.settings.gridSize) {
      if (pendingRef.current) pendingRef.current = next;
      return;
    }
    setDocument(next);
    pendingRef.current = next;
    setSaveState("saving");
    setError("");
    if (immediate) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      void drainSaveQueue();
      return;
    }
    if (saveTimer.current !== undefined) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      void drainSaveQueue();
    }, 300);
  }, [authUserId, canvasId, drainSaveQueue]);

  const renameCanvas = React.useCallback((value: string) => {
    if (sessionExpiredRef.current || !currentRef.current) return;
    const nextTitle = normalizeCanvasTitle(value);
    if (nextTitle === titleRef.current) return;
    titleRef.current = nextTitle;
    setTitle(nextTitle);
    queueSave(currentRef.current, true);
  }, [queueSave]);

  React.useEffect(() => {
    const flushPendingSave = () => {
      if (sessionExpiredRef.current) return;
      if (saveTimer.current === undefined && !pendingRef.current) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      void drainRef.current();
    };
    const flushPendingSaveWhenHidden = () => {
      if (globalThis.document.visibilityState === "hidden") flushPendingSave();
    };
    window.addEventListener("pagehide", flushPendingSave);
    globalThis.document.addEventListener("visibilitychange", flushPendingSaveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      globalThis.document.removeEventListener("visibilitychange", flushPendingSaveWhenHidden);
      flushPendingSave();
    };
  }, []);

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    const current = currentRef.current;
    if (!current) return;
    const next = pruneCanvasDeletedGenerations(current, ids);
    if (next === current) return;
    setLiveNodes(next.nodes);
    setEditorVersion((value) => value + 1);
    queueSave(next, true);
  }), [queueSave]);

  React.useEffect(() => {
    if (!document) return;
    const next = pruneCanvasDeletedGenerations(document, getKnownDeletedGenerationIds());
    if (next === document) return;
    setLiveNodes(next.nodes);
    setEditorVersion((value) => value + 1);
    queueSave(next, true);
  }, [document, queueSave]);

  const prepareServerRun = React.useCallback(async () => {
    if (sessionExpiredRef.current) throw new Error("当前画布会话已过期，请刷新页面后继续");
    if (agentConflictRef.current) throw new Error("请先处理画布保存冲突");
    const current = currentRef.current;
    if (!current) throw new Error("画布尚未加载完成");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    pendingRef.current = current;
    setSaveState("saving");
    setError("");
    await drainSaveQueue();
    if (sessionExpiredRef.current || !editorSessionIdRef.current) {
      throw new Error("当前画布会话已过期，请刷新页面后继续");
    }
    if (saveErrorRef.current) throw new Error(`画布保存失败：${saveErrorRef.current}`);
    const saved = baseRef.current;
    const latest = currentRef.current;
    if (!saved || !latest || !sameDocument(saved, latest) || baseTitleRef.current !== titleRef.current) {
      throw new Error("最新修改仍在保存，请稍后再试");
    }
    return revisionRef.current;
  }, [drainSaveQueue]);

  const prepareCanvasReturn = React.useCallback(async () => {
    const flushBoard = () => (agentBridgeRef.current ?? desktopBoardBridgeRef.current)?.flush();
    try {
      flushBoard();
      for (;;) {
        await prepareServerRun();
        // Edits made while waiting for the server may still be buffered in the board.
        flushBoard();
        const saved = baseRef.current;
        const latest = currentRef.current;
        if (saved && latest && sameDocument(saved, latest) && baseTitleRef.current === titleRef.current) return true;
      }
    } catch (reason) {
      if (!sessionExpiredRef.current) {
        setError(String((reason as Error)?.message || reason));
        setSaveState((state) => state === "conflict" ? state : "error");
      }
      return false;
    }
  }, [prepareServerRun]);

  const refreshAfterAgentCommit = React.useCallback(() => {
    void invalidateCanvasGenerationHistory(queryClient, user?.id ?? "guest");
    const refresh = async () => {
      while (savingRef.current) await new Promise(resolve => window.setTimeout(resolve, 25));
      if (sessionExpiredRef.current || agentConflictRef.current) return;
      agentSyncingRef.current = true;
      try {
        const bridge = agentBridgeRef.current;
        if (!bridge) throw new Error("画布尚未加载完成");
        bridge.flush();
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        const remote = await loadCanvasBootstrap(canvasId);
        if (sessionExpiredRef.current) return;
        // Edits made during the read are part of the same protected merge.
        bridge.flush();
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        const base = baseRef.current;
        const current = currentRef.current;
        if (!base || !current) throw new Error("画布尚未加载完成");
        const merged = mergeCreativeAgentCanvasDocuments(base, current, remote.document);
        if (merged.conflicts.length) {
          agentConflictRef.current = true;
          saveErrorRef.current = "画布存在保存冲突，请先处理冲突";
          setConflict({ result: merged, remote: remote.document, remoteRevision: remote.revision, incremental: true });
          setDecisions(Object.fromEntries(merged.conflicts.map(item => [item.key, "local"])));
          setSaveState("conflict");
          return;
        }
        bridge.applyRemote(merged.document);
        revisionRef.current = remote.revision;
        baseRef.current = remote.document;
        currentRef.current = merged.document;
        pendingRef.current = sameDocument(remote.document, merged.document) && baseTitleRef.current === titleRef.current ? null : merged.document;
        setDocument(merged.document);
        setSaveState(pendingRef.current ? "saving" : "saved");
        saveErrorRef.current = "";
      } finally {
        agentSyncingRef.current = false;
      }
      if (pendingRef.current) await drainSaveQueue();
    };
    const next = agentRefreshRef.current.catch(() => undefined).then(refresh);
    agentRefreshRef.current = next;
    return next;
  }, [canvasId, drainSaveQueue, queryClient, user?.id]);

  const prepareAgentMessage = React.useCallback(async (): Promise<CreativeAgentCanvasContext> => {
    await agentRefreshRef.current;
    const bridge = agentBridgeRef.current;
    if (!bridge) throw new Error("画布尚未加载完成");
    bridge.flush();
    await prepareServerRun();
    return { canvasId, revision: revisionRef.current, selection: bridge.getSnapshot().selection };
  }, [canvasId, prepareServerRun]);

  React.useEffect(() => {
    if (!pendingRef.current && !savingRef.current && saveState !== "error" && saveState !== "conflict") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current && !savingRef.current && saveState !== "error" && saveState !== "conflict") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [document, saveState]);

  const removeMissingMedia = React.useCallback((url: unknown) => {
    if (typeof url !== "string") return;
    const current = currentRef.current;
    if (!current) return;
    const next = removeCanvasMissingMediaNodes(current, [url]);
    if (next === current) return;
    setLiveNodes(next.nodes);
    setEditorVersion((value) => value + 1);
    queueSave(next, true);
  }, [queueSave]);

  React.useEffect(() => {
    if (!user) return;
    const source = new EventSource(`/api/canvas/media/events?canvasId=${canvasId}`);
    const onDeleted = (event: Event) => {
      try {
        removeMissingMedia(JSON.parse((event as MessageEvent<string>).data).url);
      } catch {
        // Ignore malformed push data and keep the current canvas unchanged.
      }
    };
    source.addEventListener("media-deleted", onDeleted);
    return () => {
      source.removeEventListener("media-deleted", onDeleted);
      source.close();
    };
  }, [canvasId, removeMissingMedia, user]);

  const locateNode = React.useCallback((nodeId: string) => {
    setFocusRequest((current) => ({ nodeId, requestId: (current?.requestId || 0) + 1 }));
  }, []);

  const resolveConflict = React.useCallback(() => {
    if (!conflict) return;
    const resolved = resolveCanvasMergeConflicts(conflict.result, decisions);
    void (async () => {
      const journal = journalRef.current;
      if (journal) await Promise.all(conflictDraftIdsRef.current.map((id) => journal.acknowledge(id)));
      conflictDraftIdsRef.current = [];
      revisionRef.current = conflict.remoteRevision;
      baseRef.current = conflict.remote;
      currentRef.current = resolved;
      setDocument(resolved);
      if (conflict.incremental && agentBridgeRef.current) agentBridgeRef.current.applyRemote(resolved);
      else setEditorVersion((value) => value + 1);
      agentConflictRef.current = false;
      saveErrorRef.current = "";
      setConflict(null);
      setSaveState("saving");
      pendingRef.current = resolved;
      window.setTimeout(() => { void drainSaveQueue(); }, 0);
    })().catch((reason) => {
      setError(String((reason as Error)?.message || reason));
      setSaveState("error");
    });
  }, [conflict, decisions, drainSaveQueue]);

  const downloadBlob = React.useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const exportWorkflowContent = React.useCallback(async (scope: WorkflowExportScope, format: "zip" | "library") => {
    const current = currentRef.current;
    if (!current) return;
    const exported = detachWorkflowExecution(scope === "selected" ? selectCanvasSubgraph(current, workflowSelection || []) : current);
    if (scope === "selected" && !exported.nodes.length) throw new Error("请先选择要导出的节点");
    const safeTitle = (titleRef.current || "canvas").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
    if (format === "library") {
      const response = await fetch("/api/canvas/library/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: safeTitle, document: exported }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "工作流入库失败");
      window.dispatchEvent(new Event("canvas-library-changed"));
      return;
    }
    downloadBlob(await createWorkflowArchive(exported, setWorkflowProgress), `${safeTitle}.canvas.zip`);
  }, [downloadBlob, workflowSelection]);

  const importWorkflowContent = React.useCallback(async (file: File, mode: WorkflowImportMode) => {
      if (sessionExpiredRef.current) throw new Error("当前画布会话已过期，请刷新页面后继续");
      const imported = await readWorkflowFile(file, uploadCanvasMedia, setWorkflowProgress);
      if (sessionExpiredRef.current) throw new Error("当前画布会话已过期，请刷新页面后继续");
      const next = mode === "append" && currentRef.current ? appendCanvasDocument(currentRef.current, imported) : imported;
      setWorkflowProgress("正在保存画布");
      currentRef.current = next;
      setDocument(next);
      setLiveNodes(next.nodes);
      setEditorVersion((value) => value + 1);
      queueSave(next);
      try { await prepareServerRun(); }
      catch (error) { throw new Error(`已导入到本地画布，但尚未保存成功，请点击立即保存，不要重复导入：${String((error as Error)?.message || error)}`); }
  }, [prepareServerRun, queueSave]);

  const exportWorkflow = React.useCallback((scope: WorkflowExportScope, format: "zip" | "library") =>
    runWorkflowTransfer(() => exportWorkflowContent(scope, format), format === "library" ? "工作流已存入产物库" : "工作流已导出"), [runWorkflowTransfer, exportWorkflowContent]);
  const importWorkflow = React.useCallback((file: File, mode: WorkflowImportMode) =>
    runWorkflowTransfer(() => importWorkflowContent(file, mode), "工作流已导入并保存"), [runWorkflowTransfer, importWorkflowContent]);

  if (authLoading) return <AtomicPageReveal ready={false}><div className="flex flex-1 items-center justify-center text-[var(--app-muted)]"><Loader2 className="h-6 w-6 animate-spin" /></div></AtomicPageReveal>;
  if (!user) return <AtomicPageReveal ready={hasSettledInitialLoad}><div className="flex flex-1 flex-col items-center justify-center gap-4"><p className="text-sm text-[var(--app-muted)]"><UiText id="canvas.md392c32375e1" /></p><button type="button" onClick={() => openLoginModal()} className="rounded-xl bg-[var(--primary-bg)] px-5 py-2 text-sm text-[var(--primary-fg)]">{desktopMode ? <UiText id="canvas.medd4000049f2" /> : <UiText id="canvas.me5533fd28356" />}</button></div></AtomicPageReveal>;

  return (
    <AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>
    {sessionExpired ? <CanvasSessionExpiredModal onRefresh={() => window.location.reload()} /> : <div ref={canvasHostRef} className="flex min-h-0 flex-1 flex-col">
        {(saveState === "error" || saveState === "conflict") && <div role="alert" className="absolute left-1/2 top-16 z-50 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/30 bg-[var(--app-panel)] px-4 py-3 text-sm shadow-lg">
          <CloudAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <span>{saveState === "conflict" ? <UiText id="canvas.m68f41169ab4b" /> : <UiText id="canvas.mae89188fbe86" values={{v0: uiError(error, "请重试")}} />}</span>
          {saveState === "error" && <button type="button" className="shrink-0 underline" onClick={() => currentRef.current && queueSave(currentRef.current, true)}><UiText id="canvas.me188062da724" /></button>}
        </div>}
        <span role="status" className="sr-only">{saveState === "saved" ? <UiText id="canvas.mab5bbfc7c25e" /> : saveState === "saving" ? <UiText id="canvas.m918a1af235f2" /> : ""}</span>
      <CanvasWorkspace key={`${user.id}:${canvasId}`} ownerId={user.id} canvasId={canvasId}
        titleBar={document ? { title, onRename: renameCanvas, onArrange: options => arrangeActionRef.current?.(options), arrangeDisabled: arrangePreviewActive || (liveNodes ?? document.nodes).filter(node => !node.parentId).length < 2, onBeforeReturn: desktopMode ? prepareCanvasReturn : undefined } : undefined}
        board={<><div className="absolute inset-0" style={{ right: agentOpen ? agentDockWidth : 0 }}>{document ? <SmartCanvasBoard key={`${user?.id ?? "guest"}-${canvasId}-${editorVersion}`} canvasId={canvasId} editorSessionId={editorSessionIdRef.current} preferenceOwnerId={user?.id ?? "guest"} initial={document} agentBridgeRef={agentEnabled ? agentBridgeRef : desktopMode ? desktopBoardBridgeRef : undefined} onSelectionChange={agentEnabled ? setAgentSelection : undefined} arrangeActionRef={arrangeActionRef} onArrangementPreviewChange={setArrangePreviewActive} focusRequest={focusRequest} onLiveNodesChange={setLiveNodes} onChange={(next) => queueSave(next)} onUndoMediaRefsChange={syncUndoMediaRefs} onBeforeServerRun={prepareServerRun} onServerRunCommitted={refreshAfterServerRun} workflowAnchorRef={workflowAnchorRef} onOpenWorkflow={setWorkflowSelection} onCloseWorkflow={() => setWorkflowSelection(null)} workflowOpen={Boolean(workflowSelection)} onToggleLibrary={() => { setAgentOpen(false); setLibraryOpen((open) => !open); }} libraryOpen={libraryOpen} />  : <div className="flex h-full items-center justify-center text-[var(--app-muted)]">{error || <Loader2 className="h-6 w-6 animate-spin" />}</div>}
          </div>
          {agentEnabled && document && !agentOpen && <CanvasAgentLauncher running={agentRunning} onClick={() => { setLibraryOpen(false); setWorkflowSelection(null); setAgentOpen(true); }} />}
          {agentEnabled && document && <CanvasAgentWindow key={`${user.id}:${canvasId}`} visible={agentOpen} onDockWidthChange={setAgentDockWidth}>
            {({ docked, toggleDock }) => <CanvasAgentPanel canvasId={canvasId} visible={agentOpen} docked={docked} onToggleDock={toggleDock} onRunningChange={setAgentRunning} selection={agentSelection} onGetReferences={() => {
              const snapshot = agentBridgeRef.current?.getSnapshot();
              return snapshot ? getCreativeAgentSelection(canvasId, snapshot.document, snapshot.document.nodes.map(node => node.id), []).references : [];
            }} onGetReferencePreview={reference => {
              const snapshot = agentBridgeRef.current?.getSnapshot();
              return snapshot ? getReferencePreview(snapshot.document, reference) : undefined;
            }} onPrepareMessage={prepareAgentMessage} onCanvasCommitted={refreshAfterAgentCommit} onLocateNode={(nodeId, target) => agentBridgeRef.current?.focus(nodeId, target)} onClose={() => { setAgentOpen(false); canvasHostRef.current?.querySelector<HTMLElement>(".canvas-editor-surface")?.focus({ preventScroll: true }); }} />}
          </CanvasAgentWindow>}
        </>}
        workflow={workflowSelection ? { transferBusy: workflowBusy, anchorRef: workflowAnchorRef, totalCount: document?.nodes.length ?? 0, selectedCount: workflowSelection.length, onClose: () => setWorkflowSelection(null), onExport: exportWorkflow, onImport: importWorkflow } : undefined}
        library={libraryOpen && document ? { canvasId, ownerId: authUserId ?? 0, nodes: liveNodes ?? document.nodes, onLocateNode: locateNode, onClose: () => setLibraryOpen(false) } : undefined}
        progress={workflowProgress} busy={workflowBusy}
      />

      {conflict && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] p-6">
          <div className="max-h-[80vh] w-full max-w-xl overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow)]">
            <h2 className="text-base font-semibold text-[var(--app-fg)]"><UiText id="canvas.mbda57ea86e21" /></h2>
            <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]"><UiText id="canvas.mdd05dd82d51a" /></p>
            <div className="mt-4 space-y-2">
              {conflict.result.conflicts.map((item) => (
                <div key={item.key} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[var(--app-fg)]">{item.entity === "node" ? <UiText id="canvas.m2410d860f093" /> : <UiText id="canvas.mfdc2e8ffaaa6" />} · {item.id}</p><p className="mt-1 text-[11px] text-[var(--app-muted)]">{!item.local ? <UiText id="canvas.mb43cca40e4b9" /> : !item.remote ? <UiText id="canvas.m16892bf62533" /> : <UiText id="canvas.md33b5fde9125" />}</p></div>
                  <div className="flex rounded-lg border border-[var(--border)] p-0.5">
                    {(["local", "remote"] as const).map((choice) => <button key={choice} type="button" onClick={() => setDecisions((current) => ({ ...current, [item.key]: choice }))} className={`rounded-md px-2.5 py-1 text-xs ${decisions[item.key] === choice ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]"}`}>{choice === "local" ? <UiText id="canvas.mbf4ad761840f" /> : <UiText id="canvas.mb08fb1de7ff4" />}</button>)}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={resolveConflict} className="mt-4 w-full rounded-xl bg-[var(--primary-bg)] px-4 py-2.5 text-sm font-medium text-[var(--primary-fg)]"><UiText id="canvas.m0692fab592dd" /></button>
          </div>
        </div>
      )}
    </div>}
    </AtomicPageReveal>
  );
}
