"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import { loadImageModelCatalog } from "@/lib/client/image-model-catalog";

import { isQwenImage3Model } from "@/lib/qwen-image-3-models";

import { getAvailableGptImage25Mode, getGptImage25QualityOptions, isGptImageVariantModel, getGptImage25ModelLabel } from "@/lib/gpt-image-25-models";

import * as React from "react";
import { BatchWorkbenchLoading, BatchWorkbenchSkeleton } from "@/components/batch-workbench/batch-workbench-loading";
import { Download, Loader2, Pencil, Trash2 } from "lucide-react";
import {
  BatchSettingsPanel,
  getGptImage2OfficialBatchOptions,
  normalizeGptImage2OfficialBatchSettings,
} from "@/components/batch-workbench/batch-settings-panel";
import { BatchParameterDock } from "@/components/batch-workbench/batch-parameter-dock";
import type { BatchProductLibraryDrop } from "@/components/batch-workbench/batch-media-gallery";
import { BatchTaskCard } from "@/components/batch-workbench/batch-task-card";
import { GenerateActionButton } from "@/components/batch-workbench/generate-action-button";
import { LiveVideoBatchWorkspace } from "@/components/batch-workbench/live-video-batch-workspace";
import { PromptSplitDialog } from "@/components/batch-workbench/prompt-split-dialog";
import {
  BatchResultRegistryProvider,
  useBatchResultRegistryActions,
  useRegisterBatchResultSource,
  type BatchResultSource,
} from "@/components/batch-workbench/batch-result-registry";
import { UnifiedBatchResults } from "@/components/batch-workbench/unified-batch-results";
import { useAuth } from "@/components/auth/AuthProvider";
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import {
  canStartBatchTaskAction,
  isActiveBatchOutputStatus,
  resolveFailedTaskAction,
} from "@/components/batch-workbench/task-action-mode";
import { applyHistoryGroupSettingsPatch } from "@/components/batch-workbench/history-group-settings";
import {
  buildBatchGroupResultPreview,
  latestBatchOutputs,
} from "@/components/batch-workbench/types";
import type {
  BatchGroupResultPreviewEntry,
  BatchHistoryGroup,
  BatchItem,
  BatchMediaRelation,
  BatchSettings,
  ImageBatch,
  ImageBatchListItem,
  ImageEditModel,
} from "@/components/batch-workbench/types";
import { chunkBatchUploadFiles } from "@/lib/image-batch/concurrency";
import {
  IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE,
  isGroupedImageBatchMode,
} from "@/lib/image-batch/contracts";
import { selectLatestSuccessfulBatchOutputs } from "@/lib/image-batch/download-selection";
import { validateBatchGroupDownloadName } from "@/lib/image-batch/group-download-name";
import {
  MEDIA_LIBRARY_EVENT_CLOSE,
  MEDIA_LIBRARY_EVENT_OPEN,
  MEDIA_LIBRARY_EVENT_TOGGLE,
} from "@/lib/media-library-events";
import type {
  BatchSegmentedPromptRoleContinuation,
} from "@/lib/role-positioning-continuation";
import { createToolClientUuid } from "@/lib/tool-media/client-draft";
import { useBatchRolePositioningController } from "@/hooks/use-batch-role-positioning-controller";
import type { GenerationSkillSnapshot } from "@/lib/generation/skill-metadata";
import { isKnownDeletedGenerationId, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { pruneImageBatchOrphanedSuccessItems } from "@/lib/generation-deletion";
import { ephemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { INTERRUPTED_UPLOAD_NOTICE, readDesktopInputDraft, writeDesktopInputDraft } from "@/lib/desktop-input-draft";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";

type ApiEnvelope = { success?: boolean; error?: string; code?: string } & Record<string, unknown>;
type UploadTarget = { batchId: string; role: "product" | "reference"; itemId: string | null };
type BatchSegmentedPromptGroupRequest = Omit<
  BatchSegmentedPromptRoleContinuation,
  "taskId" | "phase"
>;
type GroupResultPreviewState = {
  groupName: string;
  entries: BatchGroupResultPreviewEntry[];
  index: number;
};
type HistoryPagePayload = ApiEnvelope & {
  groups: BatchHistoryGroup[];
  hasMore: boolean;
  nextCursor: string | null;
};
type HistoryStatusPayload = ApiEnvelope & {
  groups: Array<{
    id: string;
    batchId: string;
    batch: Pick<
      BatchHistoryGroup["batch"],
      "status" | "version" | "submittedAt" | "finishedAt" | "updatedAt"
    >;
  }>;
};
type ImageHistoryPagination = {
  cursor: string | null;
  hasMore: boolean;
  loadingMore: boolean;
};

const HISTORY_PAGE_SIZE = 5;
const IMAGE_BATCH_MODES = ["style_replication", "multi_prompt"] as const;
const EMPTY_IMAGE_HISTORY_PAGINATION: Record<ImageBatch["mode"], ImageHistoryPagination> = {
  style_replication: { cursor: null, hasMore: false, loadingMore: false },
  multi_prompt: { cursor: null, hasMore: false, loadingMore: false },
};
const ACTIVE_STATUSES = new Set(["creating", "queued", "running", "submitting", "processing", "waiting_provider"]);

function inertWhenHidden(hidden: boolean): React.HTMLAttributes<HTMLDivElement> {
  return hidden
    ? ({ inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>)
    : {};
}

class BatchApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BatchApiError";
  }
}

async function apiRequest<T extends ApiEnvelope>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok || payload.success === false) {
    throw new BatchApiError(
      String(payload.error || "请求失败，请稍后重试"),
      typeof payload.code === "string" ? payload.code : undefined,
      response.status,
    );
  }
  return payload;
}

function normalizeBatch(batch: ImageBatch, models: ImageEditModel[]) {
  const items = pruneImageBatchOrphanedSuccessItems(batch.items || []).filter((item) => !item.outputs?.some((output) => (
    output.generation && isKnownDeletedGenerationId(output.generation.id)
  ))).map((item) => ({
    ...item,
    prompt: item.prompt || "",
    overrides: {
      ...(item.overrides || {}),
      ...(item.overrides?.model
        ? {
            model: models.some((model) => model.id === item.overrides?.model)
              ? item.overrides.model
              : models[0]?.id || "",
          }
        : {}),
    },
    media: item.media || [],
    outputs: item.outputs || [],
  }));
  const groups = [...(batch.groups || [])];
  if (items.some((item) => !item.groupId) && !groups.some((group) => group.position === 0)) {
    groups.unshift({ id: "legacy", position: 0, name: "分组#1" });
  }
  const requestedModel = String(batch.sharedSettings?.model || "").trim();
  const visibleModel = models.some((model) => model.id === requestedModel)
    ? requestedModel
    : models[0]?.id || "";
  return {
    ...batch,
    sharedPrompt: batch.sharedPrompt || "",
    sharedSettings: {
      schemaVersion: 1,
      aspectRatio: batch.sharedSettings?.aspectRatio || "3:4",
      resolution: batch.sharedSettings?.resolution || "2K",
      ...(batch.sharedSettings || {}),
      model: visibleModel,
    },
    items,
    groups,
    media: batch.media || [],
  };
}

function createAnonymousBatch(models: ImageEditModel[]): ImageBatch {
  return {
    id: "anonymous-style-replication",
    name: "新建图片批次",
    mode: "style_replication",
    status: "draft",
    sharedPrompt: "",
    sharedSettings: {
      schemaVersion: 1,
      model: models[0]?.id || "",
      aspectRatio: "3:4",
      resolution: "2K",
    },
    version: 0,
    updatedAt: new Date().toISOString(),
    groups: [],
    items: [],
    media: [],
  };
}

function normalizeHistoryGroup(group: BatchHistoryGroup): BatchHistoryGroup {
  return {
    ...group,
    batch: {
      ...group.batch,
      sharedSettings: group.batch?.sharedSettings || {},
    },
    items: pruneImageBatchOrphanedSuccessItems(group.items || []).filter((item) => !item.outputs?.some((output) => (
      output.generation && isKnownDeletedGenerationId(output.generation.id)
    ))).map((item) => ({
      ...item,
      prompt: item.prompt || "",
      overrides: item.overrides || {},
      media: item.media || [],
      outputs: item.outputs || [],
    })),
  };
}

function createLocalMediaRelation(
  file: File,
  role: "product" | "reference",
  itemId: string | null,
  position: number,
): BatchMediaRelation {
  const localId = `local-media-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
  return {
    id: localId,
    itemId,
    role,
    position,
    pending: true,
    media: {
      id: localId,
      originalName: file.name,
      originalKey: URL.createObjectURL(file),
      publicUrl: null,
    },
  };
}

function replaceHistoryMediaRelation(
  groups: BatchHistoryGroup[],
  batchId: string,
  temporaryId: string,
  relation: BatchMediaRelation,
) {
  return groups.map((group) => group.batchId === batchId
    ? {
        ...group,
        items: group.items.map((item) => ({
          ...item,
          media: item.media.map((entry) => entry.id === temporaryId ? relation : entry),
        })),
      }
    : group);
}

function rollbackHistoryMediaRelation(
  groups: BatchHistoryGroup[],
  batchId: string,
  temporaryIds: Set<string>,
  itemId: string | null,
  previousRelations: BatchMediaRelation[] = [],
) {
  return groups.map((group) => group.batchId === batchId
    ? {
        ...group,
        items: group.items.map((item) => item.id === itemId
          ? {
              ...item,
              media: [
                ...item.media.filter((entry) => !temporaryIds.has(entry.id)),
                ...previousRelations,
              ].sort((left, right) => left.position - right.position),
            }
          : item),
      }
    : group);
}

function syncHistoryBatchVersion(
  groups: BatchHistoryGroup[],
  batchId: string,
  version: number,
) {
  if (!Number.isInteger(version)) return groups;
  return groups.map((group) => group.batchId === batchId
    ? {
        ...group,
        batch: {
          ...group.batch,
          version: Math.max(group.batch.version, version),
        },
      }
    : group);
}

function createOptimisticHistoryGroup(
  batch: ImageBatch,
  historyGroups: BatchHistoryGroup[],
): BatchHistoryGroup {
  const id = `local-group-${window.crypto?.randomUUID?.() || Date.now()}`;
  const batchId = `local-batch-${window.crypto?.randomUUID?.() || Date.now()}`;
  const now = new Date().toISOString();
  const sequence = Math.max(0, ...historyGroups.map((group) => Number(group.sequence) || 0)) + 1;
  const products = batch.media.filter((entry) => entry.itemId === null && entry.role === "product");
  const references = batch.mode === "style_replication"
    ? batch.media.filter((entry) => entry.itemId === null && entry.role === "reference")
    : [];
  const taskProducts: Array<BatchMediaRelation | null> = products.length ? products : [null];
  return {
    id,
    batchId,
    position: 0,
    sequence,
    name: `分组#${sequence}`,
    createdAt: now,
    updatedAt: now,
    batch: {
      id: batchId,
      mode: "style_replication",
      status: "creating",
      sharedSettings: { ...batch.sharedSettings },
      version: 1,
      submittedAt: null,
      finishedAt: null,
      updatedAt: now,
    },
    items: taskProducts.map((product, index) => {
      const itemId = `local-item-${window.crypto?.randomUUID?.() || `${Date.now()}-${index}`}`;
      return {
        id: itemId,
        groupId: id,
        position: index,
        name: `产品任务 ${String(index + 1).padStart(2, "0")}`,
        prompt: batch.sharedPrompt,
        includeSharedPrompt: false,
        overrides: {},
        outputCount: 1,
        status: "draft",
        media: [
          ...(product
            ? [{ ...product, id: `${product.id}-${itemId}`, itemId }]
            : []),
          ...references.map((reference) => ({
            ...reference,
            id: `${reference.id}-${itemId}`,
            itemId,
          })),
        ],
        outputs: [],
      };
    }),
  };
}

function mergeHistoryFirstPage(
  current: BatchHistoryGroup[],
  incoming: BatchHistoryGroup[],
) {
  const incomingIds = new Set(incoming.map((group) => group.id));
  return [...incoming, ...current.filter((group) => !incomingIds.has(group.id))];
}

function isBatchActive(status: string | null | undefined) {
  return ACTIVE_STATUSES.has(String(status || ""));
}

function reconcileBatchModelVisibility(batch: ImageBatch, models: ImageEditModel[]) {
  const fallbackModel = models[0]?.id || "";
  const currentSharedModel = String(batch.sharedSettings?.model || "");
  const sharedModel = models.some((model) => model.id === currentSharedModel)
    ? currentSharedModel
    : fallbackModel;
  const sharedMode = getAvailableGptImage25Mode(sharedModel, batch.sharedSettings?.gptImage25Mode, models.find((model) => model.id === sharedModel)?.gptImage25Variants);
  let changed = sharedModel !== currentSharedModel || Boolean(sharedMode && sharedMode !== (batch.sharedSettings?.gptImage25Mode || "flare"));
  const items = batch.items.map((item) => {
    const currentModel = String(item.overrides?.model || "");
    const nextModel = !currentModel || models.some((model) => model.id === currentModel) ? currentModel : fallbackModel;
    const effectiveModel = nextModel || sharedModel;
    const currentMode = item.overrides?.gptImage25Mode || sharedMode;
    const nextMode = getAvailableGptImage25Mode(effectiveModel, currentMode, models.find((model) => model.id === effectiveModel)?.gptImage25Variants);
    if (currentModel === nextModel && (!nextMode || nextMode === (currentMode || "flare"))) return item;
    changed = true;
    return {
      ...item,
      overrides: { ...(item.overrides || {}), ...(nextModel ? { model: nextModel } : {}), ...(nextMode ? { gptImage25Mode: nextMode } : {}) },
    };
  });
  return changed
    ? {
        ...batch,
        sharedSettings: { ...(batch.sharedSettings || {}), model: sharedModel, ...(sharedMode ? { gptImage25Mode: sharedMode } : {}) },
        items,
      }
    : batch;
}

function isBatchItemActive(item: BatchItem) {
  return latestBatchOutputs(item.outputs || [])
    .some((output) => isActiveBatchOutputStatus(output.status));
}

function needsDefaultSettings(batch: ImageBatch) {
  return !batch.sharedSettings?.model || !batch.sharedSettings?.aspectRatio || !batch.sharedSettings?.resolution;
}

function hydrateBatchTemplate(batch: ImageBatch, models: ImageEditModel[]) {
  return {
    batch: normalizeBatch(batch, models),
    migrated: false,
  };
}

type ImageBatchEphemeralDraft = {
  batch: ImageBatch;
  draftSessionId: string;
  dirty: boolean;
  dirtyItemIds: string[];
  dirtyGroupIds: string[];
  interruptedUpload?: boolean;
};

function imageBatchDraftSurface(mode: ImageBatch["mode"]) {
  return `batch:image:${mode}`;
}

function BatchGroupSettingsControl({
  items,
  defaults,
  models,
  batchMode,
  editable,
  disabled,
  onChange,
}: {
  items: BatchItem[];
  defaults: BatchSettings;
  models: ImageEditModel[];
  batchMode: ImageBatch["mode"];
  editable: boolean;
  disabled: boolean;
  onChange: (patch: Partial<BatchSettings>) => void;
}) {
  const { text, locale } = useUiLocale();
  const resolved = { ...defaults, ...(items[0]?.overrides || {}) };
  const model = resolved.model || models[0]?.id || "";
  const modelLabel = models.find((entry) => entry.id === model)?.label
    || (model ? text("workspaceFollowup.mda3c032728f5") : text("workspaceFollowup.m9bb63745df8f"));
  const aspectRatio = resolved.aspectRatio || "3:4";
  const resolution = resolved.resolution || "2K";
  const parameterOptions = getGptImage2OfficialBatchOptions(model, resolution, aspectRatio);
  const imageRole = batchMode === "multi_prompt" ? "product" : "reference";
  const imageLabel = batchMode === "multi_prompt" ? text("workspaceFollowup.md65530829014") : text("workspaceFollowup.me8a1ec993427");
  const imageCount = items[0]?.media.filter((entry) => entry.role === imageRole).length || 0;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <UiProps ids={{"aria-label":["batch.m457835edc19c"]}}><div
        aria-label="batch.m457835edc19c"
        className="flex h-9 flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[10px] text-[var(--app-muted)]"
      >
        <span>{locale === "en" ? text("workspaceFollowup.m571c89addedd", { v0: imageCount.toLocaleString("en-US"), v1: imageLabel.toLowerCase() + (imageCount === 1 ? "" : "s") }) : <>{imageCount}<UiText id="batch.me9e0fdc242b4" />{imageLabel}</>}</span>
        <span className="h-3 w-px bg-[var(--border)]" />
        <span className="max-w-36 truncate text-[var(--app-fg)]">{getGptImage25ModelLabel(model, modelLabel, resolved.gptImage25Mode, models.find((entry) => entry.id === model)?.gptImage25Variants)}</span>
        <span>{aspectRatio}</span>
        <span>{resolution}</span>
        {isQwenImage3Model(model) ? <span>{resolved.quality === "pro" ? "Pro" : <UiText id="batch.m6bea77acefb3" />}</span> : null}
        {isGptImageVariantModel(model) ? <span>{getGptImage25QualityOptions(model).find((option) => option.value === (resolved.quality || "medium"))?.label}</span> : null}
      </div></UiProps>
      {editable ? (
        <BatchParameterDock
          customSize={resolved.customSize} onCustomSizeChange={customSize=>onChange({customSize})}
          variant="groupHeader"
          model={model}
          quality={resolved.quality || "medium"}
          gptImage25Mode={resolved.gptImage25Mode || "flare"}
          background={resolved.background} outputFormat={resolved.outputFormat} gifSize={resolved.gifSize} frameCount={resolved.frameCount} frameDurationMs={resolved.frameDurationMs} seedream55={resolved.seedream55}
          googleSettings={resolved}
          onGoogleSettingsChange={onChange}
          onOutputSettingsChange={onChange}
          onQualityChange={(quality) => onChange({ quality })}
          aspectRatio={aspectRatio}
          resolution={resolution}
          models={models}
          ratioOptions={parameterOptions.ratioOptions}
          resolutionOptions={parameterOptions.resolutionOptions}
          disabled={disabled || !models.length}
          onModelChange={(value) => onChange(normalizeGptImage2OfficialBatchSettings(
            value,
            resolution,
            aspectRatio,
            model,
          ))}
          onAspectRatioChange={(value) => onChange({ aspectRatio: value })}
          onResolutionChange={(value) => onChange({ resolution: value })}
        />
      ) : null}
    </div>
  );
}

function BatchResultSourceRegistration({ source }: { source: BatchResultSource }) {
  useRegisterBatchResultSource(source);
  return null;
}

function ImageBatchWorkbenchPage({
  onOpenLiveVideo,
  onInitialReady,
}: {
  onOpenLiveVideo: () => void;
  onInitialReady?: () => void;
}) {
  const { text, error: uiError } = useUiLocale();
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const { requestScrollTop } = useBatchResultRegistryActions();
  const rolePositioning = useBatchRolePositioningController();
  const [batch, setBatch] = React.useState<ImageBatch | null>(null);
  const [models, setModels] = React.useState<ImageEditModel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [switchingMode, setSwitchingMode] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [segmentedPromptPending, setSegmentedPromptPending] = React.useState(false);
  const [submittingBatchIds, setSubmittingBatchIds] = React.useState<Set<string>>(() => new Set());
  const [deletingGroupIds, setDeletingGroupIds] = React.useState<Set<string>>(() => new Set());
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    React.useState<BatchHistoryGroup | null>(null);
  const [pendingItemActions, setPendingItemActions] = React.useState<Map<string, "retry" | "regenerate" | "cancel">>(() => new Map());
  const [itemActionErrors, setItemActionErrors] = React.useState<Map<string, string>>(() => new Map());
  const pendingItemActionIdsRef = React.useRef<Set<string>>(new Set());
  const [uploadingTarget, setUploadingTarget] = React.useState<UploadTarget | null>(null);
  const [clearingRole, setClearingRole] = React.useState<"product" | "reference" | null>(null);
  const [removingSharedMediaIds, setRemovingSharedMediaIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState("");
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const groupNameComposingRef = React.useRef(false);
  const [groupNameErrors, setGroupNameErrors] = React.useState<Record<string, string>>({});
  const [groupResultPreview, setGroupResultPreview] =
    React.useState<GroupResultPreviewState | null>(null);
  const [historyGroups, setHistoryGroups] = React.useState<BatchHistoryGroup[]>([]);
  const [initialHistoryLoading, setInitialHistoryLoading] = React.useState(false);
  const [initialHistoryError, setInitialHistoryError] = React.useState("");
  const [historyPaginationByMode, setHistoryPaginationByMode] = React.useState<
    Record<ImageBatch["mode"], ImageHistoryPagination>
  >(() => ({
    style_replication: { ...EMPTY_IMAGE_HISTORY_PAGINATION.style_replication },
    multi_prompt: { ...EMPTY_IMAGE_HISTORY_PAGINATION.multi_prompt },
  }));
  const [templateDraftHydratedFor, setTemplateDraftHydratedFor] = React.useState("");
  const [templateDraftWritable, setTemplateDraftWritable] = React.useState(false);
  const currentAccountId = user?.id ? String(user.id) : "";
  const currentAccountIdRef = React.useRef(currentAccountId);
  const templateDraftOwnerRef = React.useRef("");
  const templateRequestEpochRef = React.useRef(0);
  if (currentAccountIdRef.current !== currentAccountId) {
    currentAccountIdRef.current = currentAccountId;
    templateRequestEpochRef.current += 1;
  }
  const draftSessionId = React.useRef("");
  const editRevision = React.useRef(0);
  const dirtyItemIds = React.useRef(new Set<string>());
  const dirtyGroupIds = React.useRef(new Set<string>());
  const historyGroupsRef = React.useRef<BatchHistoryGroup[]>([]);
  const watchedModelErrorBatchIdsRef = React.useRef<Set<string>>(new Set());
  const notifiedModelErrorOutputIdsRef = React.useRef<Set<string>>(new Set());
  const historyLoadInFlight = React.useRef(new Set<ImageBatch["mode"]>());
  const historyLoadRequestRef = React.useRef<Record<ImageBatch["mode"], number>>({
    style_replication: 0,
    multi_prompt: 0,
  });
  const historyStatusInFlight = React.useRef(false);
  const historyStatusRequestRef = React.useRef(0);
  const historySaveTimer = React.useRef<number | null>(null);
  const historySaveQueue = React.useRef<Promise<boolean>>(Promise.resolve(true));
  const draftSaveInFlight = React.useRef<{
    accountId: string;
    requestEpoch: number;
    batchId: string;
    promise: Promise<boolean>;
  } | null>(null);
  const dirtyHistoryItems = React.useRef(new Map<string, {
    batchId: string;
    patch: Partial<BatchItem>;
    revision: number;
  }>());
  const dirtyHistoryGroups = React.useRef(new Map<string, {
    batchId: string;
    name: string;
    revision: number;
  }>());
  const dirtyHistorySettings = React.useRef(new Map<string, {
    settings: BatchSettings;
    revision: number;
  }>());

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    const deleted = new Set(ids);
    const itemWasDeleted = (item: BatchItem) => item.outputs.some((output) => (
      output.generation && deleted.has(Number(output.generation.id))
    ));
    setHistoryGroups((current) => {
      const next = current
        .map((group) => ({ ...group, items: group.items.filter((item) => !itemWasDeleted(item)) }))
        .filter((group) => group.items.length > 0);
      historyGroupsRef.current = next;
      return next;
    });
    setBatch((current) => {
      if (!current) return current;
      const items = current.items.filter((item) => !itemWasDeleted(item));
      if (items.length === current.items.length) return current;
      const groupIds = new Set(items.map((item) => item.groupId).filter(Boolean));
      return { ...current, items, groups: current.groups.filter((group) => groupIds.has(group.id)) };
    });
    setGroupResultPreview(null);
  }), []);

  React.useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const unsubscribe = subscribeToolboxModelVisibilityChanged(() => {
      const currentRequestId = ++requestId;
      const accountId = currentAccountIdRef.current;
      void loadImageModelCatalog({ refresh: true })
        .then((payload) => {
          if (
            cancelled
            || currentRequestId !== requestId
            || currentAccountIdRef.current !== accountId
          ) return;
          const availableModels = (payload.models || []).filter((model) => model.id !== "midjourney-v8-reapi" && model.id !== "midjourney-v8-apimart");
          setModels(availableModels);
          setBatch((current) => current
            ? reconcileBatchModelVisibility(current, availableModels)
            : current);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    const newModelErrors = historyGroups.flatMap((group) => {
      if (
        group.batch.mode !== "style_replication"
        || !watchedModelErrorBatchIdsRef.current.has(group.batchId)
      ) return [];
      return group.items.flatMap((item) => latestBatchOutputs(item.outputs || []))
        .filter((output) => (
          output.status === "failed"
          && output.errorCode === IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE
          && !notifiedModelErrorOutputIdsRef.current.has(output.id)
        ));
    });
    if (!newModelErrors.length) return;
    newModelErrors.forEach((output) => notifiedModelErrorOutputIdsRef.current.add(output.id));
    const modelError = newModelErrors[0];
    setError(modelError.errorMessage || text("workspaceFollowup.m1aa54a9d1234"));
  }, [historyGroups]);
  const segmentedRunLockRef = React.useRef(false);
  const resumedSegmentedContinuationRef = React.useRef("");
  const uploading = uploadingTarget !== null;
  const mediaMutationPending = uploading
    || clearingRole !== null
    || removingSharedMediaIds.size > 0;

  React.useEffect(() => {
    historyGroupsRef.current = historyGroups;
  }, [historyGroups]);

  React.useEffect(() => {
    draftSessionId.current = window.crypto?.randomUUID?.() || `batch-${Date.now()}`;
  }, []);

  const templateBatchId = batch?.id || "";
  const templateBatchMode = batch?.mode;

  React.useLayoutEffect(() => {
    if (!batch || !currentAccountId || templateDraftOwnerRef.current !== currentAccountId
      || templateDraftHydratedFor !== batch.id) return;
    const surface = imageBatchDraftSurface(batch.mode);
    const draft: ImageBatchEphemeralDraft = {
      batch,
      draftSessionId: draftSessionId.current || createToolClientUuid(),
      dirty,
      dirtyItemIds: [...dirtyItemIds.current],
      dirtyGroupIds: [...dirtyGroupIds.current],
    };
    draftSessionId.current = draft.draftSessionId;
    ephemeralInputDraftRegistry.write<ImageBatchEphemeralDraft>(surface, currentAccountId, draft);
    if (desktopMode) {
      writeDesktopInputDraft(true, surface, currentAccountId, {
        ...draft,
        batch: {
          ...batch,
          media: batch.media.filter((relation) => !relation.pending),
          items: batch.items.map((item) => ({
            ...item,
            media: item.media.filter((relation) => !relation.pending),
          })),
        },
        interruptedUpload: uploading,
      });
    }
  }, [batch, currentAccountId, desktopMode, dirty, templateDraftHydratedFor, uploading]);

  const loadBatch = React.useCallback(async (batchId: string, availableModels: ImageEditModel[] = models) => {
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const payload = await apiRequest<ApiEnvelope & { batch: ImageBatch }>(`/api/image-batches/${batchId}`);
    if (
      currentAccountIdRef.current !== accountId
      || templateRequestEpochRef.current !== requestEpoch
    ) return null;
    const hydrated = hydrateBatchTemplate(payload.batch, availableModels);
    setBatch(hydrated.batch);
    setTemplateDraftHydratedFor(payload.batch.id);
    dirtyItemIds.current.clear();
    dirtyGroupIds.current.clear();
    setDirty(hydrated.migrated || needsDefaultSettings(payload.batch));
    return payload.batch;
  }, [models]);

  const loadTemplate = React.useCallback(async (
    mode: ImageBatch["mode"],
    availableModels: ImageEditModel[],
  ) => {
    const accountId = currentAccountIdRef.current;
    const requestEpoch = ++templateRequestEpochRef.current;
    const surface = imageBatchDraftSurface(mode);
    const remembered = readDesktopInputDraft<ImageBatchEphemeralDraft>(desktopMode, surface, accountId)
      || ephemeralInputDraftRegistry.read<ImageBatchEphemeralDraft>(surface, accountId);
    const latestBatch = remembered
      ? (await apiRequest<ApiEnvelope & { batch: ImageBatch }>(
          `/api/image-batches/${remembered.batch.id}`,
        )).batch
      : null;
    const serverBatch = latestBatch || (await apiRequest<ApiEnvelope & { batch: ImageBatch }>(
          "/api/image-batches",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, name: "新建图片批次" }),
          },
        )).batch;
    const sessionId = remembered?.draftSessionId || createToolClientUuid();
    const sameVersion = remembered?.batch.version === serverBatch.version;
    const dirtyDraft = remembered?.dirty && (sameVersion || desktopMode) ? remembered : null;
    let restoredBatch = sameVersion && remembered && !remembered.interruptedUpload
      ? remembered.batch
      : serverBatch;
    if (dirtyDraft && restoredBatch === serverBatch) {
      const localItems = new Map(dirtyDraft.batch.items.map((item) => [item.id, item]));
      const localGroups = new Map(dirtyDraft.batch.groups.map((group) => [group.id, group]));
      restoredBatch = {
        ...serverBatch,
        name: dirtyDraft.batch.name,
        sharedPrompt: dirtyDraft.batch.sharedPrompt,
        sharedSettings: dirtyDraft.batch.sharedSettings,
        items: serverBatch.items.map((item) => {
          const local = localItems.get(item.id);
          return local && dirtyDraft.dirtyItemIds.includes(item.id)
            ? { ...item, name: local.name, prompt: local.prompt, includeSharedPrompt: local.includeSharedPrompt, overrides: local.overrides }
            : item;
        }),
        groups: serverBatch.groups.map((group) => {
          const local = localGroups.get(group.id);
          return local && dirtyDraft.dirtyGroupIds.includes(group.id) ? { ...group, name: local.name } : group;
        }),
      };
    }
    const hydrated = hydrateBatchTemplate(restoredBatch, availableModels);
    return {
      accountId,
      requestEpoch,
      serverBatch,
      sessionId,
      hydratedBatch: hydrated.batch,
      dirty: Boolean(dirtyDraft) || hydrated.migrated || needsDefaultSettings(serverBatch),
      dirtyItemIds: dirtyDraft?.dirtyItemIds || [],
      dirtyGroupIds: dirtyDraft?.dirtyGroupIds || [],
      interruptedUpload: remembered?.interruptedUpload,
    };
  }, [desktopMode]);

  const applyLoadedTemplate = React.useCallback((loaded: Awaited<ReturnType<typeof loadTemplate>>) => {
    if (
      currentAccountIdRef.current !== loaded.accountId
      || templateRequestEpochRef.current !== loaded.requestEpoch
    ) return null;
    setBatch(loaded.hydratedBatch);
    templateDraftOwnerRef.current = loaded.accountId;
    setTemplateDraftHydratedFor(loaded.serverBatch.id);
    setTemplateDraftWritable(true);
    draftSessionId.current = loaded.sessionId;
    dirtyItemIds.current = new Set(loaded.dirtyItemIds);
    dirtyGroupIds.current = new Set(loaded.dirtyGroupIds);
    setDirty(loaded.dirty);
    if (loaded.interruptedUpload) setError(INTERRUPTED_UPLOAD_NOTICE);
    return loaded.serverBatch;
  }, []);

  const refreshList = React.useCallback(async () => {
    const payload = await apiRequest<ApiEnvelope & { batches: ImageBatchListItem[] }>("/api/image-batches");
    return payload.batches || [];
  }, []);

  const loadHistoryPage = React.useCallback(async (
    cursor: string | null,
    options?: {
      append?: boolean;
      quiet?: boolean;
      mode?: ImageBatch["mode"];
      replace?: boolean;
    },
  ) => {
    const mode = options?.mode || "style_replication";
    if (historyLoadInFlight.current.has(mode)) return;
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const requestId = historyLoadRequestRef.current[mode] + 1;
    historyLoadRequestRef.current[mode] = requestId;
    historyLoadInFlight.current.add(mode);
    if (options?.append) {
      setHistoryPaginationByMode((current) => ({
        ...current,
        [mode]: { ...current[mode], loadingMore: true },
      }));
    }
    try {
      const url = new URL("/api/image-batch-groups", window.location.origin);
      url.searchParams.set("take", String(HISTORY_PAGE_SIZE));
      url.searchParams.set("mode", mode);
      if (cursor) url.searchParams.set("cursor", cursor);
      const payload = await apiRequest<HistoryPagePayload>(url.toString());
      if (
        currentAccountIdRef.current !== accountId
        || templateRequestEpochRef.current !== requestEpoch
        || historyLoadRequestRef.current[mode] !== requestId
      ) return;
      const incoming = (payload.groups || []).map(normalizeHistoryGroup).filter((group) => group.items.length > 0).map((serverGroup) => {
        const localGroup = historyGroupsRef.current.find((group) => group.id === serverGroup.id);
        if (!localGroup) return serverGroup;
        const dirtyGroup = dirtyHistoryGroups.current.get(serverGroup.id);
        const dirtySettings = dirtyHistorySettings.current.get(serverGroup.batchId);
        const localItems = new Map(localGroup.items.map((item) => [item.id, item]));
        return {
          ...serverGroup,
          ...(dirtyGroup ? { name: localGroup.name } : {}),
          batch: dirtySettings
            ? {
                ...serverGroup.batch,
                status: localGroup.batch.status,
                finishedAt: localGroup.batch.finishedAt,
                sharedSettings: localGroup.batch.sharedSettings,
              }
            : serverGroup.batch,
          items: serverGroup.items.map((item) => (
            dirtyHistoryItems.current.has(item.id)
              ? localItems.get(item.id) || item
              : item
          )),
        };
      });
      setHistoryGroups((current) => {
        const next = options?.replace
          ? [
              ...current.filter((group) => group.batch.mode !== mode),
              ...incoming,
            ]
          : options?.append
          ? [...current, ...incoming.filter((group) => !current.some((entry) => entry.id === group.id))]
          : mergeHistoryFirstPage(current, incoming);
        historyGroupsRef.current = next;
        return next;
      });
      setHistoryPaginationByMode((current) => {
        const shouldAdvanceCursor = options?.replace
          || options?.append
          || current[mode].cursor === null;
        if (!shouldAdvanceCursor) return current;
        return {
          ...current,
          [mode]: {
            cursor: payload.nextCursor || null,
            hasMore: Boolean(payload.hasMore),
            loadingMore: false,
          },
        };
      });
    } catch (historyError) {
      if (
        !options?.quiet
        && currentAccountIdRef.current === accountId
        && templateRequestEpochRef.current === requestEpoch
      ) {
        setError(historyError instanceof Error ? historyError.message : text("workspaceFollowup.m5c8e1680d64b"));
      }
    } finally {
      if (historyLoadRequestRef.current[mode] === requestId) {
        historyLoadInFlight.current.delete(mode);
        if (options?.append) {
          setHistoryPaginationByMode((current) => ({
            ...current,
            [mode]: { ...current[mode], loadingMore: false },
          }));
        }
      }
    }
  }, []);

  const refreshHistoryBatch = React.useCallback(async (batchId: string) => {
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const currentGroup = historyGroupsRef.current.find((group) => group.batchId === batchId);
    if (!currentGroup) return [];
    const payload = await apiRequest<ApiEnvelope & { group: BatchHistoryGroup }>(
      `/api/image-batches/${batchId}/groups/${currentGroup.id}`,
    );
    if (
      currentAccountIdRef.current !== accountId
      || templateRequestEpochRef.current !== requestEpoch
    ) return [];
    const serverGroup = normalizeHistoryGroup(payload.group);
    const localGroup = historyGroupsRef.current.find((group) => group.id === serverGroup.id);
    const dirtyGroup = dirtyHistoryGroups.current.get(serverGroup.id);
    const dirtySettings = dirtyHistorySettings.current.get(serverGroup.batchId);
    const localItems = new Map((localGroup?.items || []).map((item) => [item.id, item]));
    const incoming = [{
      ...serverGroup,
      ...(dirtyGroup && localGroup ? { name: localGroup.name } : {}),
      batch: dirtySettings && localGroup
        ? {
            ...serverGroup.batch,
            status: localGroup.batch.status,
            finishedAt: localGroup.batch.finishedAt,
            sharedSettings: localGroup.batch.sharedSettings,
          }
        : serverGroup.batch,
      items: serverGroup.items.map((item) => (
        dirtyHistoryItems.current.has(item.id)
          ? localItems.get(item.id) || item
          : item
      )),
    }];
    setHistoryGroups((current) => {
      const incomingById = new Map(incoming.map((group) => [group.id, group]));
      const next = current.map((group) => incomingById.get(group.id) || group);
      historyGroupsRef.current = next;
      return next;
    });
    return incoming;
  }, []);

  const refreshActiveHistoryStatuses = React.useCallback(async (batchIds: string[]) => {
    if (!batchIds.length || historyStatusInFlight.current) return;
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const requestId = ++historyStatusRequestRef.current;
    historyStatusInFlight.current = true;
    try {
      const url = new URL("/api/image-batch-groups", window.location.origin);
      url.searchParams.set("statusOnly", "1");
      url.searchParams.set("batchIds", batchIds.join(","));
      const payload = await apiRequest<HistoryStatusPayload>(url.toString());
      if (
        currentAccountIdRef.current !== accountId
        || templateRequestEpochRef.current !== requestEpoch
        || historyStatusRequestRef.current !== requestId
      ) return;
      const changedBatchIds = (payload.groups || [])
        .filter((serverGroup) => {
          const current = historyGroupsRef.current.find((group) => group.id === serverGroup.id);
          return current && (
            current.batch.status !== serverGroup.batch.status
            || current.batch.version !== serverGroup.batch.version
            || current.batch.updatedAt !== serverGroup.batch.updatedAt
          );
        })
        .map((group) => group.batchId);
      await Promise.all(Array.from(new Set(changedBatchIds)).map(refreshHistoryBatch));
    } catch {
    } finally {
      if (historyStatusRequestRef.current === requestId) {
        historyStatusInFlight.current = false;
      }
    }
  }, [refreshHistoryBatch]);

  React.useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const accountId = currentAccountIdRef.current;
    setTemplateDraftWritable(false);
    setTemplateDraftHydratedFor("");
    setBatch(null);
    setBusy(false);
    draftSaveInFlight.current = null;
    historyGroupsRef.current = [];
    setHistoryGroups([]);
    setHistoryPaginationByMode({
      style_replication: { ...EMPTY_IMAGE_HISTORY_PAGINATION.style_replication },
      multi_prompt: { ...EMPTY_IMAGE_HISTORY_PAGINATION.multi_prompt },
    });
    historyLoadInFlight.current.clear();
    IMAGE_BATCH_MODES.forEach((mode) => {
      historyLoadRequestRef.current[mode] += 1;
    });
    historyStatusInFlight.current = false;
    historyStatusRequestRef.current += 1;
    dirtyItemIds.current.clear();
    dirtyGroupIds.current.clear();
    dirtyHistoryItems.current.clear();
    dirtyHistoryGroups.current.clear();
    dirtyHistorySettings.current.clear();
    setEditingGroupId(null);
    setGroupNameErrors({});
    setGroupResultPreview(null);
    if (historySaveTimer.current !== null) {
      window.clearTimeout(historySaveTimer.current);
      historySaveTimer.current = null;
    }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      setInitialHistoryLoading(Boolean(user));
      setInitialHistoryError("");
      // History is independent of model selection and draft restoration.
      // Settle immediately so a failed sibling request cannot be unhandled.
      const historyRequestIds = { ...historyLoadRequestRef.current };
      const historyRequest = user ? Promise.all(IMAGE_BATCH_MODES.map(async (mode) => {
        const historyUrl = new URL("/api/image-batch-groups", window.location.origin);
        historyUrl.searchParams.set("take", String(HISTORY_PAGE_SIZE));
        historyUrl.searchParams.set("mode", mode);
        return [mode, await apiRequest<HistoryPagePayload>(historyUrl.toString(), { signal: controller.signal })] as const;
      })).then((value) => ({ value }), (error: unknown) => ({ error })) : null;
      try {
        const modelPayload = await loadImageModelCatalog();
        if (cancelled || currentAccountIdRef.current !== accountId) return;
        const availableModels = (modelPayload.models || []).filter((model) => model.id !== "midjourney-v8-reapi" && model.id !== "midjourney-v8-apimart");
        setModels(availableModels);

        if (!user) {
          const anonymousBatch = createAnonymousBatch(availableModels);
          setBatch(anonymousBatch);
          historyGroupsRef.current = [];
          setHistoryGroups([]);
          setHistoryPaginationByMode({
            style_replication: { ...EMPTY_IMAGE_HISTORY_PAGINATION.style_replication },
            multi_prompt: { ...EMPTY_IMAGE_HISTORY_PAGINATION.multi_prompt },
          });
          dirtyItemIds.current.clear();
          dirtyGroupIds.current.clear();
          setDirty(false);
          return;
        }

        const storedMode = window.localStorage.getItem("batch_workbench_mode");
        const preferredMode: ImageBatch["mode"] = storedMode === "multi_prompt"
          ? "multi_prompt"
          : "style_replication";
        const loadedTemplate = await loadTemplate(preferredMode, availableModels);
        if (cancelled || currentAccountIdRef.current !== accountId) return;
        const template = applyLoadedTemplate(loadedTemplate);
        if (!template) return;
        // The form can be used as soon as its model and authoritative draft are ready.
        if (window.localStorage.getItem("batch_workbench_mode") !== "live_video") {
          window.localStorage.setItem("batch_workbench_mode", template.mode);
        }
        setLoading(false);
        const historyResult = await historyRequest!;
        if ("error" in historyResult) {
          if (!cancelled && currentAccountIdRef.current === accountId) {
            setInitialHistoryError(text("workspaceFollowup.m6ae3f03c6a39"));
          }
          return;
        }
        const historyPayloads = historyResult.value.filter(([mode]) => (
          historyLoadRequestRef.current[mode] === historyRequestIds[mode]
        ));
        if (!cancelled && currentAccountIdRef.current === accountId) {
          const initialHistory = historyPayloads.flatMap(([, historyPayload]) => (
            (historyPayload.groups || [])
              .map(normalizeHistoryGroup)
              .filter((group) => group.items.length > 0)
          ));
          // Keep groups created or edited while the initial history was in flight.
          const merged = new Map(initialHistory.map((group) => [group.id, group]));
          historyGroupsRef.current.forEach((group) => merged.set(group.id, group));
          historyGroupsRef.current = Array.from(merged.values());
          React.startTransition(() => {
            setHistoryGroups(historyGroupsRef.current);
            setHistoryPaginationByMode((current) => {
              const next = { ...current };
              historyPayloads.forEach(([mode, historyPayload]) => {
                next[mode] = {
                  cursor: historyPayload.nextCursor || null,
                  hasMore: Boolean(historyPayload.hasMore),
                  loadingMore: false,
                };
              });
              return next;
            });
          });
        }
      } catch (loadError) {
        if (!cancelled && currentAccountIdRef.current === accountId) setError(loadError instanceof Error ? loadError.message : text("workspaceFollowup.m0765f407130f"));
      } finally {
        if (!cancelled && currentAccountIdRef.current === accountId) {
          setLoading(false);
          setInitialHistoryLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [applyLoadedTemplate, authLoading, loadTemplate, user]);

  const saveDraft = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!batch || !dirty) return true;
    if (!templateDraftWritable) return false;
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const batchId = batch.id;
    const currentSave = draftSaveInFlight.current;
    if (
      currentSave
      && currentSave.accountId === accountId
      && currentSave.requestEpoch === requestEpoch
      && currentSave.batchId === batchId
    ) return currentSave.promise;
    const silent = options?.silent === true;
    const savingRevision = editRevision.current;
    const requestIsCurrent = () => (
      currentAccountIdRef.current === accountId
      && templateRequestEpochRef.current === requestEpoch
    );
    if (!silent) {
      setBusy(true);
      setError("");
    }
    const saveRequest = (async () => {
      try {
        const payload = await apiRequest<ApiEnvelope & { version: number }>(`/api/image-batches/${batch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: batch.version,
            batch: {
              name: batch.name,
              mode: batch.mode,
              sharedPrompt: batch.sharedPrompt,
              sharedSettings: batch.sharedSettings,
            },
            itemChanges: batch.items.filter((item) => dirtyItemIds.current.has(item.id)).map((item) => ({
              op: "update",
              itemId: item.id,
              patch: {
                name: item.name,
                prompt: item.prompt,
                includeSharedPrompt: item.includeSharedPrompt,
                overrides: item.overrides,
              },
            })),
            groupChanges: batch.groups
              .filter((group) => dirtyGroupIds.current.has(group.id))
              .map((group) => ({ groupId: group.id, name: group.name })),
          }),
        });
        if (!requestIsCurrent()) return false;
        setBatch((current) => current?.id === batchId ? { ...current, version: payload.version } : current);
        const fullySaved = editRevision.current === savingRevision;
        if (fullySaved) {
          dirtyItemIds.current.clear();
          dirtyGroupIds.current.clear();
          setDirty(false);
        }
        return fullySaved;
      } catch (saveError) {
        if (!requestIsCurrent()) return false;
        if (
          saveError instanceof BatchApiError
          && saveError.code === "BATCH_VERSION_CONFLICT"
        ) {
          try {
            await loadBatch(batchId);
            return false;
          } catch (reloadError) {
            if (!requestIsCurrent()) return false;
            setError(reloadError instanceof Error ? reloadError.message : text("workspaceFollowup.m61d1c9252d18"));
            return false;
          }
        }
        setError(saveError instanceof Error ? saveError.message : text("workspaceFollowup.m6309a3bb5ba4"));
        return false;
      } finally {
        if (!silent && requestIsCurrent()) setBusy(false);
      }
    })();
    const saveEntry = { accountId, requestEpoch, batchId, promise: saveRequest };
    draftSaveInFlight.current = saveEntry;
    try {
      return await saveRequest;
    } finally {
      if (draftSaveInFlight.current === saveEntry) draftSaveInFlight.current = null;
    }
  }, [batch, dirty, loadBatch, templateDraftWritable]);

  React.useEffect(() => {
    if (!templateDraftWritable || !dirty || busy || uploading) return;
    const timer = window.setTimeout(() => { void saveDraft({ silent: true }); }, 800);
    return () => window.clearTimeout(timer);
  }, [busy, dirty, saveDraft, templateDraftWritable, uploading]);

  const refreshCurrent = React.useCallback(async () => {
    if (!batch) return;
    await loadBatch(batch.id);
    await refreshList();
  }, [batch, loadBatch, refreshList]);

  const activeBatchId = batch?.id;
  const activeBatchStatus = batch?.status;
  const activeBatchUpdatedAt = batch?.updatedAt;

  React.useEffect(() => {
    if (
      isGroupedImageBatchMode(batch?.mode)
      || !activeBatchId
      || !activeBatchUpdatedAt
      || !activeBatchStatus
      || !isBatchActive(activeBatchStatus)
    ) return;
    let cancelled = false;
    const accountId = currentAccountIdRef.current;
    const requestEpoch = templateRequestEpochRef.current;
    const timer = window.setInterval(async () => {
      try {
        const payload = await apiRequest<ApiEnvelope & { changed: boolean; batch?: ImageBatch }>(
          `/api/image-batches/${activeBatchId}/status?updatedAfter=${encodeURIComponent(activeBatchUpdatedAt)}`,
        );
        if (
          !cancelled
          && currentAccountIdRef.current === accountId
          && templateRequestEpochRef.current === requestEpoch
          && payload.changed
          && payload.batch
        ) {
          setBatch(normalizeBatch(payload.batch, models));
          void refreshList();
        }
      } catch {}
    }, 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeBatchId, activeBatchStatus, activeBatchUpdatedAt, batch?.mode, models, refreshList]);

  const activeHistoryBatchIds = Array.from(new Set(
    historyGroups
      .filter((group) => isBatchActive(group.batch.status))
      .map((group) => group.batchId),
  )).slice(0, 20);
  const activeHistoryBatchIdsKey = activeHistoryBatchIds.join(",");
  React.useEffect(() => {
    if (!activeHistoryBatchIdsKey) return;
    const timer = window.setInterval(() => {
      void refreshActiveHistoryStatuses(activeHistoryBatchIdsKey.split(","));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeHistoryBatchIdsKey, refreshActiveHistoryStatuses]);

  const active = ["queued", "running", "submitting", "processing", "waiting_provider"].includes(batch?.status || "");

  const switchBatchMode = async (mode: ImageBatch["mode"]) => {
    if (
      !batch
      || batch.mode === mode
      || switchingMode
      || segmentedPromptPending
      || uploading
      || busy
      || active
    ) return;
    if (!user) {
      setBatch({
        ...createAnonymousBatch(models),
        id: `anonymous-${mode}`,
        mode,
      });
      window.localStorage.setItem("batch_workbench_mode", mode);
      return;
    }
    if (!(await saveDraft())) return;

    setSwitchingMode(true);
    setError("");
    const accountId = currentAccountIdRef.current;
    try {
      const loadedTemplate = await loadTemplate(mode, models);
      if (currentAccountIdRef.current !== accountId) return;
      if (!applyLoadedTemplate(loadedTemplate)) return;
      window.localStorage.setItem("batch_workbench_mode", mode);
      await loadHistoryPage(null, { mode, quiet: true });
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : text("workspaceFollowup.m2908e9d78f00"));
    } finally {
      if (currentAccountIdRef.current === accountId) setSwitchingMode(false);
    }
  };

  const openLiveVideo = async () => {
    if (switchingMode || segmentedPromptPending || uploading || busy || active) return;
    if (user && !(await saveDraft())) return;
    onOpenLiveVideo();
  };

  const changeBatch = (patch: Partial<ImageBatch>) => {
    if (active) return;
    editRevision.current += 1;
    setBatch((current) => current ? { ...current, ...patch } : current);
    setDirty(true);
  };

  const changeItem = (itemId: string, patch: Partial<BatchItem>) => {
    if (active) return;
    editRevision.current += 1;
    dirtyItemIds.current.add(itemId);
    const changesGenerationInput = ["prompt", "includeSharedPrompt", "overrides"]
      .some((key) => key in patch);
    setBatch((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId
        ? { ...item, ...patch, ...(changesGenerationInput ? { status: "draft" } : {}) }
        : item),
    } : current);
    setDirty(true);
  };

  const changeGroupName = (groupId: string, name: string) => {
    if (active) return;
    editRevision.current += 1;
    dirtyGroupIds.current.add(groupId);
    setBatch((current) => current ? {
      ...current,
      groups: current.groups.map((group) => group.id === groupId ? { ...group, name } : group),
    } : current);
    setDirty(true);
  };

  const flushHistoryChanges = React.useCallback((onlyBatchId?: string) => {
    const run = async () => {
      if (historySaveTimer.current) {
        window.clearTimeout(historySaveTimer.current);
        historySaveTimer.current = null;
      }
      const batchIds = new Set<string>();
      let succeeded = true;
      for (const entry of dirtyHistoryItems.current.values()) {
        if (!onlyBatchId || entry.batchId === onlyBatchId) batchIds.add(entry.batchId);
      }
      for (const entry of dirtyHistoryGroups.current.values()) {
        if (!onlyBatchId || entry.batchId === onlyBatchId) batchIds.add(entry.batchId);
      }
      for (const batchId of dirtyHistorySettings.current.keys()) {
        if (!onlyBatchId || batchId === onlyBatchId) batchIds.add(batchId);
      }
      for (const batchId of batchIds) {
        const group = historyGroupsRef.current.find((entry) => entry.batchId === batchId);
        if (!group) continue;
        const groupActive = isBatchActive(group.batch.status);
        const itemEntries = Array.from(dirtyHistoryItems.current.entries())
          .filter(([itemId, entry]) => {
            if (entry.batchId !== batchId) return false;
            if (group.batch.status === "creating") return false;
            if (!groupActive) return true;
            const item = group.items.find((candidate) => candidate.id === itemId);
            return Boolean(item && !isBatchItemActive(item));
          });
        const groupEntries = Array.from(dirtyHistoryGroups.current.entries())
          .filter(([, entry]) => entry.batchId === batchId);
        const settingsEntry = groupActive
          ? null
          : dirtyHistorySettings.current.get(batchId) || null;
        if (!itemEntries.length && !groupEntries.length && !settingsEntry) continue;
        try {
          const payload = await apiRequest<ApiEnvelope & { version: number }>(`/api/image-batches/${batchId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersion: group.batch.version,
              batch: settingsEntry ? { sharedSettings: settingsEntry.settings } : undefined,
              itemChanges: itemEntries.map(([itemId, entry]) => ({
                op: "update",
                itemId,
                patch: entry.patch,
              })),
              groupChanges: groupEntries.map(([groupId, entry]) => ({
                groupId,
                name: entry.name,
              })),
            }),
          });
          for (const [itemId, entry] of itemEntries) {
            if (dirtyHistoryItems.current.get(itemId)?.revision === entry.revision) {
              dirtyHistoryItems.current.delete(itemId);
            }
          }
          for (const [groupId, entry] of groupEntries) {
            if (dirtyHistoryGroups.current.get(groupId)?.revision === entry.revision) {
              dirtyHistoryGroups.current.delete(groupId);
            }
          }
          if (
            settingsEntry
            && dirtyHistorySettings.current.get(batchId)?.revision === settingsEntry.revision
          ) {
            dirtyHistorySettings.current.delete(batchId);
          }
          const applyVersion = (current: BatchHistoryGroup[]) => current.map((entry) => (
            entry.batchId === batchId
              ? { ...entry, batch: { ...entry.batch, version: payload.version } }
              : entry
          ));
          historyGroupsRef.current = applyVersion(historyGroupsRef.current);
          setHistoryGroups(applyVersion);
        } catch (saveError) {
          succeeded = false;
          setError(saveError instanceof Error ? saveError.message : text("workspaceFollowup.mbe35fed72ff3"));
        }
      }
      return succeeded;
    };
    const queued = historySaveQueue.current.then(run, run);
    historySaveQueue.current = queued;
    return queued;
  }, []);

  const scheduleHistorySave = React.useCallback(() => {
    if (historySaveTimer.current) window.clearTimeout(historySaveTimer.current);
    historySaveTimer.current = window.setTimeout(() => {
      historySaveTimer.current = null;
      void flushHistoryChanges();
    }, 350);
  }, [flushHistoryChanges]);

  React.useEffect(() => () => {
    if (historySaveTimer.current) window.clearTimeout(historySaveTimer.current);
  }, []);

  const changeHistoryItem = (
    group: BatchHistoryGroup,
    itemId: string,
    patch: Partial<BatchItem>,
  ) => {
    const item = group.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (group.batch.status === "creating") return;
    if (isBatchItemActive(item)) return;
    const groupActive = isBatchActive(group.batch.status);
    const editablePatch: Partial<BatchItem> = {};
    if ("prompt" in patch) editablePatch.prompt = String(patch.prompt || "");
    if (!Object.keys(editablePatch).length) return;
    const previous = dirtyHistoryItems.current.get(itemId);
    const revision = (previous?.revision || 0) + 1;
    dirtyHistoryItems.current.set(itemId, {
      batchId: group.batchId,
      patch: { ...(previous?.patch || {}), ...editablePatch },
      revision,
    });
    setHistoryGroups((current) => current.map((entry) => (
      entry.id === group.id
        ? {
            ...entry,
            batch: groupActive
              ? entry.batch
              : { ...entry.batch, status: "draft", finishedAt: null },
            items: entry.items.map((item) => item.id === itemId
              ? { ...item, ...editablePatch, status: "draft" }
              : item),
          }
        : entry
    )));
    scheduleHistorySave();
  };

  const changeHistoryGroupSettings = (
    group: BatchHistoryGroup,
    patch: Partial<BatchSettings>,
  ) => {
    if (isBatchActive(group.batch.status)) return;
    const currentGroup = historyGroupsRef.current.find(
      (entry) => entry.batchId === group.batchId,
    ) || group;
    const updatedGroup = applyHistoryGroupSettingsPatch(currentGroup, patch);
    const settingsRevision = (
      dirtyHistorySettings.current.get(group.batchId)?.revision || 0
    ) + 1;
    dirtyHistorySettings.current.set(group.batchId, {
      settings: updatedGroup.batch.sharedSettings,
      revision: settingsRevision,
    });
    for (const updatedItem of updatedGroup.items) {
      const previous = dirtyHistoryItems.current.get(updatedItem.id);
      dirtyHistoryItems.current.set(updatedItem.id, {
        batchId: group.batchId,
        patch: {
          ...(previous?.patch || {}),
          overrides: updatedItem.overrides,
        },
        revision: (previous?.revision || 0) + 1,
      });
    }
    const applyUpdate = (current: BatchHistoryGroup[]) => current.map((entry) => (
      entry.batchId === group.batchId ? updatedGroup : entry
    ));
    historyGroupsRef.current = applyUpdate(historyGroupsRef.current);
    setHistoryGroups(applyUpdate);
    scheduleHistorySave();
  };

  const changeHistoryGroupName = (group: BatchHistoryGroup, name: string) => {
    const validationError = validateBatchGroupDownloadName(name) || "";
    setGroupNameErrors((current) => ({
      ...current,
      [group.id]: validationError,
    }));
    setHistoryGroups((current) => current.map((entry) => (
      entry.id === group.id ? { ...entry, name } : entry
    )));
    if (validationError) {
      dirtyHistoryGroups.current.delete(group.id);
      return;
    }
    const revision = (dirtyHistoryGroups.current.get(group.id)?.revision || 0) + 1;
    dirtyHistoryGroups.current.set(group.id, {
      batchId: group.batchId,
      name,
      revision,
    });
    scheduleHistorySave();
  };

  const downloadHistoryGroup = async (group: BatchHistoryGroup) => {
    const validationError = validateBatchGroupDownloadName(group.name);
    if (validationError) {
      setGroupNameErrors((current) => ({
        ...current,
        [group.id]: validationError,
      }));
      setEditingGroupId(group.id);
      return;
    }
    if (!(await flushHistoryChanges(group.batchId))) return;

    const anchor = document.createElement("a");
    anchor.href = `/api/image-batches/${group.batchId}/download?groupId=${encodeURIComponent(group.id)}`;
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const mutate = async (action: () => Promise<unknown>, options?: { skipSave?: boolean }) => {
    if (!batch) return;
    if (!options?.skipSave && !(await saveDraft())) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshCurrent();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : text("workspaceFollowup.m0c3b4cf7aa25"));
    } finally {
      setBusy(false);
    }
  };

  const addTask = async (source?: Partial<BatchItem>) => {
    if (!batch) return;
    await mutate(() => apiRequest(`/api/image-batches/${batch.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: source?.name ? `${source.name} 副本` : `任务 ${String(batch.items.length + 1).padStart(2, "0")}`,
        prompt: source?.prompt || "",
        overrides: source?.overrides || {},
      }),
    }));
  };

  const deleteGroup = async (group: BatchHistoryGroup) => {
    if (deletingGroupIds.has(group.id)) return;
    setDeletingGroupIds((current) => new Set(current).add(group.id));
    if (!(await flushHistoryChanges(group.batchId))) {
      setDeletingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
      return;
    }
    setError("");
    const previousIndex = historyGroupsRef.current.findIndex((entry) => entry.id === group.id);
    setHistoryGroups((current) => {
      const next = current.filter((entry) => entry.id !== group.id);
      historyGroupsRef.current = next;
      return next;
    });
    try {
      await apiRequest(`/api/image-batches/${group.batchId}/groups/${group.id}`, {
        method: "DELETE",
      });
      dirtyHistoryGroups.current.delete(group.id);
      dirtyHistorySettings.current.delete(group.batchId);
      for (const item of group.items) dirtyHistoryItems.current.delete(item.id);
    } catch (deleteError) {
      setHistoryGroups((current) => {
        if (current.some((entry) => entry.id === group.id)) return current;
        const next = [...current];
        next.splice(Math.max(0, previousIndex), 0, group);
        historyGroupsRef.current = next;
        return next;
      });
      setError(deleteError instanceof Error ? deleteError.message : text("workspaceFollowup.mcab46f57b554"));
    } finally {
      setDeletingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
  };

  const uploadMedia = async (
    role: "product" | "reference",
    files: File[],
    itemId?: string,
    targetBatchId?: string,
  ) => {
    if (!batch || !files.length) return;
    const uploadBatchId = targetBatchId || batch.id;
    const historyGroup = historyGroupsRef.current.find((group) => group.batchId === uploadBatchId);
    const uploadBatchMode = uploadBatchId === batch.id
      ? batch.mode
      : historyGroup?.batch.mode;
    const sourceRelations = uploadBatchId === batch.id
      ? itemId
        ? batch.items.find((item) => item.id === itemId)?.media || []
        : batch.media
      : historyGroup?.items.find((item) => item.id === itemId)?.media || [];
    const replacesTaskProduct = Boolean(
      itemId && role === "product" && uploadBatchMode !== "multi_prompt",
    );
    const replacedRelations = replacesTaskProduct
      ? sourceRelations.filter((entry) => entry.role === "product")
      : [];
    const nextPosition = Math.max(
      -1,
      ...sourceRelations.filter((entry) => entry.role === role).map((entry) => entry.position),
    ) + 1;
    const localRelations = files.map((file, index) => (
      createLocalMediaRelation(file, role, itemId || null, nextPosition + index)
    ));
    const localIds = new Set(localRelations.map((relation) => relation.id));
    const pendingIds = new Set(localIds);

    const applyLocalRelations = (relations: BatchMediaRelation[]) => {
      if (uploadBatchId === batch.id) {
        setBatch((current) => {
          if (!current) return current;
          if (!itemId) return { ...current, media: relations };
          return {
            ...current,
            items: current.items.map((item) => item.id === itemId
              ? { ...item, media: relations, status: "draft" }
              : item),
          };
        });
        return;
      }
      setHistoryGroups((current) => {
        const next = current.map((group) => group.batchId === uploadBatchId
          ? {
              ...group,
              items: group.items.map((item) => item.id === itemId
                ? { ...item, media: relations, status: "draft" }
                : item),
            }
          : group);
        historyGroupsRef.current = next;
        return next;
      });
    };

    applyLocalRelations([
      ...sourceRelations.filter((entry) => !(replacesTaskProduct && entry.role === "product")),
      ...localRelations,
    ]);
    setUploadingTarget({ batchId: uploadBatchId, role, itemId: itemId || null });
    setError("");
    try {
      const persisted = uploadBatchId === batch.id
        ? await saveDraft()
        : await flushHistoryChanges(uploadBatchId);
      if (!persisted) throw new Error("保存当前修改后才能上传素材");

      let localOffset = 0;
      for (const chunk of chunkBatchUploadFiles(files)) {
        const chunkRelations = localRelations.slice(localOffset, localOffset + chunk.length);
        const form = new FormData();
        chunk.forEach((file) => form.append("file", file));
        form.set("draftSessionId", draftSessionId.current || `batch-${Date.now()}`);
        form.set("role", role);
        form.set("scope", itemId ? "item" : "batch");
        if (itemId) form.set("itemId", itemId);
        let payload: ApiEnvelope & { relations: BatchMediaRelation[]; version: number };
        try {
          payload = await apiRequest<ApiEnvelope & { relations: BatchMediaRelation[]; version: number }>(
            `/api/image-batches/${uploadBatchId}/media`,
            { method: "POST", body: form },
          );
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : "上传失败";
          throw new Error(chunk.map((file) => `${file.name}：${message}`).join("\n"));
        }
        if (payload.relations?.length !== chunkRelations.length) {
          throw new Error(`${chunk.map((file) => file.name).join("、")} 上传结果缺失`);
        }
        const replacements = new Map(
          chunkRelations.map((local, index) => [local.id, payload.relations[index]]),
        );
        chunkRelations.forEach((local) => pendingIds.delete(local.id));
        if (uploadBatchId === batch.id) {
          setBatch((current) => {
            if (!current) return current;
            if (!itemId) {
              return {
                ...current,
                version: Math.max(current.version, payload.version),
                media: current.media.map((entry) => replacements.get(entry.id) || entry),
              };
            }
            return {
              ...current,
              version: Math.max(current.version, payload.version),
              items: current.items.map((item) => item.id === itemId
                ? {
                    ...item,
                    media: item.media.map((entry) => replacements.get(entry.id) || entry),
                  }
                : item),
            };
          });
        } else {
          setHistoryGroups((current) => {
            const replaced = chunkRelations.reduce(
              (groups, local) => replaceHistoryMediaRelation(
                groups,
                uploadBatchId,
                local.id,
                replacements.get(local.id)!,
              ),
              current,
            );
            const next = syncHistoryBatchVersion(replaced, uploadBatchId, payload.version);
            historyGroupsRef.current = next;
            return next;
          });
        }
        chunkRelations.forEach((local) => {
          URL.revokeObjectURL(String(local.media.originalKey || ""));
        });
        localOffset += chunk.length;
      }
      if (uploadBatchId !== batch.id) {
        setHistoryGroups((current) => {
          const next = current.map((group) => group.batchId === uploadBatchId
            ? { ...group, batch: { ...group.batch, status: "draft", finishedAt: null } }
            : group);
          historyGroupsRef.current = next;
          return next;
        });
      }
    } catch (uploadError) {
      if (uploadBatchId === batch.id) {
        setBatch((current) => {
          if (!current) return current;
          if (!itemId) {
            return {
              ...current,
              media: current.media.filter((entry) => !pendingIds.has(entry.id)),
            };
          }
          return {
            ...current,
            items: current.items.map((item) => item.id === itemId
              ? {
                  ...item,
                  media: [
                    ...item.media.filter((entry) => !pendingIds.has(entry.id)),
                    ...(pendingIds.size ? replacedRelations : []),
                  ].sort((left, right) => left.position - right.position),
                }
              : item),
          };
        });
      } else {
        setHistoryGroups((current) => {
          const next = rollbackHistoryMediaRelation(
            current,
            uploadBatchId,
            pendingIds,
            itemId || null,
            pendingIds.size ? replacedRelations : [],
          );
          historyGroupsRef.current = next;
          return next;
        });
      }
      localRelations
        .filter((relation) => pendingIds.has(relation.id))
        .forEach((relation) => URL.revokeObjectURL(String(relation.media.originalKey || "")));
      setError(uploadError instanceof Error ? uploadError.message : text("workspaceFollowup.m219481a6dde7"));
    } finally {
      setUploadingTarget(null);
    }
  };

  const importProductLibraryItem = async (
    role: "product" | "reference",
    drop: BatchProductLibraryDrop,
    itemId?: string,
    targetBatchId?: string,
  ) => {
    if (!batch) return;
    const uploadBatchId = targetBatchId || batch.id;
    const historyGroup = historyGroupsRef.current.find((group) => group.batchId === uploadBatchId);
    const uploadBatchMode = uploadBatchId === batch.id
      ? batch.mode
      : historyGroup?.batch.mode;
    const replacesTaskProduct = Boolean(
      itemId && role === "product" && uploadBatchMode !== "multi_prompt",
    );
    setUploadingTarget({ batchId: uploadBatchId, role, itemId: itemId || null });
    setError("");
    try {
      const persisted = uploadBatchId === batch.id
        ? await saveDraft()
        : await flushHistoryChanges(uploadBatchId);
      if (!persisted) throw new Error("保存当前修改后才能导入产品库素材");
      const payload = await apiRequest<ApiEnvelope & {
        relation: BatchMediaRelation;
        version: number;
      }>(`/api/image-batches/${uploadBatchId}/product-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productLibraryItemId: drop.productLibraryItemId,
          requestKey: drop.requestKey,
          role,
          scope: itemId ? "item" : "batch",
          itemId: itemId || undefined,
        }),
      });
      if (!payload.relation) throw new Error("产品库导入结果缺失");
      const applyRelation = (relations: BatchMediaRelation[]) => [
        ...relations.filter((entry) => !(
          replacesTaskProduct && entry.role === "product"
        )),
        payload.relation,
      ].sort((left, right) => left.position - right.position);

      if (uploadBatchId === batch.id) {
        setBatch((current) => {
          if (!current) return current;
          if (!itemId) {
            return {
              ...current,
              version: Math.max(current.version, payload.version),
              media: applyRelation(current.media),
            };
          }
          return {
            ...current,
            version: Math.max(current.version, payload.version),
            status: "draft",
            finishedAt: null,
            items: current.items.map((item) => item.id === itemId
              ? { ...item, status: "draft", media: applyRelation(item.media) }
              : item),
          };
        });
      } else {
        setHistoryGroups((current) => {
          const next = syncHistoryBatchVersion(current.map((group) => group.batchId === uploadBatchId
            ? {
                ...group,
                batch: { ...group.batch, status: "draft", finishedAt: null },
                items: group.items.map((item) => item.id === itemId
                  ? { ...item, status: "draft", media: applyRelation(item.media) }
                  : item),
              }
            : group), uploadBatchId, payload.version);
          historyGroupsRef.current = next;
          return next;
        });
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : text("workspaceFollowup.m963178763414"));
    } finally {
      setUploadingTarget(null);
    }
  };

  const removeMedia = async (relation: BatchMediaRelation, targetBatchId?: string) => {
    if (!batch || relation.pending) return;
    const mediaBatchId = targetBatchId || batch.id;
    const itemId = relation.itemId;
    const tracksSharedTemplateMedia = mediaBatchId === batch.id && itemId === null;
    if (tracksSharedTemplateMedia) {
      setRemovingSharedMediaIds((current) => new Set(current).add(String(relation.id)));
    }
    if (mediaBatchId === batch.id) {
      setBatch((current) => {
        if (!current) return current;
        if (!itemId) {
          return { ...current, media: current.media.filter((entry) => entry.id !== relation.id) };
        }
        return {
          ...current,
          items: current.items.map((item) => item.id === itemId
            ? { ...item, media: item.media.filter((entry) => entry.id !== relation.id) }
            : item),
        };
      });
    } else {
      setHistoryGroups((current) => {
        const next = rollbackHistoryMediaRelation(
          current,
          mediaBatchId,
          new Set([relation.id]),
          itemId,
        );
        historyGroupsRef.current = next;
        return next;
      });
    }
    setError("");
    try {
      if (mediaBatchId !== batch.id && !(await flushHistoryChanges(mediaBatchId))) {
        throw new Error("保存当前修改后才能删除素材");
      }
      const payload = await apiRequest<ApiEnvelope & { version: number }>(
        `/api/image-batches/${mediaBatchId}/media/${relation.id}`,
        { method: "DELETE" },
      );
      if (mediaBatchId === batch.id) {
        setBatch((current) => current
          ? { ...current, version: Math.max(current.version, payload.version) }
          : current);
      } else {
        setHistoryGroups((current) => {
          const next = syncHistoryBatchVersion(current, mediaBatchId, payload.version);
          historyGroupsRef.current = next;
          return next;
        });
      }
    } catch (removeError) {
      if (mediaBatchId === batch.id) {
        setBatch((current) => {
          if (!current) return current;
          if (!itemId) {
            return {
              ...current,
              media: [...current.media, relation].sort((left, right) => left.position - right.position),
            };
          }
          return {
            ...current,
            items: current.items.map((item) => item.id === itemId
              ? {
                  ...item,
                  media: [...item.media, relation].sort((left, right) => left.position - right.position),
                }
              : item),
          };
        });
      } else {
        setHistoryGroups((current) => {
          const next = rollbackHistoryMediaRelation(
            current,
            mediaBatchId,
            new Set(),
            itemId,
            [relation],
          );
          historyGroupsRef.current = next;
          return next;
        });
      }
      setError(removeError instanceof Error ? removeError.message : text("workspaceFollowup.mb4adde6a7547"));
    } finally {
      if (tracksSharedTemplateMedia) {
        setRemovingSharedMediaIds((current) => {
          const next = new Set(current);
          next.delete(String(relation.id));
          return next;
        });
      }
    }
  };

  const clearSharedMedia = async (role: "product" | "reference") => {
    if (!batch || clearingRole) return;
    const batchId = batch.id;
    const relations = batch.media.filter((entry) => entry.itemId === null && entry.role === role);
    if (!relations.length) return;
    const label = role === "product" ? text("workspaceFollowup.md65530829014") : text("workspaceFollowup.me8a1ec993427");

    setClearingRole(role);
    setError("");
    const removedIds = new Set(relations.map((relation) => relation.id));
    setBatch((current) => current?.id === batchId
      ? { ...current, media: current.media.filter((entry) => !removedIds.has(entry.id)) }
      : current);
    try {
      const payload = await apiRequest<ApiEnvelope & { version: number }>(
        `/api/image-batches/${batchId}/media?role=${encodeURIComponent(role)}`,
        { method: "DELETE" },
      );
      setBatch((current) => current?.id === batchId
        ? { ...current, version: Math.max(current.version, payload.version) }
        : current);
    } catch (clearError) {
      setBatch((current) => current?.id === batchId
        ? {
            ...current,
            media: [...current.media, ...relations].sort((left, right) => left.position - right.position),
          }
        : current);
      setError(clearError instanceof Error ? clearError.message : text("workspaceFollowup.m3add92660a55", { v0: label }));
    } finally {
      setClearingRole(null);
    }
  };

  const generateGroups = async () => {
    if (!batch || creatingGroup) return;
    if (batch.mode !== "style_replication") return;
    if (!user) {
      openLoginModal();
      return;
    }
    if (!(await saveDraft())) return;
    const optimisticGroup = createOptimisticHistoryGroup(batch, historyGroupsRef.current);
    setHistoryGroups((current) => {
      const next = [optimisticGroup, ...current];
      historyGroupsRef.current = next;
      return next;
    });
    setCreatingGroup(true);
    setError("");
    try {
      const payload = await apiRequest<ApiEnvelope & {
        group: BatchHistoryGroup;
        templateVersion: number;
      }>(`/api/image-batches/${batch.id}/groups?detached=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sharedPrompt: batch.sharedPrompt,
          sharedSettings: batch.sharedSettings,
        }),
      });
      const createdGroup = normalizeHistoryGroup(payload.group);
      setHistoryGroups((current) => {
        const next = [
          createdGroup,
          ...current.filter((group) => group.id !== createdGroup.id && group.id !== optimisticGroup.id),
        ];
        historyGroupsRef.current = next;
        return next;
      });
      setBatch((current) => current ? {
        ...current,
        version: payload.templateVersion,
      } : current);
      requestScrollTop();
    } catch (groupError) {
      setHistoryGroups((current) => {
        const next = current.filter((group) => group.id !== optimisticGroup.id);
        historyGroupsRef.current = next;
        return next;
      });
      setError(groupError instanceof Error ? groupError.message : text("workspaceFollowup.m2cc34efe0489"));
    } finally {
      setCreatingGroup(false);
    }
  };

  const commitSegmentedPromptGroup = React.useCallback((group: BatchHistoryGroup) => {
    const createdGroup = normalizeHistoryGroup(group);
    setHistoryGroups((current) => {
      const next = [
        createdGroup,
        ...current.filter((entry) => entry.id !== createdGroup.id),
      ];
      historyGroupsRef.current = next;
      return next;
    });
    requestScrollTop();
  }, [requestScrollTop]);

  const createSegmentedPromptGroup = React.useCallback(async (
    continuation: BatchSegmentedPromptGroupRequest,
    generatedPrompt: string,
    skill: GenerationSkillSnapshot | null,
  ) => {
    const payload = await apiRequest<ApiEnvelope & {
      group: BatchHistoryGroup;
    }>(`/api/image-batches/${continuation.templateBatchId}/groups?detached=1&kind=segmented_prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestKey: continuation.requestKey,
        sharedPrompt: continuation.sharedPrompt,
        sharedSettings: continuation.sharedSettings,
        generatedPrompt,
        skill,
        mediaSnapshots: continuation.mediaSnapshots,
      }),
    });
    commitSegmentedPromptGroup(payload.group);
  }, [commitSegmentedPromptGroup]);

  const generateSegmentedPrompts = async () => {
    if (
      !batch
      || batch.mode !== "multi_prompt"
      || segmentedRunLockRef.current
      || rolePositioning.busy
    ) return;
    if (!user) {
      openLoginModal();
      return;
    }
    if (!rolePositioning.selectedRoleSkillId) {
      rolePositioning.openWithError("请先选择一个 Skill");
      return;
    }
    if (!String(batch.sharedSettings?.model || "").trim()) {
      setError(text("workspaceFollowup.m621e846d2bce"));
      return;
    }
    if (mediaMutationPending) {
      setError(text("workspaceFollowup.m360523f6e4d2"));
      return;
    }
    if (!(await saveDraft())) return;

    const snapshot = {
      batchId: batch.id,
      sharedPrompt: batch.sharedPrompt,
      sharedSettings: { ...batch.sharedSettings },
      media: batch.media
        .filter(
          (entry) => entry.itemId === null
            && entry.role === "product"
            && !entry.pending,
        )
        .slice()
        .sort((left, right) => (
          left.position - right.position
          || String(left.id).localeCompare(String(right.id))
        )),
    };
    const continuation = {
      kind: "batch_segmented_prompts" as const,
      requestKey: createToolClientUuid(),
      templateBatchId: snapshot.batchId,
      sharedPrompt: snapshot.sharedPrompt,
      sharedSettings: snapshot.sharedSettings,
      mediaSnapshots: snapshot.media.map((entry, position) => ({
        mediaId: String(entry.media.id),
        position,
      })),
    };
    segmentedRunLockRef.current = true;
    setSegmentedPromptPending(true);
    setError("");
    try {
      const { generatedPrompt, skill } = await rolePositioning.generatePrompt({
        prompt: snapshot.sharedPrompt,
        media: snapshot.media,
        pendingMedia: false,
        continuation,
      });
      await createSegmentedPromptGroup(continuation, generatedPrompt, skill);
      const cleared = await rolePositioning.saveNow({
        activeReverseTaskId: null,
        continuation: null,
      });
      if (!cleared.success) throw new Error(cleared.error);
    } catch (runError) {
      const message = runError instanceof Error
        ? runError.message
        : "生成分段提示词失败";
      setError(message.includes("重试") ? message : text("workspaceFollowup.m6b64771952f3", { v0: message }));
    } finally {
      segmentedRunLockRef.current = false;
      setSegmentedPromptPending(false);
    }
  };

  const resumeSegmentedPromptContinuation = React.useCallback(async (
    continuation: BatchSegmentedPromptRoleContinuation,
    generatedPrompt: string,
  ) => {
    segmentedRunLockRef.current = true;
    setSegmentedPromptPending(true);
    setError("");
    try {
      await createSegmentedPromptGroup(
        continuation,
        generatedPrompt,
        rolePositioning.resultRoleSkill || null,
      );
      const cleared = await rolePositioning.saveNow({
        activeReverseTaskId: null,
        continuation: null,
      });
      if (!cleared.success) throw new Error(cleared.error);
    } catch (runError) {
      const message = runError instanceof Error
        ? runError.message
        : "生成分段提示词失败";
      setError(message.includes("重试") ? message : text("workspaceFollowup.m6b64771952f3", { v0: message }));
    } finally {
      segmentedRunLockRef.current = false;
      setSegmentedPromptPending(false);
    }
  }, [createSegmentedPromptGroup, rolePositioning]);

  React.useEffect(() => {
    const continuation = rolePositioning.continuation;
    const generatedPrompt = rolePositioning.reversePrompt.trim();
    if (
      !rolePositioning.hydrated
      || loading
      || !batch
      || batch.mode !== "multi_prompt"
      || !continuation
      || continuation.phase !== "ready"
      || !generatedPrompt
      || segmentedRunLockRef.current
      || resumedSegmentedContinuationRef.current === continuation.requestKey
    ) return;
    resumedSegmentedContinuationRef.current = continuation.requestKey;
    void resumeSegmentedPromptContinuation(continuation, generatedPrompt);
  }, [batch, loading, resumeSegmentedPromptContinuation, rolePositioning]);

  const applySplitPrompts = async (promptText: string) => {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      const preview = await apiRequest<ApiEnvelope & { prompts: string[] }>(`/api/image-batches/${batch.id}/prompts/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: promptText }),
      });
      await apiRequest(`/api/image-batches/${batch.id}/prompts/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: preview.prompts }),
      });
      setSplitOpen(false);
      await refreshCurrent();
    } catch (splitError) {
      setError(splitError instanceof Error ? splitError.message : text("workspaceFollowup.m9e164b732729"));
    } finally {
      setBusy(false);
    }
  };

  const markHistoryBatchQueued = (batchId: string, itemIds?: string[]) => {
    const previous = historyGroupsRef.current.find((group) => group.batchId === batchId) || null;
    const targetIds = new Set(itemIds?.length ? itemIds : previous?.items.map((item) => item.id) || []);
    const applyQueued = (current: BatchHistoryGroup[]) => current.map((group) => (
      group.batchId === batchId
        ? {
            ...group,
            batch: { ...group.batch, status: "queued", finishedAt: null },
            items: group.items.map((item) => {
              if (!targetIds.has(item.id)) return item;
              const attempt = Math.max(0, ...item.outputs.map((output) => output.attempt)) + 1;
              return {
                ...item,
                status: "queued",
                outputs: [{
                  id: `local-output-${window.crypto?.randomUUID?.() || `${Date.now()}-${item.id}`}`,
                  slotIndex: 0,
                  attempt,
                  status: "queued",
                  startedAt: null,
                  finishedAt: null,
                  generation: null,
                }, ...item.outputs],
              };
            }),
          }
        : group
    ));
    historyGroupsRef.current = applyQueued(historyGroupsRef.current);
    setHistoryGroups(applyQueued);
    return previous;
  };

  const rollbackHistoryBatch = (previous: BatchHistoryGroup | null) => {
    if (!previous) return;
    const rollback = (current: BatchHistoryGroup[]) => current.map((group) => (
      group.id === previous.id ? previous : group
    ));
    historyGroupsRef.current = rollback(historyGroupsRef.current);
    setHistoryGroups(rollback);
  };

  const submitBatchItems = async (batchId: string, itemIds?: string[]) => {
    await apiRequest(`/api/image-batches/${batchId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": window.crypto?.randomUUID?.() || `${batchId}-${Date.now()}`,
      },
      body: JSON.stringify(itemIds?.length ? { itemIds } : {}),
    });
  };

  const submit = async (itemIds?: string[], targetBatchId?: string) => {
    if (!batch) return;
    const submitBatchId = targetBatchId || batch.id;
    if (targetBatchId && submittingBatchIds.has(submitBatchId)) return;
    if (targetBatchId) {
      setSubmittingBatchIds((current) => new Set(current).add(submitBatchId));
      if (!(await flushHistoryChanges(submitBatchId))) {
        setSubmittingBatchIds((current) => {
          const next = new Set(current);
          next.delete(submitBatchId);
          return next;
        });
        return;
      }
    } else {
      if (!(await saveDraft())) return;
      setBusy(true);
    }
    setError("");
    let previousHistoryGroup: BatchHistoryGroup | null = null;
    try {
      if (targetBatchId) {
        previousHistoryGroup = markHistoryBatchQueued(submitBatchId, itemIds);
        watchedModelErrorBatchIdsRef.current.add(submitBatchId);
      }
      await submitBatchItems(submitBatchId, itemIds);
      if (!targetBatchId) {
        await refreshCurrent();
      }
    } catch (submitError) {
      if (targetBatchId) rollbackHistoryBatch(previousHistoryGroup);
      setError(submitError instanceof Error ? submitError.message : text("workspaceFollowup.md697ff7deef7"));
    } finally {
      if (targetBatchId) {
        setSubmittingBatchIds((current) => {
          const next = new Set(current);
          next.delete(submitBatchId);
          return next;
        });
      } else {
        setBusy(false);
      }
    }
  };

  const runItemAction = async (
    group: BatchHistoryGroup,
    item: BatchItem,
    action: "retry" | "regenerate",
  ) => {
    if (!canStartBatchTaskAction({
      action,
      batchActive: isBatchActive(group.batch.status),
      itemOutputStatus: item.outputs[0]?.status,
      itemPending: pendingItemActionIdsRef.current.has(item.id),
      batchSubmitting: submittingBatchIds.has(group.batchId),
    })) return;
    pendingItemActionIdsRef.current.add(item.id);
    const failedAction = action === "retry"
      ? resolveFailedTaskAction({
          itemStatus: item.status,
          hasPendingChanges: dirtyHistoryItems.current.has(item.id),
        })
      : "submit";
    setPendingItemActions((current) => new Map(current).set(item.id, action));
    setItemActionErrors((current) => {
      const next = new Map(current);
      next.delete(item.id);
      return next;
    });
    try {
      if (!(await flushHistoryChanges(group.batchId))) {
        throw new Error("保存修改失败，请稍后重试");
      }
      if (failedAction === "retry") {
        await apiRequest(`/api/image-batches/${group.batchId}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: [item.id] }),
        });
      } else {
        await submitBatchItems(group.batchId, [item.id]);
      }
      markHistoryBatchQueued(group.batchId, [item.id]);
      await refreshHistoryBatch(group.batchId);
    } catch (actionError) {
      setItemActionErrors((current) => new Map(current).set(
        item.id,
        actionError instanceof Error ? actionError.message : "操作失败，请稍后重试",
      ));
    } finally {
      pendingItemActionIdsRef.current.delete(item.id);
      setPendingItemActions((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const cancelItemTask = async (
    group: BatchHistoryGroup | null,
    itemId: string,
  ) => {
    if (!batch || pendingItemActionIdsRef.current.has(itemId)) return;
    const targetBatchId = group?.batchId || batch.id;
    pendingItemActionIdsRef.current.add(itemId);
    setPendingItemActions((current) => new Map(current).set(itemId, "cancel"));
    setItemActionErrors((current) => {
      const next = new Map(current);
      next.delete(itemId);
      return next;
    });
    try {
      await apiRequest(`/api/image-batches/${targetBatchId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (group) {
        await refreshHistoryBatch(targetBatchId);
      } else {
        await refreshCurrent();
      }
    } catch (cancelError) {
      const message = cancelError instanceof Error
        ? cancelError.message
        : "取消任务失败，请稍后重试";
      setItemActionErrors((current) => new Map(current).set(
        itemId,
        message,
      ));
      setError(message);
    } finally {
      pendingItemActionIdsRef.current.delete(itemId);
      setPendingItemActions((current) => {
        const next = new Map(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  const openGroupResultPreview = React.useCallback(
    (groupName: string, items: BatchItem[], outputId: string) => {
      const preview = buildBatchGroupResultPreview(items, outputId);
      if (!preview) return;
      setGroupResultPreview({
        groupName,
        entries: preview.entries,
        index: preview.initialIndex,
      });
    },
    [],
  );
  const activeGroupResultPreview = groupResultPreview
    ? groupResultPreview.entries[groupResultPreview.index] || null
    : null;

  const errorDialog = (
    <UiProps ids={{"title":["batch.m0c3b4cf7aa25"],"confirmText":["batch.m3fd47edce45b"]}}><ConfirmDialog
      open={Boolean(error)}
      title="batch.m0c3b4cf7aa25"
      confirmText="batch.m3fd47edce45b"
      showCancel={false}
      danger
      onConfirm={() => setError("")}
      onClose={() => setError("")}
    >
      <div className="whitespace-pre-line text-sm leading-relaxed text-[var(--app-muted)]">
        {uiError(error)}
      </div>
    </ConfirmDialog></UiProps>
  );

  if (loading) {
    return (
      <AtomicPageReveal ready={!authLoading && !loading} onReveal={onInitialReady}>
      <div className="h-full min-h-0 w-full flex-1 overflow-hidden">
        <BatchWorkbenchSkeleton />
        {errorDialog}
      </div>
      </AtomicPageReveal>
    );
  }

  if (!batch) {
    return (
      <AtomicPageReveal ready={!authLoading && !loading} onReveal={onInitialReady}>
      <div className="h-full min-h-0 w-full flex-1 overflow-hidden">
        <BatchWorkbenchSkeleton />
        {errorDialog}
      </div>
      </AtomicPageReveal>
    );
  }

  const totalOutputs = batch.items.length;
  const groupedWorkflow = isGroupedImageBatchMode(batch.mode);
  const renderImageHistoryGroup = (group: BatchHistoryGroup) => {
    const groupActive = isBatchActive(group.batch.status);
    const groupSubmitting = submittingBatchIds.has(group.batchId);
    const groupDeleting = deletingGroupIds.has(group.id);
    const groupBusy = groupActive || groupSubmitting || groupDeleting;
    const downloadableGroupOutputs = selectLatestSuccessfulBatchOutputs(group.items);
    const groupDefaults = group.batch.sharedSettings || batch.sharedSettings;

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 flex-[1_1_32rem] flex-wrap items-center gap-2">
            {editingGroupId === group.id ? (
              <div className="min-w-0">
                <UiProps ids={{"aria-label":["batch.md7e266bdc806"]}}><input
                  aria-label="batch.md7e266bdc806"
                  aria-invalid={Boolean(groupNameErrors[group.id])}
                  aria-describedby={groupNameErrors[group.id]
                    ? `group-name-error-${group.id}`
                    : undefined}
                  // Registry publication runs in an effect; let the DOM retain the IME draft.
                  defaultValue={group.name}
                  size={Math.max(1, Array.from(group.name).length)}
                  disabled={groupDeleting}
                  autoFocus
                  onChange={(event) => changeHistoryGroupName(group, event.target.value)}
                  onCompositionStart={() => { groupNameComposingRef.current = true; }}
                  onCompositionEnd={() => { groupNameComposingRef.current = false; }}
                  onBlur={(event) => {
                    const validationError = validateBatchGroupDownloadName(event.currentTarget.value);
                    if (validationError) {
                      setGroupNameErrors((current) => ({
                        ...current,
                        [group.id]: validationError,
                      }));
                      return;
                    }
                    setEditingGroupId(null);
                    void flushHistoryChanges(group.batchId);
                  }}
                  onKeyDown={(event) => {
                    if (groupNameComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-9 min-w-[10rem] max-w-[min(24rem,60vw)] rounded-xl border border-[var(--primary-bg)] bg-[var(--input-bg)] px-3 text-sm font-semibold text-[var(--app-fg)] outline-none [field-sizing:content] disabled:opacity-60"
                /></UiProps>
                {groupNameErrors[group.id] ? (
                  <p
                    id={`group-name-error-${group.id}`}
                    role="alert"
                    className="mt-1 px-1 text-xs text-red-500"
                  >
                    {uiError(groupNameErrors[group.id])}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="inline-flex h-9 max-w-full items-center gap-1 px-3">
                <span className="max-w-[min(24rem,60vw)] truncate text-sm font-semibold text-[var(--app-fg)]">
                  {group.name}
                </span>
                <UiProps ids={{"aria-label":["batch.m9064f48f29b1"],"title":["batch.m9064f48f29b1"]}}><button
                  type="button"
                  aria-label="batch.m9064f48f29b1"
                  title="batch.m9064f48f29b1"
                  disabled={groupDeleting}
                  onClick={() => {
                    setGroupNameErrors((current) => ({
                      ...current,
                      [group.id]: "",
                    }));
                    setEditingGroupId(group.id);
                  }}
                  className="-mr-1 rounded-md p-1 text-[var(--app-muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-45"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button></UiProps>
              </div>
            )}
            <BatchGroupSettingsControl
              items={group.items}
              defaults={groupDefaults}
              models={models}
              batchMode={group.batch.mode}
              editable
              disabled={groupBusy}
              onChange={(patch) => changeHistoryGroupSettings(group, patch)}
            />
          </div>
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            <GenerateActionButton
              onClick={() => void submit(
                group.items.map((item) => item.id),
                group.batchId,
              )}
              disabled={groupBusy || !group.items.length || !models.length || !models.some((model) => model.id === String((group.items[0]?.overrides || {}).model || groupDefaults.model || ""))}
              busy={groupSubmitting}
              className="h-9 px-3"
            >
              {groupSubmitting ? <UiText id="batch.mdcc1a22d9e72" /> : <UiText id="batch.m92eb1b5951f4" />}
            </GenerateActionButton>
            <UiProps ids={{"title":["batch.mdf7beced4569"]}}><button
              type="button"
              onClick={() => setPendingDeleteGroup(group)}
              disabled={groupBusy}
              aria-busy={groupDeleting || undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-muted)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-45"
              title="batch.mdf7beced4569"
            >
              {groupDeleting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {groupDeleting ? <UiText id="batch.m8989b881f3eb" /> : <UiText id="batch.m7605c1d82eed" />}
            </button></UiProps>
            {downloadableGroupOutputs.length > 0 ? (
              <UiProps ids={{"title":["batch.m69119231334c"]}}><button
                type="button"
                onClick={() => void downloadHistoryGroup(group)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-fg)] transition-colors hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)]"
                title="batch.m69119231334c"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /><UiText id="batch.m10f986252e03" /></button></UiProps>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {group.items.map((item) => {
            const pendingAction = pendingItemActions.get(item.id) || null;
            const itemActive = isBatchItemActive(item);
            const itemUploading = uploadingTarget?.batchId === group.batchId
              && uploadingTarget?.itemId === item.id;
            return (
              <BatchTaskCard
                key={item.id}
                batchId={group.batchId}
                item={item}
                batchMode={group.batch.mode}
                allowMultipleProductMedia={group.batch.mode === "multi_prompt"}
                defaultMedia={[]}
                busy={groupBusy || pendingAction !== null}
                promptBusy={itemActive
                  || group.batch.status === "creating"
                  || groupSubmitting
                  || groupDeleting
                  || pendingAction !== null}
                uploadingRole={itemUploading ? uploadingTarget?.role || null : null}
                pendingAction={pendingAction}
                actionError={itemActionErrors.get(item.id) || ""}
                onChange={(patch) => changeHistoryItem(group, item.id, patch)}
                onCommit={() => void flushHistoryChanges(group.batchId)}
                onUpload={(role, files) => uploadMedia(role, files, item.id, group.batchId)}
                onImportProductLibraryItem={(role, drop) => importProductLibraryItem(
                  role,
                  drop,
                  item.id,
                  group.batchId,
                )}
                onRemoveMedia={(relation) => removeMedia(relation, group.batchId)}
                onRetry={() => runItemAction(group, item, "retry")}
                onRegenerate={() => runItemAction(group, item, "regenerate")}
                onCancel={() => cancelItemTask(group, item.id)}
                onPreviewResult={(outputId) =>
                  openGroupResultPreview(group.name, group.items, outputId)
                }
              />
            );
          })}
        </div>
      </div>
    );
  };
  const imageResultSource: BatchResultSource = {
    id: "image-batch",
    initialLoading: initialHistoryLoading,
    initialError: initialHistoryError,
    entries: historyGroups.map((group) => ({
      key: `image:${group.id}`,
      mode: group.batch.mode,
      modeLabel: group.batch.mode === "multi_prompt" ? "自定义分批" : "统一参考批量复刻",
      mediaKind: "image",
      createdAt: group.createdAt,
      content: renderImageHistoryGroup(group),
    })),
    hasMore: IMAGE_BATCH_MODES.some((mode) => historyPaginationByMode[mode].hasMore),
    loadingMore: IMAGE_BATCH_MODES.some((mode) => historyPaginationByMode[mode].loadingMore),
    loadMore: () => {
      IMAGE_BATCH_MODES.forEach((mode) => {
        const pagination = historyPaginationByMode[mode];
        if (pagination.hasMore && pagination.cursor && !pagination.loadingMore) {
          void loadHistoryPage(pagination.cursor, { append: true, mode });
        }
      });
    },
  };
  return (
    <AtomicPageReveal ready={!authLoading && !loading} onReveal={onInitialReady}>
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <BatchResultSourceRegistration source={imageResultSource} />
      <div className="h-full min-h-0 w-full [&>aside]:h-full">
        <BatchSettingsPanel
          batch={batch}
          models={models}
          uploading={uploading}
          uploadingRole={
            uploadingTarget?.batchId === batch.id && uploadingTarget.itemId === null
              ? uploadingTarget.role
              : null
          }
          clearingRole={clearingRole}
          mediaMutationPending={mediaMutationPending}
          disabled={!groupedWorkflow && (uploading || busy || active)}
          authenticated={Boolean(user)}
          switchingMode={switchingMode}
          generatePending={creatingGroup}
          segmentedPromptPending={segmentedPromptPending}
          rolePositioning={rolePositioning}
          onBatchChange={changeBatch}
          onModeChange={switchBatchMode}
          onOpenLiveVideo={() => void openLiveVideo()}
          onUpload={(role, files) => uploadMedia(role, files)}
          onImportProductLibraryItem={(role, drop) => importProductLibraryItem(role, drop)}
          onRemoveMedia={removeMedia}
          onClearMedia={clearSharedMedia}
          onLimitExceeded={setError}
          onAddTask={() => addTask()}
          onGenerateGroups={generateGroups}
          onGenerateSegmentedPrompts={generateSegmentedPrompts}
          onOpenPromptSplit={() => setSplitOpen(true)}
        />

      </div>

      {!groupedWorkflow ? (
        <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 shadow-[var(--shadow-2)]">
          <div className="text-xs text-[var(--app-muted)]"><strong className="font-semibold text-[var(--app-fg)]">{batch.items.length}</strong><UiText id="batch.m26bd6f18e3b9" /><strong className="font-semibold text-[var(--app-fg)]">{totalOutputs}</strong><UiText id="batch.mc5feaaf478d5" /></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saveDraft()} disabled={busy || !dirty} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-5 text-xs font-medium text-[var(--app-fg)] disabled:opacity-45"><UiText id="batch.m5329e3f0ee46" /></button>
            <GenerateActionButton onClick={() => void submit()} disabled={busy || active || !batch.items.length} className="h-10 min-w-36 px-5 font-semibold">
              {active ? <UiText id="batch.m56e26561a735" /> : <UiText id="batch.m92eb1b5951f4" />}
            </GenerateActionButton>
          </div>
        </footer>
      ) : null}

      {errorDialog}
      <UiProps ids={{"title":["batch.m6c1bb7935779"],"description":["batch.m0e6a1f27b8ef"],"confirmText":["batch.m2f9daa828907"]}}><ConfirmDialog
        open={Boolean(pendingDeleteGroup)}
        title="batch.m6c1bb7935779"
        description="batch.m0e6a1f27b8ef"
        confirmText="batch.m2f9daa828907"
        danger
        onClose={() => setPendingDeleteGroup(null)}
        onConfirm={async () => {
          if (!pendingDeleteGroup) return;
          await deleteGroup(pendingDeleteGroup);
        }}
      /></UiProps>
      <UiProps ids={{"title":["batch.m63a570e277c4"]}}><MediaLightbox
        open={Boolean(activeGroupResultPreview)}
        src={activeGroupResultPreview?.src || null}
        kind="image"
        title={groupResultPreview?.groupName || "batch.m63a570e277c4"}
        layout="floating"
        counter={
          groupResultPreview
            ? `${groupResultPreview.index + 1}/${groupResultPreview.entries.length}`
            : undefined
        }
        counterAlwaysVisible
        dots={
          groupResultPreview
            ? {
                count: groupResultPreview.entries.length,
                activeIndex: groupResultPreview.index,
              }
            : undefined
        }
        hasPrev={Boolean(groupResultPreview && groupResultPreview.index > 0)}
        hasNext={Boolean(
          groupResultPreview &&
            groupResultPreview.index < groupResultPreview.entries.length - 1,
        )}
        onPrev={() =>
          setGroupResultPreview((current) =>
            current
              ? { ...current, index: Math.max(0, current.index - 1) }
              : null,
          )
        }
        onNext={() =>
          setGroupResultPreview((current) =>
            current
              ? {
                  ...current,
                  index: Math.min(current.entries.length - 1, current.index + 1),
                }
              : null,
          )
        }
        onClose={() => setGroupResultPreview(null)}
      /></UiProps>
      <PromptSplitDialog open={splitOpen} busy={busy} onClose={() => setSplitOpen(false)} onApply={applySplitPrompts} />
    </div>
    </AtomicPageReveal>
  );
}

export function BatchWorkbenchPage() {
  const [displayedSurface, setDisplayedSurface] = React.useState<"image" | "live">("image");
  const [requestedSurface, setRequestedSurface] = React.useState<"image" | "live">("image");
  const [readySurfaces, setReadySurfaces] = React.useState<Set<"image" | "live">>(() => new Set());
  const [modeResolved, setModeResolved] = React.useState(false);
  const [mountedSurfaces, setMountedSurfaces] = React.useState<Set<"image" | "live">>(() => new Set());
  const [mediaLibraryOpen, setMediaLibraryOpen] = React.useState(false);
  const [mediaLibraryVisited, setMediaLibraryVisited] = React.useState(false);
  React.useEffect(() => { if (mediaLibraryOpen) setMediaLibraryVisited(true); }, [mediaLibraryOpen]);

  const markSurfaceReady = React.useCallback((surface: "image" | "live") => {
    setReadySurfaces((current) => {
      if (current.has(surface)) return current;
      const next = new Set(current);
      next.add(surface);
      return next;
    });
  }, []);

  React.useEffect(() => {
    const initialSurface = window.localStorage.getItem("batch_workbench_mode") === "live_video"
      ? "live"
      : "image";
    setDisplayedSurface(initialSurface);
    setRequestedSurface(initialSurface);
    setMountedSurfaces(new Set([initialSurface]));
    setModeResolved(true);
  }, []);

  React.useEffect(() => {
    if (!modeResolved) return;
    setMountedSurfaces((previous) => {
      const next = new Set(previous);
      next.add(requestedSurface);
      // Both sources feed the shared history, but the inactive source starts
      // only after the selected workspace is usable. Never unmount visited work.
      if (readySurfaces.has(displayedSurface)) {
        next.add("image");
        next.add("live");
      }
      return next.size === previous.size ? previous : next;
    });
  }, [displayedSurface, modeResolved, readySurfaces, requestedSurface]);

  React.useEffect(() => {
    if (!modeResolved) return;
    if (!readySurfaces.has(requestedSurface)) return;
    setDisplayedSurface(requestedSurface);
  }, [modeResolved, readySurfaces, requestedSurface]);

  React.useEffect(() => {
    const onToggle = () => setMediaLibraryOpen((current) => !current);
    const onOpen = () => setMediaLibraryOpen(true);
    const onClose = () => setMediaLibraryOpen(false);
    window.addEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
    window.addEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
    window.addEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    return () => {
      window.removeEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    };
  }, []);

  const resultsReady = modeResolved && readySurfaces.has(displayedSurface);

  if (!modeResolved) return <BatchWorkbenchLoading />;

  return (
    <BatchResultRegistryProvider>
      <AtomicPageReveal ready={modeResolved}>
        <main className="h-full min-h-0 flex-1 overflow-hidden p-[clamp(12px,2dvh,20px)]">
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="relative min-h-0 overflow-hidden" data-batch-mode-host="true">
              <div
                className={`absolute inset-0 flex h-full min-h-0 min-w-0 ${displayedSurface === "image" ? "visible" : "invisible"} ${displayedSurface === "image" ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"}`}
                data-workbench-surface-state={displayedSurface === "image" ? "visible" : "staging"}
                data-workbench-surface-mounted="true"
                aria-hidden={displayedSurface !== "image"}
                {...inertWhenHidden(displayedSurface !== "image")}
              >
                {mountedSurfaces.has("image") ? <ImageBatchWorkbenchPage
                  onOpenLiveVideo={() => {
                    window.localStorage.setItem("batch_workbench_mode", "live_video");
                    setRequestedSurface("live");
                  }}
                  onInitialReady={() => markSurfaceReady("image")}
                /> : null}
              </div>
              <div
                className={`absolute inset-0 flex h-full min-h-0 min-w-0 ${displayedSurface === "live" ? "visible" : "invisible"} ${displayedSurface === "live" ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"}`}
                data-workbench-surface-state={displayedSurface === "live" ? "visible" : "staging"}
                data-workbench-surface-mounted="true"
                aria-hidden={displayedSurface !== "live"}
                {...inertWhenHidden(displayedSurface !== "live")}
              >
                {mountedSurfaces.has("live") ? <LiveVideoBatchWorkspace
                  onModeChange={(mode) => {
                    window.localStorage.setItem("batch_workbench_mode", mode);
                    setRequestedSurface("image");
                  }}
                  onInitialReady={() => markSurfaceReady("live")}
                /> : null}
              </div>
            </div>
            <section
              className="relative flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]"
              data-batch-unified-result-shell="true"
            >
              {resultsReady ? (
                <>
                  {readySurfaces.size < 2 ? <p role="status" className="shrink-0 px-4 pt-4 text-xs text-[var(--app-muted)]"><UiText id="batch.m3376be22080c" /></p> : null}
                  <UnifiedBatchResults />
                </>
              ) : (
                <BatchWorkbenchSkeleton embedded />
              )}
              <MediaLibraryPanel
                open={mediaLibraryOpen}
                onClose={() => setMediaLibraryOpen(false)}
                keepMounted={mediaLibraryVisited}
              />
            </section>
          </div>
        </main>
      </AtomicPageReveal>
    </BatchResultRegistryProvider>
  );
}
