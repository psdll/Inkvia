import { getDefaultLlmEndpointTemplate } from "@/lib/llm-routing/endpoint";
import { hasLlmProtocolAdapter } from "@/lib/llm-routing/adapters/registry";
import type { ProviderProtocol } from "./types";

type ProviderLlmUiInput = {
  id: string;
  protocol: ProviderProtocol;
  chatModels?: string[];
  llmProtocol?: unknown;
  llmEndpointTemplate?: unknown;
};

export function resolveProviderLlmUiSettings(provider: ProviderLlmUiInput) {
  const defaultEndpointTemplate = getDefaultLlmEndpointTemplate(provider);
  const explicitOpenAiChat = provider.llmProtocol === "openai-chat";
  const llmProtocol = provider.llmProtocol ?? "openai-chat";
  const supportsLlm = (explicitOpenAiChat || defaultEndpointTemplate !== null) && hasLlmProtocolAdapter(llmProtocol);
  const configuredTemplate = typeof provider.llmEndpointTemplate === "string"
    ? provider.llmEndpointTemplate.trim()
    : "";

  return {
    supportsLlm,
    defaultEndpointTemplate,
    llmProtocol: supportsLlm ? "openai-chat" as const : undefined,
    llmEndpointTemplate: configuredTemplate || defaultEndpointTemplate || undefined,
  };
}

export type AdminLlmBinding = { providerId: string; modelId: string };

export type AdminLlmScenarioView = {
  id: string;
  label: string;
  visual: boolean;
  configured: AdminLlmBinding | null;
  effective: Partial<AdminLlmBinding> & { status: string };
  candidates: Array<AdminLlmBinding & { status: string }>;
};

export function isScenarioBoundToModel(
  scenario: AdminLlmScenarioView,
  providerId: string,
  modelId: string,
): boolean {
  const binding = scenario.configured ?? (
    scenario.effective.providerId && scenario.effective.modelId
      ? { providerId: scenario.effective.providerId, modelId: scenario.effective.modelId }
      : null
  );
  return binding?.providerId === providerId && binding.modelId === modelId;
}

export function boundScenarioLabels(
  scenarios: AdminLlmScenarioView[],
  providerId: string,
  modelId: string,
): string[] {
  return scenarios
    .filter((scenario) => isScenarioBoundToModel(scenario, providerId, modelId))
    .map((scenario) => scenario.label);
}

type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type InlineRouteAction = {
  kind: "busy" | "success" | "error" | "sync_failed";
  providerId: string;
  modelId: string;
  message?: string;
};

export const PROVIDER_LLM_SYNC_FAILED_MESSAGE = "模型已激活，但配置同步失败，请刷新后再操作。";
export const PROVIDER_SAVE_SYNC_FAILED_MESSAGE = "配置已保存，但配置同步失败，请刷新后再操作。";

export type ProviderAdminSnapshotOperation =
  | { kind: "refresh" }
  | { kind: "activation" }
  | { kind: "provider-save"; providerId: string }
  | { kind: "proxy-save" };

type ProviderAdminSnapshotRow = {
  id: string;
  chatModels: string[];
  hasKey?: unknown;
  keyPreview?: unknown;
  keySource?: unknown;
};

export function providerAdminRowFingerprint<T extends ProviderAdminSnapshotRow>(provider: T) {
  const { hasKey, keyPreview, keySource, ...persistedProvider } = provider;
  return JSON.stringify(persistedProvider);
}

export function mergeProviderAdminSnapshotCommit<T extends ProviderAdminSnapshotRow>({
  operation,
  currentProviders,
  snapshotProviders,
  savedProviderFingerprints,
  keyDrafts,
  clearKeyDrafts,
  proxyUrlDraft,
}: {
  operation: ProviderAdminSnapshotOperation;
  currentProviders: T[];
  snapshotProviders: T[];
  savedProviderFingerprints: Record<string, string>;
  keyDrafts: Record<string, string>;
  clearKeyDrafts: Record<string, boolean>;
  proxyUrlDraft: string;
}) {
  const currentById = new Map(currentProviders.map((provider) => [provider.id, provider]));
  const snapshotIds = new Set(snapshotProviders.map((provider) => provider.id));
  const unsavedDraftProviders = currentProviders.filter((provider) => (
    !snapshotIds.has(provider.id)
    && !Object.prototype.hasOwnProperty.call(savedProviderFingerprints, provider.id)
    && provider.id.startsWith("custom-")
  ));
  const unsavedDraftIds = new Set(unsavedDraftProviders.map((provider) => provider.id));
  const savedTargetId = operation.kind === "provider-save" ? operation.providerId : null;
  const nextSavedProviderFingerprints: Record<string, string> = {};

  const providers = snapshotProviders.map((snapshotProvider) => {
    const currentProvider = currentById.get(snapshotProvider.id);
    const dirty = Boolean(currentProvider) && (
      providerAdminRowFingerprint(currentProvider!) !== savedProviderFingerprints[snapshotProvider.id]
      || Boolean(keyDrafts[snapshotProvider.id]?.trim())
      || clearKeyDrafts[snapshotProvider.id] === true
    );
    const preserveDraft = Boolean(currentProvider) && dirty && snapshotProvider.id !== savedTargetId;

    if (preserveDraft && Object.prototype.hasOwnProperty.call(savedProviderFingerprints, snapshotProvider.id)) {
      nextSavedProviderFingerprints[snapshotProvider.id] = savedProviderFingerprints[snapshotProvider.id];
    } else if (!preserveDraft) {
      nextSavedProviderFingerprints[snapshotProvider.id] = providerAdminRowFingerprint(snapshotProvider);
    }

    return preserveDraft ? currentProvider! : snapshotProvider;
  }).concat(unsavedDraftProviders);

  const keepProviderDraft = (providerId: string) => (
    (snapshotIds.has(providerId) || unsavedDraftIds.has(providerId)) && providerId !== savedTargetId
  );

  return {
    providers,
    savedProviderFingerprints: nextSavedProviderFingerprints,
    savedChatModelsByProviderId: Object.fromEntries(
      snapshotProviders.map((provider) => [provider.id, [...provider.chatModels]]),
    ),
    keyDrafts: Object.fromEntries(
      Object.entries(keyDrafts).filter(([providerId]) => keepProviderDraft(providerId)),
    ),
    clearKeyDrafts: Object.fromEntries(
      Object.entries(clearKeyDrafts).filter(([providerId]) => keepProviderDraft(providerId)),
    ),
    proxyUrlDraft: operation.kind === "proxy-save" ? "" : proxyUrlDraft,
  };
}

export type ProviderLlmAdminControllerState = {
  revision: string;
  sync: { kind: "ready" | "refreshing" | "sync_failed"; message?: string };
  operation: { kind: "idle" | "refreshing" | "activating" | "writing" };
  actions: Record<string, InlineRouteAction>;
};

export function canMutateAdminDraft(state: ProviderLlmAdminControllerState) {
  return state.operation.kind === "idle"
    && state.sync.kind === "ready"
    && !Object.values(state.actions).some((action) => action.kind === "busy");
}

export function guardAdminDraftMutation(
  state: ProviderLlmAdminControllerState,
  mutation: () => void,
) {
  if (!canMutateAdminDraft(state)) return false;
  mutation();
  return true;
}

export function commitProviderAdminDraftState<T>(
  ref: { current: T },
  setState: (next: T) => void,
  update: (current: T) => T,
) {
  const next = update(ref.current);
  ref.current = next;
  setState(next);
  return next;
}

export function createProviderLlmAdminController({
  initialRevision,
  fetchImpl,
  prepareSnapshots,
  reloadProviders,
  reloadRoutes,
  announceChange = () => undefined,
  onStateChange = () => undefined,
}: {
  initialRevision: string;
  fetchImpl: AdminFetch;
  prepareSnapshots?: (operation: ProviderAdminSnapshotOperation) => Promise<{ revision: string; commit: () => void }>;
  reloadProviders?: () => Promise<string>;
  reloadRoutes?: () => Promise<void>;
  announceChange?: () => void;
  onStateChange?: (state: ProviderLlmAdminControllerState) => void;
}) {
  let state: ProviderLlmAdminControllerState = {
    revision: initialRevision,
    sync: { kind: "ready" },
    operation: { kind: "idle" },
    actions: {},
  };
  let refreshPromise: Promise<"success" | "error"> | null = null;
  let nextOperationId = 0;
  let activeOperation: { id: number; source: "public-refresh" | "save" | "activation" } | null = null;

  const replaceState = (next: ProviderLlmAdminControllerState) => {
    state = next;
    onStateChange({
      ...state,
      sync: { ...state.sync },
      operation: { ...state.operation },
      actions: { ...state.actions },
    });
  };

  const acquireOperation = (
    source: "public-refresh" | "save" | "activation",
    kind: "refreshing" | "writing" | "activating",
  ) => {
    if (activeOperation) return null;
    const owner = { id: ++nextOperationId, source };
    activeOperation = owner;
    replaceState({ ...state, operation: { kind } });
    return owner;
  };

  const transitionOperation = (owner: { id: number }, kind: "refreshing" | "writing" | "activating") => {
    if (activeOperation?.id !== owner.id) return;
    replaceState({ ...state, operation: { kind } });
  };

  const releaseOperation = (owner: { id: number }) => {
    if (activeOperation?.id !== owner.id) return;
    activeOperation = null;
    replaceState({ ...state, operation: { kind: "idle" } });
  };

  const setAction = (scenarioId: string, action: InlineRouteAction) => {
    replaceState({ ...state, actions: { ...state.actions, [scenarioId]: action } });
  };

  const syncSnapshots = async (operation: ProviderAdminSnapshotOperation) => {
    if (prepareSnapshots) {
      const prepared = await prepareSnapshots(operation);
      prepared.commit();
      replaceState({ ...state, revision: prepared.revision });
      return;
    }
    if (!reloadProviders || !reloadRoutes) throw new Error("未配置管理端快照刷新器");
    const revision = await reloadProviders();
    await reloadRoutes();
    replaceState({ ...state, revision });
  };

  const runRefresh = (
    mode: "ordinary" | "retry" | "activation" | "save",
    operation: ProviderAdminSnapshotOperation,
  ): Promise<"success" | "error"> => {
    if (refreshPromise) return refreshPromise;
    const committedActivation = mode !== "ordinary";
    const syncFailureMessage = mode === "save"
      ? PROVIDER_SAVE_SYNC_FAILED_MESSAGE
      : state.sync.message || PROVIDER_LLM_SYNC_FAILED_MESSAGE;
    replaceState({
      ...state,
      sync: mode === "retry"
        ? { kind: "refreshing", message: syncFailureMessage }
        : { kind: "refreshing" },
    });

    const currentRefresh = (async (): Promise<"success" | "error"> => {
      try {
        await syncSnapshots(operation);
      } catch (error: any) {
        replaceState({
          ...state,
          sync: committedActivation
            ? { kind: "sync_failed", message: syncFailureMessage }
            : { kind: "ready", message: String(error?.message || error) },
        });
        return "error";
      }

      const actions = mode === "retry"
        ? Object.fromEntries(Object.entries(state.actions).map(([scenarioId, action]) => [
          scenarioId,
          action.kind === "sync_failed"
            ? { ...action, kind: "success" as const, message: "测试通过并已应用" }
            : action,
        ]))
        : state.actions;
      replaceState({ ...state, sync: { kind: "ready" }, actions });
      if (mode === "retry") announceChange();
      return "success";
    })();
    refreshPromise = currentRefresh;
    void currentRefresh.finally(() => {
      if (refreshPromise === currentRefresh) refreshPromise = null;
    });
    return currentRefresh;
  };

  const refresh = (): Promise<"success" | "error" | "busy"> => {
    if (activeOperation) {
      if (activeOperation.source === "public-refresh" && refreshPromise) return refreshPromise;
      return Promise.resolve("busy");
    }
    if (refreshPromise) return refreshPromise;
    if (Object.values(state.actions).some((action) => action.kind === "busy")) {
      return Promise.resolve("busy");
    }
    const owner = acquireOperation("public-refresh", "refreshing");
    if (!owner) return Promise.resolve("busy");
    const currentRefresh = runRefresh(
      state.sync.kind === "sync_failed" ? "retry" : "ordinary",
      { kind: "refresh" },
    );
    void currentRefresh.finally(() => releaseOperation(owner));
    return currentRefresh;
  };

  const markSyncFailed = (scenarioId: string, binding: AdminLlmBinding) => {
    replaceState({
      ...state,
      sync: { kind: "sync_failed", message: PROVIDER_LLM_SYNC_FAILED_MESSAGE },
    });
    setAction(scenarioId, {
      ...binding,
      kind: "sync_failed",
      message: PROVIDER_LLM_SYNC_FAILED_MESSAGE,
    });
  };

  const activate = async ({
    scenarioId,
    binding,
    scenarios,
    hasUnsavedProviderChanges,
  }: {
    scenarioId: string;
    binding: AdminLlmBinding;
    scenarios: AdminLlmScenarioView[];
    hasUnsavedProviderChanges: boolean;
  }): Promise<"blocked" | "busy" | "success" | "error" | "sync_failed"> => {
    if (state.sync.kind === "sync_failed") return "blocked";
    if (activeOperation) return "busy";
    if (state.sync.kind === "refreshing") return "busy";
    if (Object.values(state.actions).some((action) => action.kind === "busy")) return "busy";
    if (hasUnsavedProviderChanges) {
      setAction(scenarioId, {
        ...binding,
        kind: "error",
        message: "先保存平台配置，再应用 LLM 模型",
      });
      return "blocked";
    }

    const owner = acquireOperation("activation", "activating");
    if (!owner) return "busy";
    setAction(scenarioId, { ...binding, kind: "busy" });
    try {
      try {
        const response = await fetchImpl(`/api/admin/llm-routes/${scenarioId}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(binding),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      } catch (error: any) {
        setAction(scenarioId, {
          ...binding,
          kind: "error",
          message: String(error?.message || error),
        });
        return "error";
      }

      transitionOperation(owner, "refreshing");
      if (await runRefresh("activation", { kind: "activation" }) === "error") {
        markSyncFailed(scenarioId, binding);
        return "sync_failed";
      }

      setAction(scenarioId, { ...binding, kind: "success", message: "测试通过并已应用" });
      announceChange();
      return "success";
    } finally {
      releaseOperation(owner);
    }
  };

  const retrySync = async (): Promise<"success" | "sync_failed"> => {
    return await refresh() === "success" ? "success" : "sync_failed";
  };

  const save = async <T extends { revision?: unknown }>(
    request: (expectedRevision: string) => Promise<T>,
    operation: ProviderAdminSnapshotOperation = { kind: "refresh" },
  ): Promise<
    { kind: "blocked"; message: string }
    | { kind: "sync_failed"; data: T; message: string }
    | { kind: "success"; data: T }
  > => {
    if (state.sync.kind === "sync_failed") {
      return { kind: "blocked", message: state.sync.message || PROVIDER_LLM_SYNC_FAILED_MESSAGE };
    }
    if (activeOperation || state.sync.kind === "refreshing") {
      return { kind: "blocked", message: "配置同步中，请稍后再操作。" };
    }
    if (Object.values(state.actions).some((action) => action.kind === "busy")) {
      return { kind: "blocked", message: "模型配置中，请稍后再保存。" };
    }
    const owner = acquireOperation("save", "writing");
    if (!owner) return { kind: "blocked", message: "配置操作中，请稍后再保存。" };
    try {
      const data = await request(state.revision);
      if (data.revision !== undefined) replaceState({ ...state, revision: String(data.revision || "") });
      transitionOperation(owner, "refreshing");
      if (await runRefresh("save", operation) === "error") {
        return { kind: "sync_failed" as const, data, message: PROVIDER_SAVE_SYNC_FAILED_MESSAGE };
      }
      return { kind: "success" as const, data };
    } finally {
      releaseOperation(owner);
    }
  };

  return {
    getState: () => state,
    activate,
    refresh,
    retrySync,
    save,
  };
}

export async function requestProviderAdminSnapshot(fetchImpl: AdminFetch = fetch) {
  const response = await fetchImpl("/api/admin/providers", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function requestProviderAdminSave(fetchImpl: AdminFetch, payload: unknown) {
  const response = await fetchImpl("/api/admin/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export type ProviderAdminProxyAction =
  | { action: "keep" }
  | { action: "set"; url: string }
  | { action: "disable" }
  | { action: "inherit" }
  | { action: "system" };

export function requestProviderAdminProviderSave<T extends object>(
  fetchImpl: AdminFetch,
  {
    expectedRevision,
    provider,
    apiKey,
    clearApiKey = false,
  }: {
    expectedRevision: string;
    provider: T;
    apiKey?: string;
    clearApiKey?: boolean;
  },
) {
  return requestProviderAdminSave(fetchImpl, {
    expectedRevision,
    provider: {
      ...provider,
      apiKey: apiKey || undefined,
      clearApiKey,
    },
    proxyAction: { action: "keep" },
  });
}

export function requestProviderAdminProxySave(
  fetchImpl: AdminFetch,
  {
    expectedRevision,
    proxyAction,
  }: {
    expectedRevision: string;
    proxyAction: ProviderAdminProxyAction;
  },
) {
  return requestProviderAdminSave(fetchImpl, { expectedRevision, proxyAction });
}

export function removeProviderChatModel({
  scenarios,
  providerId,
  modelId,
  onBlocked,
  onRemove,
}: {
  scenarios: AdminLlmScenarioView[];
  providerId: string;
  modelId: string;
  onBlocked: (message: string) => void;
  onRemove: () => void;
}): boolean {
  const labels = boundScenarioLabels(scenarios, providerId, modelId);
  if (labels.length) {
    onBlocked(`该模型正在用于：${labels.join("、")}；请先切换这些用途`);
    return false;
  }
  onRemove();
  return true;
}

export function confirmProviderModelSelection({
  scenarios,
  providerId,
  currentChatModels,
  nextChatModels,
  onBlocked,
  onConfirm,
}: {
  scenarios: AdminLlmScenarioView[];
  providerId: string;
  currentChatModels: string[];
  nextChatModels: string[];
  onBlocked: (message: string) => void;
  onConfirm: () => void;
}) {
  for (const modelId of currentChatModels) {
    if (nextChatModels.includes(modelId)) continue;
    const allowed = removeProviderChatModel({
      scenarios,
      providerId,
      modelId,
      onBlocked,
      onRemove: () => undefined,
    });
    if (!allowed) return false;
  }
  onConfirm();
  return true;
}
