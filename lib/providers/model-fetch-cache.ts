import type { ProviderModelGroups } from "./model-selection";

export type ProviderModelFetchCacheEntry = {
  revision: number;
  groups: ProviderModelGroups;
};

export type ProviderModelFetchState = {
  revisions: Record<string, number>;
  entries: Record<string, ProviderModelFetchCacheEntry>;
  chatModelDrafts: Record<string, string>;
};

export type ProviderModelFetchModal = {
  providerId: string;
  providerName: string;
  fetchedModels: ProviderModelGroups;
  revision: number;
};

export type ProviderModelFetchResponse = {
  ok?: boolean;
  total?: number;
  message?: string;
  grouped?: Partial<ProviderModelGroups>;
};

export type ProviderModelFetchRequestOwner = {
  token: number;
  revision: number;
};

export type ProviderModelFetchRequestUiState<T> = {
  owners: Record<string, ProviderModelFetchRequestOwner>;
  transient: Record<string, T>;
};

type ProviderModelFetchRequestSettlement<T> = {
  applied: boolean;
  state: ProviderModelFetchRequestUiState<T>;
};

export function beginProviderModelFetchRequest<T>(
  state: ProviderModelFetchRequestUiState<T>,
  key: string,
  owner: ProviderModelFetchRequestOwner,
  busy: T,
): ProviderModelFetchRequestUiState<T> {
  return {
    owners: { ...state.owners, [key]: owner },
    transient: { ...state.transient, [key]: busy },
  };
}

export function invalidateProviderModelFetchRequest<T>(
  state: ProviderModelFetchRequestUiState<T>,
  key: string,
  providerId: string,
): ProviderModelFetchRequestUiState<T> {
  if (!(key in state.owners) && !(key in state.transient) && !(providerId in state.transient)) {
    return state;
  }
  const owners = { ...state.owners };
  const transient = { ...state.transient };
  delete owners[key];
  delete transient[key];
  delete transient[providerId];
  return { owners, transient };
}

export function clearProviderModelFetchRequestIfOwned<T>(
  state: ProviderModelFetchRequestUiState<T>,
  key: string,
  owner: ProviderModelFetchRequestOwner,
): { cleared: boolean; state: ProviderModelFetchRequestUiState<T> } {
  const currentOwner = state.owners[key];
  if (!currentOwner || currentOwner.token !== owner.token || currentOwner.revision !== owner.revision) {
    return { cleared: false, state };
  }
  const owners = { ...state.owners };
  const transient = { ...state.transient };
  delete owners[key];
  delete transient[key];
  return { cleared: true, state: { owners, transient } };
}

export function settleProviderModelFetchRequestIfOwned<T>(
  state: ProviderModelFetchRequestUiState<T>,
  key: string,
  providerId: string,
  owner: ProviderModelFetchRequestOwner,
  result: T,
): ProviderModelFetchRequestSettlement<T> {
  const cleared = clearProviderModelFetchRequestIfOwned(state, key, owner);
  if (!cleared.cleared) return { applied: false, state };
  return {
    applied: true,
    state: {
      owners: cleared.state.owners,
      transient: {
        ...cleared.state.transient,
        [key]: result,
        [providerId]: result,
      },
    },
  };
}

export function getAvailableFetchedModels(
  entry: ProviderModelFetchCacheEntry | undefined,
  currentRevision: number,
  kind: keyof ProviderModelGroups,
  selected: string[],
): string[] {
  if (!entry || entry.revision !== currentRevision) return [];
  const selectedSet = new Set(selected);
  return Array.from(new Set(entry.groups[kind].filter(Boolean)))
    .filter((modelId) => !selectedSet.has(modelId));
}

export function getCurrentAvailableFetchedModels(
  state: ProviderModelFetchState,
  providerId: string,
  kind: keyof ProviderModelGroups,
  selected: string[],
): string[] {
  if (!Object.prototype.hasOwnProperty.call(state.revisions, providerId)) return [];
  return getAvailableFetchedModels(
    state.entries[providerId],
    state.revisions[providerId],
    kind,
    selected,
  );
}

export function invalidateProviderModelFetchState(
  state: ProviderModelFetchState,
  providerId: string,
): ProviderModelFetchState {
  const { [providerId]: _entry, ...entries } = state.entries;
  const { [providerId]: _chatModelDraft, ...chatModelDrafts } = state.chatModelDrafts;
  const hasRevision = Object.prototype.hasOwnProperty.call(state.revisions, providerId);
  return {
    revisions: hasRevision
      ? { ...state.revisions, [providerId]: state.revisions[providerId] + 1 }
      : state.revisions,
    entries,
    chatModelDrafts,
  };
}

export function replaceProviderModelFetchSnapshot(
  state: ProviderModelFetchState,
  providerIds: string[],
): ProviderModelFetchState {
  const revisions = Object.fromEntries(
    Object.entries(state.revisions).map(([providerId, revision]) => [providerId, revision + 1]),
  );
  for (const providerId of providerIds) {
    if (!Object.prototype.hasOwnProperty.call(state.revisions, providerId)) {
      revisions[providerId] = 0;
    }
  }
  return {
    revisions,
    entries: {},
    chatModelDrafts: {},
  };
}

export function ensureProviderModelFetchRevisions(
  state: ProviderModelFetchState,
  providerIds: string[],
): ProviderModelFetchState {
  const revisions = { ...state.revisions };
  let changed = false;
  for (const providerId of providerIds) {
    if (!Object.prototype.hasOwnProperty.call(revisions, providerId)) {
      revisions[providerId] = 0;
      changed = true;
    }
  }
  return changed ? { ...state, revisions } : state;
}

export function isCurrentProviderModelFetch(
  revisions: Record<string, number>,
  providerId: string,
  requestRevision: number,
): boolean {
  return Object.prototype.hasOwnProperty.call(revisions, providerId)
    && revisions[providerId] === requestRevision;
}

export function applyFetchedModelsIfCurrent(
  state: ProviderModelFetchState,
  providerId: string,
  requestRevision: number,
  groups: ProviderModelGroups,
): { applied: boolean; state: ProviderModelFetchState } {
  if (!isCurrentProviderModelFetch(state.revisions, providerId, requestRevision)) {
    return { applied: false, state };
  }
  return {
    applied: true,
    state: {
      ...state,
      entries: {
        ...state.entries,
        [providerId]: { revision: requestRevision, groups },
      },
    },
  };
}

export function canAddFetchedChatModel(modelId: string, options: string[]): boolean {
  return Boolean(modelId) && options.includes(modelId);
}

export function canAddCurrentFetchedChatModel(
  state: ProviderModelFetchState,
  providerId: string,
  selectedModels: string[],
  modelId: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(state.revisions, providerId)) return false;
  const options = getAvailableFetchedModels(
    state.entries[providerId],
    state.revisions[providerId],
    "chat",
    selectedModels,
  );
  return canAddFetchedChatModel(modelId, options);
}

export function canConfirmProviderModelFetch(
  state: ProviderModelFetchState,
  providerIds: string[],
  providerId: string,
  requestRevision: number,
): boolean {
  return providerIds.includes(providerId) && isCurrentProviderModelFetch(
    state.revisions,
    providerId,
    requestRevision,
  );
}

export function canFetchProviderModels(
  isPersistedProvider: boolean,
  supportsModelFetch: boolean,
): boolean {
  return isPersistedProvider && supportsModelFetch;
}

export function canStartProviderModelFetch(
  providerId: string,
  providerIds: string[],
  savedProviderFingerprints: Record<string, string>,
  supportsModelFetch: boolean,
  revisions: Record<string, number>,
): boolean {
  return Object.prototype.hasOwnProperty.call(revisions, providerId)
    && providerIds.includes(providerId) && canFetchProviderModels(
    Object.prototype.hasOwnProperty.call(savedProviderFingerprints, providerId),
    supportsModelFetch,
  );
}

type ProviderModelFetchRequest = {
  providerId: string;
  providerName: string;
  providerIds: string[];
  savedProviderFingerprints: Record<string, string>;
  supportsModelFetch: boolean;
  getCurrentProviderIds: () => string[];
  getState: () => ProviderModelFetchState;
  replaceState: (state: ProviderModelFetchState) => void;
  openModal: (modal: ProviderModelFetchModal) => void;
  isCurrentRequest?: () => boolean;
};

export type ProviderModelFetchRunResult =
  | { started: false }
  | {
    started: true;
    applied: false;
    reason: "response";
    requestRevision: number;
    response: ProviderModelFetchResponse;
  }
  | {
    started: true;
    applied: false;
    reason: "stale";
    requestRevision: number;
    response?: ProviderModelFetchResponse;
  }
  | {
    started: true;
    applied: true;
    requestRevision: number;
    response: ProviderModelFetchResponse;
  };

export function settleProviderModelFetchRunIfOwned<T>(
  state: ProviderModelFetchRequestUiState<T>,
  key: string,
  providerId: string,
  owner: ProviderModelFetchRequestOwner,
  run: ProviderModelFetchRunResult,
  toTransient: (notice: { ok: boolean; message: string }) => T,
  notStartedMessage: string,
): ProviderModelFetchRequestSettlement<T> {
  if (run.started && !run.applied && run.reason === "stale") {
    return { applied: false, state };
  }

  let notice: { ok: boolean; message: string };
  if (!run.started) {
    notice = { ok: false, message: notStartedMessage };
  } else if (run.applied) {
    notice = {
      ok: true,
      message: `拉到 ${run.response.total} 个模型，请在弹窗中选择`,
    };
  } else {
    notice = {
      ok: false,
      message: run.response.message || (run.response.ok ? "模型响应缺少分组数据" : "失败"),
    };
  }

  return settleProviderModelFetchRequestIfOwned(
    state,
    key,
    providerId,
    owner,
    toTransient(notice),
  );
}

type OwnedProviderModelFetchRequest<T> = Omit<ProviderModelFetchRequest, "isCurrentRequest"> & {
  key: string;
  getRequestUiState: () => ProviderModelFetchRequestUiState<T>;
  replaceRequestUiState: (state: ProviderModelFetchRequestUiState<T>) => void;
  nextToken: () => number;
  busy: T;
  toTransient: (notice: { ok: boolean; message: string }) => T;
  toErrorTransient: (error: unknown) => T;
  notStartedMessage: string;
};

export async function runOwnedProviderModelFetch<T>(
  request: OwnedProviderModelFetchRequest<T>,
  execute: () => Promise<ProviderModelFetchResponse>,
): Promise<void> {
  const requestRevision = request.getState().revisions[request.providerId];
  const owner: ProviderModelFetchRequestOwner = {
    token: request.nextToken(),
    revision: typeof requestRevision === "number" ? requestRevision : -1,
  };
  request.replaceRequestUiState(beginProviderModelFetchRequest(
    request.getRequestUiState(),
    request.key,
    owner,
    request.busy,
  ));
  const isCurrentOwner = () => {
    const currentOwner = request.getRequestUiState().owners[request.key];
    return Boolean(
      currentOwner
      && currentOwner.token === owner.token
      && currentOwner.revision === owner.revision,
    );
  };

  try {
    const run = await runProviderModelFetch({
      providerId: request.providerId,
      providerName: request.providerName,
      providerIds: request.providerIds,
      savedProviderFingerprints: request.savedProviderFingerprints,
      supportsModelFetch: request.supportsModelFetch,
      getCurrentProviderIds: request.getCurrentProviderIds,
      getState: request.getState,
      replaceState: request.replaceState,
      openModal: request.openModal,
      isCurrentRequest: isCurrentOwner,
    }, execute);
    const settlement = settleProviderModelFetchRunIfOwned(
      request.getRequestUiState(),
      request.key,
      request.providerId,
      owner,
      run,
      request.toTransient,
      request.notStartedMessage,
    );
    if (settlement.applied) request.replaceRequestUiState(settlement.state);
  } catch (error) {
    const settlement = settleProviderModelFetchRequestIfOwned(
      request.getRequestUiState(),
      request.key,
      request.providerId,
      owner,
      request.toErrorTransient(error),
    );
    if (settlement.applied) request.replaceRequestUiState(settlement.state);
  }
}

export async function runProviderModelFetch(
  request: ProviderModelFetchRequest,
  execute: () => Promise<ProviderModelFetchResponse>,
): Promise<ProviderModelFetchRunResult> {
  const startState = request.getState();
  if (!canStartProviderModelFetch(
    request.providerId,
    request.providerIds,
    request.savedProviderFingerprints,
    request.supportsModelFetch,
    startState.revisions,
  )) return { started: false };
  const requestRevision = startState.revisions[request.providerId];
  const getCurrentState = () => {
    const currentState = request.getState();
    return canConfirmProviderModelFetch(
      currentState,
      request.getCurrentProviderIds(),
      request.providerId,
      requestRevision,
    ) && (request.isCurrentRequest?.() ?? true) ? currentState : null;
  };
  let response: ProviderModelFetchResponse;
  try {
    response = await execute();
  } catch (error) {
    if (!getCurrentState()) {
      return { started: true, applied: false, reason: "stale", requestRevision };
    }
    throw error;
  }

  const currentState = getCurrentState();
  if (!currentState) {
    return { started: true, applied: false, reason: "stale", requestRevision, response };
  }
  if (!response.ok || !response.grouped) {
    return { started: true, applied: false, reason: "response", requestRevision, response };
  }

  const groups: ProviderModelGroups = {
    image: response.grouped.image || [],
    video: response.grouped.video || [],
    chat: response.grouped.chat || [],
  };
  const applied = applyFetchedModelsIfCurrent(
    currentState,
    request.providerId,
    requestRevision,
    groups,
  );
  if (!applied.applied) {
    return { started: true, applied: false, reason: "stale", requestRevision, response };
  }

  request.replaceState(applied.state);
  request.openModal({
    providerId: request.providerId,
    providerName: request.providerName,
    fetchedModels: groups,
    revision: requestRevision,
  });
  return { started: true, applied: true, requestRevision, response };
}
