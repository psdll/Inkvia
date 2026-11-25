"use client";

import * as React from "react";

export type BatchResultEntry = {
  key: string;
  mode: string;
  modeLabel: string;
  mediaKind: "image" | "video";
  createdAt: string;
  pinned?: boolean;
  content: React.ReactNode;
};

export type BatchResultSource = {
  id: string;
  initialLoading?: boolean;
  initialError?: string;
  entries: BatchResultEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

function entryTimestamp(entry: BatchResultEntry) {
  const timestamp = new Date(entry.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareStableKeys(left: BatchResultEntry, right: BatchResultEntry) {
  if (left.key === right.key) return 0;
  return left.key < right.key ? -1 : 1;
}

export function mergeBatchResultEntries(sources: BatchResultSource[]) {
  return sources.flatMap((source) => source.entries).sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    const leftTimestamp = entryTimestamp(left);
    const rightTimestamp = entryTimestamp(right);
    if (leftTimestamp === null && rightTimestamp !== null) return 1;
    if (leftTimestamp !== null && rightTimestamp === null) return -1;
    if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
    return compareStableKeys(left, right);
  });
}

type BatchResultRegistryState = {
  sources: BatchResultSource[];
  scrollRevision: number;
};

type BatchResultRegistryDispatch = {
  upsertSource(source: BatchResultSource): void;
  removeSource(sourceId: string): void;
  requestScrollTop(): void;
};

const BatchResultRegistryStateContext = React.createContext<BatchResultRegistryState>({
  sources: [],
  scrollRevision: 0,
});

const BatchResultRegistryDispatchContext = React.createContext<BatchResultRegistryDispatch | null>(null);

export function BatchResultRegistryProvider({ children }: { children: React.ReactNode }) {
  const [sourcesById, setSourcesById] = React.useState<Map<string, BatchResultSource>>(
    () => new Map(),
  );
  const [scrollRevision, setScrollRevision] = React.useState(0);

  const upsertSource = React.useCallback((source: BatchResultSource) => {
    setSourcesById((current) => {
      if (current.get(source.id) === source) return current;
      const next = new Map(current);
      next.set(source.id, source);
      return next;
    });
  }, []);

  const removeSource = React.useCallback((sourceId: string) => {
    setSourcesById((current) => {
      if (!current.has(sourceId)) return current;
      const next = new Map(current);
      next.delete(sourceId);
      return next;
    });
  }, []);

  const requestScrollTop = React.useCallback(() => {
    setScrollRevision((current) => current + 1);
  }, []);

  const dispatch = React.useMemo<BatchResultRegistryDispatch>(() => ({
    upsertSource,
    removeSource,
    requestScrollTop,
  }), [removeSource, requestScrollTop, upsertSource]);

  const state = React.useMemo<BatchResultRegistryState>(() => ({
    sources: Array.from(sourcesById.values()),
    scrollRevision,
  }), [scrollRevision, sourcesById]);

  return (
    <BatchResultRegistryDispatchContext.Provider value={dispatch}>
      <BatchResultRegistryStateContext.Provider value={state}>
        {children}
      </BatchResultRegistryStateContext.Provider>
    </BatchResultRegistryDispatchContext.Provider>
  );
}

export function useRegisterBatchResultSource(source: BatchResultSource) {
  const registry = React.useContext(BatchResultRegistryDispatchContext);
  if (!registry) throw new Error("BatchResultRegistryProvider is required");

  React.useEffect(() => {
    registry.upsertSource(source);
  }, [registry, source]);

  React.useEffect(() => () => {
    registry.removeSource(source.id);
  }, [registry, source.id]);

  return { requestScrollTop: registry.requestScrollTop };
}

export function useBatchResultRegistryActions() {
  const registry = React.useContext(BatchResultRegistryDispatchContext);
  if (!registry) throw new Error("BatchResultRegistryProvider is required");
  return { requestScrollTop: registry.requestScrollTop };
}

export function useBatchResultRegistryState() {
  return React.useContext(BatchResultRegistryStateContext);
}
