"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useAdminPageSelection } from "@/components/admin/useAdminPageSelection";
import { ProviderSidebar } from "@/components/admin/ProviderSidebar";
import { useDesktopMode } from "@/components/system/desktop-mode";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  Plug,
  Search,
  Settings2,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import { ProviderModelsModal } from "@/components/admin/ProviderModelsModal";
import { ProviderModelUsageGroups } from "@/components/admin/ProviderModelUsageGroups";
import type { InlineRouteAction } from "@/components/admin/ProviderLlmUsageTags";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FrostedSelect } from "@/components/ui/frosted-select";
import {
  canMutateAdminDraft,
  commitProviderAdminDraftState,
  confirmProviderModelSelection,
  createProviderLlmAdminController,
  guardAdminDraftMutation,
  mergeProviderAdminSnapshotCommit,
  providerAdminRowFingerprint as providerRowFingerprint,
  PROVIDER_LLM_SYNC_FAILED_MESSAGE,
  removeProviderChatModel,
  requestProviderAdminProviderSave,
  requestProviderAdminProxySave,
  requestProviderAdminSnapshot,
  resolveProviderLlmUiSettings,
  type AdminLlmBinding,
  type AdminLlmScenarioView,
  type ProviderAdminSnapshotOperation,
} from "@/lib/providers/admin-ui";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { hasConfiguredProviderModels, isBuiltinProviderModel } from "@/lib/providers/model-availability";
import { publishToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import type { ProviderModelGroups } from "@/lib/providers/model-selection";
import {
  canAddCurrentFetchedChatModel,
  canConfirmProviderModelFetch,
  canFetchProviderModels,
  ensureProviderModelFetchRevisions,
  getCurrentAvailableFetchedModels,
  invalidateProviderModelFetchRequest,
  invalidateProviderModelFetchState,
  replaceProviderModelFetchSnapshot,
  runOwnedProviderModelFetch,
  type ProviderModelFetchRequestOwner,
  type ProviderModelFetchState,
} from "@/lib/providers/model-fetch-cache";

// AI 平台配置面板。
//
// 数据流：
//   GET  /api/admin/providers              → 安全平台视图、代理状态和 revision
//   POST /api/admin/providers              → 原子保存平台注册表、服务端 Key 和代理配置
//   POST /api/admin/providers/fetch-models → 拉取并归类模型
//   POST /api/admin/providers/test         → 使用未保存草稿测试网络线路
//
// 已保存 Key 和代理凭据永不回填，本面板只展示脱敏状态。

type Protocol = "openai" | "apimart" | "gemini" | "volcengine" | "jimeng";

interface ProviderRow {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  envKeyName: string;
  egressMode: "direct" | "proxy";
  allowLegacyFallback?: boolean;
  configurationError?: "invalid-egress";
  imageModels: string[];
  videoModels: string[];
  audioModels: string[];
  chatModels: string[];
  modelProtocols: Record<string, Protocol>;
  imageRequestMode?: "openai" | "openai-json";
  registerUrl?: string;
  websiteUrl?: string;
  enabled: boolean;
  sortOrder: number;
  hasKey?: boolean;
  keyPreview?: string;
  keySource?: "saved" | "env" | "none";
  builtin?: boolean;
  llmProtocol?: "openai-chat";
  llmEndpointTemplate?: string;
}

type ProxyView = import("@/lib/providers/proxy-config").SafeProxyView;
type ProxyAction = import("@/lib/providers/admin-ui").ProviderAdminProxyAction;
type ProxyAvailability = "ready" | "missing" | "invalid";

function systemProxyMessage(system: ProxyView["system"], text: ReturnType<typeof useUiLocale>["text"]) {
  if (system?.status === "proxy") return text("admin.systemProxyDetected", { url: system.url });
  if (system?.status === "direct") return text("admin.systemProxyDirect");
  if (system?.status === "socks") return text("admin.systemProxySocks");
  return text("admin.systemProxyUnavailable");
}

type Transient = { kind: "fetch" | "test"; ok: boolean; message: string } | "busy";
type ProviderSaveState = { kind: "success" | "error"; message: string } | "busy";
type ModelModalState = { providerId: string; providerName: string; fetchedModels: ProviderModelGroups; revision: number };
type ProviderTestRequestOwner = { token: number; connectionRevision: number; connectionFingerprint: string };
type LlmRouteStatus =
  | "ready"
  | "missing-binding"
  | "provider-disabled"
  | "missing-key"
  | "missing-proxy"
  | "invalid-proxy"
  | "model-disabled"
  | "unsupported-capability"
  | "unsupported-protocol"
  | "invalid-endpoint";
type LlmRouteCandidate = {
  providerId: string;
  providerName: string;
  modelId: string;
  protocol: import("@/lib/llm-routing/adapters/types").LlmProtocol;
  status: LlmRouteStatus;
};
type LlmRouteBinding = AdminLlmBinding;
type LlmRouteScenario = AdminLlmScenarioView & {
  id: string;
  label: string;
  allowOverride: boolean;
  visual: boolean;
  candidates: LlmRouteCandidate[];
  configured: LlmRouteBinding | null;
  effective: Partial<LlmRouteBinding> & {
    providerName?: string;
    source?: string;
    status: LlmRouteStatus;
  };
  lastCall: null | {
    status: string;
    providerId: string | null;
    modelId: string | null;
    routeSource: string | null;
    createdAt: string;
  };
};

function providerTestConnectionFingerprint(
  provider: ProviderRow,
  apiKeyDraft: string,
  clearApiKey: boolean,
  proxyUrlDraft: string,
) {
  return JSON.stringify({
    id: provider.id,
    baseUrl: provider.baseUrl.trim(),
    egressMode: provider.egressMode,
    enabled: provider.enabled,
    hasKey: provider.hasKey === true,
    keySource: provider.keySource || "none",
    apiKeyDraft,
    clearApiKey,
    proxyUrlDraft: proxyUrlDraft.trim(),
  });
}

function providerModelFetchConnectionFingerprint(provider: ProviderRow) {
  return JSON.stringify({
    id: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl.trim(),
    egressMode: provider.egressMode,
    enabled: provider.enabled,
    configurationError: provider.configurationError || null,
    hasKey: provider.hasKey === true,
    keySource: provider.keySource || "none",
    keyPreview: provider.keyPreview || "",
    llmProtocol: provider.llmProtocol || null,
    llmEndpointTemplate: provider.llmEndpointTemplate || null,
  });
}

export default function ProvidersPanel({ refreshSignal, active = true }: { refreshSignal?: number; active?: boolean }) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, label: uiLabel } = useUiLocale();
  const desktopMode = useDesktopMode();
  const { text } = useUiLocale();
  const environmentName = desktopMode ? "本机" : "服务器";
  const [selectedProviderId, setSelectedProviderId] = useAdminPageSelection<string>("api-provider", "");
  const [search, setSearch] = React.useState("");
  const [settingsProviderId, setSettingsProviderId] = React.useState<string | null>(null);
  const [proxySettingsOpen, setProxySettingsOpen] = React.useState(false);
  const [proxyMode, setProxyMode] = React.useState<"set" | "inherit" | "disable" | "system">("set");
  const [keyEditing, setKeyEditing] = React.useState<Record<string, boolean>>({});
  const [proxySaved, setProxySaved] = React.useState(false);
  const [providers, setProviders] = React.useState<ProviderRow[]>([]);
  const providersRef = React.useRef(providers);
  const [proxy, setProxy] = React.useState<ProxyView>({
    overrideState: "inherit",
    source: "none",
    preview: null,
    hasCredentials: false,
  });
  React.useEffect(() => {
    if (!desktopMode || !active || !proxySettingsOpen) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const res = await fetch("/api/admin/providers?proxyStatus=1", { cache: "no-store", signal: controller.signal });
        if (res.ok) {
          const data = await res.json() as { proxy: ProxyView };
          if (!controller.signal.aborted) setProxy(current => ({ ...current, system: data.proxy.system }));
        }
      } catch {} finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [desktopMode, active, proxySettingsOpen]);
  const [proxyUrlDraft, setProxyUrlDraft] = React.useState("");
  const [proxyStatusByProviderId, setProxyStatusByProviderId] = React.useState<Record<string, ProxyAvailability>>({});
  const [proxySaving, setProxySaving] = React.useState(false);
  const [snapshotsRefreshing, setSnapshotsRefreshing] = React.useState(true);
  const [controllerBusy, setControllerBusy] = React.useState(true);
  const [savingProviderId, setSavingProviderId] = React.useState<string | null>(null);
  const [providerSaveStates, setProviderSaveStates] = React.useState<Record<string, ProviderSaveState>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [transient, setTransientState] = React.useState<Record<string, Transient>>({});
  const transientRef = React.useRef(transient);
  const providerTestRequestOwnersRef = React.useRef<Record<string, ProviderTestRequestOwner>>({});
  const providerTestConnectionRevisionsRef = React.useRef<Record<string, number>>({});
  const nextProviderTestRequestTokenRef = React.useRef(0);
  const modelFetchRequestOwnersRef = React.useRef<Record<string, ProviderModelFetchRequestOwner>>({});
  const nextModelFetchRequestTokenRef = React.useRef(0);
  const [keyDrafts, setKeyDrafts] = React.useState<Record<string, string>>({});
  const keyDraftsRef = React.useRef(keyDrafts);
  const [clearKeyDrafts, setClearKeyDrafts] = React.useState<Record<string, boolean>>({});
  const clearKeyDraftsRef = React.useRef(clearKeyDrafts);
  const proxyUrlDraftRef = React.useRef(proxyUrlDraft);
  const [modelFetchState, setModelFetchState] = React.useState<ProviderModelFetchState>({
    revisions: {},
    entries: {},
    chatModelDrafts: {},
  });
  const modelFetchStateRef = React.useRef(modelFetchState);
  const [modelModal, setModelModal] = React.useState<ModelModalState | null>(null);
  const [savedProviderFingerprints, setSavedProviderFingerprints] = React.useState<Record<string, string>>({});
  const savedProviderFingerprintsRef = React.useRef(savedProviderFingerprints);
  const [savedChatModelsByProviderId, setSavedChatModelsByProviderId] = React.useState<Record<string, string[]>>({});
  const [scenarios, setScenarios] = React.useState<LlmRouteScenario[]>([]);
  const [routeDrafts, setRouteDrafts] = React.useState<Record<string, LlmRouteBinding>>({});
  const routeDraftsRef = React.useRef(routeDrafts);
  const [routeStatus, setRouteStatus] = React.useState<Record<string, InlineRouteAction>>({});
  const [dismissedRouteFailures, setDismissedRouteFailures] = React.useState<Record<string, string>>({});
  const [disableBlockedProvider, setDisableBlockedProvider] = React.useState<{
    providerName: string;
    scenarioLabels: string[];
  } | null>(null);
  const [routeSyncMessage, setRouteSyncMessage] = React.useState<string | null>(null);

  React.useEffect(() => { keyDraftsRef.current = keyDrafts; }, [keyDrafts]);
  React.useEffect(() => { clearKeyDraftsRef.current = clearKeyDrafts; }, [clearKeyDrafts]);
  React.useEffect(() => { proxyUrlDraftRef.current = proxyUrlDraft; }, [proxyUrlDraft]);
  React.useEffect(() => { routeDraftsRef.current = routeDrafts; }, [routeDrafts]);

  const replaceProviders = React.useCallback((next: ProviderRow[]) => {
    providersRef.current = next;
    setProviders(next);
  }, []);

  const updateProviders = React.useCallback((update: (current: ProviderRow[]) => ProviderRow[]) => {
    const next = update(providersRef.current);
    providersRef.current = next;
    setProviders(next);
  }, []);

  const replaceTransient = React.useCallback((next: Record<string, Transient>) => {
    transientRef.current = next;
    setTransientState(next);
  }, []);

  const updateTransient = React.useCallback((update: (current: Record<string, Transient>) => Record<string, Transient>) => {
    replaceTransient(update(transientRef.current));
  }, [replaceTransient]);

  const currentProviderTestConnectionFingerprint = React.useCallback((providerId: string) => {
    const provider = providersRef.current.find((item) => item.id === providerId);
    if (!provider) return null;
    return providerTestConnectionFingerprint(
      provider,
      keyDraftsRef.current[providerId] || "",
      clearKeyDraftsRef.current[providerId] === true,
      proxyUrlDraftRef.current,
    );
  }, []);

  const invalidateProviderTestRequest = React.useCallback((providerId: string) => {
    const key = `${providerId}:test`;
    providerTestConnectionRevisionsRef.current = {
      ...providerTestConnectionRevisionsRef.current,
      [providerId]: (providerTestConnectionRevisionsRef.current[providerId] || 0) + 1,
    };
    if (key in providerTestRequestOwnersRef.current) {
      const owners = { ...providerTestRequestOwnersRef.current };
      delete owners[key];
      providerTestRequestOwnersRef.current = owners;
    }
    if (key in transientRef.current || providerId in transientRef.current) {
      const next = { ...transientRef.current };
      delete next[key];
      delete next[providerId];
      replaceTransient(next);
    }
  }, [replaceTransient]);

  const invalidateAllProviderTestRequests = React.useCallback(() => {
    const providerIds = new Set(providersRef.current.map((provider) => provider.id));
    for (const key of Object.keys(providerTestRequestOwnersRef.current)) {
      if (key.endsWith(":test")) providerIds.add(key.slice(0, -":test".length));
    }
    for (const providerId of providerIds) invalidateProviderTestRequest(providerId);
  }, [invalidateProviderTestRequest]);

  const applyModelFetchRequestUiState = React.useCallback((next: {
    owners: Record<string, ProviderModelFetchRequestOwner>;
    transient: Record<string, Transient>;
  }) => {
    modelFetchRequestOwnersRef.current = next.owners;
    replaceTransient(next.transient);
  }, [replaceTransient]);

  const invalidateModelFetchRequest = React.useCallback((providerId: string) => {
    const key = `${providerId}:fetch-models`;
    const current = {
      owners: modelFetchRequestOwnersRef.current,
      transient: transientRef.current,
    };
    const next = invalidateProviderModelFetchRequest(current, key, providerId);
    if (next !== current) applyModelFetchRequestUiState(next);
  }, [applyModelFetchRequestUiState]);

  const invalidateAllModelFetchRequests = React.useCallback(() => {
    let next = {
      owners: modelFetchRequestOwnersRef.current,
      transient: transientRef.current,
    };
    const providerIds = new Set(providersRef.current.map((provider) => provider.id));
    for (const key of Object.keys(next.owners)) {
      if (key.endsWith(":fetch-models")) providerIds.add(key.slice(0, -":fetch-models".length));
    }
    for (const providerId of providerIds) {
      next = invalidateProviderModelFetchRequest(next, `${providerId}:fetch-models`, providerId);
    }
    applyModelFetchRequestUiState(next);
  }, [applyModelFetchRequestUiState]);

  const replaceSavedProviderFingerprints = React.useCallback((next: Record<string, string>) => {
    savedProviderFingerprintsRef.current = next;
    setSavedProviderFingerprints(next);
  }, []);

  const replaceModelFetchState = React.useCallback((next: ProviderModelFetchState) => {
    modelFetchStateRef.current = next;
    setModelFetchState(next);
  }, []);

  const invalidateFetchedModels = React.useCallback((providerId: string) => {
    invalidateModelFetchRequest(providerId);
    replaceModelFetchState(invalidateProviderModelFetchState(modelFetchStateRef.current, providerId));
  }, [invalidateModelFetchRequest, replaceModelFetchState]);

  const invalidateAllFetchedModels = React.useCallback(() => {
    invalidateAllModelFetchRequests();
    replaceModelFetchState(replaceProviderModelFetchSnapshot(
      modelFetchStateRef.current,
      providersRef.current.map((provider) => provider.id),
    ));
  }, [invalidateAllModelFetchRequests, replaceModelFetchState]);

  const prepareAdminSnapshots = React.useCallback(async (operation: ProviderAdminSnapshotOperation) => {
    const [providerData, routeResponse] = await Promise.all([
      requestProviderAdminSnapshot(fetch),
      fetch("/api/admin/llm-routes", { cache: "no-store" }),
    ]);
    const routeData = await routeResponse.json().catch(() => null);
    if (!routeResponse.ok || !routeData?.success) {
      throw new Error(routeData?.error || `HTTP ${routeResponse.status}`);
    }
    const nextProviders: ProviderRow[] = (providerData.providers || []).map(normalizeRow);
    const nextScenarios = Array.isArray(routeData.scenarios) ? routeData.scenarios as LlmRouteScenario[] : [];

    return {
      revision: String(providerData.revision || ""),
      commit: () => {
        const savedProviderId = operation.kind === "provider-save" ? operation.providerId : null;
        const currentSavedProvider = savedProviderId
          ? providersRef.current.find((provider) => provider.id === savedProviderId)
          : undefined;
        const nextSavedProvider = savedProviderId
          ? nextProviders.find((provider) => provider.id === savedProviderId)
          : undefined;
        const preservedModelFetchProviderId = operation.kind === "provider-save"
          && !keyDraftsRef.current[operation.providerId]?.trim()
          && clearKeyDraftsRef.current[operation.providerId] !== true
          && currentSavedProvider
          && nextSavedProvider
          && providerModelFetchConnectionFingerprint(currentSavedProvider)
            === providerModelFetchConnectionFingerprint(nextSavedProvider)
          ? operation.providerId
          : null;
        const merged = mergeProviderAdminSnapshotCommit({
          operation,
          currentProviders: providersRef.current,
          snapshotProviders: nextProviders,
          savedProviderFingerprints: savedProviderFingerprintsRef.current,
          keyDrafts: keyDraftsRef.current,
          clearKeyDrafts: clearKeyDraftsRef.current,
          proxyUrlDraft: proxyUrlDraftRef.current,
        });
        invalidateAllModelFetchRequests();
        invalidateAllProviderTestRequests();
        replaceProviders(merged.providers);
        if (providerData.proxy) setProxy(providerData.proxy as ProxyView);
        setProxyStatusByProviderId(providerData.proxyStatusByProviderId || {});
        commitProviderAdminDraftState(proxyUrlDraftRef, setProxyUrlDraft, () => merged.proxyUrlDraft);
        replaceSavedProviderFingerprints(merged.savedProviderFingerprints);
        setSavedChatModelsByProviderId(merged.savedChatModelsByProviderId);
        commitProviderAdminDraftState(keyDraftsRef, setKeyDrafts, () => merged.keyDrafts);
        commitProviderAdminDraftState(clearKeyDraftsRef, setClearKeyDrafts, () => merged.clearKeyDrafts);
        setProviderSaveStates({});
        const previousModelFetchState = modelFetchStateRef.current;
        const nextModelFetchState = replaceProviderModelFetchSnapshot(
          modelFetchStateRef.current,
          nextProviders.map((provider: ProviderRow) => provider.id),
        );
        if (preservedModelFetchProviderId
          && Object.prototype.hasOwnProperty.call(previousModelFetchState.revisions, preservedModelFetchProviderId)) {
          nextModelFetchState.revisions[preservedModelFetchProviderId] = previousModelFetchState.revisions[preservedModelFetchProviderId];
          if (previousModelFetchState.entries[preservedModelFetchProviderId]) {
            nextModelFetchState.entries[preservedModelFetchProviderId] = previousModelFetchState.entries[preservedModelFetchProviderId];
          }
          if (Object.prototype.hasOwnProperty.call(previousModelFetchState.chatModelDrafts, preservedModelFetchProviderId)) {
            nextModelFetchState.chatModelDrafts[preservedModelFetchProviderId] = previousModelFetchState.chatModelDrafts[preservedModelFetchProviderId];
          }
        }
        replaceModelFetchState(nextModelFetchState);
        setScenarios(nextScenarios);
      },
    };
  }, [invalidateAllModelFetchRequests, invalidateAllProviderTestRequests, replaceModelFetchState, replaceProviders, replaceSavedProviderFingerprints]);

  const llmAdminController = React.useMemo(() => createProviderLlmAdminController({
    initialRevision: "",
    fetchImpl: fetch,
    prepareSnapshots: prepareAdminSnapshots,
    announceChange: () => {
      window.dispatchEvent(new Event("llm-routes-changed"));
      publishToolboxModelVisibilityChanged();
    },
    onStateChange: (state) => {
      setRouteStatus(state.actions);
      setSnapshotsRefreshing(state.sync.kind === "refreshing");
      setControllerBusy(state.operation.kind !== "idle");
      setRouteSyncMessage(state.sync.kind === "sync_failed" || (state.sync.kind === "refreshing" && Boolean(state.sync.message))
        ? state.sync.message || PROVIDER_LLM_SYNC_FAILED_MESSAGE
        : null);
      if (state.sync.kind === "ready" && state.sync.message) setError(state.sync.message);
    },
  }), [prepareAdminSnapshots]);

  React.useEffect(() => {
    void llmAdminController.refresh();
  }, [llmAdminController]);

  const reloadAdminSnapshots = React.useCallback(async () => {
    setError(null);
    await llmAdminController.refresh();
  }, [llmAdminController]);

  const isProviderDirty = React.useCallback((row: ProviderRow) => (
    providerRowFingerprint(row) !== savedProviderFingerprints[row.id]
    || Boolean(keyDrafts[row.id]?.trim())
    || clearKeyDrafts[row.id] === true
  ), [clearKeyDrafts, keyDrafts, savedProviderFingerprints]);

  const hasUnsavedProviderChanges = React.useMemo(() => (
    providers.some(isProviderDirty)
    || proxyUrlDraft.trim().length > 0
    || Object.keys(routeDrafts).length > 0
  ), [isProviderDirty, providers, proxyUrlDraft, routeDrafts]);
  const routeBusy = Object.values(routeStatus).some((action) => action.kind === "busy");
  const lastRefreshSignal = React.useRef(refreshSignal);
  React.useEffect(() => {
    if (lastRefreshSignal.current === refreshSignal) return;
    if (!active) { lastRefreshSignal.current = refreshSignal; return; }
    if (controllerBusy || routeBusy) return;
    lastRefreshSignal.current = refreshSignal;
    void reloadAdminSnapshots();
  }, [refreshSignal, active, controllerBusy, routeBusy, reloadAdminSnapshots]);
  const query = search.trim().toLowerCase();
  const platformMatches = (row: ProviderRow) => `${row.name} ${row.id}`.toLowerCase().includes(query);
  const modelsOf = (row: ProviderRow) => [...row.imageModels, ...row.videoModels, ...row.audioModels, ...row.chatModels];
  const configuredProviders = providers.filter((row) => hasConfiguredProviderModels(row)
    || isProviderDirty(row));
  const visibleProviders = configuredProviders.filter((row) => platformMatches(row) || modelsOf(row).some((model) => model.toLowerCase().includes(query)));
  const currentProviderId = visibleProviders.some((row) => row.id === selectedProviderId)
    ? selectedProviderId : visibleProviders[0]?.id;
  const adminOperationsLocked = controllerBusy || routeSyncMessage !== null || routeBusy;
  const draftMutationsDisabled = adminOperationsLocked || !canMutateAdminDraft(llmAdminController.getState());
  const mutateAdminDraft = React.useCallback((mutation: () => void) => {
    if (controllerBusy) return false;
    return guardAdminDraftMutation(llmAdminController.getState(), mutation);
  }, [controllerBusy, llmAdminController]);

  const updateRouteDrafts = React.useCallback((
    update: (current: Record<string, LlmRouteBinding>) => Record<string, LlmRouteBinding>,
  ) => commitProviderAdminDraftState(routeDraftsRef, setRouteDrafts, update), []);

  const pruneProviderRouteDrafts = React.useCallback((providerId: string, chatModels: string[]) => {
    updateRouteDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([, binding]) => (
        binding.providerId !== providerId || chatModels.includes(binding.modelId)
      )),
    ));
  }, [updateRouteDrafts]);

  const clearProviderSaveState = (id: string) => setProviderSaveStates((current) => {
    if (!(id in current)) return current;
    const next = { ...current };
    delete next[id];
    return next;
  });

  const patch = (id: string, p: Partial<ProviderRow>) => {
    mutateAdminDraft(() => {
      clearProviderSaveState(id);
      invalidateFetchedModels(id);
      invalidateProviderTestRequest(id);
      updateProviders((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
    });
  };

  const toggleProviderEnabled = (row: ProviderRow) => {
    if (row.enabled) {
      const scenarioLabels = scenarios.flatMap((scenario) => {
        const currentBinding = scenario.configured ?? (
          scenario.effective.providerId && scenario.effective.modelId
            ? { providerId: scenario.effective.providerId, modelId: scenario.effective.modelId }
            : null
        );
        return currentBinding?.providerId === row.id ? [scenario.label] : [];
      });
      if (scenarioLabels.length) {
        setDisableBlockedProvider({ providerName: row.name, scenarioLabels });
        return;
      }
    }
    patch(row.id, { enabled: !row.enabled });
  };

  const patchProviderModels = (
    id: string,
    models: Partial<Pick<ProviderRow, "imageModels" | "videoModels" | "audioModels" | "chatModels">>,
  ) => {
    return mutateAdminDraft(() => {
      clearProviderSaveState(id);
      updateProviders((list) => list.map((item) => (item.id === id ? { ...item, ...models } : item)));
    });
  };

  const callAction = async (
    row: ProviderRow,
    path: "fetch-models" | "test",
  ) => {
    if (!mutateAdminDraft(() => undefined)) return;
    const key = `${row.id}:${path}`;
    const currentRow = providersRef.current.find((provider) => provider.id === row.id);
    const actionRow = currentRow || row;
    const executeRequest = async () => {
      const res = await fetch(`/api/admin/providers/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: actionRow.id,
          baseUrl: actionRow.baseUrl,
          apiKey: keyDraftsRef.current[row.id] || undefined,
          clearApiKey: clearKeyDraftsRef.current[row.id] === true,
          egressMode: actionRow.egressMode,
          proxyAction: proxyUrlDraftRef.current.trim()
            ? { action: "set", url: proxyUrlDraftRef.current.trim() }
            : { action: "keep" },
        }),
      });
      return res.json();
    };
    if (path === "fetch-models") {
      await runOwnedProviderModelFetch({
        key,
        providerId: row.id,
        providerName: actionRow.name,
        providerIds: providersRef.current.map((provider) => provider.id),
        savedProviderFingerprints: savedProviderFingerprintsRef.current,
        supportsModelFetch: Boolean(currentRow && supportsProviderModelFetch(currentRow)),
        getCurrentProviderIds: () => providersRef.current.map((provider) => provider.id),
        getState: () => modelFetchStateRef.current,
        replaceState: replaceModelFetchState,
        openModal: setModelModal,
        getRequestUiState: () => ({
          owners: modelFetchRequestOwnersRef.current,
          transient: transientRef.current,
        }),
        replaceRequestUiState: applyModelFetchRequestUiState,
        nextToken: () => { nextModelFetchRequestTokenRef.current += 1; return nextModelFetchRequestTokenRef.current; },
        busy: "busy" as const,
        toTransient: (notice) => ({ kind: "fetch" as const, ...notice }),
        toErrorTransient: (error) => ({
          kind: "fetch" as const,
          ok: false,
          message: String(error instanceof Error ? error.message : error),
        }),
        notStartedMessage: currentRow && !(row.id in savedProviderFingerprintsRef.current)
          ? "请先保存平台"
          : "平台配置已变化，请重新拉取模型",
      }, executeRequest);
      return;
    }

    const connectionRevision = providerTestConnectionRevisionsRef.current[row.id] || 0;
    const owner: ProviderTestRequestOwner = {
      token: nextProviderTestRequestTokenRef.current += 1,
      connectionRevision,
      connectionFingerprint: providerTestConnectionFingerprint(
        actionRow,
        keyDraftsRef.current[row.id] || "",
        clearKeyDraftsRef.current[row.id] === true,
        proxyUrlDraftRef.current,
      ),
    };
    providerTestRequestOwnersRef.current = {
      ...providerTestRequestOwnersRef.current,
      [key]: owner,
    };
    replaceTransient({ ...transientRef.current, [key]: "busy" });
    const ownsCurrentConnection = () => {
      const currentOwner = providerTestRequestOwnersRef.current[key];
      return Boolean(
        currentOwner
        && currentOwner.token === owner.token
        && currentOwner.connectionRevision === owner.connectionRevision
        && currentOwner.connectionFingerprint === owner.connectionFingerprint
        && (providerTestConnectionRevisionsRef.current[row.id] || 0) === owner.connectionRevision
        && currentProviderTestConnectionFingerprint(row.id) === owner.connectionFingerprint,
      );
    };
    const settleIfOwned = (result: Exclude<Transient, "busy">) => {
      if (!ownsCurrentConnection()) return;
      const owners = { ...providerTestRequestOwnersRef.current };
      delete owners[key];
      providerTestRequestOwnersRef.current = owners;
      replaceTransient({ ...transientRef.current, [key]: result, [row.id]: result });
    };
    try {
      const data = await executeRequest();
      const result = { kind: "test" as const, ok: !!data.ok, message: data.message || "" };
      settleIfOwned(result);
    } catch (e: any) {
      const result = { kind: "test" as const, ok: false, message: String(e?.message || e) };
      settleIfOwned(result);
    }
  };

  const runRouteActivation = (scenarioId: string, binding: LlmRouteBinding) => {
    setDismissedRouteFailures((current) => {
      if (!(scenarioId in current)) return current;
      const next = { ...current };
      delete next[scenarioId];
      return next;
    });
    return llmAdminController.activate({
      scenarioId,
      binding,
      scenarios,
      hasUnsavedProviderChanges,
    });
  };

  const saveProvider = async (row: ProviderRow) => {
    const pendingRoutes = Object.entries(routeDraftsRef.current).filter(([, binding]) => (
      binding.providerId === row.id
    ));
    const savingState: ProviderSaveState = "busy";
    invalidateProviderTestRequest(row.id);
    setSavingProviderId(row.id);
    setProviderSaveStates((current) => ({ ...current, [row.id]: savingState }));
    setError(null);
    try {
      const saveResult = await llmAdminController.save((expectedRevision) => (
        requestProviderAdminProviderSave(fetch, {
          expectedRevision,
          provider: row,
          apiKey: keyDrafts[row.id],
          clearApiKey: clearKeyDrafts[row.id] === true,
        })
      ), { kind: "provider-save", providerId: row.id });
      if (saveResult.kind === "blocked") throw new Error(saveResult.message);
      if (saveResult.kind === "sync_failed") {
        const data = saveResult.data;
        const nextProviders = (data.providers || []).map(normalizeRow);
        const savedRow = nextProviders.find((provider: ProviderRow) => provider.id === row.id);
        if (!savedRow) throw new Error("保存成功后未返回当前平台");
        updateProviders((current) => current.map((provider) => provider.id === row.id ? savedRow : provider));
        replaceModelFetchState(ensureProviderModelFetchRevisions(
          modelFetchStateRef.current,
          nextProviders.map((provider: ProviderRow) => provider.id),
        ));
        if (data.proxy) setProxy(data.proxy as ProxyView);
        setProxyStatusByProviderId(data.proxyStatusByProviderId || {});
        replaceSavedProviderFingerprints({
          ...savedProviderFingerprintsRef.current,
          [row.id]: providerRowFingerprint(savedRow),
        });
        setSavedChatModelsByProviderId((current) => ({
          ...current,
          [row.id]: [...savedRow.chatModels],
        }));
      }
      commitProviderAdminDraftState(keyDraftsRef, setKeyDrafts, (current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      commitProviderAdminDraftState(clearKeyDraftsRef, setClearKeyDrafts, (current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      if (saveResult.kind === "success") {
        for (const [scenarioId, binding] of pendingRoutes) {
          const activationResult = await llmAdminController.activate({
            scenarioId,
            binding,
            scenarios,
            hasUnsavedProviderChanges: false,
          });
          if (activationResult !== "success") {
            const action = llmAdminController.getState().actions[scenarioId];
            throw new Error(`模型已保存，但用途应用失败：${action?.message || "请重试"}`);
          }
          updateRouteDrafts((current) => {
            const next = { ...current };
            delete next[scenarioId];
            return next;
          });
        }
      }
      setProviderSaveStates((current) => ({
        ...current,
        [row.id]: {
          kind: "success",
          message: saveResult.kind === "sync_failed"
            ? `已保存；${saveResult.message}`
            : pendingRoutes.length
              ? "已保存，本平台配置及用途已立即生效"
              : "已保存，本平台配置已立即生效",
        },
      }));
    } catch (e: any) {
      setProviderSaveStates((current) => ({
        ...current,
        [row.id]: { kind: "error", message: String(e?.message || e) },
      }));
    } finally {
      setSavingProviderId(null);
    }
  };

  const saveProxy = async (proxyAction: ProxyAction) => {
    invalidateAllFetchedModels();
    invalidateAllProviderTestRequests();
    setProxySaving(true);
    setProxySaved(false);
    setError(null);
    try {
      const saveResult = await llmAdminController.save((expectedRevision) => (
        requestProviderAdminProxySave(fetch, { expectedRevision, proxyAction })
      ), { kind: "proxy-save" });
      if (saveResult.kind === "blocked") throw new Error(saveResult.message);
      if (saveResult.kind !== "sync_failed") setProxySaved(true);
      if (saveResult.kind === "sync_failed") {
        const data = saveResult.data;
        invalidateAllFetchedModels();
        if (data.proxy) setProxy(data.proxy as ProxyView);
        setProxyStatusByProviderId(data.proxyStatusByProviderId || {});
        commitProviderAdminDraftState(proxyUrlDraftRef, setProxyUrlDraft, () => "");
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setProxySaving(false);
    }
  };

  const modalProvider = modelModal
    ? providers.find((provider) => provider.id === modelModal.providerId)
    : undefined;

  const failedRouteChoices = React.useMemo(() => Object.entries(routeStatus).flatMap(([scenarioId, action]) => {
    if (action.kind !== "error" || action.message === "先保存平台配置，再应用 LLM 模型") return [];
    const failureKey = `${action.providerId}:${action.modelId}:${action.message || ""}`;
    if (dismissedRouteFailures[scenarioId] === failureKey) return [];
    const scenario = scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return [];
    const currentBinding = scenario.configured ?? (
      scenario.effective.providerId && scenario.effective.modelId
        ? { providerId: scenario.effective.providerId, modelId: scenario.effective.modelId }
        : null
    );
    const alternatives = scenario.candidates.flatMap((candidate) => {
      if (candidate.status !== "ready" || candidate.providerId === action.providerId) return [];
      if (currentBinding?.providerId === candidate.providerId && currentBinding.modelId === candidate.modelId) return [];
      const provider = providers.find((item) => item.id === candidate.providerId);
      if (!provider) return [];
      return [{ ...candidate, providerName: provider.name }];
    });
    return [{
      scenarioId,
      scenarioLabel: scenario.label,
      failureKey,
      message: action.message || "当前 LLM 模型不可用",
      hasCurrentBinding: currentBinding !== null,
      alternatives,
    }];
  }), [dismissedRouteFailures, providers, routeStatus, scenarios]);
  const failedRouteChoice = failedRouteChoices[0] || null;
  const dismissFailedRouteChoice = () => {
    if (!failedRouteChoice) return;
    setDismissedRouteFailures((current) => ({
      ...current,
      [failedRouteChoice.scenarioId]: failedRouteChoice.failureKey,
    }));
  };

  return (
    <div className="flex min-h-0 flex-col gap-5 lg:h-full">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2">
            <Plug className="w-4 h-4 text-blue-500" /><UiText id="admin.m8308b969c781" /></h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" aria-expanded={proxySettingsOpen} onClick={() => { setSettingsProviderId(null); setProxyMode(proxy.overrideState === "configured" ? "set" : proxy.overrideState === "disabled" ? "disable" : proxy.overrideState === "system" ? "system" : "inherit"); setProxySaved(false); setProxySettingsOpen(true); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)]"><Globe2 className="h-4 w-4" /><UiText id="admin.m01f8683f7bba" /></button>
          {snapshotsRefreshing && <UiProps ids={{"aria-label":["admin.m0069032e9ad3"]}}><Loader2 aria-label="admin.m0069032e9ad3" className="h-4 w-4 animate-spin text-[var(--app-muted)]" /></UiProps>}
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--app-muted)]" />
            <UiProps ids={{"aria-label":["admin.m24ce63a2a810"],"placeholder":["admin.ma0d9569277d4"]}}><input aria-label="admin.m24ce63a2a810" placeholder="admin.ma0d9569277d4" value={search} onChange={(event) => setSearch(event.target.value)} className="w-44 bg-transparent text-xs outline-none sm:w-64" /></UiProps>
          </label>
        </div>
      </header>

      {routeSyncMessage ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          {routeSyncMessage}<UiText id="admin.m2a08af3f4bf4" /></div>
      ) : null}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
          {uiError(error)}
        </div>
      )}

      {/* 已配置平台 */}
      <UiProps ids={{"title":["admin.m01f8683f7bba"],"confirmText":["admin.mc8550237ba70"],"cancelText":["admin.m3fd47edce45b"]}}><ConfirmDialog open={proxySettingsOpen} placement="right" title="admin.m01f8683f7bba" confirmText="admin.mc8550237ba70" cancelText="admin.m3fd47edce45b"
        confirmDisabled={adminOperationsLocked || proxySaving || (proxyMode === "set" && !proxyUrlDraft.trim())}
        onClose={() => setProxySettingsOpen(false)}
        onConfirm={async () => {
          if ((proxyMode === "disable" || proxyMode === "inherit") && !window.confirm(proxyMode === "disable" ? uiLabel(`禁用代理后，${proxyProviderNames(providers)} 将无法请求。确定继续吗？`) : uiLabel(`恢复环境继承后，${proxyProviderNames(providers)} 将改用${environmentName}环境变量${desktopMode ? "，未配置时使用系统代理" : ""}。确定继续吗？`))) return false;
          await saveProxy(proxyMode === "set" ? { action: "set", url: proxyUrlDraft.trim() } : { action: proxyMode });
          return false;
        }}>
        <div className="space-y-6">
          <div><div className="mb-3 text-sm font-medium"><UiText id="admin.m9fbd3b4f0eb2" /></div>
            <div className={desktopMode ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>{([{ value: "system", label: "admin.proxySystem" }, { value: "set", label: "admin.proxySet" }, { value: "inherit", label: "admin.proxyInherit" }, { value: "disable", label: "admin.proxyDisable" }] as const).filter(option => desktopMode || option.value !== "system").map((option) => <button key={option.value} type="button" aria-pressed={proxyMode === option.value} disabled={adminOperationsLocked} onClick={() => { setProxyMode(option.value); setProxySaved(false); }} className={`rounded-lg border px-2 py-2.5 text-xs ${proxyMode === option.value ? "border-[var(--primary-bg)] bg-[var(--panel-2)]" : "border-[var(--border)] text-[var(--app-muted)]"}`}>{text(option.label)}</button>)}</div>
          </div>
          {proxyMode === "set" ? <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="admin-proxy-url"><UiText id="admin.mb9af2de88d90" /></label>
          <UiProps ids={{"aria-label":["admin.m9ae6304e258f"],"placeholder":["admin.m6fee66a91154"]}}><input
            id="admin-proxy-url"
            type="text"
            aria-label="admin.m9ae6304e258f"
            value={proxyUrlDraft}
            disabled={draftMutationsDisabled}
            onChange={(event) => {
              const value = event.target.value;
              mutateAdminDraft(() => {
                invalidateAllFetchedModels();
                invalidateAllProviderTestRequests();
                commitProviderAdminDraftState(proxyUrlDraftRef, setProxyUrlDraft, () => value);
              });
            }}
            placeholder={proxy.overrideState === "configured" ? "admin.m6fee66a91154" : "http://user:password@proxy-host:7890"}
            autoComplete="off"
            spellCheck={false}
            className="w-full h-10 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[12px] text-[var(--app-fg)] outline-none"
          /></UiProps>
            <p className="break-all text-xs leading-5 text-[var(--app-muted)]"><UiText id="admin.m660648805666" />{proxy.preview || <UiText id="admin.m80a57e03f071" />}</p>
          </div> : <p className="text-sm leading-6 text-[var(--app-muted)]">{proxyMode === "system" || (desktopMode && proxyMode === "inherit" && proxy.source === "system") ? systemProxyMessage(proxy.system, text) : proxyMode === "inherit" ? <UiText id="admin.mccc03803bbf7" values={{v0: String(environmentName), v1: String(desktopMode ? "环境变量为空时跟随系统。" : "")}} /> : <UiText id="admin.m17201028f800" />}</p>}
          <div className="border-t border-[var(--border)] pt-5"><div className="mb-2 text-sm font-medium"><UiText id="admin.m70dea8132327" /></div><p className="text-sm leading-6 text-[var(--app-muted)]">{proxyProviderNames(providers)}</p></div>
          {proxyMode !== "system" && proxy.source === "mixed-environment" && <p className="text-xs text-amber-600"><UiText id="admin.mc912b8c2ec8d" /></p>}
          {proxySaved && <p role="status" className="text-sm text-emerald-600"><UiText id="admin.m22c6b4eb4cae" /></p>}
          {error && <p role="alert" className="text-sm text-red-500">{uiError(error)}</p>}
          {routeSyncMessage && <p role="alert" className="text-sm text-amber-600">{routeSyncMessage}</p>}
          <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.m2e99a3306691" /></p>
        </div>
      </ConfirmDialog></UiProps>

      <div className="grid min-h-0 gap-4 lg:-ml-2 lg:flex-1 lg:grid-cols-[164px_minmax(0,1fr)] lg:gap-x-6 lg:overflow-hidden">
        <UiProps ids={{"label":["admin.m44db1996481b"]}}><ProviderSidebar label="admin.m44db1996481b" selectedId={currentProviderId} onSelect={setSelectedProviderId}
          items={visibleProviders.map(row => ({ id: row.id, name: row.name, enabled: row.enabled, count: modelsOf(row).length, dirty: isProviderDirty(row) }))} /></UiProps>
      <UiProps ids={{"aria-label":["admin.m00376d744fbd"]}}><section className="min-h-0 min-w-0 lg:overflow-hidden" aria-label="admin.m00376d744fbd">
        {!visibleProviders.length && configuredProviders.length > 0 && <p className="py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m1282e12f862f" /></p>}
        {configuredProviders.map((row) => {
          const tr = transient[row.id];
          const result = tr && tr !== "busy" ? tr : null;
          const llmUiSettings = resolveProviderLlmUiSettings(row);
          const showModelFetch = supportsProviderModelFetch(row);
          const showModelUsage = showModelFetch || hasConfiguredProviderModels(row);
          const isPersistedProvider = row.id in savedProviderFingerprints;
          const canFetchModels = canFetchProviderModels(isPersistedProvider, showModelFetch);
          const showChatModels = showModelFetch && llmUiSettings.supportsLlm;
          const chatModelOptions = getCurrentAvailableFetchedModels(
            modelFetchState,
            row.id,
            "chat",
            row.chatModels,
          );
          const saveState = providerSaveStates[row.id];
          const rowDirty = isProviderDirty(row) || Object.values(routeDrafts).some((binding) => (
            binding.providerId === row.id
          ));
          return (
            <div
              key={row.id}
              hidden={row.id !== currentProviderId}
              className={[
                "min-h-0 min-w-0 transition-opacity",
                row.id === currentProviderId ? "lg:flex lg:h-full lg:flex-col lg:overflow-hidden" : "",
                row.enabled
                  ? ""
                  : "opacity-60",
              ].join(" ")}
            >
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-[var(--app-fg)]">{row.name}</span>
                {row.websiteUrl ? (
                  <a
                    href={row.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tLabel(`打开 ${row.name} 平台：${row.websiteUrl}`)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
                  >
                    <ExternalLink className="h-3 w-3" /><UiText id="admin.m6bd9b8c7543e" /></a>
                ) : null}
              {result && (
                <div
                  className={[
                    "inline-flex min-w-0 items-center gap-1.5 text-xs",
                    result.ok
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-600 dark:text-red-400",
                  ].join(" ")}
                >
                  {result.ok ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  <span className="truncate" title={result.message}>{result.message}</span>
                </div>
              )}

                {!row.enabled ? (
                  <span className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-[10px] font-medium text-[var(--app-muted)]"><UiText id="admin.ma8c3698b5b8c" /></span>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <UiProps ids={{"label":["admin.m0a98a48eaaac"]}}><ActionBtn icon={<Plug className="w-3.5 h-3.5" />} label="admin.m0a98a48eaaac" busy={transient[`${row.id}:test`] === "busy"} disabled={draftMutationsDisabled} onClick={() => callAction(row, "test")} /></UiProps>
                  <button type="button" aria-expanded={settingsProviderId === row.id} onClick={() => { setProxySettingsOpen(false); setSettingsProviderId(row.id); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs hover:bg-[var(--panel-2)]"><Settings2 className="h-3.5 w-3.5" /><UiText id="admin.mc49378a04488" /></button>
                  {showModelFetch ? <UiProps ids={{"label":["admin.m64af2e0f6b0a"]}}><ActionBtn icon={<Download className="w-3.5 h-3.5" />} label="admin.m64af2e0f6b0a" busy={transient[`${row.id}:fetch-models`] === "busy"} disabled={draftMutationsDisabled || !canFetchModels} onClick={() => callAction(row, "fetch-models")} /></UiProps> : null}
                  <button
                    type="button"
                    onClick={() => void saveProvider(row)}
                    disabled={adminOperationsLocked || !rowDirty || savingProviderId !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3 py-1.5 text-[12px] font-medium text-[var(--primary-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingProviderId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}<UiText id="admin.m0c7149986c66" /></button>
                </div>
              </div>

              {row.configurationError === "invalid-egress" ? (
                <div className="mt-2 text-[11px] text-red-600 dark:text-red-400"><UiText id="admin.mb8e1bcdf0f75" /></div>
              ) : row.egressMode === "proxy" && providerProxyAvailability(
                row.id,
                proxy,
                proxyStatusByProviderId,
                proxyUrlDraft,
              ) !== "ready" ? (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {uiLabel(providerProxyAvailabilityLabel(providerProxyAvailability(
                    row.id,
                    proxy,
                    proxyStatusByProviderId,
                    proxyUrlDraft,
                  )))}
                </div>
              ) : null}

              {!row.builtin && row.baseUrl.trim().toLowerCase().startsWith("http://") ? (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"><UiText id="admin.m22f264d8601f" /></div>
              ) : null}

              <UiProps ids={{"confirmText":["admin.mc8550237ba70"],"cancelText":["admin.m3fd47edce45b"]}}><ConfirmDialog open={settingsProviderId === row.id} placement="right" title={tLabel(`${row.name} · 平台设置`)} confirmText="admin.mc8550237ba70" cancelText="admin.m3fd47edce45b"
                confirmDisabled={adminOperationsLocked || !rowDirty || savingProviderId !== null}
                onClose={() => setSettingsProviderId(null)} onConfirm={async () => { await saveProvider(row); return false; }}>
                <div className="mb-6 flex items-center justify-between"><span className="text-sm font-medium"><UiText id="admin.m79612d07708f" /></span>                  <UiProps ids={{"title":["admin.maa70271f4273"]}}><button
                    disabled={draftMutationsDisabled}
                    onClick={() => toggleProviderEnabled(row)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-[11px] text-[var(--app-fg)]"
                    title="admin.maa70271f4273"
                  >
                    {row.enabled ? <UiText id="admin.m4e6fd0e28c55" /> : <UiText id="admin.mf4f0ead1116b" />}
                  </button></UiProps>
</div>
              <div className="mt-3">
                <span className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m6bd9b8c7543e" /></span>
                <div className="mt-1 flex items-center gap-2">
                  <UiProps ids={{"placeholder":["admin.maf62cf40eb6c"],"aria-label":["admin.m6bd9b8c7543e"]}}><input
                    value={row.websiteUrl || ""}
                    disabled={draftMutationsDisabled}
                    onChange={(e) => patch(row.id, { websiteUrl: e.target.value })}
                    placeholder="admin.maf62cf40eb6c"
                    aria-label="admin.m6bd9b8c7543e"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1.5 text-[12px] text-[var(--app-fg)]"
                  /></UiProps>
                  {/^https?:\/\//i.test(row.websiteUrl || "") ? (
                    <a
                      href={row.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
                    >
                      <ExternalLink className="h-3 w-3" /><UiText id="admin.mc771248e511f" /></a>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m6eb9acab4e9b" /></p>
              </div>
              <div className="mt-3">
                <label className="block">
                  <span className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m03b11112dc97" /></span>
                  <UiProps ids={{"placeholder":["admin.m53413c019b45"]}}><input
                    value={row.baseUrl}
                    disabled={draftMutationsDisabled}
                    onChange={(e) => patch(row.id, { baseUrl: e.target.value })}
                    placeholder={row.id === "bailian" ? "admin.m53413c019b45" : "https://api.example.com/v1"}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1.5 text-[12px] text-[var(--app-fg)]"
                  /></UiProps>
                </label>
                {row.id === "bailian" && <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mf6433bd6c99f" /></p>}
              </div>

                {row.id === "volcengine-mediakit" && <p className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m9572342113c2" /></p>}
                {row.id === "volcengine-speech" && <p className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m90a9ee37c112" /></p>}
                <div className="mt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-medium text-[var(--app-fg)]">API Key</div>
                    <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">
                      {row.keySource === "saved"
                        ? <UiText id="admin.mf74818c165a7" values={{v0: String(row.keyPreview || "")}} />
                        : row.keySource === "env"
                          ? <UiText id="admin.ma2525a519ee6" values={{v0: String(row.keyPreview || "")}} />
                          : <UiText id="admin.me49639a76984" />}
                    </div>
                  </div>
                  {row.hasKey && <button type="button" disabled={draftMutationsDisabled} onClick={() => setKeyEditing((current) => ({ ...current, [row.id]: !current[row.id] }))} className="ml-auto mr-2 text-xs text-[var(--primary-bg)]">{keyEditing[row.id] ? <UiText id="admin.mafd4b783536b" /> : <UiText id="admin.m916afcd85322" />}</button>}
                  {row.hasKey ? (
                    <button
                      type="button"
                      disabled={draftMutationsDisabled}
                      onClick={() => {
                        mutateAdminDraft(() => {
                          clearProviderSaveState(row.id);
                          invalidateFetchedModels(row.id);
                          invalidateProviderTestRequest(row.id);
                          commitProviderAdminDraftState(clearKeyDraftsRef, setClearKeyDrafts, (current) => ({
                            ...current,
                            [row.id]: !current[row.id],
                          }));
                        });
                      }}
                      className={[
                        "rounded-lg border px-2.5 py-1 text-[11px]",
                        clearKeyDrafts[row.id]
                          ? "border-red-500/35 bg-red-500/10 text-red-500"
                          : "border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-bg)]",
                      ].join(" ")}
                    >
                      {clearKeyDrafts[row.id] ? <UiText id="admin.me6f78e087224" /> : <UiText id="admin.mc2901574bffd" />}
                    </button>
                  ) : null}
                </div>
                <UiProps ids={{"placeholder":["admin.mf663867020cd"]}}><input
                  hidden={row.hasKey && !keyEditing[row.id] && !keyDrafts[row.id]}
                  type="password"
                  value={keyDrafts[row.id] || ""}
                  disabled={draftMutationsDisabled}
                  onChange={(e) => {
                    const value = e.target.value;
                    mutateAdminDraft(() => {
                      clearProviderSaveState(row.id);
                      invalidateFetchedModels(row.id);
                      invalidateProviderTestRequest(row.id);
                      commitProviderAdminDraftState(keyDraftsRef, setKeyDrafts, (current) => ({
                        ...current,
                        [row.id]: value,
                      }));
                      if (value) {
                        commitProviderAdminDraftState(clearKeyDraftsRef, setClearKeyDrafts, (current) => ({
                          ...current,
                          [row.id]: false,
                        }));
                      }
                    });
                  }}
                  placeholder={row.hasKey ? `输入新 Key 以覆盖当前值 ${row.keyPreview || ""}` : "admin.mf663867020cd"}
                  autoComplete="new-password"
                  spellCheck={false}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1.5 text-[12px] font-mono text-[var(--app-fg)]"
                /></UiProps>
              </div>

              <div className="mt-6"><div className="mb-2 text-sm font-medium"><UiText id="admin.m485a26050ce5" /></div>                <FrostedSelect
                  value={row.egressMode}
                  disabled={draftMutationsDisabled}
                  onChange={(value) => patch(row.id, { egressMode: value as "direct" | "proxy" })}
                  options={[{ value: "direct", label: tLabel("直连") }, { value: "proxy", label: tLabel("代理") }]}
                  showLeading={false}
                  side="auto"
                  compact
                  className="w-[100px]"
                  buttonClassName="h-8 rounded-lg px-2 text-[12px] shadow-none"
                />
</div>
              <details className="mt-6 text-xs text-[var(--app-muted)]"><summary className="cursor-pointer"><UiText id="admin.m44455611b910" /></summary><p className="mt-3"><UiText id="admin.m9ced4a9248d2" />{row.protocol}</p></details>
              {saveState && saveState !== "busy" && <p role="status" className={`mt-5 text-sm ${saveState.kind === "success" ? "text-emerald-600" : "text-red-500"}`}>{saveState.message}</p>}
              {result && <p role="status" className={`mt-4 text-sm ${result.ok ? "text-emerald-600" : "text-red-500"}`}>{result.message}</p>}
              {routeSyncMessage && <p role="alert" className="mt-4 text-sm text-amber-600">{routeSyncMessage}</p>}
              <p className="mt-6 text-xs text-[var(--app-muted)]"><UiText id="admin.m118e381dc8dd" /></p>
              </ConfirmDialog></UiProps>

              {showModelFetch && !isPersistedProvider ? (
                <div className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m4e2f954976f7" /></div>
              ) : null}

              {saveState && saveState !== "busy" ? (
                <div className={[
                  "mt-2 text-[11px]",
                  saveState.kind === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                ].join(" ")}>
                  {saveState.message}
                </div>
              ) : null}


              {showModelUsage ? (
                <ProviderModelUsageGroups
                  providerId={row.id}
                  compact
                  searchQuery={platformMatches(row) ? "" : query}
                  imageModels={row.imageModels}
                  audioModels={row.audioModels}
                  chatModels={row.chatModels}
                  videoModels={row.videoModels}
                  chatModelDraft={modelFetchState.chatModelDrafts[row.id] || ""}
                  chatModelOptions={chatModelOptions}
                  canManageChat={showChatModels}
                  savedChatModels={savedChatModelsByProviderId[row.id] || []}
                  scenarios={scenarios}
                  routeDrafts={routeDrafts}
                  routeActions={routeStatus}
                  routesDisabled={adminOperationsLocked || (hasUnsavedProviderChanges && !rowDirty)}
                  mutationsDisabled={draftMutationsDisabled}
                  onChatModelDraftChange={(value) => mutateAdminDraft(() => replaceModelFetchState({
                    ...modelFetchStateRef.current,
                    chatModelDrafts: { ...modelFetchStateRef.current.chatModelDrafts, [row.id]: value },
                  }))}
                  onAddChatModel={() => {
                    const model = modelFetchStateRef.current.chatModelDrafts[row.id] || "";
                    const currentRow = providersRef.current.find((provider) => provider.id === row.id);
                    if (!currentRow || !canAddCurrentFetchedChatModel(
                      modelFetchStateRef.current,
                      row.id,
                      currentRow.chatModels,
                      model,
                    )) return;
                    const nextChatModels = [...currentRow.chatModels, model];
                    if (!patchProviderModels(row.id, { chatModels: nextChatModels })) return;
                    const nextDraft = getCurrentAvailableFetchedModels(
                      modelFetchStateRef.current,
                      row.id,
                      "chat",
                      nextChatModels,
                    )[0] || "";
                    replaceModelFetchState({
                      ...modelFetchStateRef.current,
                      chatModelDrafts: {
                        ...modelFetchStateRef.current.chatModelDrafts,
                        [row.id]: nextDraft,
                      },
                    });
                  }}
                  onActivateRoute={(scenarioId, binding) => {
                    if (rowDirty) {
                      mutateAdminDraft(() => updateRouteDrafts((current) => ({
                        ...current,
                        [scenarioId]: binding,
                      })));
                      return;
                    }
                    void runRouteActivation(scenarioId, binding);
                  }}
                  onRemove={(kind, model) => {
                    if (isBuiltinProviderModel(row.id, kind, model)) return;
                    if (!mutateAdminDraft(() => undefined)) return;
                    const currentRow = providersRef.current.find((provider) => provider.id === row.id);
                    if (!currentRow) return;
                    if (kind === "image") {
                      patchProviderModels(row.id, { imageModels: currentRow.imageModels.filter((item) => item !== model) });
                      return;
                    }
                    if (kind === "video") {
                      patchProviderModels(row.id, { videoModels: currentRow.videoModels.filter((item) => item !== model) });
                      return;
                    }
                    if (kind === "audio") {
                      patchProviderModels(row.id, { audioModels: currentRow.audioModels.filter((item) => item !== model) });
                      return;
                    }
                    removeProviderChatModel({
                      scenarios,
                      providerId: row.id,
                      modelId: model,
                      onBlocked: (message) => setProviderSaveStates((current) => ({
                        ...current,
                        [row.id]: { kind: "error", message },
                      })),
                      onRemove: () => {
                        const nextChatModels = currentRow.chatModels.filter((item) => item !== model);
                        if (!patchProviderModels(row.id, { chatModels: nextChatModels })) return;
                        pruneProviderRouteDrafts(row.id, nextChatModels);
                      },
                    });
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {configuredProviders.length === 0 && !snapshotsRefreshing && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-6 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m17ca5b816661" /></div>
        )}
      </section></UiProps>
      </div>

      <UiProps ids={{"title":["admin.md33f1a6d1d02"],"description":["admin.m2f39265b1dcd"],"confirmText":["admin.mde32e20193ad"]}}><ConfirmDialog
        open={disableBlockedProvider !== null}
        title={disableBlockedProvider ? text("providersDynamic.m33da0f0d2d51", { provider: disableBlockedProvider.providerName }) : "admin.md33f1a6d1d02"}
        description="admin.m2f39265b1dcd"
        confirmText="admin.mde32e20193ad"
        showCancel={false}
        onClose={() => setDisableBlockedProvider(null)}
        onConfirm={() => setDisableBlockedProvider(null)}
      >
        {disableBlockedProvider ? (
          <div>
            <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.md8ee610c3bfb" /></div>
            <div className="mt-2 flex flex-wrap gap-2">
              {disableBlockedProvider.scenarioLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[12px] text-[var(--app-fg)]"
                >
                  {uiLabel(label)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </ConfirmDialog></UiProps>

      <UiProps ids={{"title":["admin.m4c90a2f1770b"],"confirmText":["admin.md6f3758d72fa"]}}><ConfirmDialog
        open={failedRouteChoice !== null}
        title={failedRouteChoice ? text("providersDynamic.m98071217de5c", { scenario: uiLabel(failedRouteChoice.scenarioLabel) }) : "admin.m4c90a2f1770b"}
        description={failedRouteChoice ? uiError(failedRouteChoice.message) : undefined}
        confirmText="admin.md6f3758d72fa"
        showCancel={false}
        danger
        onClose={dismissFailedRouteChoice}
        onConfirm={dismissFailedRouteChoice}
      >
        {failedRouteChoice ? (
          <div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--app-muted)]">
              {failedRouteChoice.hasCurrentBinding ? <UiText id="admin.mfb66d2a707ff" /> : <UiText id="admin.m56c7a58d8ed7" />}<UiText id="admin.m23380c4fb0af" /></div>
            {failedRouteChoice.alternatives.length ? (
              <div className="mt-3 grid gap-2">
                {failedRouteChoice.alternatives.map((candidate) => (
                  <button
                    key={`${candidate.providerId}:${candidate.modelId}`}
                    type="button"
                    disabled={adminOperationsLocked}
                    onClick={() => void runRouteActivation(failedRouteChoice.scenarioId, {
                      providerId: candidate.providerId,
                      modelId: candidate.modelId,
                    })}
                    className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-left text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{candidate.providerName} · {candidate.modelId}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mfdc8c141d064" /></div>
            )}
          </div>
        ) : null}
      </ConfirmDialog></UiProps>

      {modelModal ? (
        <ProviderModelsModal
          providerId={modelModal.providerId}
          providerName={modelModal.providerName}
          fetchedModels={modelModal.fetchedModels}
          selectedModels={{
            image: modalProvider?.imageModels || [],
            video: modalProvider?.videoModels || [],
            chat: modalProvider?.chatModels || [],
          }}
          supportsLlm={modalProvider ? resolveProviderLlmUiSettings(modalProvider).supportsLlm : false}
          mutationsDisabled={draftMutationsDisabled}
          canMutateDraft={() => !controllerBusy && canMutateAdminDraft(llmAdminController.getState())}
          onClose={() => setModelModal(null)}
          onConfirm={(models) => {
            if (!mutateAdminDraft(() => undefined)) return;
            if (!canConfirmProviderModelFetch(
              modelFetchStateRef.current,
              providersRef.current.map((provider) => provider.id),
              modelModal.providerId,
              modelModal.revision,
            )) {
              const result = { kind: "fetch" as const, ok: false, message: "平台配置已变化，请重新拉取模型" };
              updateTransient((current) => ({
                ...current,
                [`${modelModal.providerId}:fetch-models`]: result,
                [modelModal.providerId]: result,
              }));
              setModelModal(null);
              return;
            }
            const currentProvider = providersRef.current.find((provider) => provider.id === modelModal.providerId);
            if (!currentProvider) return;
            confirmProviderModelSelection({
              scenarios,
              providerId: modelModal.providerId,
              currentChatModels: currentProvider.chatModels,
              nextChatModels: models.chat,
              onBlocked: (message) => setProviderSaveStates((current) => ({
                ...current,
                [modelModal.providerId]: { kind: "error", message },
              })),
              onConfirm: () => {
                if (!patchProviderModels(modelModal.providerId, {
                  imageModels: currentProvider.builtin ? models.image : [],
                  videoModels: currentProvider.builtin ? models.video : [],
                  chatModels: models.chat,
                })) return;
                pruneProviderRouteDrafts(modelModal.providerId, models.chat);
                setModelModal(null);
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}

function ActionBtn({ icon, label, busy, disabled = false, onClick }: { icon: React.ReactNode; label: string; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-bg)] disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function normalizeRow(r: any): ProviderRow {
  const id = String(r.id);
  const protocol = (r.protocol ?? "openai") as Protocol;
  const chatModels = Array.isArray(r.chatModels) ? r.chatModels.map(String) : [];
  const llmUiSettings = resolveProviderLlmUiSettings({
    id,
    protocol,
    chatModels,
    llmProtocol: r.llmProtocol,
    llmEndpointTemplate: r.llmEndpointTemplate,
  });
  return {
    id,
    name: String(r.name ?? r.id),
    protocol,
    baseUrl: String(r.baseUrl ?? ""),
    envKeyName: String(r.envKeyName ?? ""),
    egressMode: r.egressMode === "proxy" ? "proxy" : "direct",
    allowLegacyFallback: r.allowLegacyFallback === true,
    configurationError: r.configurationError === "invalid-egress" ? "invalid-egress" : undefined,
    imageModels: Array.isArray(r.imageModels) ? r.imageModels.map(String) : [],
    videoModels: Array.isArray(r.videoModels) ? r.videoModels.map(String) : [],
    audioModels: Array.isArray(r.audioModels) ? r.audioModels.map(String) : [],
    chatModels,
    modelProtocols: r.modelProtocols && typeof r.modelProtocols === "object" ? r.modelProtocols : {},
    imageRequestMode: r.imageRequestMode,
    registerUrl: r.registerUrl,
    websiteUrl: typeof r.websiteUrl === "string" ? r.websiteUrl : "",
    enabled: r.enabled !== false,
    sortOrder: Number.isFinite(r.sortOrder) ? Number(r.sortOrder) : 0,
    hasKey: Boolean(r.hasKey),
    keyPreview: String(r.keyPreview || ""),
    keySource: r.keySource === "saved" || r.keySource === "env" ? r.keySource : "none",
    builtin: Boolean(r.builtin),
    llmProtocol: llmUiSettings.llmProtocol,
    llmEndpointTemplate: llmUiSettings.llmEndpointTemplate,
  };
}

function proxyAvailability(proxy: ProxyView): "ready" | "missing" | "invalid" | "mixed" {
  if (proxy.overrideState === "configured") return "ready";
  if (proxy.overrideState === "disabled") return "missing";
  if (proxy.overrideState === "invalid") return "invalid";
  if (proxy.source === "environment") return "ready";
  if (proxy.source === "mixed-environment") return "mixed";
  return "missing";
}

function providerProxyAvailability(
  providerId: string,
  proxy: ProxyView,
  statuses: Record<string, ProxyAvailability>,
  proxyUrlDraft: string,
): ProxyAvailability {
  if (proxyUrlDraft.trim()) return "ready";
  return statuses[providerId] ?? (proxyAvailability(proxy) === "ready" ? "ready" : "missing");
}

function providerProxyAvailabilityLabel(availability: ProxyAvailability) {
  if (availability === "invalid") return "该平台的代理配置无效，请修正后再发送请求。";
  return "该平台当前缺少代理；请求会严格失败且不会回退直连。";
}

function proxyStateLabel(proxy: ProxyView) {
  const availability = proxyAvailability(proxy);
  if (availability === "ready") return proxy.source === "database" ? "数据库统一代理已配置" : "正在继承环境代理";
  if (availability === "mixed") return "旧环境变量不一致";
  if (availability === "invalid") return "数据库代理配置非法";
  return proxy.overrideState === "disabled" ? "代理已明确禁用" : "未找到可用代理";
}

function proxyAvailabilityLabel(proxy: ProxyView) {
  const availability = proxyAvailability(proxy);
  if (availability === "mixed") return "代理环境变量不一致或部分不可用，请保存统一代理。";
  if (availability === "invalid") return "代理配置非法，代理平台会严格失败。";
  return "当前缺少代理，代理平台会严格失败且不会回退直连。";
}

function proxyProviderNames(providers: ProviderRow[]) {
  const names = providers.filter((provider) => provider.egressMode === "proxy").map((provider) => provider.name);
  return names.length ? names.join("、") : "所有选择代理的平台";
}
