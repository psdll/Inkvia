"use client";
import * as React from "react";
import { CanvasNodeEditorContext, type NodeEditor } from "./CanvasNodeCard";

/** Current operations are stable; display snapshots change only for their node. */
export function createCanvasNodeEditorStore(initial: NodeEditor, revision?: unknown) {
  let current = initial;
  let currentRevision = revision;
  const listeners = new Map<string, Set<() => void>>();
  const snapshots = new Map<string, { key: string; revision: unknown; separationJob: NonNullable<NodeEditor["videoSeparationJobs"]>[string] | undefined; breakdownModels: NodeEditor["breakdownModels"]; editor: NodeEditor }>();
  const operations = Object.fromEntries(Object.keys(initial).filter(key => typeof initial[key as keyof NodeEditor] === "function").map(key => [key, (...args: unknown[]) => {
    const operation = current[key as keyof NodeEditor] as (...args: unknown[]) => unknown;
    return operation(...args);
  }])) as unknown as NodeEditor;
  const getSnapshot = (id: string) => {
    const panel = current.isPanelVisible(id);
    const taskPanel = current.isTaskPanelVisible(id);
    const group = current.isGroupSelected(id);
    const target = current.connectionFeedbackTarget?.nodeId === id ? current.connectionFeedbackTarget : null;
    const videoFocusRequest = current.videoFocusRequest?.nodeId === id ? current.videoFocusRequest : null;
    const separationJob = current.videoSeparationJobs?.[id];
    // 拉片模型列表全画布共用，只在模型启用状态变化时换引用
    const breakdownModels = current.breakdownModels;
    // 多图节点里聚焦的那一张只影响这一个节点
    const focusedOutput = current.focusedOutput?.nodeId === id ? current.focusedOutput : null;
    const key = `${panel}:${taskPanel}:${group}:${current.connectionInProgress}:${target?.state ?? ""}:${videoFocusRequest?.revision ?? 0}:${focusedOutput?.outputId ?? ""}:${focusedOutput?.pulse ?? 0}`;
    const cached = snapshots.get(id);
    const panelRevision = taskPanel ? currentRevision : undefined;
    if (cached?.key === key && cached.revision === panelRevision && cached.separationJob === separationJob && cached.breakdownModels === breakdownModels) return cached.editor;
    const editor: NodeEditor = {
      ...operations,
      isPanelVisible: () => panel,
      isTaskPanelVisible: () => taskPanel,
      isGroupSelected: () => group,
      connectionInProgress: current.connectionInProgress,
      connectionFeedbackTarget: target,
      videoFocusRequest,
      videoSeparationJobs: separationJob ? { [id]: separationJob } : undefined,
      focusedOutput,
      breakdownModels,
    };
    snapshots.set(id, { key, revision: panelRevision, separationJob, breakdownModels, editor });
    return editor;
  };
  return {
    getSnapshot,
    subscribe(id: string, listener: () => void) {
      let nodeListeners = listeners.get(id);
      if (!nodeListeners) listeners.set(id, nodeListeners = new Set());
      nodeListeners.add(listener);
      return () => {
        nodeListeners.delete(listener);
        if (!nodeListeners.size) { listeners.delete(id); snapshots.delete(id); }
      };
    },
    update(editor: NodeEditor, revision?: unknown) {
      current = editor;
      currentRevision = revision;
      for (const [id, callbacks] of listeners) {
        const previous = snapshots.get(id)?.editor;
        if (getSnapshot(id) !== previous) for (const callback of callbacks) callback();
      }
    },
  };
}

const NodeStoreContext = React.createContext<ReturnType<typeof createCanvasNodeEditorStore> | null>(null);
export function CanvasNodeSubscriptionsProvider({ editor, revision, children }: { editor: NodeEditor; revision: unknown; children: React.ReactNode }) {
  const [store] = React.useState(() => createCanvasNodeEditorStore(editor, revision));
  React.useLayoutEffect(() => store.update(editor, revision), [editor, revision, store]);
  return <NodeStoreContext.Provider value={store}>{children}</NodeStoreContext.Provider>;
}
function SubscribedNode({ id, store, children }: { id: string; store: ReturnType<typeof createCanvasNodeEditorStore>; children: React.ReactNode }) {
  const subscribe = React.useCallback((listener: () => void) => store.subscribe(id, listener), [id, store]);
  const getSnapshot = React.useCallback(() => store.getSnapshot(id), [id, store]);
  const editor = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return <CanvasNodeEditorContext.Provider value={editor}>{children}</CanvasNodeEditorContext.Provider>;
}
export function CanvasNodeSubscription({ id, children }: { id: string; children: React.ReactNode }) {
  const store = React.useContext(NodeStoreContext);
  return store ? <SubscribedNode id={id} store={store}>{children}</SubscribedNode> : <>{children}</>;
}
