"use client";
import { UiText, UiProps } from "@/i18n/ui";
import { useCreateLocalization } from "@/components/studio/create-localization";

import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";

import { createWorkspaceMediaQueue } from "@/lib/tool-media/workspace-media-queue";

import * as React from "react";
import { createPortal } from "react-dom";
import { PromptEditorPortal } from "@/components/ui/prompt-editor-portal";
import { ChevronDown, CircleHelp, Image, Maximize2, Video, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { UnifiedHistoryPanel, type UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
import { PresetPromptsTrigger } from "@/components/presets/preset-prompts";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { ParamCardSections, ParamOptionGrid } from "@/components/parameters/param-cards";
import { CanvasAspectRatioIcon } from "@/components/canvas/CanvasAspectRatioIcon";
import { MultiUploadDropzone, type MultiUploadItem } from "@/components/ui/multi-upload-dropzone";
import { PromptRichEditor } from "@/components/ui/prompt-rich-editor";
import { FriendlyErrorBlock, type FriendlyUiError } from "@/components/ui/friendly-error-block";
import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog";
import { RoleSkillTrigger } from "@/components/role-skills/role-skill-trigger";
import { useLogger } from "@/hooks/use-logger";
import { useAccountRolePositioningDraft } from "@/hooks/use-account-role-positioning-draft";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import type { ToolboxVideoRoleContinuation } from "@/lib/role-positioning-continuation";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";
import {
  startToolboxRoleSkillPrompt,
  waitForToolboxRoleSkillPrompt,
} from "@/lib/role-skills/toolbox-surface-client";
import { useGenerateHotkey } from "@/lib/hooks/use-generate-hotkey";
import { matchHotkey, parseHotkeyString } from "@/lib/hotkeys";
import { MEDIA_LIBRARY_EVENT_CLOSE, MEDIA_LIBRARY_EVENT_OPEN, MEDIA_LIBRARY_EVENT_TOGGLE } from "@/lib/media-library-events";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import { normalizeApiFriendlyError } from "@/lib/error-friendly";
import { needsImportToImports, importInputToImportsTracked } from "@/lib/protected-input";
import {
  basenameFromPath,
  buildPromptWithAssetReferences,
  inferPromptAssetKind,
  type PromptReferenceAsset,
} from "@/lib/prompt-asset-references";
import {
  getVideoModelSpec,
  isSeedance20VideoModel,
  modelSupportsGenerateAudio,
  modelSupportsReferenceAudio,
  modelSupportsWebSearch,
  normalizeVideoInputMode,
  normalizeVideoModelId,
  isSeedance25VideoModel,
  sora2Models,
  type SeedanceOmniReferenceTaskType,
  type VideoInputMode
} from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel } from "@/lib/wan-models";
import { validateWanMediaSet } from "@/lib/wan-media-policy";
import { getVideoDisplayResolution, getVideoDisplaySpec } from "@/lib/video-resolution-visibility";
import {
  createToolClientUuid,
  getToolMediaGenerateButtonState,
  hasFailedToolMediaUploads,
  hasPendingToolMediaUploads,
  isToolMediaSourceItem,
  isToolMediaPreviewUrl,
  isToolMediaUploadFile,
  partitionToolMediaInputs,
  releaseEphemeralToolMedia,
  removedToolMediaIds,
  resolveToolMediaUploadCommit,
  settleToolMediaUpload,
  uploadEphemeralToolMedia,
  uploadEphemeralToolMediaFromSource,
  type GenerationSubmissionPhase,
  type ToolMediaUploadCommit,
} from "@/lib/tool-media/client-draft";
import {
  fetchToolWorkspaceDraft,
  patchToolWorkspaceDraft,
  readLegacyToolWorkspaceMigration,
  readLocalWorkspaceDraftBackup,
  workspaceDraftFingerprint,
  writeLocalWorkspaceDraftBackup,
  type ToolWorkspaceDraftDto,
} from "@/lib/tool-workspace-draft/client";
import { ephemeralInputDraftRegistry, takeEphemeralToolTemplate } from "@/lib/ephemeral-input-draft";
import { getVideoTemplateMediaPaths, isRemovedVideoReference } from "@/lib/video-template-reuse";
import { useDesktopMode } from "@/components/system/desktop-mode";
import {
  desktopDraftMediaItems,
  desktopDraftUploadWasPending,
  INTERRUPTED_UPLOAD_NOTICE,
  readDesktopInputDraft,
  recoverDesktopDraftMedia,
  writeDesktopInputDraft,
} from "@/lib/desktop-input-draft";
import { pendingWorkspaceNavigationSave, trackWorkspaceNavigationSave } from "@/lib/tool-workspace-draft/navigation-save";
import {
  getSeedanceMediaPolicy,
  validateSeedanceMediaSet,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import {
  getMiniMaxH3UploadContract,
  validateMiniMaxH3MediaSet,
} from "@/lib/minimax-h3-media-policy";

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
const DEFAULT_VIDEO_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_VIDEO_INPUT_MODE: VideoInputMode = "multimodal";
const DEFAULT_VIDEO_RESOLUTION = "720p";
const DEFAULT_VIDEO_RATIO = "9:16";
const DEFAULT_VIDEO_DURATION = "15";
const DEFAULT_VIDEO_RETURN_LAST_FRAME = false;

type VideoUploadItem = MultiUploadItem & {
  slot?: "first" | "last";
  kind?: "image" | "video" | "audio";
  byteSize?: number;
  probe?: SeedanceMediaProbe;
};

function inferVideoUploadItemKind(item: VideoUploadItem): "image" | "video" | "audio" | "" {
  if (item.kind === "image" || item.kind === "video" || item.kind === "audio") return item.kind;
  const mime = String(item.file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const value = String(item.url || item.file?.name || "").split(/[?#]/, 1)[0];
  if (/\.(?:mp3|wav)$/i.test(value)) return "audio";
  if (/\.(?:mp4|mov|webm|mkv|m4v)$/i.test(value)) return "video";
  if (/\.(?:jpe?g|png|gif|webp|bmp|tiff?|heic|heif)$/i.test(value)) return "image";
  return "";
}

type VideoWorkspaceSnapshot = {
  payload: Record<string, unknown>;
  media: Array<{ mediaId: string; position: number; slot?: "first" | "last" }>;
  fingerprint: string;
};

type VideoEphemeralInputDraft = {
  prompt: string;
  items: VideoUploadItem[];
  draftSessionId: string;
  workspacePayload?: Record<string, unknown>;
  interruptedUpload?: boolean;
};

function nextWorkspaceSnapshotFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

type FloatingPanelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PromptReverseTaskItem = {
  id: number;
  status: string;
  llmProviderId: string;
  model: string;
  userPrompt: string;
  mediaUrls: string[];
  generatedPrompt: string;
  errorMsg: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  skill?: null | {
    id: string;
    name: string;
    revision: number;
  };
};

function isPromptReverseTaskRunning(task: PromptReverseTaskItem) {
  return task.status === "pending" || task.status === "running";
}

type ToolboxVideoGenerationResume = {
  activeTask: PromptReverseTaskItem;
  continuation: ToolboxVideoRoleContinuation;
};

function ParameterLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span>{label}</span>
      {hint ? (
        <span
          className="group relative inline-flex items-center"
          tabIndex={0}
          aria-label={hint}
        >
          <CircleHelp className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span
            role="tooltip"
            className={[
              "absolute bottom-[calc(100%+8px)] left-0 z-20",
              "hidden w-56 whitespace-normal group-hover:block group-focus-within:block",
              "rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5",
              "text-[11px] leading-relaxed text-[var(--app-fg)] shadow-[var(--shadow)]",
            ].join(" ")}
          >
            {hint}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  hint
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition",
        disabled
          ? "cursor-not-allowed border-[var(--border)] bg-[var(--panel-2)] opacity-50"
          : "border-[var(--border)] bg-[var(--input-bg)] hover:bg-[var(--panel-2)]"
      ].join(" ")}
    >
      <div className="text-left">
        <div className="text-[var(--app-fg)]">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">{hint}</div> : null}
      </div>
      <span
        className={[
          "relative inline-flex h-6 w-11 rounded-full border transition",
          checked
            ? "border-[var(--app-fg)] bg-[var(--panel-3)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            : "border-[var(--border)] bg-[var(--panel-2)]"
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition",
            checked ? "left-[22px]" : "left-0.5"
          ].join(" ")}
        />
      </span>
    </button>
  );
}

function ParameterField({
  label,
  hint,
  children,
  className = ""
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={["canvas-task-parameter-section", className].join(" ")}>
      <div className="canvas-task-parameter-label">
        <ParameterLabel label={label} hint={hint} />
      </div>
      {children}
    </section>
  );
}

function DurationSlider({
  value,
  onChange,
  min,
  max,
  allowAuto,
  autoFallback
}: {
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  allowAuto: boolean;
  autoFallback: string;
}) {
  const isAuto = value === "-1";
  const current = isAuto ? min : Math.min(Math.max(Number.parseInt(value, 10) || min, min), max);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--app-muted)]"><UiText id="video.m04a95e0654d3" /></span>
        <span className="text-xs text-[var(--app-fg)]">{isAuto ? <UiText id="video.m7eb336e42cb5" /> : `${current}s`}</span>
      </div>
      <div className="flex items-center gap-2">
        <UiProps ids={{"aria-label":["video.m79aab44c0bee"]}}><input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current}
          disabled={isAuto}
          aria-label="video.m79aab44c0bee"
          onChange={(e) => onChange(e.target.value)}
          className="h-1.5 flex-1 cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        /></UiProps>
        {allowAuto ? (
          <button
            type="button"
            onClick={() => onChange(isAuto ? autoFallback : "-1")}
            className={[
              "rounded-lg border px-2.5 py-1 text-xs transition",
              isAuto
                ? "border-blue-600 bg-blue-600/10 text-blue-600"
                : "border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]"
            ].join(" ")}
          ><UiText id="video.m7eb336e42cb5" /></button>
        ) : null}
      </div>
      <div className="flex justify-between text-[10px] text-[var(--app-muted)]">
        <span>{min}s</span>
        <span>{max}s</span>
      </div>
    </div>
  );
}

function ratioDisplayLabel(value: string): string {
  return value === "adaptive" || value === "auto" ? "自适应" : value;
}

function coerceInputMode(raw: unknown): VideoInputMode {
  const value = String(raw || "").trim();
  if (value === "text_to_video" || value === "multimodal" || value === "first_last_frame" || value === "first_frame") return value;
  return "multimodal";
}

function coerceBoolean(raw: unknown, fallback: boolean) {
  if (typeof raw === "boolean") return raw;
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function getDefaultResolution(spec: ReturnType<typeof getVideoModelSpec>) {
  return spec.supportedResolutions.includes(DEFAULT_VIDEO_RESOLUTION as any)
    ? DEFAULT_VIDEO_RESOLUTION
    : spec.supportedResolutions[0];
}

function getDefaultRatio(spec: ReturnType<typeof getVideoModelSpec>) {
  const ratios = spec.supportedRatios ?? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
  return ratios.includes(DEFAULT_VIDEO_RATIO) ? DEFAULT_VIDEO_RATIO : ratios[0];
}

function getDefaultDuration(spec: ReturnType<typeof getVideoModelSpec>) {
  if (spec.durationOptions) {
    if (spec.durationOptions.includes(15)) return DEFAULT_VIDEO_DURATION;
    if (spec.durationOptions.includes(8)) return "8";
    return String(spec.durationOptions[0]);
  }
  if (spec.provider === "volcengine") {
    return String(Math.min(Math.max(15, spec.minDurationSeconds), spec.maxDurationSeconds));
  }
  return String(Math.min(Math.max(8, spec.minDurationSeconds), spec.maxDurationSeconds));
}

function toItemsFromPaths(paths: string[], mode: VideoInputMode, maxFiles = 12): VideoUploadItem[] {
  const normalized = paths
    .filter((p): p is string => typeof p === "string" && Boolean(p))
    .map((url) => ({ file: null, url }));
  if (mode === "first_frame") {
    return normalized.slice(0, 1).map((item) => ({ ...item, slot: "first" as const }));
  }
  if (mode === "first_last_frame") {
    return normalized.slice(0, 2).map((item, index) => ({ ...item, slot: index === 0 ? "first" : "last" }));
  }
  return normalized.slice(0, maxFiles);
}

function normalizeItemsForMode(items: VideoUploadItem[], mode: VideoInputMode, maxFiles = 12): VideoUploadItem[] {
  const cleaned = items
    .filter((it) => it && (it.file || it.url))
    .map((it) => ({ ...it, file: it.file ?? null, url: it.url ?? null }));
  if (mode === "first_frame") {
    const first = cleaned.find((it) => it.slot === "first") || cleaned[0];
    return first ? [{ ...first, slot: "first" as const }] : [];
  }
  if (mode === "first_last_frame") {
    const first = cleaned.find((it) => it.slot === "first") || cleaned.find((it) => !it.slot);
    const last = cleaned.find((it) => it.slot === "last") || cleaned.find((it) => !it.slot && it !== first);
    return [
      ...(first ? [{ ...first, slot: "first" as const }] : []),
      ...(last ? [{ ...last, slot: "last" as const }] : []),
    ];
  }
  return cleaned.slice(0, maxFiles).map((it) => ({ ...it, slot: undefined }));
}

function getOrderedUploadItems(items: VideoUploadItem[], mode: VideoInputMode) {
  if (mode === "first_frame") {
    const first = items.find((it) => it.slot === "first") || items[0];
    return first ? [first] : [];
  }
  if (mode === "first_last_frame") {
    return ["first", "last"]
      .map((slot) => items.find((it) => it.slot === slot))
      .filter((item): item is VideoUploadItem => Boolean(item));
  }
  return items;
}

function getOrderedItemUrls(items: VideoUploadItem[], mode: VideoInputMode) {
  return getOrderedUploadItems(items, mode)
    .map((item) => item.url)
    .filter((url): url is string => typeof url === "string" && Boolean(url));
}

export default function VideoPage({
  studioNav,
  sharedHistory,
  onInitialReady,
  embeddedInStudioShell = false,
}: {
  studioNav?: {
    activeTool: "image" | "video";
    onSelectTool: (tool: "image" | "video") => void;
  };
  sharedHistory?: {
    historyRef: React.RefObject<UnifiedHistoryPanelHandle>;
    historyFocusId: string | null;
    setHistoryFocusId: (id: string | null) => void;
    historyCount: number;
    setHistoryCount: (count: number) => void;
  };
  onInitialReady?: () => void;
  embeddedInStudioShell?: boolean;
} = {}) {
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const { locale, text, generationLabel, parameterLabel, error: localizeError, label: localizeLabel } = useCreateLocalization();
  const { logAction } = useLogger();

  const [userId, setUserId] = React.useState("");
  const [items, setItems] = React.useState<VideoUploadItem[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [skillLibraryEntry, setSkillLibraryEntry] = React.useState<{
    view: "browse" | "create" | "detail";
    skill?: RoleSkillListItem;
  }>({ view: "browse" });
  const [toolboxRoleSkill, setToolboxRoleSkill] = React.useState<RoleSkillListItem | null>(null);
  const {
    systemPrompt,
    reversePrompt,
    activeReverseTaskId,
    continuation,
    selectedRoleSkillId,
    resultRoleSkill,
    setReversePrompt,
    setReversePromptApplied,
    setActiveReverseTaskId,
    setResultRoleSkill,
    saveNow: saveRoleDraftNow,
    saveError: roleDraftError,
    hydrated: roleDraftHydrated,
  } = useAccountRolePositioningDraft({
    userId,
    surface: "toolbox_video",
    persistSelectedRoleSkillId: false,
  });
  const [reverseLoading, setReverseLoading] = React.useState(false);
  const [reverseError, setReverseError] = React.useState<string | null>(null);
  const [reverseTasks, setReverseTasks] = React.useState<PromptReverseTaskItem[]>([]);
  const hasRunningReverseTask = React.useMemo(
    () => reverseTasks.some(isPromptReverseTaskRunning),
    [reverseTasks],
  );
  const [model, setModel] = React.useState(DEFAULT_VIDEO_MODEL);
  const [visibleVideoModels, setVisibleVideoModels] = React.useState<ReturnType<typeof getVideoDisplaySpec>[]>([]);
  const [videoCapabilityStatus, setVideoCapabilityStatus] = React.useState<"pending" | "loaded" | "failed">("pending");
  const [inputMode, setInputMode] = React.useState<VideoInputMode>(DEFAULT_VIDEO_INPUT_MODE);
  const [resolution, setResolution] = React.useState(DEFAULT_VIDEO_RESOLUTION);
  const [ratio, setRatio] = React.useState(DEFAULT_VIDEO_RATIO);
  const [duration, setDuration] = React.useState(DEFAULT_VIDEO_DURATION);
  const [seed, setSeed] = React.useState("-1");
  const [returnLastFrame, setReturnLastFrame] = React.useState(DEFAULT_VIDEO_RETURN_LAST_FRAME);
  const [generateAudio, setGenerateAudio] = React.useState(false);
  const [cameraFixed, setCameraFixed] = React.useState(false);
  const [watermark, setWatermark] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false);
  const [omniReferenceTaskType, setOmniReferenceTaskType] = React.useState<SeedanceOmniReferenceTaskType>("auto");
  const [paramOpen, setParamOpen] = React.useState(false);
  const videoParamPanelRef = React.useRef<HTMLDivElement | null>(null);
  const videoParamButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [advOpen, setAdvOpen] = React.useState(false);
  const [submissionPhase, setSubmissionPhase] = React.useState<GenerationSubmissionPhase>("idle");
  const [error, setError] = React.useState<FriendlyUiError | null>(null);
  const materialErrorRef = React.useRef<FriendlyUiError | null>(null);
  const setMaterialError = React.useCallback((nextError: FriendlyUiError) => {
    materialErrorRef.current = nextError;
    setError(nextError);
  }, []);
  const syncMaterialErrorAfterItemsChange = React.useCallback((
    previousItems: VideoUploadItem[],
    nextItems: VideoUploadItem[],
  ) => {
    const removedFailedItem = previousItems.some((item) =>
      Boolean(String(item.uploadError || "").trim()) && !nextItems.includes(item)
    );
    if (!removedFailedItem) return;
    const remainingUploadError = nextItems
      .map((item) => String(item.uploadError || "").trim())
      .find(Boolean);
    if (remainingUploadError) {
      setMaterialError(normalizeApiFriendlyError(
        { error: remainingUploadError },
        "素材上传失败，请重新上传",
      ));
      return;
    }
    const currentMaterialError = materialErrorRef.current;
    materialErrorRef.current = null;
    setError((current) => current === currentMaterialError ? null : current);
  }, [setMaterialError]);
  const [inlineNotice, setInlineNotice] = React.useState<string | null>(null);
  const [faceAcknowledgedStorageKey, setFaceAcknowledgedStorageKey] = React.useState("");
  const [mediaLibraryOpen, setMediaLibraryOpen] = React.useState(false);
  const inlineNoticeTimerRef = React.useRef<number | null>(null);
  const [promptPanelOpen, setPromptPanelOpen] = React.useState(false);
  const [promptEditorHost, setPromptEditorHost] = React.useState<HTMLDivElement | null>(null);
  const [promptPanelRect, setPromptPanelRect] = React.useState<FloatingPanelRect | null>(null);
  const promptSourceRef = React.useRef<HTMLDivElement | null>(null);
  const promptPanelRef = React.useRef<HTMLDivElement | null>(null);
  const promptPanelDragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panelLeft: number;
    panelTop: number;
  } | null>(null);
  const promptPanelResizeRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panelWidth: number;
    panelHeight: number;
  } | null>(null);
  const localHistoryRef = React.useRef<UnifiedHistoryPanelHandle>(null);
  const historyRef = sharedHistory?.historyRef || localHistoryRef;
  const [localHistoryCount, setLocalHistoryCount] = React.useState(0);
  const historyCount = sharedHistory?.historyCount ?? localHistoryCount;
  const setHistoryCount = sharedHistory?.setHistoryCount ?? setLocalHistoryCount;
  const historyFocusId = sharedHistory?.historyFocusId ?? null;

  const generationSubmitInFlightRef = React.useRef(false);
  const resumedToolboxContinuationRef = React.useRef("");
  const uploadingRef = React.useRef<WeakSet<File>>(new WeakSet());
  const uploadingSourceRef = React.useRef<Set<string>>(new Set());
  const importingUrlRef = React.useRef<Set<string>>(new Set());
  const itemsRef = React.useRef(items);
  const authenticatedUserId = user?.id ? String(user.id) : "";
  const authenticatedUserIdRef = React.useRef(authenticatedUserId);
  authenticatedUserIdRef.current = authenticatedUserId;
  const [workspaceDraftHydrated, setWorkspaceDraftHydrated] = React.useState(false);
  const [workspaceDraftWritable, setWorkspaceDraftWritable] = React.useState(false);
  const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable);
  const workspaceDraftOwnerRef = React.useRef("");
  const workspaceDraftVersionRef = React.useRef(0);
  const workspaceDraftFingerprintRef = React.useRef("");
  const workspaceDraftSnapshotRef = React.useRef<VideoWorkspaceSnapshot | null>(null);
  const workspaceDraftSaveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const workspaceMediaMutationQueueRef = React.useRef(createWorkspaceMediaQueue());
  const ephemeralMediaSessionRef = React.useRef("");
  const [toolMediaUploadCommits, setToolMediaUploadCommits] = React.useState<ToolMediaUploadCommit[]>([]);
  const generateHotkey = useGenerateHotkey();
  const generateHotkeySpec = React.useMemo(() => parseHotkeyString(generateHotkey), [generateHotkey]);
  const isActive = !studioNav || studioNav.activeTool === "video";
  const {
    skills: roleSkills,
    loading: roleSkillsLoading,
    error: roleSkillsError,
  } = useRoleSkillCatalog({
    authUserId: userId,
    enabled: isActive && Boolean(userId),
    mediaType: "video",
  });
  const activeSelectedRoleSkillId = selectedRoleSkillId || null;
  const selectToolboxRoleSkill = React.useCallback((skill: RoleSkillListItem) => {
    setReverseError(null);
    setToolboxRoleSkill(skill);
    setReversePromptApplied(false);
    void saveRoleDraftNow({
      selectedRoleSkillId: skill.id,
      reversePromptApplied: false,
    });
  }, [saveRoleDraftNow, setReversePromptApplied]);
  const clearToolboxRoleSkillSelection = React.useCallback(() => {
    setToolboxRoleSkill(null);
    void saveRoleDraftNow({
      selectedRoleSkillId: null,
      reversePromptApplied: false,
    });
  }, [saveRoleDraftNow]);
  React.useEffect(() => {
    if (!selectedRoleSkillId) {
      setToolboxRoleSkill(null);
      return;
    }
    if (toolboxRoleSkill?.id === selectedRoleSkillId || roleSkillsLoading || roleSkillsError) return;
    const selectedSkill = roleSkills.find((skill) => skill.id === selectedRoleSkillId);
    if (selectedSkill) {
      setToolboxRoleSkill(selectedSkill);
    } else {
      clearToolboxRoleSkillSelection();
    }
  }, [
    clearToolboxRoleSkillSelection,
    roleSkills,
    roleSkillsError,
    roleSkillsLoading,
    selectedRoleSkillId,
    toolboxRoleSkill?.id,
  ]);
  const hasObjectiveMediaPolicy = Boolean(
    getSeedanceMediaPolicy(model) || getMiniMaxH3UploadContract(model),
  );
  const hasPendingUploads = React.useMemo(
    () => hasPendingToolMediaUploads(
      items,
      (item) => !item.file && (
        needsImportToImports(item.url)
        || (hasObjectiveMediaPolicy && isToolMediaSourceItem(item))
      ),
    ),
    [hasObjectiveMediaPolicy, items],
  );
  const hasFailedUploads = React.useMemo(
    () => hasFailedToolMediaUploads(items),
    [items],
  );
  const effectiveSubmissionPhase: GenerationSubmissionPhase =
    submissionPhase === "idle" && (reverseLoading || hasRunningReverseTask)
      ? "enhancing"
      : submissionPhase;
  const baseGenerateButtonState = React.useMemo(() => {
    if (!userId) return { disabled: true, label: "生成" };
    if (!visibleVideoModels.length) return { disabled: true, label: "暂无可用模型" };
    const state = getToolMediaGenerateButtonState({
      items,
      phase: effectiveSubmissionPhase,
      hasPrompt: Boolean(prompt.trim() || selectedRoleSkillId),
      isLegacyPending: (item) => !item.file && (
        needsImportToImports(item.url)
        || (hasObjectiveMediaPolicy && isToolMediaSourceItem(item))
      ),
    });
    if (workspaceDraftHydrated && workspaceDraftWritable) return state;
    return {
      disabled: true,
      label: workspaceDraftHydrated ? "草稿服务暂时不可用" : "正在加载草稿…",
    };
  }, [effectiveSubmissionPhase, hasObjectiveMediaPolicy, items, prompt, selectedRoleSkillId, userId, visibleVideoModels.length, workspaceDraftHydrated, workspaceDraftWritable]);
  const modelSpec = React.useMemo(
    () => visibleVideoModels.find((item) => item.id === model) || getVideoDisplaySpec(model),
    [model, visibleVideoModels],
  );
  const isSeedance25 = isSeedance25VideoModel(model);
  const isMiniMaxH3 = isMiniMaxH3VideoModel(model);
  const isWan = isWanVideoModel(model);
  const isSeedance25VideoEdit = isSeedance25 && omniReferenceTaskType === "edit";
  const maxReferenceFiles = modelSpec.referenceLimits?.total ?? 12;
  const seedancePolicy = React.useMemo(() => getSeedanceMediaPolicy(model), [model]);
  const miniMaxH3Policy = React.useMemo(() => getMiniMaxH3UploadContract(model), [model]);
  const hasReferenceVideo = React.useMemo(
    () => items.some((item) => inferVideoUploadItemKind(item) === "video"),
    [items],
  );
  const seedance25ModeOptions = (["multimodal", "first_last_frame", "first_frame", "text_to_video"] as const)
    .filter((mode) => modelSpec.supportedInputModes.includes(mode))
    .flatMap((mode) => {
      const option = {
        value: mode,
        label: parameterLabel(mode === "multimodal" ? "全能参考" : mode === "first_last_frame" ? "首尾帧" : mode === "first_frame" ? "首帧图" : "文生视频"),
      };
      return mode === "multimodal"
        ? [option, { value: "edit", label: parameterLabel("视频编辑") }, { value: "extend", label: parameterLabel("视频续写") }]
        : [option];
    });
  const selectedVideoMode = isSeedance25 && inputMode === "multimodal" && omniReferenceTaskType !== "auto"
    ? omniReferenceTaskType : inputMode;
  const videoModeLabel = seedance25ModeOptions.find((option) => option.value === selectedVideoMode)?.label;
  const mediaIssues = React.useMemo(() => {
    const media = items.flatMap((item) =>
      item.probe && item.byteSize !== undefined
        ? [{
            mediaId: item.mediaId,
            fileName: item.file?.name || String(item.url || "").split(/[\\/]/).pop(),
            byteSize: item.byteSize,
            probe: item.probe,
          }]
        : [],
    );
    if (isWan) return validateWanMediaSet({ duration: Number(duration), media });
    if (miniMaxH3Policy) return validateMiniMaxH3MediaSet({ modelId: model, media });
    if (!seedancePolicy) return [];
    return validateSeedanceMediaSet({
      modelId: model,
      taskType: isSeedance25 ? omniReferenceTaskType : "auto",
      media,
    });
  }, [isSeedance25, isWan, duration, items, miniMaxH3Policy, model, omniReferenceTaskType, seedancePolicy]);
  const mediaIssueMessage = mediaIssues[0]?.message || "";
  const faceAcknowledgementStorageKey = userId && seedancePolicy && !seedancePolicy.allowRealPersonFace
    ? `studio_seedance_face_notice_v1_${userId}_${model}`
    : "";
  useIsoLayoutEffect(() => {
    if (!faceAcknowledgementStorageKey) {
      setFaceAcknowledgedStorageKey("");
      return;
    }
    try {
      setFaceAcknowledgedStorageKey(
        localStorage.getItem(faceAcknowledgementStorageKey) === "acknowledged"
          ? faceAcknowledgementStorageKey
          : "",
      );
    } catch {
      setFaceAcknowledgedStorageKey("");
    }
  }, [faceAcknowledgementStorageKey]);
  const requiresFaceAcknowledgement = React.useMemo(() => {
    if (
      !seedancePolicy
      || seedancePolicy.allowRealPersonFace
    ) {
      return false;
    }
    return items.some(
      (item) => ["image", "video"].includes(inferVideoUploadItemKind(item)),
    );
  }, [items, seedancePolicy]);
  const faceAcknowledged = Boolean(faceAcknowledgementStorageKey)
    && faceAcknowledgedStorageKey === faceAcknowledgementStorageKey;
  const acknowledgeFaceNotice = React.useCallback(() => {
    if (!faceAcknowledgementStorageKey) return;
    try {
      localStorage.setItem(faceAcknowledgementStorageKey, "acknowledged");
    } catch {}
    setFaceAcknowledgedStorageKey(faceAcknowledgementStorageKey);
  }, [faceAcknowledgementStorageKey]);
  const generateButtonState = React.useMemo(() => {
    if (mediaIssueMessage) {
      return { disabled: true, label: "请处理不合规素材" };
    }
    if (requiresFaceAcknowledgement && !faceAcknowledged) {
      return { disabled: true, label: "请确认真人脸提示" };
    }
    return baseGenerateButtonState;
  }, [baseGenerateButtonState, faceAcknowledged, mediaIssueMessage, requiresFaceAcknowledgement]);
  const showsReferenceAudioHint = modelSupportsReferenceAudio(model);
  const referenceMediaKindsHint = showsReferenceAudioHint ? text("createDynamic.m7b1a8ce0c05c") : text("createDynamic.ma5c52dbd728e");
  const referenceMentionExamples = locale === "en" ? "@" : showsReferenceAudioHint ? "@图片1 @视频1 @音频1" : "@图片1 @视频1";
  // Seedance 2.0 系列不支持 seed / camera_fixed（与后端过滤一致）
  const isSeedance20 = isSeedance20VideoModel(model);
  const blocksSeedCameraControls = isSeedance20 || isSeedance25 || isMiniMaxH3;
  // 时长连续档用滑杆；离散档（如 gemini 的 4/6/8/10）保留下拉
  const useDurationSlider = modelSpec.provider !== "kie" && !modelSpec.durationOptions;
  // 切到 Seedance 2.0 系列时，把它不支持的 seed / 固定镜头复位，避免界面残留已开状态
  React.useEffect(() => {
    if (blocksSeedCameraControls) {
      setCameraFixed(false);
      setSeed("-1");
    }
  }, [blocksSeedCameraControls]);
  // H3 未提供这些请求参数；切换模型时同步清掉隐藏控件可能残留的值。
  React.useEffect(() => {
    if (!isMiniMaxH3) return;
    setGenerateAudio(false);
    setReturnLastFrame(false);
    setWebSearch(false);
    setCameraFixed(false);
    setSeed("-1");
  }, [isMiniMaxH3]);
  React.useEffect(() => {
    if (!isWan) return;
    setReturnLastFrame(false);
    setWebSearch(false);
    setCameraFixed(false);
  }, [isWan]);
  const videoModelOptions = React.useMemo(
    () => visibleVideoModels.map((m) => ({ label: m.label, value: m.id })),
    [visibleVideoModels]
  );
  const durationOptions = React.useMemo(() => {
    const values =
      modelSpec.durationOptions ??
      Array.from(
        { length: modelSpec.maxDurationSeconds - modelSpec.minDurationSeconds + 1 },
        (_, index) => modelSpec.minDurationSeconds + index
      );
    const base = values.map((value) => ({ label: `${value}s`, value: String(value) }));
    return modelSpec.allowAutoDuration ? [{ label: "自动", value: "-1" }, ...base] : base;
  }, [modelSpec]);
  const resolutionOptions = React.useMemo(
    () => modelSpec.supportedResolutions.map((value) => ({ label: value, value })),
    [modelSpec]
  );
  const effectiveResolution = getVideoDisplayResolution(modelSpec, resolution);
  const ratioOptions = React.useMemo(() => {
    let ratios = modelSpec.supportedRatios ?? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
    if (isMiniMaxH3) {
      if (inputMode === "first_frame" || inputMode === "first_last_frame") ratios = ["adaptive"];
      if (inputMode === "text_to_video") ratios = ratios.filter((value) => value !== "adaptive");
    }
    // adaptive / auto 是英文枚举值，展示为中文，但保留原值传给后端
    return ratios.map((value) => ({ label: ratioDisplayLabel(value), value }));
  }, [inputMode, isMiniMaxH3, modelSpec]);

  const firstFrameItems = React.useMemo(() => {
    const first = items.find((it) => it.slot === "first");
    return first ? [first] : [];
  }, [items]);

  React.useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const loadModels = async (initial: boolean) => {
      const currentRequestId = ++requestId;
      try {
        const res = await fetch("/api/toolbox/models?category=video", { cache: "no-store" });
        const json = await res.json();
        if (cancelled || currentRequestId !== requestId) return;
        if (!json?.success || !Array.isArray(json.models)) {
          if (initial) {
            setVisibleVideoModels([]);
            setVideoCapabilityStatus("failed");
          }
          return;
        }
        const visibleIds = new Set(json.models.map((item: any) => String(item?.id || "")).filter(Boolean));
        const nextModels = sora2Models
          .filter((item) => visibleIds.has(item.id))
          .map((item) => {
            const id = item.id;
            return getVideoDisplaySpec(id, json.models);
          });
        setVisibleVideoModels(nextModels);
        setVideoCapabilityStatus("loaded");
        setModel((current) => {
          if (!nextModels.length || nextModels.some((item) => item.id === current)) return current;
          return nextModels[0]?.id || current;
        });
      } catch {
        if (!cancelled && currentRequestId === requestId && initial) {
          setVisibleVideoModels([]);
          setVideoCapabilityStatus("failed");
        }
      }
    };
    void loadModels(true);
    const unsubscribe = subscribeToolboxModelVisibilityChanged(() => {
      void loadModels(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  const lastFrameItems = React.useMemo(() => {
    const last = items.find((it) => it.slot === "last");
    return last ? [last] : [];
  }, [items]);

  const promptAssets = React.useMemo<PromptReferenceAsset[]>(() => {
    if (inputMode === "text_to_video") return [];
    const orderedUrls = getOrderedItemUrls(items, inputMode);
    const uploadAssets: PromptReferenceAsset[] = [];
    const kindCounts: Record<"image" | "video" | "audio", number> = { image: 0, video: 0, audio: 0 };

    orderedUrls.forEach((url) => {
      const kind = inferPromptAssetKind(url);
      kindCounts[kind] += 1;
      const token = `${kind === "video" ? "视频" : kind === "audio" ? "音频" : "图片"}${kindCounts[kind]}`;
      const item = items.find((entry) => entry.url === url);
      uploadAssets.push({
        id: `video-${String(item?.uploadRequestId || item?.mediaId || url)}`,
        token,
        kind,
        url,
        name: item?.file?.name || basenameFromPath(url) || token,
      });
    });

    return uploadAssets;
  }, [inputMode, items]);

  const loadPromptReverseTasks = React.useCallback(async (silent = false) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/prompt-reverse?limit=50&surface=toolbox_video", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || "角色提示词记录加载失败"));
      }
      const tasks = Array.isArray(data?.tasks) ? data.tasks as PromptReverseTaskItem[] : [];
      setReverseTasks(tasks);

      const activeTask = activeReverseTaskId
        ? tasks.find((task) => task.id === activeReverseTaskId)
        : null;
      if (activeTask?.status === "success" && activeTask.generatedPrompt) {
        setReversePrompt(activeTask.generatedPrompt);
        setResultRoleSkill(activeTask.skill || null);
        setReversePromptApplied(false);
        setReverseLoading(false);
        setReverseError(null);
      } else if (activeTask?.status === "failed") {
        setReverseLoading(false);
        setReverseError(activeTask.errorMsg || "生成专业提示词失败");
      } else if (activeTask && isPromptReverseTaskRunning(activeTask)) {
        setReverseLoading(true);
      }
    } catch (taskError: any) {
      if (!silent) setReverseError(String(taskError?.message || "角色提示词记录加载失败"));
    }
  }, [activeReverseTaskId, setResultRoleSkill, setReversePrompt, setReversePromptApplied, userId]);

  React.useEffect(() => {
    if (!isActive || !userId) return;
    void loadPromptReverseTasks(true);
  }, [activeReverseTaskId, isActive, loadPromptReverseTasks, userId]);

  React.useEffect(() => {
    if (!isActive || !userId || !hasRunningReverseTask) return;
    const timer = window.setInterval(() => {
      void loadPromptReverseTasks(true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningReverseTask, isActive, loadPromptReverseTasks, userId]);

  React.useEffect(() => {
    if (
      !roleDraftHydrated
      || continuation?.kind !== "toolbox_video_generation"
      || continuation.taskId !== activeReverseTaskId
    ) return;
    const activeTask = reverseTasks.find((task) => task.id === continuation.taskId);
    if (!activeTask) return;
    if (activeTask.status === "success" && activeTask.generatedPrompt) {
      if (continuation.phase === "waiting") {
        void saveRoleDraftNow({
          reversePrompt: activeTask.generatedPrompt,
          reversePromptApplied: false,
          activeReverseTaskId: activeTask.id,
          continuation: {
            ...continuation,
            phase: "ready",
          },
          resultRoleSkill: activeTask.skill || null,
        });
      }
      return;
    }
    if (activeTask.status === "failed" || activeTask.status === "cancelled") {
      setReverseLoading(false);
      setReverseError(activeTask.errorMsg || "生成专业提示词失败");
      void saveRoleDraftNow({
        activeReverseTaskId: null,
        continuation: null,
      });
    }
  }, [
    activeReverseTaskId,
    continuation,
    reverseTasks,
    roleDraftHydrated,
    saveRoleDraftNow,
  ]);

  const queueVideoMediaReleases = React.useCallback((mediaIds: string[]) => {
    const draftSessionId = ephemeralMediaSessionRef.current;
    const ownerUserId = authenticatedUserIdRef.current;
    const uniqueMediaIds = Array.from(new Set(mediaIds.filter(Boolean)));
    if (!draftSessionId || !uniqueMediaIds.length) return workspaceMediaMutationQueueRef.current.idle;
    const mutation = async () => {
      if (authenticatedUserIdRef.current !== ownerUserId || ephemeralMediaSessionRef.current !== draftSessionId) return;
      // Uploads may have completed or an item may have been restored while queued.
      const unusedMediaIds = removedToolMediaIds(
        uniqueMediaIds.map((mediaId) => ({ mediaId })),
        itemsRef.current,
      );
      if (unusedMediaIds.length) await releaseEphemeralToolMedia({ draftSessionId, mediaIds: unusedMediaIds });
    };
    const queued = workspaceMediaMutationQueueRef.current.enqueueMutation(mutation);
    return queued;
  }, []);

  const committedMediaItemsRef = React.useRef({ ownerUserId: userId, items });
  React.useEffect(() => {
    const previous = committedMediaItemsRef.current;
    committedMediaItemsRef.current = { ownerUserId: userId, items };
    // State updaters can be replayed or discarded. Only release from committed changes.
    if (workspaceDraftHydrated && previous.ownerUserId === userId && workspaceDraftOwnerRef.current === userId) {
      const removedMediaIds = removedToolMediaIds(previous.items, items);
      if (removedMediaIds.length) void queueVideoMediaReleases(removedMediaIds).catch(() => undefined);
    }
  }, [items, queueVideoMediaReleases, userId, workspaceDraftHydrated]);

  const setFrameItems = React.useCallback((slot: "first" | "last", nextItems: MultiUploadItem[]) => {
    if (!workspaceDraftHydrated) return;
    const previousItems = itemsRef.current;
    const other = previousItems.find((it) => it.slot !== slot);
    const next = (nextItems[0] ? [{ ...nextItems[0], slot }, other].filter(Boolean) : [other].filter(Boolean)) as VideoUploadItem[];
    syncMaterialErrorAfterItemsChange(previousItems, next);
    setItems(next);
  }, [syncMaterialErrorAfterItemsChange, workspaceDraftHydrated]);

  const setMultimodalItems = React.useCallback((nextItems: MultiUploadItem[]) => {
    if (!workspaceDraftHydrated) return;
    const next = (nextItems as VideoUploadItem[]).slice(0, maxReferenceFiles);
    if (seedancePolicy) {
      const counts = next.reduce<Record<"image" | "video" | "audio", number>>(
        (result, item) => {
          const kind = inferVideoUploadItemKind(item);
          if (kind) result[kind] += 1;
          return result;
        },
        { image: 0, video: 0, audio: 0 },
      );
      const exceeded = counts.image > seedancePolicy.limits.maxImages
        ? `当前模型最多支持 ${seedancePolicy.limits.maxImages} 张参考图片`
        : counts.video > seedancePolicy.limits.maxVideos
          ? `当前模型最多支持 ${seedancePolicy.limits.maxVideos} 个参考视频`
          : counts.audio > seedancePolicy.limits.maxAudios
            ? `当前模型最多支持 ${seedancePolicy.limits.maxAudios} 个参考音频`
            : "";
      if (exceeded) {
        setError(normalizeApiFriendlyError({ error: exceeded }, exceeded));
        return;
      }
    }
    syncMaterialErrorAfterItemsChange(itemsRef.current, next);
    setItems(next);
  }, [maxReferenceFiles, seedancePolicy, syncMaterialErrorAfterItemsChange, workspaceDraftHydrated]);

  useIsoLayoutEffect(() => {
    setUserId(authenticatedUserId);
  }, [authenticatedUserId]);

  useIsoLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    if (!isActive) return;
    try {
      localStorage.setItem("studio_last_tool_v1", "video");
    } catch {}
  }, [isActive]);

  React.useEffect(() => {
    if (userId && isActive) {
      logAction("page_view", "用户访问了视频生成页面", { page: "/video" });
    }
  }, [isActive, logAction, userId]);

  React.useEffect(() => {
    return () => {
      if (inlineNoticeTimerRef.current) {
        window.clearTimeout(inlineNoticeTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const onToggle = () => setMediaLibraryOpen((prev) => !prev);
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

  const showInlineNotice = React.useCallback((text: string) => {
    const next = String(text || "").trim();
    if (!next) return;
    setInlineNotice(next);
    if (inlineNoticeTimerRef.current) {
      window.clearTimeout(inlineNoticeTimerRef.current);
    }
    inlineNoticeTimerRef.current = window.setTimeout(() => {
      setInlineNotice(null);
      inlineNoticeTimerRef.current = null;
    }, 3500);
  }, []);

  React.useEffect(() => {
    if (!paramOpen) return;
    const handleVideoParamPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && videoParamPanelRef.current?.contains(target)) return;
      if (target && videoParamButtonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-frosted-select-menu]")) return;
      setParamOpen(false);
    };
    document.addEventListener("pointerdown", handleVideoParamPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleVideoParamPointerDown, true);
  }, [paramOpen]);

  React.useEffect(() => {
    setItems((prev) => normalizeItemsForMode(prev, inputMode, maxReferenceFiles));
  }, [inputMode, maxReferenceFiles]);

  React.useEffect(() => {
    const nextMode = normalizeVideoInputMode(model, inputMode);
    if (nextMode !== inputMode) setInputMode(nextMode);
    if (!modelSupportsGenerateAudio(model) && generateAudio) setGenerateAudio(false);
    if (!modelSupportsWebSearch(model) && webSearch) setWebSearch(false);
  }, [generateAudio, inputMode, model, webSearch]);

  React.useEffect(() => {
    if (!isSeedance25) {
      if (omniReferenceTaskType !== "auto") setOmniReferenceTaskType("auto");
      return;
    }
    if ((inputMode === "first_frame" || inputMode === "first_last_frame") && ratio !== "adaptive") {
      setRatio("adaptive");
    }
    if (inputMode !== "multimodal" && omniReferenceTaskType !== "auto") {
      setOmniReferenceTaskType("auto");
    }
    if (inputMode === "multimodal" && omniReferenceTaskType === "auto" && hasReferenceVideo) {
      if (ratio !== "adaptive") setRatio("adaptive");
      if (duration !== "-1") setDuration("-1");
    }
    if (omniReferenceTaskType === "edit" || omniReferenceTaskType === "extend") {
      if (inputMode !== "multimodal") setInputMode("multimodal");
      if (ratio !== "adaptive") setRatio("adaptive");
      if (omniReferenceTaskType === "edit" && duration !== "-1") setDuration("-1");
    }
  }, [duration, hasReferenceVideo, inputMode, isSeedance25, omniReferenceTaskType, ratio]);

  React.useEffect(() => {
    if (!isMiniMaxH3) return;
    if ((inputMode === "first_frame" || inputMode === "first_last_frame") && ratio !== "adaptive") {
      setRatio("adaptive");
    }
    if (inputMode === "text_to_video" && ratio === "adaptive") {
      setRatio("9:16");
    }
  }, [inputMode, isMiniMaxH3, ratio]);

  React.useEffect(() => {
    if (videoCapabilityStatus === "loaded" && !modelSpec.supportedResolutions.includes(resolution as any)) {
      setResolution(getDefaultResolution(modelSpec));
    }
    const parsedDuration = Number.parseInt(duration, 10);
    if (modelSpec.durationOptions) {
      if (!modelSpec.durationOptions.includes(parsedDuration)) {
        setDuration(getDefaultDuration(modelSpec));
      }
      return;
    }
    const invalidAuto = parsedDuration === -1 && !modelSpec.allowAutoDuration;
    const invalidRange =
      parsedDuration !== -1 &&
      (!Number.isFinite(parsedDuration) ||
        parsedDuration < modelSpec.minDurationSeconds ||
        parsedDuration > modelSpec.maxDurationSeconds);
    if (invalidAuto || invalidRange || Number.isNaN(parsedDuration)) {
      setDuration(getDefaultDuration(modelSpec));
    }
  }, [duration, modelSpec, resolution, videoCapabilityStatus]);

  const applyStoredVideoTemplate = React.useCallback(() => {
    if (!userId || !workspaceDraftHydrated) return;
    try {
      const parsed = takeEphemeralToolTemplate<Record<string, any>>("video", userId);
      if (!parsed) return;
      const nextModel = typeof parsed?.model === "string" ? normalizeVideoModelId(parsed.model) : DEFAULT_VIDEO_MODEL;
      const nextInputMode = normalizeVideoInputMode(nextModel, coerceInputMode(parsed?.inputMode));
      const paths = getVideoTemplateMediaPaths({ params: parsed }).filter((path) => !isToolMediaPreviewUrl(path));
      const maxFiles = getVideoModelSpec(nextModel).referenceLimits?.total ?? 12;

      if (typeof parsed?.prompt === "string") setPrompt(parsed.prompt.replace(/@人像\d+/g, ""));
      setModel(nextModel);
      setInputMode(nextInputMode);
      if (typeof parsed?.resolution === "string") {
        setResolution(parsed.resolution);
      }
      if (typeof parsed?.ratio === "string") setRatio(parsed.ratio);
      if (typeof parsed?.duration === "string") setDuration(parsed.duration);
      if (typeof parsed?.seed === "string") setSeed(parsed.seed);
      setReturnLastFrame(coerceBoolean(parsed?.returnLastFrame, DEFAULT_VIDEO_RETURN_LAST_FRAME));
      setGenerateAudio(modelSupportsGenerateAudio(nextModel) ? coerceBoolean(parsed?.generateAudio, false) : false);
      setCameraFixed(coerceBoolean(parsed?.cameraFixed, false));
      setWatermark(coerceBoolean(parsed?.watermark, false));
      setWebSearch(modelSupportsWebSearch(nextModel) ? coerceBoolean(parsed?.webSearch, false) : false);
      setOmniReferenceTaskType(isSeedance25VideoModel(nextModel) && ["auto", "edit", "extend"].includes(String(parsed?.omniReferenceTaskType || ""))
        ? parsed.omniReferenceTaskType
        : "auto");
      setItems(toItemsFromPaths(paths, nextInputMode, maxFiles));
    } catch {}
  }, [userId, workspaceDraftHydrated]);

  React.useEffect(() => {
    if (!isActive || !userId) return;
    applyStoredVideoTemplate();
  }, [applyStoredVideoTemplate, isActive, userId]);

  React.useEffect(() => {
    if (!isActive || !userId) return;
    try {
      const key = `studio_video_notice_v1_${userId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      localStorage.removeItem(key);
      showInlineNotice(raw);
    } catch {}
  }, [isActive, showInlineNotice, userId]);

  React.useEffect(() => {
    if (!userId) return;
    const onApplyTemplate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>)?.detail || {};
      if (detail.userId && detail.userId !== userId) return;
      applyStoredVideoTemplate();
    };
    window.addEventListener("studio:apply-video-template", onApplyTemplate as EventListener);
    return () => {
      window.removeEventListener("studio:apply-video-template", onApplyTemplate as EventListener);
    };
  }, [applyStoredVideoTemplate, userId]);

  const workspaceBackupKey = userId ? `tool_workspace_draft_backup_v1:video:${userId}` : "";

  React.useEffect(() => {
    if (userId) return;
    setItems([]);
    setPrompt("");
  }, [userId]);

  const applyVideoWorkspaceDraft = React.useCallback((draft: Pick<ToolWorkspaceDraftDto, "payload"> | null) => {
    const state = (draft?.payload?.state && typeof draft.payload.state === "object" && !Array.isArray(draft.payload.state))
      ? draft.payload.state as Record<string, unknown>
      : {};
    const nextModel = normalizeVideoModelId(String(state.model || DEFAULT_VIDEO_MODEL));
    const nextInputMode = normalizeVideoInputMode(nextModel, coerceInputMode(state.inputMode));
    setModel(nextModel);
    setInputMode(nextInputMode);
    setResolution(typeof state.resolution === "string" ? state.resolution : DEFAULT_VIDEO_RESOLUTION);
    setRatio(typeof state.ratio === "string" ? state.ratio : DEFAULT_VIDEO_RATIO);
    setDuration(typeof state.duration === "string" ? state.duration : DEFAULT_VIDEO_DURATION);
    setSeed(typeof state.seed === "string" ? state.seed : "-1");
    setReturnLastFrame(coerceBoolean(state.returnLastFrame, DEFAULT_VIDEO_RETURN_LAST_FRAME));
    setGenerateAudio(modelSupportsGenerateAudio(nextModel) ? coerceBoolean(state.generateAudio, false) : false);
    setCameraFixed(coerceBoolean(state.cameraFixed, false));
    setWatermark(coerceBoolean(state.watermark, false));
    setWebSearch(modelSupportsWebSearch(nextModel) ? coerceBoolean(state.webSearch, false) : false);
    setOmniReferenceTaskType(isSeedance25VideoModel(nextModel) && ["auto", "edit", "extend"].includes(String(state.omniReferenceTaskType || ""))
      ? state.omniReferenceTaskType as SeedanceOmniReferenceTaskType
      : "auto");

  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setWorkspaceDraftHydrated(false);
    setWorkspaceDraftWritable(false);
    setToolMediaUploadCommits([]);
    workspaceDraftOwnerRef.current = userId;
    workspaceDraftVersionRef.current = 0;
    workspaceDraftFingerprintRef.current = "";
    if (!userId) return () => { cancelled = true; };

    const desktopDraft = readDesktopInputDraft<VideoEphemeralInputDraft>(desktopMode, "toolbox:video", userId);
    const remembered = desktopDraft || ephemeralInputDraftRegistry.read<VideoEphemeralInputDraft>(
      "toolbox:video",
      userId,
    );
    const draftSessionId = remembered?.draftSessionId || createToolClientUuid();
    ephemeralMediaSessionRef.current = draftSessionId;
    setPrompt((remembered?.prompt || "").replace(/@人像\d+/g, ""));

    const restoreItems = (restoredItems: VideoUploadItem[]) => {
      setItems(restoredItems.filter((item) => !isRemovedVideoReference(item)));
    };
    if (!desktopDraft) restoreItems(remembered?.items || []);
    const restoredMedia = desktopDraft
      ? recoverDesktopDraftMedia(draftSessionId, desktopDraft.items)
      : null;

    const hydrate = async () => {
      const pendingSave = pendingWorkspaceNavigationSave("video", userId);
      try {
        await pendingSave;
        let draft = await fetchToolWorkspaceDraft("video");
        if (!draft) {
          const legacy = readLegacyToolWorkspaceMigration({
            tool: "video",
            userId,
            localStorage,
            sessionStorage,
          });
          if (legacy) {
            draft = await patchToolWorkspaceDraft("video", {
              accountGuardUserId: userId,
              expectedVersion: 0,
              payload: legacy.payload,
              media: legacy.media,
            });
          }
        }
        if (cancelled || authenticatedUserIdRef.current !== userId) return;
        applyVideoWorkspaceDraft(desktopDraft?.workspacePayload ? { payload: desktopDraft.workspacePayload } : draft);
        workspaceDraftVersionRef.current = draft?.version || 0;
        workspaceDraftFingerprintRef.current = draft
          ? workspaceDraftFingerprint(
              draft.payload,
              draft.media.map((item) => ({
                mediaId: item.mediaId,
                position: item.position,
                ...(item.slot ? { slot: item.slot } : {}),
              })),
            )
          : "";
        setWorkspaceDraftWritable(true);
      } catch {
        if (cancelled || authenticatedUserIdRef.current !== userId) return;
        const backup = workspaceBackupKey ? readLocalWorkspaceDraftBackup(localStorage, workspaceBackupKey) : null;
        const payload = desktopDraft?.workspacePayload || backup?.payload;
        applyVideoWorkspaceDraft(payload ? { payload } : null);
        workspaceDraftVersionRef.current = backup?.version || 0;
        setWorkspaceDraftWritable(true);
        setInlineNotice("参数偏好暂时无法同步，但当前输入仍可继续使用。");
      } finally {
        const restoredItems = restoredMedia ? await restoredMedia : null;
        if (!cancelled && authenticatedUserIdRef.current === userId) {
          if (restoredItems) restoreItems(restoredItems);
          if (desktopDraft?.interruptedUpload) setInlineNotice(INTERRUPTED_UPLOAD_NOTICE);
          setWorkspaceDraftHydrated(true);
        }
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [applyVideoWorkspaceDraft, desktopMode, userId, workspaceBackupKey]);

  React.useEffect(() => {
    if (!authLoading && videoCapabilityStatus !== "pending" && (!userId || workspaceDraftHydrated)) onInitialReady?.();
  }, [authLoading, onInitialReady, userId, videoCapabilityStatus, workspaceDraftHydrated]);

  React.useEffect(() => {
    if (!isActive) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("model");
      if (!raw) return;
      setModel(normalizeVideoModelId(raw));
    } catch {}
  }, [isActive]);

  const videoWorkspaceSnapshot = React.useMemo<VideoWorkspaceSnapshot>(() => {
    const payload = {
      schemaVersion: 1,
      tool: "video",
      state: {
        model,
        inputMode,
        resolution,
        ratio,
        duration,
        seed,
        returnLastFrame,
        generateAudio,
        cameraFixed,
        watermark,
        webSearch,
        omniReferenceTaskType,
      },
    };
    const media: Array<{ mediaId: string; position: number; slot?: "first" | "last" }> = [];
    return {
      payload,
      media,
      fingerprint: workspaceDraftFingerprint(payload, media),
    };
  }, [cameraFixed, duration, generateAudio, inputMode, model, omniReferenceTaskType, ratio, resolution, returnLastFrame, seed, watermark, webSearch]);

  useIsoLayoutEffect(() => {
    workspaceDraftSnapshotRef.current = videoWorkspaceSnapshot;
  }, [videoWorkspaceSnapshot]);

  useIsoLayoutEffect(() => {
    if (!userId || !workspaceDraftHydrated || !ephemeralMediaSessionRef.current || workspaceDraftOwnerRef.current !== userId) return;
    const stableItems = items.flatMap((item) => {
      const candidate = item.replacement?.previousItem || item;
      const url = String(candidate.url || "").trim();
      if (!url || candidate.file || candidate.uploadError) return [];
      return [{ ...candidate, file: null } as VideoUploadItem];
    });
    const inputDraft: VideoEphemeralInputDraft = {
      prompt,
      items: stableItems,
      draftSessionId: ephemeralMediaSessionRef.current,
    };
    ephemeralInputDraftRegistry.write("toolbox:video", userId, inputDraft);
    if (desktopMode) {
      writeDesktopInputDraft(true, "toolbox:video", userId, {
        ...inputDraft,
        items: desktopDraftMediaItems(stableItems),
        workspacePayload: videoWorkspaceSnapshot.payload,
        interruptedUpload: desktopDraftUploadWasPending(items),
      });
    }
  }, [desktopMode, items, prompt, userId, workspaceDraftHydrated, videoWorkspaceSnapshot.payload]);

  const saveVideoWorkspaceDraftNow = React.useCallback(async (
    options: { keepalive?: boolean } = {},
  ) => {
    const ownerUserId = userId;
    if (!workspaceDraftHydrated || !workspaceDraftWritable || !ownerUserId || workspaceDraftOwnerRef.current !== ownerUserId) return;
    const save = async () => {
      // The account draft contains settings only. Ephemeral uploads have their own queue.
      const snapshot = workspaceDraftSnapshotRef.current;
      if (!snapshot || snapshot.fingerprint === workspaceDraftFingerprintRef.current) return;
      let saved: ToolWorkspaceDraftDto;
      try {
        saved = await patchToolWorkspaceDraft(
          "video",
          {
            accountGuardUserId: ownerUserId,
            expectedVersion: workspaceDraftVersionRef.current,
            payload: snapshot.payload,
            media: snapshot.media,
          },
          fetch,
          { keepalive: options.keepalive },
        );
      } catch (saveError: any) {
        if (saveError?.code !== "TOOL_WORKSPACE_DRAFT_VERSION_CONFLICT") throw saveError;
        const latest = await fetchToolWorkspaceDraft("video");
        if (authenticatedUserIdRef.current !== ownerUserId) return;
        applyVideoWorkspaceDraft(latest);
        workspaceDraftVersionRef.current = latest?.version || 0;
        workspaceDraftFingerprintRef.current = latest
          ? workspaceDraftFingerprint(
              latest.payload,
              latest.media.map((item) => ({
                mediaId: item.mediaId,
                position: item.position,
                ...(item.slot ? { slot: item.slot } : {}),
              })),
            )
          : "";
        await nextWorkspaceSnapshotFrame();
        return;
      }
      if (authenticatedUserIdRef.current !== ownerUserId) return;
      workspaceDraftVersionRef.current = saved.version;
      workspaceDraftFingerprintRef.current = snapshot.fingerprint;
      if (workspaceBackupKey) {
        try {
          writeLocalWorkspaceDraftBackup(localStorage, workspaceBackupKey, {
            version: saved.version,
            payload: snapshot.payload,
            media: snapshot.media,
          });
        } catch {}
      }
    };
    workspaceDraftSaveQueueRef.current = workspaceDraftSaveQueueRef.current.then(save, save);
    return workspaceDraftSaveQueueRef.current;
  }, [applyVideoWorkspaceDraft, userId, workspaceBackupKey, workspaceDraftHydrated, workspaceDraftWritable]);

  React.useEffect(() => {
    if (!workspaceDraftHydrated || !workspaceDraftWritable || !userId) return;
    const timer = window.setTimeout(() => {
      void saveVideoWorkspaceDraftNow().catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [saveVideoWorkspaceDraftNow, userId, videoWorkspaceSnapshot.fingerprint, workspaceDraftHydrated, workspaceDraftWritable]);

  const flushWorkspaceDraftRef = React.useRef<() => void>(() => undefined);
  useIsoLayoutEffect(() => {
    flushWorkspaceDraftRef.current = () => {
      if (!userId || !workspaceDraftHydrated || !workspaceDraftWritable) return;
      const save = saveVideoWorkspaceDraftNow({ keepalive: true });
      trackWorkspaceNavigationSave("video", userId, save);
    };
  }, [saveVideoWorkspaceDraftNow, userId, workspaceDraftHydrated, workspaceDraftWritable]);
  React.useEffect(() => {
    const flush = () => flushWorkspaceDraftRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  React.useEffect(() => {
    const validRatios = ratioOptions.map((option) => option.value);
    if (!validRatios.includes(ratio)) {
      setRatio(validRatios.includes(DEFAULT_VIDEO_RATIO) ? DEFAULT_VIDEO_RATIO : validRatios[0] || getDefaultRatio(modelSpec));
    }
  }, [modelSpec, ratio, ratioOptions]);

  const uploadToolMediaFile = React.useCallback(
    async (
      file: File,
      slot: "first" | "last" | undefined,
      requestKey: string,
      onStateChange: (state: "uploading" | "verifying") => void,
    ) => {
      if (!workspaceDraftHydrated || !workspaceDraftWritable || !authenticatedUserId || workspaceDraftOwnerRef.current !== authenticatedUserId) {
        throw new Error("素材工作草稿尚未就绪");
      }
      void slot;
      void requestKey;
      return uploadEphemeralToolMedia({
        draftSessionId: ephemeralMediaSessionRef.current,
        file,
        model,
        onStateChange,
      });
    },
    [authenticatedUserId, model, workspaceDraftHydrated, workspaceDraftWritable]
  );

  const uploadToolMediaSource = React.useCallback(
    async (
      sourceUrl: string,
      onStateChange: (state: "uploading" | "verifying") => void,
    ) => {
      if (!workspaceDraftHydrated || !workspaceDraftWritable || !authenticatedUserId || workspaceDraftOwnerRef.current !== authenticatedUserId) {
        throw new Error("素材工作草稿尚未就绪");
      }
      return uploadEphemeralToolMediaFromSource({
        draftSessionId: ephemeralMediaSessionRef.current,
        sourceUrl,
        model,
        onStateChange,
      });
    },
    [authenticatedUserId, model, workspaceDraftHydrated, workspaceDraftWritable],
  );

  const uploadLegacyImport = React.useCallback(
    async (file: File) => {
      if (!userId) return null;
      const form = new FormData();
      form.set("file", file);
      form.set("userId", userId);
      const res = await fetch("/api/assets/import", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "上传失败");
      const path = String(json?.data?.localPath || "");
      if (!path) throw new Error("上传失败");
      return path;
    },
    [userId]
  );

  React.useEffect(() => {
    if (!workspaceDraftHydrated || !workspaceDraftWritable || !authenticatedUserId || workspaceDraftOwnerRef.current !== authenticatedUserId) return;
    const idx = items.findIndex((it) =>
      it.file
      && !it.uploadError
      && (it.uploadState === undefined || it.uploadState === "queued")
      && !uploadingRef.current.has(it.file)
    );
    if (idx < 0) return;
    const nextFile = items[idx]?.file;
    if (!nextFile) return;

    uploadingRef.current.add(nextFile);
    setError(null);
    logAction("upload_input", "用户上传输入素材", {
      filename: nextFile.name,
      size: nextFile.size,
      mimeType: nextFile.type,
      taskType: "video_generate",
      sourcePage: "/video"
    });

    const pendingItem = items[idx];
    const uploadRequestId = String(pendingItem.uploadRequestId || createToolClientUuid());
    const ownerUserId = authenticatedUserId;
    const uploadMutation = async () => {
    const pendingItemForUpload: VideoUploadItem = {
      ...pendingItem,
      uploadRequestId,
      uploadState: "uploading",
      uploadError: undefined,
    };
    setItems((prev) => prev.map((item) =>
      item.file === nextFile ? pendingItemForUpload : item
    ));
    if (!isToolMediaUploadFile(nextFile, { allowAudio: modelSupportsReferenceAudio(model) })) {
      await uploadLegacyImport(nextFile)
        .then((path) => {
          if (!path) return;
          if (authenticatedUserIdRef.current !== ownerUserId) return;
          setItems((prev) =>
            prev.map((item) => item.file === nextFile ? { ...item, file: null, url: path, uploadError: undefined, uploadState: "ready" } : item)
          );
        })
        .catch((uploadError: any) => {
          const uploadErrorMessage = String(uploadError?.message || "素材上传失败，请重新添加");
          setItems((prev) => prev.map((item) => item.file === nextFile ? { ...item, uploadError: uploadErrorMessage, uploadState: "failed" } : item));
          setMaterialError(normalizeApiFriendlyError(
            { error: uploadError?.message },
            "素材上传失败，请重新上传",
          ));
        })
        ;
      await nextWorkspaceSnapshotFrame();
      return;
    }

    await settleToolMediaUpload({
      pendingItem: pendingItemForUpload,
      upload: async () => {
        return uploadToolMediaFile(
          nextFile,
          pendingItem.slot,
          uploadRequestId,
          (state) => {
            if (authenticatedUserIdRef.current !== ownerUserId) return;
            setItems((prev) => prev.map((item) =>
              item.file === nextFile ? { ...item, uploadState: state } : item
            ));
          },
        );
      },
    })
      .then((result) => {
        if (authenticatedUserIdRef.current !== ownerUserId) return;
        const readyItem = result.item as VideoUploadItem | null;
        setItems((prev) =>
          prev.flatMap((it) => {
            if (it.file !== nextFile) return [it];
            return readyItem ? [readyItem] : [];
          })
        );
        if (result.commit) {
          setToolMediaUploadCommits((previous) => [...previous, result.commit!]);
        }
        if (result.error) {
          setMaterialError(normalizeApiFriendlyError(
            { error: (result.error as any)?.message },
            "素材上传失败，请重新上传",
          ));
        }
      })
      ;
    await nextWorkspaceSnapshotFrame();
    };
    const queuedUpload = workspaceMediaMutationQueueRef.current.enqueueUpload(uploadMutation);
    void queuedUpload.finally(() => {
      uploadingRef.current.delete(nextFile);
    }).catch(() => undefined);
  }, [authenticatedUserId, items, logAction, model, setMaterialError, uploadLegacyImport, uploadToolMediaFile, workspaceDraftHydrated, workspaceDraftWritable]);

  React.useEffect(() => {
    if ((!seedancePolicy && !miniMaxH3Policy) || !workspaceDraftHydrated || !workspaceDraftWritable || !authenticatedUserId || workspaceDraftOwnerRef.current !== authenticatedUserId) return;
    const idx = items.findIndex((item) =>
      isToolMediaSourceItem(item)
      && !item.uploadError
      // A completed legacy import still needs a mediaId after switching models.
      && (item.uploadState === undefined || item.uploadState === "queued" || item.uploadState === "ready")
    );
    if (idx < 0) return;
    const pendingItem = items[idx];
    const sourceUrl = String(pendingItem.url || "").trim();
    if (!sourceUrl) return;
    const uploadRequestId = String(pendingItem.uploadRequestId || createToolClientUuid());
    if (uploadingSourceRef.current.has(uploadRequestId)) return;

    uploadingSourceRef.current.add(uploadRequestId);
    setError(null);
    const ownerUserId = authenticatedUserId;
    const pendingItemForUpload: VideoUploadItem = {
      ...pendingItem,
      file: null,
      uploadRequestId,
      uploadState: "uploading",
      uploadError: undefined,
    };
    setItems((previous) => previous.map((item, position) =>
      // Model normalization clones items, so object identity is not stable here.
      position === idx
        && isToolMediaSourceItem(item)
        && item.url === pendingItem.url
        && item.uploadRequestId === pendingItem.uploadRequestId
        && item.uploadState === pendingItem.uploadState
        && !item.uploadError
        ? { ...item, uploadRequestId, uploadState: "uploading", uploadError: undefined }
        : item
    ));

    const uploadMutation = async () => {
      const result = await settleToolMediaUpload({
        pendingItem: pendingItemForUpload,
        upload: async () => uploadToolMediaSource(
          sourceUrl,
          (state) => {
            if (authenticatedUserIdRef.current !== ownerUserId) return;
            setItems((previous) => previous.map((item) =>
              item.uploadRequestId === uploadRequestId ? { ...item, uploadState: state } : item
            ));
          },
        ),
      });
      if (authenticatedUserIdRef.current !== ownerUserId) return;
      const readyItem = result.item as VideoUploadItem | null;
      setItems((previous) => previous.flatMap((item) => {
        if (item.uploadRequestId !== uploadRequestId) return [item];
        return readyItem ? [readyItem] : [];
      }));
      if (result.commit) {
        setToolMediaUploadCommits((previous) => [...previous, result.commit!]);
      }
      if (result.error) {
        setMaterialError(normalizeApiFriendlyError(
          { error: (result.error as any)?.message },
          "素材处理失败，请重新拖入",
        ));
      }
      await nextWorkspaceSnapshotFrame();
    };
    const queuedUpload = workspaceMediaMutationQueueRef.current.enqueueUpload(uploadMutation);
    void queuedUpload.finally(() => {
      uploadingSourceRef.current.delete(uploadRequestId);
    }).catch(() => undefined);
  }, [authenticatedUserId, items, miniMaxH3Policy, seedancePolicy, setMaterialError, uploadToolMediaSource, workspaceDraftHydrated, workspaceDraftWritable]);

  React.useEffect(() => {
    if (!toolMediaUploadCommits.length) return;
    const completed = toolMediaUploadCommits.flatMap((commit) => {
      const resolution = resolveToolMediaUploadCommit(items, commit);
      return resolution.complete ? [{ commit, resolution }] : [];
    });
    if (!completed.length) return;
    const completedIds = new Set(
      completed.map(({ commit }) => commit.readyMediaId),
    );
    setToolMediaUploadCommits((previous) =>
      previous.filter((commit) => !completedIds.has(commit.readyMediaId)),
    );
    for (const { resolution } of completed) {
      if (!resolution.releaseMediaIds.length) continue;
      void queueVideoMediaReleases(resolution.releaseMediaIds).catch(() => undefined);
    }
  }, [items, queueVideoMediaReleases, toolMediaUploadCommits]);

  // 产品库/素材库等受保护源目录被拖进输入框时，先复制一份到 imports/ 再使用，实现解耦
  React.useEffect(() => {
    if (!userId || seedancePolicy || miniMaxH3Policy) return;
    const target = items.find(
      (it) => !it.file && needsImportToImports(it.url) && !it.uploadError && !importingUrlRef.current.has(it.url as string)
    );
    const srcUrl = target?.url;
    if (!srcUrl) return;
    setError(null);
    setItems((prev) => prev.map((it) => (
      !it.file && it.url === srcUrl
        ? { ...it, uploadState: "uploading", uploadError: undefined }
        : it
    )));
    void importInputToImportsTracked({
      sourceUrl: srcUrl,
      userId,
      inFlight: importingUrlRef.current,
    })
      .then((p) => {
        if (!p) return;
        setItems((prev) => prev.map((it) => (
          !it.file && it.url === srcUrl
            ? { ...it, url: p, uploadState: "ready", uploadError: undefined }
            : it
        )));
      })
      .catch((e: any) => {
        // 保留失败素材的原始位置，交给用户替换或删除。
        const uploadError = String(e?.message || "素材处理失败，请重新添加");
        setItems((prev) => prev.map((it) => (
          !it.file && it.url === srcUrl
            ? { ...it, uploadState: "failed", uploadError }
            : it
        )));
        setMaterialError(normalizeApiFriendlyError({ error: e?.message }, "素材处理失败，请重新拖入"));
      });
  }, [items, miniMaxH3Policy, seedancePolicy, setMaterialError, userId]);

  const handleGenerate = async (resume?: ToolboxVideoGenerationResume) => {
    if (generationSubmitInFlightRef.current) return;
    if (!resume && (reverseLoading || hasRunningReverseTask)) return;
    if (!user) {
      openLoginModal(() => {
        void handleGenerate();
      });
      return;
    }
    if (!userId) return;
    if (!workspaceDraftHydrated || !workspaceDraftWritable) {
      setError(normalizeApiFriendlyError(
        { error: "草稿服务暂时不可用，请刷新页面后重试。" },
        "草稿服务暂时不可用，请刷新页面后重试。",
      ));
      return;
    }

    const promptToSend = prompt.trim();
    if (!resume && !promptToSend && !selectedRoleSkillId) {
      setError(normalizeApiFriendlyError({ error: "请输入提示词" }, "请输入提示词"));
      return;
    }
    if (hasPendingUploads) {
      setError(normalizeApiFriendlyError({ error: "素材仍在上传中，请稍后再生成" }, "素材仍在上传中，请稍后再生成"));
      return;
    }
    if (hasFailedUploads) {
      setError(normalizeApiFriendlyError({ error: "有素材上传失败，请替换或删除后再生成" }, "有素材上传失败，请替换或删除后再生成"));
      return;
    }
    if (mediaIssueMessage) {
      setError(normalizeApiFriendlyError(
        { error: mediaIssueMessage },
        mediaIssueMessage,
      ));
      return;
    }
    if (requiresFaceAcknowledgement && !faceAcknowledged) {
      setError(normalizeApiFriendlyError(
        { error: "请先确认素材中的真人脸风险" },
        "请先确认素材中的真人脸风险",
      ));
      return;
    }
    // Lock before the first await so slow draft saves cannot admit another click.
    generationSubmitInFlightRef.current = true;
    setSubmissionPhase("validating");
    setError(null);
    const submissionStartedAt = performance.now();
    let validationFinishedAt = submissionStartedAt;
    let responseReceivedAt: number | null = null;
    let requestSubmitted = false;
    let submitAccepted = false;
    const releaseSubmissionButton = () => {
      const finishedAt = responseReceivedAt ?? performance.now();
      void logAction("generation_submit_timing", "video generation submission timing", {
        taskType: "video_generate",
        validationMs: Math.max(0, Math.round(validationFinishedAt - submissionStartedAt)),
        submitMs: Math.max(0, Math.round(finishedAt - validationFinishedAt)),
        totalMs: Math.max(0, Math.round(finishedAt - submissionStartedAt)),
        requestSubmitted,
        accepted: submitAccepted,
      });
      generationSubmitInFlightRef.current = false;
      setSubmissionPhase("idle");
    };
    try {
      await saveVideoWorkspaceDraftNow();
    } catch (saveError: any) {
      setError(normalizeApiFriendlyError(
        { error: saveError?.message },
        "保存视频工作草稿失败，请重试",
      ));
      validationFinishedAt = performance.now();
      releaseSubmissionButton();
      return;
    }
    let submission: ReturnType<typeof partitionToolMediaInputs>;
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const orderedItems = inputMode === "text_to_video" ? [] : getOrderedUploadItems(items, inputMode);
      submission = partitionToolMediaInputs(orderedItems);
      validationFinishedAt = performance.now();
    } catch (e: any) {
      validationFinishedAt = performance.now();
      setError(normalizeApiFriendlyError({ error: e?.message }, "素材检查失败，请重新添加后再试"));
      releaseSubmissionButton();
      return;
    }
    const { manifest, toolMediaIds, legacyPaths: imagePaths } = submission;
    const inputCount = toolMediaIds.length + imagePaths.length;
    if (inputMode === "first_frame" && inputCount < 1) {
      setError(normalizeApiFriendlyError({ error: "首帧图模式至少需要上传 1 张图片" }, "首帧图模式至少需要上传 1 张图片"));
      releaseSubmissionButton();
      return;
    }
    if (inputMode === "first_last_frame" && inputCount < 2) {
      setError(normalizeApiFriendlyError({ error: "首尾帧模式需要上传首帧和尾帧" }, "首尾帧模式需要上传首帧和尾帧"));
      releaseSubmissionButton();
      return;
    }
    if (inputMode === "multimodal" && inputCount === 0 && modelSpec.provider !== "kie") {
      setError(normalizeApiFriendlyError({ error: "全能参考模式至少需要 1 个素材" }, "全能参考模式至少需要 1 个素材"));
      releaseSubmissionButton();
      return;
    }
    if (generateAudio && !modelSupportsGenerateAudio(model)) {
      setError(normalizeApiFriendlyError({ error: `${modelSpec.label} 不支持生成音频` }, `${modelSpec.label} 不支持生成音频`));
      releaseSubmissionButton();
      return;
    }
    if (webSearch && !modelSupportsWebSearch(model)) {
      setError(normalizeApiFriendlyError({ error: `${modelSpec.label} 不支持联网搜索` }, `${modelSpec.label} 不支持联网搜索`));
      releaseSubmissionButton();
      return;
    }

    let generationPrompt = prompt;
    let skillUserPrompt = String(resume?.continuation.userPrompt || "").trim();
    let generationSkill = resume?.activeTask.skill || null;
    let requestKey = resume?.continuation.requestKey || createToolClientUuid();
    if (resume) {
      generationPrompt = String(resume.activeTask.generatedPrompt || "").trim();
    } else if (selectedRoleSkillId) {
      setSubmissionPhase("enhancing");
      setReverseLoading(true);
      setReverseError(null);
      try {
        const skillPromptRequest = buildPromptWithAssetReferences(prompt, promptAssets);
        const startedTask = await startToolboxRoleSkillPrompt({
          surface: "toolbox_video",
          roleSkillId: selectedRoleSkillId,
          userPrompt: skillPromptRequest.modelPrompt,
          mediaUrls: items.map((item) => String(item.url || "")).filter(Boolean),
        });
        const activeContinuation: ToolboxVideoRoleContinuation = {
          kind: "toolbox_video_generation",
          taskId: startedTask.id,
          requestKey,
          phase: "waiting",
          userPrompt: skillPromptRequest.displayPrompt,
        };
        skillUserPrompt = skillPromptRequest.displayPrompt;
        const activeTaskSave = await saveRoleDraftNow({
          activeReverseTaskId: startedTask.id,
          selectedRoleSkillId,
          reversePromptApplied: false,
          continuation: activeContinuation,
        });
        if (!activeTaskSave.success) throw new Error(activeTaskSave.error);
        const completedTask = await waitForToolboxRoleSkillPrompt({
          surface: "toolbox_video",
          taskId: startedTask.id,
        });
        const generatedPrompt = String(completedTask.generatedPrompt || "").trim();
        generationPrompt = generatedPrompt;
        setReversePrompt(generatedPrompt);
        setReversePromptApplied(false);
        setActiveReverseTaskId(completedTask.id);
        setResultRoleSkill(completedTask.skill || null);
        generationSkill = completedTask.skill || null;
        const completedTaskSave = await saveRoleDraftNow({
          reversePrompt: generatedPrompt,
          reversePromptApplied: false,
          activeReverseTaskId: completedTask.id,
          continuation: {
            ...activeContinuation,
            phase: "ready",
          },
          resultRoleSkill: completedTask.skill || null,
        });
        if (!completedTaskSave.success) throw new Error(completedTaskSave.error);
        requestKey = activeContinuation.requestKey;
        void loadPromptReverseTasks(true);
      } catch (skillError: any) {
        const message = String(skillError?.message || "技能生成提示词失败，请重试");
        setReverseError(message);
        setError(normalizeApiFriendlyError({ error: message }, message));
        validationFinishedAt = performance.now();
        releaseSubmissionButton();
        return;
      } finally {
        setReverseLoading(false);
      }
    }
    validationFinishedAt = performance.now();
    setSubmissionPhase("submitting");
    logAction("submit_generation", "用户提交生成任务", {
      taskType: "video_generate",
      prompt: generationPrompt.substring(0, 100),
      model,
      inputMode,
      resolution: effectiveResolution,
      ratio,
      duration,
      mediaCount: inputCount,
      sourcePage: "/video"
    });

    const tempId = historyRef.current?.addPendingItem("video_gen", requestKey, {
      prompt: generationPrompt,
      model,
      params: { ratio, resolution: effectiveResolution, duration, inputMode },
    });

    setParamOpen(false);

    try {
      const form = new FormData();
      form.set("userId", userId);
      form.set("prompt", generationPrompt);
      if (skillUserPrompt) form.set("userPrompt", skillUserPrompt);
      if (generationSkill) form.set("skill", JSON.stringify(generationSkill));
      form.set("model", model);
      form.set("requestKey", requestKey);
      toolMediaIds.forEach((mediaId) => form.append("toolMediaId[]", mediaId));
      imagePaths.forEach((p) => form.append("mediaPath[]", p));
      form.set("inputManifest", JSON.stringify(manifest));
      form.set("inputMode", inputMode);
      form.set("resolution", effectiveResolution);
      form.set("ratio", ratio);
      form.set("duration", duration);
      form.set("seed", seed);
      form.set("returnLastFrame", String(!isWan && returnLastFrame));
      form.set("generateAudio", String(generateAudio));
      form.set("cameraFixed", String(!isWan && cameraFixed));
      form.set("watermark", String(watermark));
      form.set("webSearch", String(webSearch));
      if (isSeedance25) {
        form.set("omniReferenceTaskType", omniReferenceTaskType);
        form.set("outputFormat", "mp4");
      }

      requestSubmitted = true;
      const res = await fetch("/api/video-gen", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      responseReceivedAt = performance.now();
      submitAccepted = res.ok && Boolean(String(json?.data?.generationId || "").trim());
      if (!res.ok) {
        historyRef.current?.reload();
        if (json?.displayInHistory) {
          const failedGenerationId = String(json?.data?.generationId || "").trim();
          if (failedGenerationId) {
            // 失败任务也已入库：把占位项按 id 关联到这条失败记录，避免占位项与失败记录并存
            if (tempId) historyRef.current?.resolvePendingItem(tempId, failedGenerationId);
          } else if (tempId) historyRef.current?.removePendingItem(tempId);
          setError(null);
          return;
        }
        setError(normalizeApiFriendlyError(json, "生成失败"));
        if (tempId) historyRef.current?.removePendingItem(tempId);
        return;
      }
      const generationId = String(json?.data?.generationId || "").trim();
      // 把乐观占位项按 id 关联到真实任务（不依赖时钟，避免“历史里显示两个任务”）
      if (tempId) {
        if (generationId) historyRef.current?.resolvePendingItem(tempId, generationId);
        else historyRef.current?.removePendingItem(tempId);
      }
      if (resume || selectedRoleSkillId) {
        const cleared = await saveRoleDraftNow({
          activeReverseTaskId: null,
          continuation: null,
        });
        if (!cleared.success) setInlineNotice(cleared.error);
      }
      // 占位项已按当前选中状态迁移到真实任务，不覆盖提交期间用户切换的历史记录。
      historyRef.current?.reload();
    } catch (e: any) {
      setError(normalizeApiFriendlyError({ error: e?.message }, "生成失败"));
      if (tempId) historyRef.current?.removePendingItem(tempId);
      historyRef.current?.reload();
    } finally {
      releaseSubmissionButton();
    }
  };

  const handleGenerateRef = React.useRef(handleGenerate);
  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);
  const resumeToolboxVideoContinuation = React.useCallback((
    activeTask: PromptReverseTaskItem,
    activeContinuation: ToolboxVideoRoleContinuation,
  ) => {
    void handleGenerateRef.current({
      activeTask,
      continuation: activeContinuation,
    });
  }, []);
  React.useEffect(() => {
    if (
      !isActive
      || !userId
      || !workspaceDraftHydrated
      || !workspaceDraftWritable
      || !roleDraftHydrated
      || continuation?.kind !== "toolbox_video_generation"
      || continuation.phase !== "ready"
      || hasPendingUploads
      || hasFailedUploads
      || generationSubmitInFlightRef.current
      || resumedToolboxContinuationRef.current === continuation.requestKey
    ) return;
    const activeTask = reverseTasks.find((task) => task.id === continuation.taskId);
    if (!activeTask || activeTask.status !== "success" || !activeTask.generatedPrompt) return;
    resumedToolboxContinuationRef.current = continuation.requestKey;
    resumeToolboxVideoContinuation(activeTask, continuation);
  }, [
    continuation,
    hasFailedUploads,
    hasPendingUploads,
    isActive,
    resumeToolboxVideoContinuation,
    reverseTasks,
    roleDraftHydrated,
    userId,
    workspaceDraftHydrated,
    workspaceDraftWritable,
  ]);

  const clampPromptPanelRect = React.useCallback((rect: FloatingPanelRect) => {
    if (typeof window === "undefined") return rect;
    const width = Math.max(360, Math.min(rect.width, window.innerWidth - 32));
    const height = Math.max(260, Math.min(rect.height, window.innerHeight - 32));
    return {
      width,
      height,
      left: Math.max(16, Math.min(rect.left, Math.max(16, window.innerWidth - width - 16))),
      top: Math.max(16, Math.min(rect.top, Math.max(16, window.innerHeight - height - 16))),
    };
  }, []);

  const measurePromptSourceRect = React.useCallback((): FloatingPanelRect => {
    const rect = promptSourceRef.current?.getBoundingClientRect();
    if (rect) {
      return clampPromptPanelRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    return clampPromptPanelRect({
      left: 112,
      top: 440,
      width: 460,
      height: 260,
    });
  }, [clampPromptPanelRect]);

  const getPromptPanelTargetRect = React.useCallback(
    (sourceRect?: FloatingPanelRect): FloatingPanelRect => {
      if (typeof window === "undefined") return sourceRect || { left: 620, top: 160, width: 760, height: 620 };
      const width = Math.min(760, window.innerWidth - 32);
      const height = Math.min(620, window.innerHeight - 32);
      const source = sourceRect || measurePromptSourceRect();
      return clampPromptPanelRect({
        left: source.left + source.width + 24,
        top: Math.max(88, source.top - 280),
        width,
        height,
      });
    },
    [clampPromptPanelRect, measurePromptSourceRect]
  );

  const openPromptPanel = React.useCallback(() => {
    if (promptPanelOpen) return;
    const sourceRect = measurePromptSourceRect();
    const targetRect = getPromptPanelTargetRect(sourceRect);
    setPromptPanelRect(targetRect);
    setPromptPanelOpen(true);
  }, [getPromptPanelTargetRect, measurePromptSourceRect, promptPanelOpen]);

  const closePromptPanel = React.useCallback(() => {
    if (!promptPanelOpen) return;
    promptPanelDragRef.current = null;
    promptPanelResizeRef.current = null;
    setPromptPanelOpen(false);
    setPromptPanelRect(null);
  }, [promptPanelOpen]);

  React.useEffect(() => {
    if (isActive || !promptPanelOpen) return;
    closePromptPanel();
  }, [closePromptPanel, isActive, promptPanelOpen]);

  React.useEffect(() => {
    if (!promptPanelOpen) return;
    const onResize = () => {
      setPromptPanelRect((current) => (current ? clampPromptPanelRect(current) : current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPromptPanelRect, promptPanelOpen]);

  React.useEffect(() => {
    if (!promptPanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[data-role-skill-dialog]")) return;
      event.preventDefault();
      closePromptPanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePromptPanel, promptPanelOpen]);

  React.useEffect(() => {
    if (!promptPanelOpen) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = promptPanelDragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        setPromptPanelRect((current) => {
          if (!current) return current;
          return clampPromptPanelRect({
            ...current,
            left: drag.panelLeft + event.clientX - drag.startX,
            top: drag.panelTop + event.clientY - drag.startY,
          });
        });
        return;
      }

      const resize = promptPanelResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      setPromptPanelRect((current) => {
        if (!current) return current;
        return clampPromptPanelRect({
          ...current,
          width: resize.panelWidth + event.clientX - resize.startX,
          height: resize.panelHeight + event.clientY - resize.startY,
        });
      });
    };
    const stopPointerAction = (event: PointerEvent) => {
      const drag = promptPanelDragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        promptPanelDragRef.current = null;
      }
      const resize = promptPanelResizeRef.current;
      if (resize && resize.pointerId === event.pointerId) {
        promptPanelResizeRef.current = null;
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerAction);
    window.addEventListener("pointercancel", stopPointerAction);
    return () => {
      promptPanelDragRef.current = null;
      promptPanelResizeRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopPointerAction);
      window.removeEventListener("pointercancel", stopPointerAction);
    };
  }, [clampPromptPanelRect, promptPanelOpen]);

  const handlePromptPanelPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !promptPanelRect) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      promptPanelDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panelLeft: promptPanelRect.left,
        panelTop: promptPanelRect.top,
      };
    },
    [promptPanelRect]
  );

  const handlePromptPanelPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = promptPanelDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      promptPanelDragRef.current = null;
    }
    const resize = promptPanelResizeRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      promptPanelResizeRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handlePromptPanelResizePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !promptPanelRect) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      promptPanelResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panelWidth: promptPanelRect.width,
        panelHeight: promptPanelRect.height,
      };
    },
    [promptPanelRect]
  );

  const handlePromptKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const native = event.nativeEvent as KeyboardEvent;
      if (!matchHotkey(native, generateHotkeySpec)) return;
      event.preventDefault();
      if (generateButtonState.disabled) return;
      void handleGenerate();
    },
    [generateButtonState.disabled, generateHotkeySpec, handleGenerate]
  );

  const handlePromptReverse = React.useCallback(async () => {
    if (!userId) {
      openLoginModal();
      return;
    }
    if (!selectedRoleSkillId) {
      setReverseError("请先选择一个 Skill");
      return;
    }
    if (hasPendingUploads) {
      setReverseError("素材仍在上传中，请稍后再生成专业提示词");
      return;
    }
    setReverseLoading(true);
    setReverseError(null);
    let taskStarted = false;
    try {
      const mediaUrls = items.map((item) => String(item.url || "")).filter(Boolean);
      const promptRequest = buildPromptWithAssetReferences(prompt, promptAssets);
      const res = await fetch("/api/prompt-reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          async: true,
          surface: "toolbox_video",
          roleSkillId: selectedRoleSkillId,
          userPrompt: promptRequest.modelPrompt,
          mediaUrls,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || "生成专业提示词失败"));
      }
      const task = data?.task as PromptReverseTaskItem | undefined;
      if (!task?.id) throw new Error("任务创建失败，请重试");
      const activeTaskSave = await saveRoleDraftNow({
        activeReverseTaskId: task.id,
        selectedRoleSkillId,
        reversePromptApplied: false,
      });
      if (!activeTaskSave.success) throw new Error(activeTaskSave.error);
      taskStarted = true;
      setReverseTasks((previous) => [task, ...previous.filter((item) => item.id !== task.id)]);
      setReversePromptApplied(false);
      window.setTimeout(() => {
        void loadPromptReverseTasks(true);
      }, 1200);
    } catch (reverseTaskError: any) {
      setReverseError(String(reverseTaskError?.message || "生成专业提示词失败"));
    } finally {
      if (!taskStarted) setReverseLoading(false);
    }
  }, [
    hasPendingUploads,
    items,
    loadPromptReverseTasks,
    openLoginModal,
    prompt,
    promptAssets,
    saveRoleDraftNow,
    selectedRoleSkillId,
    setReversePromptApplied,
    userId,
  ]);

  const renderUploadSection = () => {
    if (inputMode === "text_to_video") {
      return null;
    }

    if (inputMode === "first_last_frame") {
      return (
        <div className="flex h-full flex-col gap-3">
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <UiProps ids={{"title":["video.m0eee51419641"]}}><MultiUploadDropzone
              title="video.m0eee51419641"
              desc={text("createDynamic.m030fe49da609")}
              accept="image/*"
              items={firstFrameItems}
              onItemsChange={(next) => setFrameItems("first", next)}
              disabled={workspaceControlsDisabled}
              previewSize="video"
              maxFiles={1}
              pickLabel={text("createDynamic.m3d564203e885")}
              className="min-h-0"
              staticVideoPreviews={embeddedInStudioShell}
            /></UiProps>
            <UiProps ids={{"title":["video.m8a07f2e0a84c"]}}><MultiUploadDropzone
              title="video.m8a07f2e0a84c"
              desc={text("createDynamic.m775b657e8883")}
              accept="image/*"
              items={lastFrameItems}
              onItemsChange={(next) => setFrameItems("last", next)}
              disabled={workspaceControlsDisabled}
              previewSize="video"
              maxFiles={1}
              pickLabel={text("createDynamic.m3a9fcf17c339")}
              className="min-h-0"
              staticVideoPreviews={embeddedInStudioShell}
            /></UiProps>
          </div>
        </div>
      );
    }

    if (inputMode === "first_frame") {
      return (
        <div className="flex h-full flex-col gap-3">
          <UiProps ids={{"title":["video.m0eee51419641"]}}><MultiUploadDropzone
            title="video.m0eee51419641"
            desc={text("createDynamic.m030fe49da609")}
            accept="image/*"
            items={firstFrameItems}
            onItemsChange={(next) => setFrameItems("first", next)}
            disabled={workspaceControlsDisabled}
            previewSize="video"
            maxFiles={1}
            pickLabel={text("createDynamic.m3d564203e885")}
            className="h-full"
            staticVideoPreviews={embeddedInStudioShell}
          /></UiProps>
        </div>
      );
    }

    return (
      <UiProps ids={{"title":["video.m493ee58f81f5"]}}><MultiUploadDropzone
        title="video.m493ee58f81f5"
        desc={text("createDynamic.m7e0e7c79d1e0", { limit: maxReferenceFiles, kinds: referenceMediaKindsHint, mentions: referenceMentionExamples })}
        accept="image/*,video/*,audio/*"
        items={items}
        onItemsChange={setMultimodalItems}
        disabled={workspaceControlsDisabled}
        previewSize="video"
        audioPlayback
        maxFiles={maxReferenceFiles}
        pickLabel={text("createDynamic.mc0fb30a4372f")}
        className="h-full"
        staticVideoPreviews={embeddedInStudioShell}
        replaceOnItemDrop
      /></UiProps>
    );
  };

  const renderSeedanceParameterPanel = () => visibleVideoModels.length ? (
    <div ref={videoParamPanelRef} className="video-param-panel flex max-h-[min(56vh,520px)] flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]"><UiText id="video.m6a45a1fc60f8" /></div>
        </div>
        <button
          type="button"
          onClick={() => setParamOpen(false)}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
        ><UiText id="video.mafd4b783536b" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ParamCardSections>
        <UiProps ids={{"label":["video.mc98e118e0a43"]}}><ParameterField label="video.mc98e118e0a43" className="col-span-2">
          <FrostedSelect
            ariaLabel={parameterLabel("模型")}
            value={model}
            onChange={(value) => setModel(normalizeVideoModelId(value))}
            options={videoModelOptions}
            side="top"
            showLeading={false}
            compact
            truncateLabel={false}
          />
        </ParameterField></UiProps>
        {modelSpec.provider !== "kie" && (
        <UiProps ids={{"label":["video.m1cb2da1e673a","video.m47b2d56f0bf9"]}}><ParameterField label={isSeedance25 ? "video.m1cb2da1e673a" : "video.m47b2d56f0bf9"}>
          <FrostedSelect
            ariaLabel={parameterLabel(isSeedance25 ? "视频生成模式" : "输入模式")}
            value={selectedVideoMode}
            onChange={(value) => {
              if (isSeedance25 && (value === "edit" || value === "extend")) {
                setInputMode("multimodal");
                setOmniReferenceTaskType(value);
                setRatio("adaptive");
                if (value === "edit") setDuration("-1");
                return;
              }
              const nextMode = normalizeVideoInputMode(model, value);
              setInputMode(nextMode);
              if (isSeedance25) setOmniReferenceTaskType("auto");
              if ((isSeedance25 || isMiniMaxH3) && (nextMode === "first_frame" || nextMode === "first_last_frame")) {
                setRatio("adaptive");
              }
              if (isMiniMaxH3 && nextMode === "text_to_video" && ratio === "adaptive") setRatio("9:16");
            }}
            options={isSeedance25 ? seedance25ModeOptions : modelSpec.supportedInputModes.map((mode) => ({
              label: parameterLabel(
                mode === "first_last_frame"
                  ? "首尾帧"
                  : mode === "first_frame"
                    ? "首帧图"
                    : mode === "multimodal"
                      ? "全能参考"
                      : "文生视频"),
              value: mode
            }))}
            side="top"
            showLeading={false}
            compact
            truncateLabel={false}
          />
        </ParameterField></UiProps>
        )}
        <UiProps ids={{"label":["video.m22aca111bd1d"]}}><ParameterField label="video.m22aca111bd1d">
          {isSeedance25VideoEdit ? (
            <UiProps ids={{"aria-label":["video.mc309c39a8023"]}}><div
              data-seedance-video-edit-ratio-static
              aria-label="video.mc309c39a8023"
              className="flex h-10 w-full items-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[11px] text-[var(--app-fg)] shadow-[var(--shadow-2)]"
            ><UiText id="video.m8f1f75950e38" /></div></UiProps>
          ) : (
            <ParamOptionGrid
              ariaLabel={parameterLabel("宽高比")}
              value={ratio}
              onChange={setRatio}
              options={sortAspectRatioOptions(ratioOptions).map(option => ({ ...option, label: parameterLabel(option.label) }))}
              renderAspect={(option) => <CanvasAspectRatioIcon value={option.value} />}
            />
          )}
        </ParameterField></UiProps>
        <UiProps ids={{"label":["video.mb92421822c21"]}}><ParameterField label="video.mb92421822c21" className="col-span-2">
          <ParamOptionGrid
            ariaLabel={parameterLabel("分辨率")}
            value={effectiveResolution}
            onChange={setResolution}
            options={resolutionOptions}
          />
        </ParameterField></UiProps>
        {!isSeedance25VideoEdit && (useDurationSlider ? (
          <section className="canvas-task-parameter-section col-span-2">
            <DurationSlider
              value={duration}
              onChange={setDuration}
              min={modelSpec.minDurationSeconds}
              max={modelSpec.maxDurationSeconds}
              allowAuto={modelSpec.allowAutoDuration}
              autoFallback={getDefaultDuration(modelSpec)}
            />
          </section>
        ) : (
          <UiProps ids={{"label":["video.m04a95e0654d3"]}}><ParameterField label="video.m04a95e0654d3" className="col-span-2">
            <FrostedSelect
              ariaLabel={parameterLabel("时长")}
              value={duration}
              onChange={setDuration}
              options={durationOptions.map(option => ({ ...option, label: parameterLabel(option.label) }))}
              side="top"
              showLeading={false}
              compact
              truncateLabel={false}
            />
          </ParameterField></UiProps>
        ))}
        {modelSpec.provider !== "kie" && !isMiniMaxH3 && (
          <UiProps ids={{"label":["video.mb311c8ba2968"],"hint":["video.m2b7949c4318d"]}}><ParameterField
            label="video.mb311c8ba2968"
            hint="video.m2b7949c4318d"
            className="col-span-2"
          >
            <ParamOptionGrid
              ariaLabel={parameterLabel("生成音频")}
              value={generateAudio ? "enabled" : "disabled"}
              onChange={(value) => setGenerateAudio(value === "enabled")}
              options={[
                { label: parameterLabel("开启"), value: "enabled" },
                { label: parameterLabel("关闭"), value: "disabled" },
              ]}
              columns={2}
              disabled={!modelSpec.supportsGenerateAudio}
            />
          </ParameterField></UiProps>
        )}
        </ParamCardSections>

        {modelSpec.provider !== "kie" && !isMiniMaxH3 && !isWan && (
          <button
            type="button"
            onClick={() => setAdvOpen((prev) => !prev)}
            className="mb-3 mt-3 flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]"
          >
            <span className="inline-flex items-center gap-2">
              <UiProps ids={{"label":["video.ma42c8d6a892a"],"hint":["video.m02cd0b8e6a91"]}}><ParameterLabel label="video.ma42c8d6a892a" hint="video.m02cd0b8e6a91" /></UiProps>
            </span>
            <ChevronDown className={["h-4 w-4 transition", advOpen ? "rotate-180" : ""].join(" ")} />
          </button>
        )}

        {modelSpec.provider !== "kie" && !isMiniMaxH3 && !isWan &&
          (advOpen ? (
          <div className="grid grid-cols-1 gap-3">
              <UiProps ids={{"label":["video.mf30b4fa151f2"],"hint":["video.m2634fc14e5d6"]}}><ToggleRow
                label="video.mf30b4fa151f2"
                checked={webSearch}
                onChange={setWebSearch}
                disabled={inputMode !== "text_to_video" || !modelSpec.supportsWebSearch}
                hint={
                  inputMode !== "text_to_video"
                    ? "video.m2634fc14e5d6"
                    : !modelSpec.supportsWebSearch
                      ? text("createDynamic.mc7c9c34bf18f", { model: modelSpec.label })
                      : undefined
                }
              /></UiProps>
              <UiProps ids={{"label":["video.md46e2e1d920a"]}}><ToggleRow
                label="video.md46e2e1d920a"
                checked={cameraFixed}
                onChange={setCameraFixed}
                disabled={blocksSeedCameraControls}
                hint={blocksSeedCameraControls ? text("createDynamic.mc7c9c34bf18f", { model: modelSpec.label }) : undefined}
              /></UiProps>
          </div>
        ) : null)}
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-sm text-[var(--app-muted)] shadow-[var(--shadow)]"><UiText id="video.m6d8044e3d773" /></div>
  );
  const promptPlaceholder = text("createDynamic.m48ad12256119");

  const renderPromptEditor = (textareaClassName: string, expanded = false) => (
    <div className="relative h-full min-h-0">
      <PromptRichEditor
        autoFocus={expanded}
        expanded={expanded}
        disabled={workspaceControlsDisabled}
        value={prompt}
        assets={promptAssets}
        roleSkills={roleSkills}
        onOpenRoleSkillLibrary={(view, skill) => {
          setSkillLibraryEntry({ view, skill });
          setSystemPromptOpen(true);
        }}
        roleSkillMediaType="video"
        roleSkillsLoading={roleSkillsLoading}
        roleSkillsError={roleSkillsError}
        onRoleSkillSelect={selectToolboxRoleSkill}
        selectedRoleSkill={toolboxRoleSkill}
        onRoleSkillRemove={clearToolboxRoleSkillSelection}
        onValueChange={setPrompt}
        onKeyDown={handlePromptKeyDown}
        placeholder={promptPlaceholder}
        className={textareaClassName}
        contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}
      />
      <PresetPromptsTrigger
        onApply={(content) => {
          if (!workspaceControlsDisabled) setPrompt(String(content || ""));
        }}
        mode="inline"
        triggerVariant="inline"
        hideTrigger={workspaceControlsDisabled}
        triggerLabel="预设提示词"
        className="absolute bottom-3 right-3"
      />
    </div>
  );

  const promptSection = (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <span><UiText id="video.me1658d41f0be" /></span>
        <RoleSkillTrigger
          onClick={() => { setSkillLibraryEntry({ view: "browse" }); setSystemPromptOpen(true); }}
          disabled={workspaceControlsDisabled}
          selected={Boolean(activeSelectedRoleSkillId)}
        />
      </div>
      <div ref={promptSourceRef} data-video-prompt-source className="flex-1 min-h-0 relative">
        <PromptEditorPortal target={promptEditorHost}>
          {renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)}
        </PromptEditorPortal>
        {promptPanelOpen ? (
          <div className="h-full w-full" aria-hidden="true" />
        ) : (
          <>
            <div ref={setPromptEditorHost} className="h-full w-full" />
            <UiProps ids={{"title":["video.maec5cc0d276f"],"aria-label":["video.maec5cc0d276f"]}}><button
              data-video-prompt-expand-corner
              type="button"
              onClick={openPromptPanel}
              title="video.maec5cc0d276f"
              aria-label="video.maec5cc0d276f"
              className="absolute right-0 top-0 z-10 inline-flex h-6 w-6 items-center justify-center bg-transparent text-[var(--app-muted)] transition-colors hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <span aria-hidden="true" className="block h-2.5 w-2.5 border-r border-t border-current" />
            </button></UiProps>
          </>
        )}
      </div>
    </div>
  );

  const expandedPromptPanel = isActive && promptPanelOpen && promptPanelRect && typeof document !== "undefined" ? createPortal(
    <div
      ref={promptPanelRef}
      data-video-prompt-panel
      className="fixed z-[120] flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)] dark:bg-[#242424] dark:[--input-bg:#242424] dark:[--panel-2:#242424] dark:[--panel-bg:#242424]"
      style={promptPanelRect}
    >
      <div className="flex h-11 flex-shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel-2)] dark:bg-[#242424]">
        <div
          className="flex h-full min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 px-3"
          onPointerDown={handlePromptPanelPointerDown}
          onPointerUp={handlePromptPanelPointerUp}
          onPointerCancel={handlePromptPanelPointerUp}
        >
          <Maximize2 className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
          <span className="truncate text-sm font-semibold"><UiText id="video.me1658d41f0be" /></span>
          <span className="shrink-0 text-xs font-normal text-[var(--app-muted)]">{prompt.length}<UiText id="video.mc55038b272b1" /></span>
        </div>
        <UiProps ids={{"title":["video.m3fd47edce45b"],"aria-label":["video.m57004465b7d3"]}}><button
          type="button"
          onClick={closePromptPanel}
          title="video.m3fd47edce45b"
          aria-label="video.m57004465b7d3"
          className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
        >
          <X className="h-4 w-4" />
        </button></UiProps>
      </div>
      <div className="relative min-h-0 flex-1 p-3">
        <div ref={setPromptEditorHost} className="h-full" />
      </div>
      <UiProps ids={{"aria-label":["video.m58f002bafda0"],"title":["video.m6cf2895f0080"]}}><div
        role="separator"
        aria-orientation="horizontal"
        aria-label="video.m58f002bafda0"
        title="video.m6cf2895f0080"
        onPointerDown={handlePromptPanelResizePointerDown}
        onPointerUp={handlePromptPanelPointerUp}
        onPointerCancel={handlePromptPanelPointerUp}
        className="absolute bottom-1.5 right-1.5 h-5 w-5 cursor-se-resize touch-none rounded-md text-[var(--app-muted)] opacity-70 transition hover:bg-white/10 hover:opacity-100"
      >
        <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-current" />
        <span className="absolute bottom-1 right-1 h-4 w-4 border-b border-r border-current opacity-60" />
      </div></UiProps>
    </div>,
    document.body
  ) : null;

  const activeReverseTask = activeReverseTaskId
    ? reverseTasks.find((task) => task.id === activeReverseTaskId)
    : undefined;

  const systemPromptPanel = isActive && systemPromptOpen ? (
    <RoleSkillDialog
      open
      initialView={skillLibraryEntry.view}
      initialSkill={skillLibraryEntry.skill}
      authUserId={userId}
      mediaType="video"
      selectedRoleSkillId={activeSelectedRoleSkillId}
      resultRoleSkillId={resultRoleSkill?.id || null}
      legacySystemPrompt={systemPrompt}
      generating={reverseLoading || hasRunningReverseTask}
      generateDisabledReason={hasPendingUploads ? "素材仍在上传中，请稍后再生成。" : undefined}
      showApplyResult={false}
      onClose={() => {
        void saveRoleDraftNow();
        setSystemPromptOpen(false);
      }}
      onSelect={(skill: RoleSkillListItem) => {
        selectToolboxRoleSkill(skill);
        setSystemPromptOpen(false);
      }}
      onGenerate={() => void handlePromptReverse()}
      onApplyResult={() => undefined}
      result={(
        <div className="flex h-full min-h-[220px] flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
            <span><UiText id="video.m8ae2bac25454" /></span>
          </div>
          <UiProps ids={{"placeholder":["video.m3ddfd59a7642"]}}><textarea
            value={reversePrompt}
            onChange={(event) => {
              setReversePrompt(event.target.value);
              setActiveReverseTaskId(null);
              setReversePromptApplied(false);
            }}
            onBlur={() => void saveRoleDraftNow()}
            disabled={reverseLoading || hasRunningReverseTask}
            placeholder="video.m3ddfd59a7642"
            className="min-h-0 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-3 text-sm leading-relaxed text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)] disabled:opacity-60"
          /></UiProps>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-red-500">{(reverseError || roleDraftError) && localizeError(reverseError || roleDraftError)}</span>
            <button
              type="button"
              onClick={() => {
                setReversePrompt("");
                setActiveReverseTaskId(null);
                setResultRoleSkill(null);
                setReversePromptApplied(false);
                setReverseError(null);
              }}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)]"
            ><UiText id="video.me4b823dc13c3" /></button>
          </div>
        </div>
      )}
    />
  ) : null;

  const leftPanelContent = (
    <div inert={workspaceControlsDisabled} className="flex h-full min-h-0 flex-col gap-3">
      {inputMode !== "text_to_video" ? (
        <div className="min-h-[168px] shrink-0">{renderUploadSection()}</div>
      ) : null}
      {promptSection}
    </div>
  );

  const footerContent = (
    <div inert={workspaceControlsDisabled} className="relative space-y-3">
      {paramOpen || mediaIssueMessage || error ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+12px)] left-0 right-0 z-30 flex flex-col gap-3">
          {paramOpen ? (
            <div className="pointer-events-auto">
              {renderSeedanceParameterPanel()}
            </div>
          ) : null}
          {mediaIssueMessage || error ? (
            <div data-video-error-overlay className="pointer-events-auto max-h-[min(32dvh,240px)] w-full max-w-full min-w-0 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain break-all pr-1">
              {mediaIssueMessage ? (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {localizeError(mediaIssueMessage, "请处理不合规素材")}
                </div>
              ) : null}
              {error ? (
                <FriendlyErrorBlock error={error} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {requiresFaceAcknowledgement && !faceAcknowledged ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/80 px-3 py-2 text-xs leading-relaxed text-[var(--app-fg)]">
          <input
            type="checkbox"
            checked={faceAcknowledged}
            onChange={(event) => {
              if (event.target.checked) acknowledgeFaceNotice();
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary-bg)]"
          />
          <span><UiText id="video.m1a9800ff756e" /></span>
        </label>
      ) : null}
      {inlineNotice ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/80 px-3 py-2 text-sm text-[var(--app-fg)]">
          {localizeError(localizeLabel(inlineNotice))}
        </div>
      ) : null}
      <button
        ref={videoParamButtonRef}
        type="button"
        onClick={() => setParamOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span><UiText id="video.m6a45a1fc60f8" /></span>
          <span className="truncate text-[11px] font-normal text-[var(--app-muted)]">
            {visibleVideoModels.length ? `${modelSpec.label} · ${modelSpec.provider === "kie" ? "" : `${isSeedance25 ? videoModeLabel : parameterLabel(inputMode === "first_last_frame" ? "首尾帧" : inputMode === "first_frame" ? "首帧图" : inputMode === "multimodal" ? "全能参考" : "文生视频")} · `}${parameterLabel(ratioDisplayLabel(ratio))} · ${duration === "-1" ? parameterLabel("自动时长") : `${duration}s`} · ${effectiveResolution}` : <UiText id="video.m0c4ff1cbb701" />}
          </span>
        </span>
        <ChevronDown className={["h-4 w-4 shrink-0 transition", paramOpen ? "rotate-180" : ""].join(" ")} />
      </button>
      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={generateButtonState.disabled}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary-bg)] text-base font-medium text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:bg-[var(--border)] disabled:text-[var(--app-muted)] disabled:hover:bg-[var(--border)]"
      >
        {generationLabel(generateButtonState.label)}
      </button>
    </div>
  );

  if (sharedHistory) {
    return (
      <section
        className={embeddedInStudioShell ? "contents"
          : "isolate flex h-full min-h-0 flex-col overflow-visible rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]"}
      >
        {!embeddedInStudioShell ? (
        <div className="flex h-[64px] items-center border-b border-[var(--border)] p-[clamp(12px,1.8dvh,16px)]">
          <div className="mx-auto grid w-full max-w-[520px] grid-cols-3 gap-2">
            {(["image", "video"] as const).map((tool) => (
              <button
                key={tool}
                type="button"
                onClick={() => studioNav?.onSelectTool(tool)}
                className={[
                  "flex h-10 w-full items-center justify-center gap-2 rounded-2xl px-3 text-sm font-medium transition-all",
                  studioNav?.activeTool === tool
                    ? "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                    : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                ].join(" ")}
              >

                {tool === "image" && (
                  <>
                    <Image className="h-4 w-4" /><UiText id="video.md721fd5257b8" /></>
                )}
                {tool === "video" && (
                  <>
                    <Video className="h-4 w-4" /><UiText id="video.m89174fe72eee" /></>
                )}
              </button>
            ))}
          </div>
        </div>
        ) : null}
        <div className="flex-1 min-h-0 px-[clamp(14px,2.2dvh,20px)] pt-[clamp(14px,2.2dvh,20px)] pb-0">
          {leftPanelContent}
        </div>
        <div className="relative z-20 mt-2 px-[clamp(14px,2.2dvh,20px)] pb-[clamp(14px,2.2dvh,20px)] pt-3">{footerContent}</div>
        {expandedPromptPanel}
        {systemPromptPanel}
      </section>
    );
  }

  return (
    <div className="flex h-full gap-2.5">
      {systemPromptPanel}
      <div className="flex w-[310px] shrink-0 flex-col rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow)]">
        <div className="mb-3 grid grid-cols-3 gap-2">
          {(studioNav ? (["image", "video"] as const) : (["image", "video"] as const)).map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => {
                if (studioNav) {
                  studioNav.onSelectTool(tool);
                  return;
                }
                const href = tool === "image" ? "/studio?tool=image" : "/video";
                window.location.href = href;
              }}
              className={[
                "flex h-10 w-full items-center justify-center gap-2 rounded-2xl px-3 text-sm font-medium transition-all",
                (studioNav?.activeTool || "video") === tool
                  ? "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                  : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
              ].join(" ")}
            >

              {tool === "image" && (
                <>
                  <Image className="h-4 w-4" /><UiText id="video.md721fd5257b8" /></>
              )}
              {tool === "video" && (
                <>
                  <Video className="h-4 w-4" /><UiText id="video.m89174fe72eee" /></>
              )}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{leftPanelContent}</div>
        <div className="border-t border-[var(--border)] pt-3">{footerContent}</div>
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow)]">
        <div className="min-h-0 flex-1 overflow-hidden">
          <UnifiedHistoryPanel
            ref={historyRef}
            defaultType="all"
            focusId={historyFocusId}
            userId={userId}
            onItemCountChange={setHistoryCount}
          />
        </div>
        <MediaLibraryPanel open={mediaLibraryOpen} onClose={() => setMediaLibraryOpen(false)} />
      </div>
      {expandedPromptPanel}
    </div>
  );
}
