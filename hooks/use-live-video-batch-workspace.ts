"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createToolClientUuid } from "@/lib/tool-media/client-draft";
import { nextLiveVideoBatchName } from "@/lib/live-video-batch/naming";
import type { LiveVideoBatchInputMode } from "@/lib/live-video-batch/video-models";
import type { BatchProductLibraryDrop } from "@/components/batch-workbench/batch-media-gallery";
import type { BatchMediaRelation } from "@/components/batch-workbench/types";
import { isKnownDeletedGenerationId, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { ephemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { INTERRUPTED_UPLOAD_NOTICE, readDesktopInputDraft, writeDesktopInputDraft } from "@/lib/desktop-input-draft";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import { isSeedanceMediaPolicyModel } from "@/lib/seedance-media-policy";
import {
  BATCH_UPLOAD_MAX_FILES_PER_REQUEST,
  chunkBatchUploadFiles,
} from "@/lib/batch-upload/concurrency";

const ACTIVE_PROMPT_STATUSES = new Set(["prompt_queued", "prompt_running"]);
const ACTIVE_VIDEO_STATUSES = new Set(["queued", "submitting", "waiting_provider"]);

export type LiveVideoSettings = {
  model: string;
  inputMode: LiveVideoBatchInputMode;
  duration: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
};

export type LiveVideoModel = {
  id: string;
  label: string;
  provider: string;
  providerName: string;
  supportedResolutions: string[];
  supportedRatios: string[];
  durationOptions: number[];
  supportsGenerateAudio: boolean;
  supportedInputModes: LiveVideoBatchInputMode[];
};

export type LiveVideoBatchOutput = {
  id: string;
  attempt: number;
  status: string;
  startedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  generation?: {
    id: number;
    status: string | null;
    localPath: string | null;
    errorMsg: string | null;
    templateData: string | null;
  } | null;
};

export type LiveVideoBatchItem = {
  id: string;
  position: number;
  name: string;
  prompt: string;
  promptStatus: string;
  videoStatus: string;
  sourceMedia: {
    id: string;
    originalName?: string | null;
    originalKey?: string | null;
    publicUrl?: string | null;
  } | null;
  promptJobs: Array<{
    id: string;
    attempt: number;
    status: string;
    errorMessage?: string | null;
  }>;
  outputs: LiveVideoBatchOutput[];
};

export type LiveVideoBatch = {
  id: string;
  name: string;
  status: string;
  skillSnapshot: {
    publicId?: string;
    name?: string;
    revision?: number;
  };
  sharedRequirement: string;
  videoSettings: LiveVideoSettings;
  version: number;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  finishedAt?: string | null;
  items: LiveVideoBatchItem[];
};

export type LiveVideoDefaultSkill = {
  publicId: string;
  name: string;
  revision: number;
};

type LiveVideoEphemeralInputDraft = {
  workspaceSessionId: string;
  itemMediaSessionId: string;
  draft: LiveVideoBatch | null;
  overrideSkillId: string;
  sharedRequirement: string;
  settings: LiveVideoSettings;
  dirty: boolean;
  interruptedUpload?: boolean;
};

function pruneKnownDeletedLiveBatches(batches: LiveVideoBatch[]) {
  return batches
    .map((batch) => ({
      ...batch,
      items: batch.items.filter((item) => !item.outputs.some((output) => (
        output.generation && isKnownDeletedGenerationId(output.generation.id)
      ))),
    }))
    .filter((batch) => batch.items.length > 0);
}

type ApiEnvelope = { success?: boolean; error?: string; code?: string } & Record<string, unknown>;

export class LiveVideoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LiveVideoApiError";
  }
}

export async function retryLiveVideoVersionConflict<T>(
  expectedVersion: number,
  mutate: (version: number) => Promise<T>,
  loadLatestVersion: () => Promise<number>,
) {
  try {
    return await mutate(expectedVersion);
  } catch (error) {
    if (!(error instanceof LiveVideoApiError) || error.code !== "LIVE_VIDEO_VERSION_CONFLICT") {
      throw error;
    }
    return mutate(await loadLatestVersion());
  }
}

async function apiRequest<T extends ApiEnvelope>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok || payload.success === false) {
    throw new LiveVideoApiError(
      String(payload.error || "请求失败，请稍后重试"),
      response.status,
      typeof payload.code === "string" ? payload.code : undefined,
    );
  }
  return payload;
}

function draftState(draft: LiveVideoBatch | null) {
  return {
    sharedRequirement: String(draft?.sharedRequirement || ""),
    settings: draft?.videoSettings || {},
  };
}

export function normalizeLiveVideoModelSettings(
  model: LiveVideoModel | undefined,
  value: Partial<LiveVideoSettings> = {},
): LiveVideoSettings {
  const durationOptions = model?.durationOptions?.length ? model.durationOptions : [4];
  const selectedResolution = String(value.resolution || "");
  const isSameModel = Boolean(model?.id && value.model === model.id);
  const isSeedanceModel = Boolean(model && isSeedanceMediaPolicyModel(model.id));
  const defaultResolution = isSeedanceModel
    && model?.supportedResolutions.includes("720p")
    ? "720p"
    : model?.supportedResolutions[0] || "720p";
  return {
    model: model?.id || "",
    inputMode: "multimodal",
    duration: Math.min(...durationOptions),
    ratio: model?.supportedRatios.includes(String(value.ratio || ""))
      ? String(value.ratio)
      : model?.supportedRatios[0] || "adaptive",
    resolution: model?.supportedResolutions.includes(selectedResolution)
      && (!isSeedanceModel || isSameModel)
      ? selectedResolution
      : defaultResolution,
    generateAudio: Boolean(model?.supportsGenerateAudio && value.generateAudio),
  };
}

function defaultSettings(models: LiveVideoModel[], value?: Partial<LiveVideoSettings>) {
  const model = models.find((entry) => entry.id === value?.model) || models[0];
  return normalizeLiveVideoModelSettings(model, value);
}

function hasActiveWork(batch: LiveVideoBatch) {
  return batch.items.some((item) =>
    ACTIVE_PROMPT_STATUSES.has(item.promptStatus)
    || item.outputs.some((output) => ACTIVE_VIDEO_STATUSES.has(output.status)),
  );
}

export function useLiveVideoBatchWorkspace({ accountId }: { accountId: string }) {
  const { text } = useUiLocale();
  const desktopMode = useDesktopMode();
  const [models, setModels] = React.useState<LiveVideoModel[]>([]);
  const [draft, setDraft] = React.useState<LiveVideoBatch | null>(null);
  const [defaultSkillId, setDefaultSkillId] = React.useState("");
  const [overrideSkillId, setOverrideSkillId] = React.useState("");
  const selectedSkillId = overrideSkillId || defaultSkillId;
  const [sharedRequirement, setSharedRequirementState] = React.useState("");
  const [settings, setSettingsState] = React.useState<LiveVideoSettings>(() => defaultSettings([]));
  const [batches, setBatches] = React.useState<LiveVideoBatch[]>([]);
  const [historyCursor, setHistoryCursor] = React.useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = React.useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [pendingMedia, setPendingMedia] = React.useState<BatchMediaRelation[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [pendingActions, setPendingActions] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState("");
  const hydratedAccountRef = React.useRef("");
  const hydratedRef = React.useRef(false);
  const dirtyDraftRef = React.useRef(false);
  const draftRef = React.useRef<LiveVideoBatch | null>(null);
  const defaultSkillIdRef = React.useRef("");
  const overrideSkillIdRef = React.useRef("");
  const sharedRequirementRef = React.useRef("");
  const settingsRef = React.useRef(settings);
  const modelVisibilityRefreshRequestRef = React.useRef(0);
  const modelVisibilityRefreshPendingRef = React.useRef(false);
  const saveTimerRef = React.useRef<number | null>(null);
  const saveQueueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const createRequestKeyRef = React.useRef("");
  const workspaceSessionRef = React.useRef("");
  const itemMediaSessionRef = React.useRef("");
  const pendingMediaRef = React.useRef<BatchMediaRelation[]>([]);
  const pollInFlightRef = React.useRef(false);
  const historyLoadInFlightRef = React.useRef(false);

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    const deleted = new Set(ids);
    setBatches((current) => current
      .map((batch) => ({
        ...batch,
        items: batch.items.filter((item) => !item.outputs.some((output) => (
          output.generation && deleted.has(Number(output.generation.id))
        ))),
      }))
      .filter((batch) => batch.items.length > 0));
  }), []);

  const assignDraft = React.useCallback((value: LiveVideoBatch | null) => {
    draftRef.current = value;
    setDraft(value);
  }, []);

  const releasePendingMedia = React.useCallback((ids: Set<string>) => {
    const removed = pendingMediaRef.current.filter((relation) => ids.has(relation.id));
    const remaining = pendingMediaRef.current.filter((relation) => !ids.has(relation.id));
    pendingMediaRef.current = remaining;
    setPendingMedia(remaining);
    removed.forEach((relation) => {
      URL.revokeObjectURL(String(relation.media.originalKey || ""));
    });
  }, []);

  React.useEffect(() => () => {
    pendingMediaRef.current.forEach((relation) => {
      URL.revokeObjectURL(String(relation.media.originalKey || ""));
    });
  }, []);

  React.useEffect(() => { defaultSkillIdRef.current = defaultSkillId; }, [defaultSkillId]);
  React.useEffect(() => { overrideSkillIdRef.current = overrideSkillId; }, [overrideSkillId]);
  React.useEffect(() => { sharedRequirementRef.current = sharedRequirement; }, [sharedRequirement]);
  React.useEffect(() => { settingsRef.current = settings; }, [settings]);

  React.useLayoutEffect(() => {
    if (!accountId || hydratedAccountRef.current !== accountId || !hydratedRef.current || !workspaceSessionRef.current) return;
    const inputDraft: LiveVideoEphemeralInputDraft = {
      workspaceSessionId: workspaceSessionRef.current,
      itemMediaSessionId: itemMediaSessionRef.current,
      draft,
      overrideSkillId,
      sharedRequirement,
      settings,
      dirty: dirtyDraftRef.current,
    };
    ephemeralInputDraftRegistry.write<LiveVideoEphemeralInputDraft>("batch:live-video", accountId, inputDraft);
    writeDesktopInputDraft(desktopMode, "batch:live-video", accountId, {
      ...inputDraft,
      interruptedUpload: pendingMedia.length > 0,
    });
  }, [accountId, desktopMode, draft, overrideSkillId, pendingMedia.length, settings, sharedRequirement]);

  const loadLatestVersion = React.useCallback(async (batchId: string) => {
    const response = await apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
      `/api/live-video-batches/${batchId}`,
    );
    return response.batch.version;
  }, []);

  const saveDraftNow = React.useCallback(async () => {
    if (!accountId || !hydratedRef.current || !dirtyDraftRef.current) return draftRef.current;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const run = saveQueueRef.current.then(async () => {
      if (!dirtyDraftRef.current) return draftRef.current;
      const current = draftRef.current;
      if (!current) return null;
      const sharedRequirement = sharedRequirementRef.current;
      const videoSettings = settingsRef.current;
      const response = await retryLiveVideoVersionConflict(
        current.version,
        (expectedVersion) => apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
          `/api/live-video-batches/${current.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersion,
              sharedRequirement,
              videoSettings,
            }),
          },
        ),
        () => loadLatestVersion(current.id),
      );
      const saved = response.batch;
      dirtyDraftRef.current = sharedRequirementRef.current !== sharedRequirement || settingsRef.current !== videoSettings;
      assignDraft(saved);
      return saved;
    });
    saveQueueRef.current = run.catch(() => undefined);
    return run;
  }, [accountId, assignDraft, loadLatestVersion]);

  const markDraftDirty = React.useCallback(() => {
    dirtyDraftRef.current = true;
    if (!accountId || !hydratedRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveDraftNow().catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : text("workspaceFollowup.mfcd9761bc618"));
      });
    }, 800);
  }, [accountId, saveDraftNow]);

  const setSelectedSkillId = React.useCallback((value: string) => {
    const next = value && value !== defaultSkillIdRef.current ? value : "";
    overrideSkillIdRef.current = next;
    setOverrideSkillId(next);
  }, []);

  const setSharedRequirement = React.useCallback((value: string) => {
    sharedRequirementRef.current = value;
    setSharedRequirementState(value);
    markDraftDirty();
  }, [markDraftDirty]);

  const setSettings = React.useCallback((value: LiveVideoSettings) => {
    settingsRef.current = value;
    setSettingsState(value);
    markDraftDirty();
  }, [markDraftDirty]);

  const loadMoreBatches = React.useCallback(async () => {
    if (!accountId || !hasMoreHistory || !historyCursor || historyLoadInFlightRef.current) return;
    historyLoadInFlightRef.current = true;
    setLoadingMoreHistory(true);
    try {
      const response = await apiRequest<ApiEnvelope & {
        batches: LiveVideoBatch[];
        hasMore: boolean;
        nextCursor: string | null;
      }>(`/api/live-video-batches?historyOnly=1&cursor=${encodeURIComponent(historyCursor)}`);
      setBatches((current) => {
        const existingIds = new Set(current.map((batch) => batch.id));
        return pruneKnownDeletedLiveBatches([
          ...current,
          ...(response.batches || []).filter((batch) => !existingIds.has(batch.id)),
        ]);
      });
      setHasMoreHistory(Boolean(response.hasMore));
      setHistoryCursor(response.nextCursor || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : text("workspaceFollowup.m68fa50b62c72"));
    } finally {
      historyLoadInFlightRef.current = false;
      setLoadingMoreHistory(false);
    }
  }, [accountId, hasMoreHistory, historyCursor]);

  const refreshVisibleModels = React.useCallback(async () => {
    const requestId = ++modelVisibilityRefreshRequestRef.current;
    try {
      const response = await apiRequest<ApiEnvelope & { models: LiveVideoModel[] }>(
        "/api/live-video-batches/models",
      );
      if (requestId !== modelVisibilityRefreshRequestRef.current) return;
      const availableModels = response.models || [];
      setModels(availableModels);
      setSettingsState((current) => {
        const next = defaultSettings(availableModels, current);
        settingsRef.current = next;
        return next;
      });
    } catch {}
  }, []);

  React.useEffect(() => subscribeToolboxModelVisibilityChanged(() => {
    if (!hydratedRef.current) {
      modelVisibilityRefreshPendingRef.current = true;
      return;
    }
    void refreshVisibleModels();
  }), [refreshVisibleModels]);

  React.useEffect(() => {
    let cancelled = false;
    hydratedAccountRef.current = "";
    hydratedRef.current = false;
    dirtyDraftRef.current = false;
    modelVisibilityRefreshPendingRef.current = false;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const remembered = readDesktopInputDraft<LiveVideoEphemeralInputDraft>(desktopMode, "batch:live-video", accountId)
          || (accountId ? ephemeralInputDraftRegistry.read<LiveVideoEphemeralInputDraft>("batch:live-video", accountId) : null);
        const workspaceSessionId = remembered?.workspaceSessionId || createToolClientUuid();
        const itemMediaSessionId = remembered?.itemMediaSessionId || createToolClientUuid();
        workspaceSessionRef.current = workspaceSessionId;
        itemMediaSessionRef.current = itemMediaSessionId;
        const modelResponse = await apiRequest<ApiEnvelope & { models: LiveVideoModel[] }>(
          "/api/live-video-batches/models",
        );
        if (cancelled) return;
        const availableModels = modelResponse.models || [];
        setModels(availableModels);
        if (!accountId) {
          assignDraft(null);
          defaultSkillIdRef.current = "";
          overrideSkillIdRef.current = "";
          setDefaultSkillId("");
          setOverrideSkillId("");
          setSharedRequirementState("");
          const nextSettings = defaultSettings(availableModels);
          settingsRef.current = nextSettings;
          setSettingsState(nextSettings);
          setBatches([]);
          setHistoryCursor(null);
          setHasMoreHistory(false);
          return;
        }
        const initialSettings = defaultSettings(availableModels, remembered?.settings);
        settingsRef.current = initialSettings;
        setSettingsState(initialSettings);
        const batchResponse = await apiRequest<ApiEnvelope & {
          draft: LiveVideoBatch;
          defaultSkill: LiveVideoDefaultSkill | null;
          batches: LiveVideoBatch[];
          hasMore: boolean;
          nextCursor: string | null;
        }>(`/api/live-video-batches?draftSessionId=${encodeURIComponent(workspaceSessionId)}`);
        if (cancelled) return;
        const loadedDraft = remembered?.draft?.id === batchResponse.draft.id
          && (!desktopMode || remembered.draft.version === batchResponse.draft.version)
          ? remembered.draft
          : batchResponse.draft;
        const restored = draftState(loadedDraft);
        const nextSettings = defaultSettings(
          availableModels,
          remembered?.settings || restored.settings,
        );
        const nextDefaultSkillId = String(batchResponse.defaultSkill?.publicId || "");
        const nextOverrideSkillId = String(remembered?.overrideSkillId || "");
        const nextSharedRequirement = remembered?.sharedRequirement ?? restored.sharedRequirement;
        assignDraft(loadedDraft);
        defaultSkillIdRef.current = nextDefaultSkillId;
        overrideSkillIdRef.current = nextOverrideSkillId;
        sharedRequirementRef.current = nextSharedRequirement;
        settingsRef.current = nextSettings;
        setDefaultSkillId(nextDefaultSkillId);
        setOverrideSkillId(nextOverrideSkillId);
        setSharedRequirementState(nextSharedRequirement);
        setSettingsState(nextSettings);
        setBatches(pruneKnownDeletedLiveBatches(batchResponse.batches || []));
        setHistoryCursor(batchResponse.nextCursor || null);
        setHasMoreHistory(Boolean(batchResponse.hasMore));
        hydratedAccountRef.current = accountId;
        dirtyDraftRef.current = Boolean(remembered?.dirty);
        if (remembered?.interruptedUpload) setError(INTERRUPTED_UPLOAD_NOTICE);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : text("workspaceFollowup.m6eab5fdb1283"));
        }
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          if (hydratedAccountRef.current === accountId && dirtyDraftRef.current) markDraftDirty();
          setLoading(false);
          if (modelVisibilityRefreshPendingRef.current) {
            modelVisibilityRefreshPendingRef.current = false;
            void refreshVisibleModels();
          }
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      hydratedRef.current = false;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [accountId, assignDraft, desktopMode, markDraftDirty, refreshVisibleModels]);

  const activeBatchesKey = batches.filter(hasActiveWork).map((batch) => batch.id).join(",");
  React.useEffect(() => {
    if (!accountId || !activeBatchesKey) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      const params = new URLSearchParams({
        statusOnly: "1",
        batchIds: activeBatchesKey,
      });
      void apiRequest<ApiEnvelope & { batches: LiveVideoBatch[] }>(
        `/api/live-video-batches?${params.toString()}`,
      ).then((response) => {
        const updates = new Map((response.batches || []).map((batch) => [batch.id, batch]));
        setBatches((current) => pruneKnownDeletedLiveBatches(
          current.map((batch) => updates.get(batch.id) || batch),
        ));
      }).catch(() => undefined).finally(() => {
        pollInFlightRef.current = false;
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [accountId, activeBatchesKey]);

  const upload = React.useCallback(async (files: File[]) => {
    if (!accountId || !files.length) return;
    const currentDraft = draftRef.current;
    if (!currentDraft) throw new Error("Live 工作区草稿尚未准备完成");
    const nextPosition = currentDraft.items.length
      ? Math.max(...currentDraft.items.map((item) => Number(item.position) || 0)) + 1
      : 0;
    const localRelations = files.map((file, index): BatchMediaRelation => {
      const id = `local-live-media-${createToolClientUuid()}`;
      return {
        id,
        itemId: null,
        role: "product",
        position: nextPosition + index,
        pending: true,
        media: {
          id,
          originalName: file.name,
          originalKey: URL.createObjectURL(file),
          publicUrl: null,
        },
      };
    });
    const localIds = new Set(localRelations.map((relation) => relation.id));
    pendingMediaRef.current = [...pendingMediaRef.current, ...localRelations];
    setPendingMedia(pendingMediaRef.current);
    setUploading(true);
    setError("");
    try {
      await saveDraftNow();
      const uploadRequests = chunkBatchUploadFiles(files).map((chunk, index) => ({
        files: chunk,
        relations: localRelations.slice(
          index * BATCH_UPLOAD_MAX_FILES_PER_REQUEST,
          index * BATCH_UPLOAD_MAX_FILES_PER_REQUEST + chunk.length,
        ),
      }));
      while (uploadRequests.length) {
        const request = uploadRequests.shift()!;
        const current = draftRef.current;
        if (!current) throw new Error("Live 工作区草稿尚未准备完成");
        const response = await retryLiveVideoVersionConflict(
          current.version,
          (expectedVersion) => {
            const form = new FormData();
            request.files.forEach((file) => form.append("file", file));
            form.set("draftSessionId", itemMediaSessionRef.current);
            form.set("expectedVersion", String(expectedVersion));
            return apiRequest<ApiEnvelope & {
              draft: LiveVideoBatch;
              uploadedFileCount?: number;
            }>(
              `/api/live-video-batches/${current.id}/media`,
              { method: "POST", body: form },
            );
          },
          () => loadLatestVersion(current.id),
        );
        assignDraft(response.draft);
        const reportedCount = Number(response.uploadedFileCount);
        const completedCount = Number.isInteger(reportedCount)
          ? Math.max(0, Math.min(request.files.length, reportedCount))
          : 1;
        if (!completedCount) throw new Error("Live 上传结果缺失，请重试");
        const completedIds = new Set(
          request.relations.slice(0, completedCount).map((relation) => relation.id),
        );
        completedIds.forEach((id) => localIds.delete(id));
        releasePendingMedia(completedIds);
        if (completedCount < request.files.length) {
          uploadRequests.unshift({
            files: request.files.slice(completedCount),
            relations: request.relations.slice(completedCount),
          });
        }
      }
    } catch (uploadError) {
      releasePendingMedia(localIds);
      setError(uploadError instanceof Error ? uploadError.message : text("workspaceFollowup.mdbd401fec5cd"));
      throw uploadError;
    } finally {
      setUploading(false);
    }
  }, [accountId, assignDraft, loadLatestVersion, releasePendingMedia, saveDraftNow]);

  const importProductLibraryItem = React.useCallback(async (drop: BatchProductLibraryDrop) => {
    if (!accountId) return;
    setUploading(true);
    setError("");
    try {
      await saveDraftNow();
      const current = draftRef.current;
      if (!current) throw new Error("Live 工作区草稿尚未准备完成");
      const response = await retryLiveVideoVersionConflict(
        current.version,
        (expectedVersion) => apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
          `/api/live-video-batches/${current.id}/product-library`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productLibraryItemId: drop.productLibraryItemId,
              requestKey: drop.requestKey,
              expectedVersion,
            }),
          },
        ),
        () => loadLatestVersion(current.id),
      );
      assignDraft(response.batch);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : text("workspaceFollowup.m963178763414"));
      throw importError;
    } finally {
      setUploading(false);
    }
  }, [accountId, assignDraft, loadLatestVersion, saveDraftNow]);

  const removeMedia = React.useCallback(async (itemId: string) => {
    if (!accountId) return;
    setError("");
    try {
      await saveDraftNow();
      const current = draftRef.current;
      if (!current) return;
      const response = await retryLiveVideoVersionConflict(
        current.version,
        (expectedVersion) => apiRequest<ApiEnvelope & { draft: LiveVideoBatch }>(
          `/api/live-video-batches/${current.id}/media`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId, expectedVersion }),
          },
        ),
        () => loadLatestVersion(current.id),
      );
      assignDraft(response.draft);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : text("workspaceFollowup.m0758dce53c17"));
    }
  }, [accountId, assignDraft, loadLatestVersion, saveDraftNow]);

  const clearMedia = React.useCallback(async () => {
    for (const item of [...(draftRef.current?.items || [])]) {
      await removeMedia(item.id);
    }
  }, [removeMedia]);

  const replaceBatch = React.useCallback((next: LiveVideoBatch) => {
    setBatches((current) => [next, ...current.filter((batch) => batch.id !== next.id)]);
  }, []);

  const createBatch = React.useCallback(async () => {
    if (!accountId || creating) return;
    setCreating(true);
    setError("");
    try {
      await saveDraftNow();
      const current = draftRef.current;
      if (!current) throw new Error("Live 工作区草稿尚未准备完成");
      const requestKey = createRequestKeyRef.current || createToolClientUuid();
      createRequestKeyRef.current = requestKey;
      const response = await apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        "/api/live-video-batches",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey,
            name: nextLiveVideoBatchName(batches),
            skillPublicId: overrideSkillIdRef.current || undefined,
            sharedRequirement: sharedRequirementRef.current,
            videoSettings: settingsRef.current,
            sourceBatchId: current.id,
          }),
        },
      );
      replaceBatch(response.batch);
      createRequestKeyRef.current = "";
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : text("workspaceFollowup.m49e8f59f8de8"));
    } finally {
      setCreating(false);
    }
  }, [accountId, batches, creating, replaceBatch, saveDraftNow]);

  const runBatchAction = React.useCallback(async (
    key: string,
    action: () => Promise<LiveVideoBatch | null>,
  ) => {
    setPendingActions((current) => new Set(current).add(key));
    setError("");
    try {
      const next = await action();
      if (next) replaceBatch(next);
      return next;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : text("workspaceFollowup.m0c3b4cf7aa25"));
      return null;
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [replaceBatch]);

  const patchBatch = React.useCallback(async (
    batch: LiveVideoBatch,
    body: Record<string, unknown>,
  ) => {
    const response = await retryLiveVideoVersionConflict(
      batch.version,
      (expectedVersion) => apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        `/api/live-video-batches/${batch.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion, ...body }),
        },
      ),
      () => loadLatestVersion(batch.id),
    );
    return response.batch;
  }, [loadLatestVersion]);

  const updateBatchSettings = React.useCallback((batch: LiveVideoBatch, value: LiveVideoSettings) =>
    runBatchAction(`settings:${batch.id}`, () => patchBatch(batch, { videoSettings: value })),
  [patchBatch, runBatchAction]);

  const updateBatchName = React.useCallback(async (batch: LiveVideoBatch, name: string) =>
    Boolean(await runBatchAction(`name:${batch.id}`, () => patchBatch(batch, { name }))),
  [patchBatch, runBatchAction]);

  const updatePrompt = React.useCallback((batch: LiveVideoBatch, itemId: string, prompt: string) =>
    runBatchAction(`prompt:${itemId}`, () => patchBatch(batch, {
      itemPrompts: [{ itemId, prompt }],
    })), [patchBatch, runBatchAction]);

  const uploadItemMedia = React.useCallback((
    batch: LiveVideoBatch,
    itemId: string,
    files: File[],
  ) => runBatchAction(`media:${itemId}`, async () => {
    const file = files[0];
    if (!file) return null;
    const response = await retryLiveVideoVersionConflict(
      batch.version,
      (expectedVersion) => {
        const form = new FormData();
        form.set("file", file);
        form.set("draftSessionId", itemMediaSessionRef.current);
        form.set("expectedVersion", String(expectedVersion));
        return apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
          `/api/live-video-batches/${batch.id}/items/${itemId}/media`,
          { method: "POST", body: form },
        );
      },
      () => loadLatestVersion(batch.id),
    );
    return response.batch;
  }), [loadLatestVersion, runBatchAction]);

  const importItemProductLibraryItem = React.useCallback((
    batch: LiveVideoBatch,
    itemId: string,
    drop: BatchProductLibraryDrop,
  ) => runBatchAction(`media:${itemId}`, async () => {
    const response = await retryLiveVideoVersionConflict(
      batch.version,
      (expectedVersion) => apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        `/api/live-video-batches/${batch.id}/product-library`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            productLibraryItemId: drop.productLibraryItemId,
            requestKey: drop.requestKey,
            expectedVersion,
          }),
        },
      ),
      () => loadLatestVersion(batch.id),
    );
    return response.batch;
  }), [loadLatestVersion, runBatchAction]);

  const removeItemMedia = React.useCallback((batch: LiveVideoBatch, itemId: string) =>
    runBatchAction(`media:${itemId}`, async () => {
      const response = await retryLiveVideoVersionConflict(
        batch.version,
        (expectedVersion) => apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
          `/api/live-video-batches/${batch.id}/items/${itemId}/media`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedVersion }),
          },
        ),
        () => loadLatestVersion(batch.id),
      );
      return response.batch;
    }), [loadLatestVersion, runBatchAction]);

  const retryPrompt = React.useCallback((batchId: string, itemId: string) =>
    runBatchAction(`prompt-retry:${itemId}`, async () => {
      const response = await apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        `/api/live-video-batches/${batchId}/prompt-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, requestKey: createToolClientUuid() }),
        },
      );
      return response.batch;
    }), [runBatchAction]);

  const retryVideo = React.useCallback((batchId: string, itemId: string) =>
    runBatchAction(`video-retry:${itemId}`, async () => {
      const response = await apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        `/api/live-video-batches/${batchId}/video-retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, requestKey: createToolClientUuid() }),
        },
      );
      return response.batch;
    }), [runBatchAction]);

  const submitBatch = React.useCallback((batch: LiveVideoBatch) =>
    runBatchAction(`submit:${batch.id}`, async () => {
      const response = await apiRequest<ApiEnvelope & { batch: LiveVideoBatch }>(
        `/api/live-video-batches/${batch.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionKey: createToolClientUuid(),
            itemRequestKeys: Object.fromEntries(
              batch.items.map((item) => [item.id, createToolClientUuid()]),
            ),
          }),
        },
      );
      return response.batch;
    }), [runBatchAction]);

  const deleteBatch = React.useCallback((batchId: string) =>
    runBatchAction(`delete:${batchId}`, async () => {
      await apiRequest(`/api/live-video-batches/${batchId}`, { method: "DELETE" });
      setBatches((current) => current.filter((batch) => batch.id !== batchId));
      return null;
    }), [runBatchAction]);

  return {
    models,
    draft,
    selectedSkillId,
    defaultSkillId,
    overrideSkillId,
    sharedRequirement,
    settings,
    batches,
    hasMoreHistory,
    loadingMoreHistory,
    loading,
    uploading,
    pendingMedia,
    creating,
    pendingActions,
    error,
    setError,
    setSelectedSkillId,
    setSharedRequirement,
    setSettings,
    upload,
    importProductLibraryItem,
    removeMedia,
    clearMedia,
    loadMoreBatches,
    createBatch,
    updateBatchName,
    updateBatchSettings,
    updatePrompt,
    uploadItemMedia,
    importItemProductLibraryItem,
    removeItemMedia,
    retryPrompt,
    retryVideo,
    submitBatch,
    deleteBatch,
  };
}
