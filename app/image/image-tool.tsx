"use client";
import { UiProps, UiText } from "@/i18n/ui";
import { useCreateLocalization } from "@/components/studio/create-localization";

import { isSeedream55Model, VOLC_SEEDREAM_55_MODEL } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_MODEL, SEEDREAM_55_RATIOS, SEEDREAM_55_RESOLUTIONS, type Seedream55Settings } from "@/lib/apimart-seedream-55";
import { useGenerationRunning } from "@/lib/hooks/use-generation-running";
import { GoogleImageSettings } from "@/components/image/google-image-settings";
import { getGoogleImageOptions, googleImageSettingsSummary, normalizeGoogleImageSettings } from "@/lib/google-image-settings";

import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, NANO_BANANA_21_RATIOS } from "@/lib/nano-banana-21-providers";
import { GOOGLE_NANO_BANANA_21_MODEL, GOOGLE_NANO_BANANA_21_RATIOS, GOOGLE_NANO_BANANA_21_RESOLUTIONS, GOOGLE_NANO_BANANA_21_MAX_REFERENCES } from "@/lib/google-nano-banana-21";
import { loadImageModelCatalog } from "@/lib/client/image-model-catalog";
import { fetchImageDraftForEntry } from "@/lib/tool-workspace-draft/entry-request";
import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import { isOpenRouterImageModel, getOpenRouterImageParams, getOpenRouterResolutionDisplayOptions } from "@/lib/openrouter-image-params";

import { QWEN_IMAGE_3_MODEL_ID, QWEN_IMAGE_3_RATIOS, QWEN_IMAGE_3_RESOLUTIONS, QWEN_IMAGE_3_QUALITIES, isQwenImage3Model } from "@/lib/qwen-image-3-models";

import { QWEN_IMAGE_21_MODEL_ID, QWEN_IMAGE_21_RATIOS, QWEN_IMAGE_21_RESOLUTIONS, isQwenImage21Model } from "@/lib/work-fisher-image-params";
import { GPT_IMAGE_25_BACKGROUND_OPTIONS, supportsImageBackground } from "@/lib/gpt-image-25-models";
import { supportsGptImage26Gif } from "@/lib/gpt-image-26-animation";
import { GptImage25OutputSettings } from "@/components/image/gpt-image-25-output-settings";

import { createWorkspaceMediaQueue } from "@/lib/tool-media/workspace-media-queue";

import { REAPI_GPT_IMAGE_25_MODEL_ID } from "@/lib/gpt-image-25-models";
import { REAPI_GPT_IMAGE_25_RATIOS } from "@/lib/reapi-gpt-image-25";
import { APIMART_GPT_IMAGE_25_MODEL_ID } from "@/lib/apimart-gpt-image-25";
import { expandGptImage25ModelOptions, getGptImage25SelectionValue, resolveGptImage25Selection, GPT_IMAGE_25_RATIOS, isGptImageVariantModel, getGptImage25QualityOptions } from "@/lib/gpt-image-25-models";
import { AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID } from "@/lib/aicoming-merchant-models";
import { AICOMING_GPT_IMAGE_25_RATIOS } from "@/lib/aicoming-gpt-image-25";

import * as React from "react";
import { createPortal } from "react-dom";
import { PromptEditorPortal } from "@/components/ui/prompt-editor-portal";
import dynamic from "next/dynamic";
import { AlertCircle, ChevronDown, Image, Maximize2, UserRound, Video, X } from "lucide-react";
import { ToolShell } from "@/components/layout/tool-shell";
import { useAuth } from '@/components/auth/AuthProvider'
import { UnifiedHistoryPanel, type UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";
import { UnifiedHistoryActions } from "@/components/history/unified-history-actions";
import { MultiUploadDropzone, type MultiUploadItem } from "@/components/ui/multi-upload-dropzone";
import type { FrostedSelectLeadingContext, FrostedSelectOption } from "@/components/ui/frosted-select";
import { ParamCard, ParamCardSections, ParamOptionGrid, type ParamCardKind } from "@/components/parameters/param-cards";
import { FriendlyErrorBlock, type FriendlyUiError } from "@/components/ui/friendly-error-block";
import { RoleSkillTrigger } from "@/components/role-skills/role-skill-trigger";
import { listRoleSkills } from "@/lib/role-skills/client";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";
import {
  startToolboxImageRoleSkillPrompt,
  waitForToolboxImageRoleSkillPrompt,
} from "@/lib/role-skills/toolbox-image-client";

import { useGenerateHotkey } from "@/lib/hooks/use-generate-hotkey";
import { isEditableTarget, matchHotkey, parseHotkeyString } from "@/lib/hotkeys";
import { useLogger } from "@/hooks/use-logger";
import { useAccountRolePositioningDraft } from "@/hooks/use-account-role-positioning-draft";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import type {
  ToolboxImageRoleContinuation,
} from "@/lib/role-positioning-continuation";
import { normalizeApiFriendlyError } from "@/lib/error-friendly";
import { needsImportToImports, importInputToImportsTracked } from "@/lib/protected-input";
import { getAspectRatioPreviewSize } from "@/lib/aspect-ratio-preview";
import {
  EASYROUTER_IMAGE_2_ASPECT_RATIOS,
  EASYROUTER_IMAGE_2_RESOLUTIONS,
  getEasyRouterCustomSizeError,
} from "@/lib/easyrouter-image-params";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_RATIOS,
  GPT_IMAGE_2_OFFICIAL_RESOLUTIONS,
  REAPI_GPT_IMAGE_2_MODEL_ID,
  REAPI_GPT_IMAGE_2_RATIOS,
  getGptImage2OfficialRatios,
  isGptImage2OfficialProviderModel,
  isGptImage2OfficialSizeComboValid,
} from "@/lib/gpt-image-2-official";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
} from "@/lib/aicoming-merchant-models";
import {
  TUZI_GPT_IMAGE_2_ASPECT_RATIOS,
  TUZI_GPT_IMAGE_2_MODEL_ID,
  TUZI_GPT_IMAGE_2_RESOLUTIONS,
  getTuziGptImage2Ratios,
  isTuziGptImage2SizeComboValid,
} from "@/lib/tuzi-image-params";
import {
  APIMART_MIDJOURNEY_V8_MODEL_ID,
  isMidjourneyV8Model,
  MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_RATIOS,
  MIDJOURNEY_V8_SPEEDS,
  type MidjourneyV8Speed,
  type MidjourneyV8Options,
  normalizeMidjourneyV8Options,
  midjourneyVersionLabel,
} from "@/lib/midjourney-v8";
import { MidjourneySettings } from "@/components/image/midjourney-settings";
import { DOUBAO_SEEDREAM_5_LITE_MODEL, DOUBAO_SEEDREAM_5_PRO_MODEL, IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { NANO_BANANA_2_LITE_ASPECT_RATIOS } from "@/lib/kie-image-lite";
import {
  APIMART_GPT_IMAGE_26_MODEL_ID,
  APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES,
  APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES,
} from "@/lib/apimart-image-models";
import { basenameFromPath, buildPromptWithAssetReferences, type PromptReferenceAsset } from "@/lib/prompt-asset-references";
import {
  createToolClientUuid,
  getToolMediaGenerateButtonState,
  hasFailedToolMediaUploads,
  hasPendingToolMediaUploads,
  partitionToolMediaInputs,
  releaseEphemeralToolMedia,
  removedToolMediaIds,
  resolveToolMediaUploadCommit,
  restoreToolMediaTemplateItems,
  settleToolMediaUpload,
  uploadEphemeralToolMedia,
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
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import {
  isImageWorkspaceDisplayReady,
  readImageWorkspaceDisplayCache,
  updateImageWorkspaceDisplayCache,
} from "@/lib/tool-workspace-draft/image-display-cache";

const PromptRichEditor = dynamic(() => import("@/components/ui/prompt-rich-editor").then((module) => module.PromptRichEditor), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-full min-h-[132px] rounded-xl border border-[var(--border)] bg-[var(--input-bg)]" />,
});

const IMAGE_OUTPUT_QUANTITIES = [1, 2, 4] as const;
function normalizeOutputQuantity(value: unknown) {
  return IMAGE_OUTPUT_QUANTITIES.find((quantity) => quantity === value) ?? 1;
}
const PresetPromptsTrigger = dynamic(() => import("@/components/presets/preset-prompts").then((module) => module.PresetPromptsTrigger), {
  ssr: false,
  loading: () => null,
});
const RoleSkillDialog = dynamic(() => import("@/components/role-skills/role-skill-dialog").then((module) => module.RoleSkillDialog), {
  ssr: false,
  loading: () => null,
});

type ImageModelValue = string;

type ImageWorkspaceSnapshot = {
  payload: Record<string, unknown>;
  media: Array<{ mediaId: string; position: number }>;
  fingerprint: string;
};

type ImageEphemeralInputDraft = {
  prompt: string;
  items: MultiUploadItem[];
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

type ToolboxImageGenerationResume = {
  activeTask: PromptReverseTaskItem;
  continuation: ToolboxImageRoleContinuation;
};

function isPromptReverseTaskRunning(task: PromptReverseTaskItem) {
  return task.status === "pending" || task.status === "running";
}

const NANO_ASPECT_RATIO_VALUES = ["auto", "1:1", "4:1", "8:1", "3:4", "1:4", "4:3", "16:9", "9:16", "3:2", "2:3"] as const;
const NANO_BANANA_PRO_ASPECT_RATIO_VALUES = ["auto", "1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3"] as const;
const GPT_IMAGE_2_ASPECT_RATIO_VALUES = ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"] as const;
const EASYROUTER_IMAGE_2_ASPECT_RATIO_VALUES = [...EASYROUTER_IMAGE_2_ASPECT_RATIOS, "custom"] as const;
const GPT_IMAGE_2_APIMART_ASPECT_RATIO_VALUES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"] as const;
const GPT_IMAGE_2_JIEKOU_ASPECT_RATIO_VALUES = ["auto", "1:1", "2:3", "3:2", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"] as const;
const SEEDREAM_ASPECT_RATIO_VALUES = ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;

function formatModelParamLabel(value: string) {
  return value === "auto" ? "自适应" : value;
}

const ASPECT_RATIO_OPTIONS_BY_MODEL: Record<ImageModelValue, FrostedSelectOption[]> = {
  ...Object.fromEntries([KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL].map(model => [model, NANO_BANANA_21_RATIOS.map(value => ({ value, label: formatModelParamLabel(value) }))])),
  [GOOGLE_NANO_BANANA_21_MODEL]: GOOGLE_NANO_BANANA_21_RATIOS.map(value => ({ value, label: formatModelParamLabel(value) })),
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RATIOS.map(value => ({ value, label: value === "auto" ? "自适应" : value })),
  [QWEN_IMAGE_21_MODEL_ID]: QWEN_IMAGE_21_RATIOS.map((value) => ({ label: value, value })),
  "nano-banana-pro": NANO_BANANA_PRO_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [VOLC_SEEDREAM_55_MODEL]: [...SEEDREAM_55_RATIOS, "custom"].map(value => ({ value, label: value === "custom" ? "自定义" : formatModelParamLabel(value) })),
  [APIMART_SEEDREAM_55_MODEL]: [...SEEDREAM_55_RATIOS, "custom"].map(value => ({ value, label: value === "custom" ? "自定义" : formatModelParamLabel(value) })),
  "nano-banana-pro-apimart": APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "nano-banana-2": NANO_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "nano-banana-2-lite": NANO_BANANA_2_LITE_ASPECT_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gemini-3.1-flash-image": NANO_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gemini-3.1-flash-lite-image": NANO_BANANA_2_LITE_ASPECT_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gemini-3-pro-image": NANO_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gpt-image-2": GPT_IMAGE_2_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [REAPI_GPT_IMAGE_25_MODEL_ID]: REAPI_GPT_IMAGE_25_RATIOS.map((value) => ({ label: value, value })),
  [AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID]: AICOMING_GPT_IMAGE_25_RATIOS.map((value) => ({ label: value, value })),
  [APIMART_GPT_IMAGE_25_MODEL_ID]: GPT_IMAGE_25_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [APIMART_GPT_IMAGE_26_MODEL_ID]: GPT_IMAGE_25_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gpt-image-2-apimart": GPT_IMAGE_2_APIMART_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gpt-image-2-jiekou": GPT_IMAGE_2_JIEKOU_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [REAPI_GPT_IMAGE_2_MODEL_ID]: REAPI_GPT_IMAGE_2_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "gpt-image-2-aicoming-haiya": AICOMING_HAIYA_GPT_IMAGE_2_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [TUZI_GPT_IMAGE_2_MODEL_ID]: TUZI_GPT_IMAGE_2_ASPECT_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [APIMART_MIDJOURNEY_V8_MODEL_ID]: MIDJOURNEY_V8_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [MIDJOURNEY_V8_MODEL_ID]: MIDJOURNEY_V8_RATIOS.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "image 2": EASYROUTER_IMAGE_2_ASPECT_RATIO_VALUES.map((v) => ({ label: v === "custom" ? "自定义" : formatModelParamLabel(v), value: v })),
  [DOUBAO_SEEDREAM_5_PRO_MODEL]: SEEDREAM_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  [DOUBAO_SEEDREAM_5_LITE_MODEL]: SEEDREAM_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "doubao-seedream-4.5": SEEDREAM_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v })),
  "doubao-seedream-4.0": SEEDREAM_ASPECT_RATIO_VALUES.map((v) => ({ label: formatModelParamLabel(v), value: v }))
};

const RESOLUTION_OPTIONS_BY_MODEL: Record<ImageModelValue, FrostedSelectOption[]> = {
  [GOOGLE_NANO_BANANA_21_MODEL]: GOOGLE_NANO_BANANA_21_RESOLUTIONS.map(value => ({ value, label: value })),
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RESOLUTIONS.map(value => ({ value, label: value })),
  "nano-banana-pro": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  [QWEN_IMAGE_21_MODEL_ID]: QWEN_IMAGE_21_RESOLUTIONS.map((value) => ({ label: value, value })),
  [VOLC_SEEDREAM_55_MODEL]: SEEDREAM_55_RESOLUTIONS.map(value => ({ value, label: value })),
  [APIMART_SEEDREAM_55_MODEL]: SEEDREAM_55_RESOLUTIONS.map(value => ({ value, label: value })),
  "nano-banana-pro-apimart": [
    ...APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES.map((value) => ({ label: value, value }))
  ],
  "nano-banana-2": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  "nano-banana-2-lite": [
    { label: "1K", value: "1K" }
  ],
  "gemini-3.1-flash-image": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  "gemini-3.1-flash-lite-image": [
    { label: "1K", value: "1K" }
  ],
  "gemini-3-pro-image": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  "gpt-image-2": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  [REAPI_GPT_IMAGE_25_MODEL_ID]: ["1K", "2K", "4K"].map((value) => ({ label: value, value })),
  [AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID]: ["1K", "2K", "4K"].map((value) => ({ label: value, value })),
  [APIMART_GPT_IMAGE_25_MODEL_ID]: ["1K", "2K", "4K"].map((value) => ({ label: value, value })),
  [APIMART_GPT_IMAGE_26_MODEL_ID]: ["1K", "2K", "4K"].map((value) => ({ label: value, value })),
  "gpt-image-2-apimart": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  "gpt-image-2-jiekou": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  [REAPI_GPT_IMAGE_2_MODEL_ID]: GPT_IMAGE_2_OFFICIAL_RESOLUTIONS.map((value) => ({ label: value, value })),
  "gpt-image-2-aicoming-haiya": GPT_IMAGE_2_OFFICIAL_RESOLUTIONS.map((value) => ({ label: value, value })),
  [TUZI_GPT_IMAGE_2_MODEL_ID]: TUZI_GPT_IMAGE_2_RESOLUTIONS.map((value) => ({ label: value, value })),
  "image 2": [
    ...EASYROUTER_IMAGE_2_RESOLUTIONS.map((value) => ({ label: value, value }))
  ],
  [DOUBAO_SEEDREAM_5_PRO_MODEL]: [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" }
  ],
  [DOUBAO_SEEDREAM_5_LITE_MODEL]: [
    { label: "2K", value: "2K" },
    { label: "3K", value: "3K" }
  ],
  "doubao-seedream-4.5": [
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ],
  "doubao-seedream-4.0": [
    { label: "1K", value: "1K" },
    { label: "2K", value: "2K" },
    { label: "4K", value: "4K" }
  ]
};

const MODEL_OPTIONS = IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => ({ label: model.label, value: model.id }));
const TASK_STYLE_OPTIONS: FrostedSelectOption[] = [
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
];
const PARALLEL_COUNT_OPTIONS: FrostedSelectOption[] = Array.from({ length: 8 }, (_, index) => {
  const value = String(index + 1);
  return { label: value + "张", value };
});

function isImageModelValue(value: string | null): value is ImageModelValue {
  return MODEL_OPTIONS.some((option) => option.value === value);
}

function isImageAspectRatioValue(value: string | null): value is string {
  return [...NANO_ASPECT_RATIO_VALUES, ...NANO_BANANA_2_LITE_ASPECT_RATIOS, ...GPT_IMAGE_2_ASPECT_RATIO_VALUES, ...EASYROUTER_IMAGE_2_ASPECT_RATIO_VALUES, ...GPT_IMAGE_2_APIMART_ASPECT_RATIO_VALUES, ...GPT_IMAGE_2_JIEKOU_ASPECT_RATIO_VALUES, ...REAPI_GPT_IMAGE_2_RATIOS, ...TUZI_GPT_IMAGE_2_ASPECT_RATIOS, ...MIDJOURNEY_V8_RATIOS, ...SEEDREAM_ASPECT_RATIO_VALUES].some((option) => option === value);
}

function isImageResolutionValue(value: string | null): value is string {
  return value === "512" || Object.values(RESOLUTION_OPTIONS_BY_MODEL).flat().some((option) => option.value === value);
}

function isJiekouSizeComboValid(aspectRatio: string, resolution: string) {
  if (aspectRatio === "auto") return true;
  const allowed: Record<string, string[]> = {
    "1K": ["1:1", "2:3", "3:2"],
    "2K": ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"],
    "4K": ["16:9", "9:16"],
  };
  return (allowed[resolution] || []).includes(aspectRatio);
}

function getAspectRatioOptions(model: ImageModelValue, resolution?: string) {
  if (isOpenRouterImageModel(model)) return getOpenRouterImageParams(model).aspectRatios.map(item => ({ ...item, disabled: false }));
  const options = (getGoogleImageOptions(model)?.ratios.map(value => ({ value, label: formatModelParamLabel(value), disabled: false })) || ASPECT_RATIO_OPTIONS_BY_MODEL[model]) || ASPECT_RATIO_OPTIONS_BY_MODEL["nano-banana-pro"];
  if (model === TUZI_GPT_IMAGE_2_MODEL_ID) {
    const selectedResolution = resolution || "2K";
    const visibleRatios = getTuziGptImage2Ratios(selectedResolution);
    return options.filter((option) => visibleRatios.includes(option.value)).map((option) => ({
      ...option,
      disabled: !isTuziGptImage2SizeComboValid(option.value, selectedResolution),
    }));
  }
  if (isGptImage2OfficialProviderModel(model)) {
    const selectedResolution = resolution || "2K";
    const visibleRatios = getGptImage2OfficialRatios(model, selectedResolution);
    return options.filter((option) => visibleRatios.includes(option.value)).map((option) => ({
      ...option,
      disabled: !isGptImage2OfficialSizeComboValid(model, option.value, selectedResolution),
    }));
  }
  if (model !== "gpt-image-2-jiekou") return options;
  const selectedResolution = resolution || "1K";
  return options.map((option) => ({
    ...option,
    disabled: !isJiekouSizeComboValid(option.value, selectedResolution),
  }));
}

function getResolutionOptions(model: ImageModelValue, aspectRatio?: string) {
  if (isOpenRouterImageModel(model)) return getOpenRouterImageParams(model, aspectRatio).resolutions.map(item => ({ ...item, disabled: false }));
  const options = (getGoogleImageOptions(model)?.resolutions.map(value => ({ value, label: value === "512" ? "512 (0.5K)" : value, disabled: false })) || RESOLUTION_OPTIONS_BY_MODEL[model]) || RESOLUTION_OPTIONS_BY_MODEL["nano-banana-pro"];
  if (model === TUZI_GPT_IMAGE_2_MODEL_ID) {
    const selectedAspectRatio = aspectRatio || "1:1";
    return options.map((option) => ({
      ...option,
      disabled: !isTuziGptImage2SizeComboValid(selectedAspectRatio, option.value),
    }));
  }
  if (isGptImage2OfficialProviderModel(model)) {
    const selectedAspectRatio = aspectRatio || "1:1";
    return options.map((option) => ({
      ...option,
      disabled: !isGptImage2OfficialSizeComboValid(model, selectedAspectRatio, option.value),
    }));
  }
  if (model !== "gpt-image-2-jiekou") return options;
  const selectedAspectRatio = aspectRatio || "1:1";
  return options.map((option) => ({
    ...option,
    disabled: !isJiekouSizeComboValid(selectedAspectRatio, option.value),
  }));
}

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export default function ImagePage({
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
  const { user, loading: authLoading, openLoginModal } = useAuth()
  const desktopMode = useDesktopMode();
  const { text, locale, generationLabel, parameterLabel, error: localizeError, label: localizeLabel } = useCreateLocalization();
  const imageCountLabel = (count: string | number) => {
    const number = Number(count);
    const displayCount = locale === "en" ? new Intl.NumberFormat("en").format(number) : count;
    return number === 1
      ? text("createDynamic.imageCountSingle", { count: displayCount })
      : text("createDynamic.m2d48bec84927", { count: displayCount });
  };
  const [userId, setUserId] = React.useState("");
  const [items, setItems] = React.useState<MultiUploadItem[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState<ImageModelValue>("nano-banana-pro");
  const [aspectRatio, setAspectRatio] = React.useState("auto");
  const [resolution, setResolution] = React.useState("2K");
  const [customSize, setCustomSize] = React.useState("1024x1024");
  const [taskStyle, setTaskStyle] = React.useState("medium");
  const [parallelCount, setParallelCount] = React.useState("1");
  const [outputQuantity, setOutputQuantity] = React.useState(1);
  const [midjourneySpeed, setMidjourneySpeed] = React.useState<MidjourneyV8Speed>("relax");
  const [midjourneyOptions, setMidjourneyOptions] = React.useState<MidjourneyV8Options>({});
  const [seedreamOutputMode, setSeedreamOutputMode] = React.useState<"single" | "group">("single");
  const [seedreamOutputCount, setSeedreamOutputCount] = React.useState("4");
  const [parameterPanelOpen, setParameterPanelOpen] = React.useState<"model" | "params" | null>(null);
  const [parameterPanelStyle, setParameterPanelStyle] = React.useState<React.CSSProperties | null>(null);
  const [officialQuality, setOfficialQuality] = React.useState<"standard" | "pro" | "auto" | "low" | "medium" | "high" | "xhigh" | "max">("auto");
  const [gptImage25Mode, setGptImage25Mode] = React.useState("flare");
  const [officialOutputCount, setOfficialOutputCount] = React.useState("1");
  const [googleThinkingLevel, setGoogleThinkingLevel] = React.useState("");
  const [googleSearchMode, setGoogleSearchMode] = React.useState("off");
  const googleSettings = normalizeGoogleImageSettings(model, { googleThinkingLevel, googleSearchMode });
  const [officialBackground, setOfficialBackground] = React.useState<"auto" | "opaque" | "transparent">("auto");
  const [officialModeration, setOfficialModeration] = React.useState<"auto" | "low">("low");
  const [officialOutputFormat, setOfficialOutputFormat] = React.useState<"png" | "jpeg" | "webp" | "gif">("png");
  const [gifSize, setGifSize] = React.useState("512x512");
  const [frameCount, setFrameCount] = React.useState(9);
  const [seedream55, setSeedream55] = React.useState<Seedream55Settings>({});
  const [frameDurationMs, setFrameDurationMs] = React.useState(200);
  const [officialOutputCompression, setOfficialOutputCompression] = React.useState("80");
  const [nanoOfficialSeed, setNanoOfficialSeed] = React.useState("");
  const [visibleModelOptions, setVisibleModelOptions] = React.useState<FrostedSelectOption[]>([]);
  const [modelsSettled, setModelsSettled] = React.useState(false);
  const [modelsConfirmed, setModelsConfirmed] = React.useState(false);
  const [submissionPhase, setSubmissionPhase] = React.useState<GenerationSubmissionPhase>("idle");
  const loading = submissionPhase !== "idle";
  const [error, setError] = React.useState<FriendlyUiError | null>(null);
  const [inlineNotice, setInlineNotice] = React.useState<string | null>(null);
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [skillLibraryEntry, setSkillLibraryEntry] = React.useState<{
    view: "browse" | "create" | "detail";
    skill?: RoleSkillListItem;
  }>({ view: "browse" });
  const [toolboxRoleSkill, setToolboxRoleSkill] = React.useState<RoleSkillListItem | null>(null);
  const {
    systemPrompt,
    reversePrompt,
    reversePromptApplied,
    activeReverseTaskId,
    continuation,
    selectedRoleSkillId,
    resultRoleSkill,
    setSystemPrompt,
    setReversePrompt,
    setReversePromptApplied,
    setActiveReverseTaskId,
    setResultRoleSkill,
    saveNow: saveRoleDraftNow,
    saveError: roleDraftError,
    hydrated: roleDraftHydrated,
  } = useAccountRolePositioningDraft({
    userId,
    surface: "toolbox_image",
    legacyStorageKey: userId ? "prompt_reverse_panel_v1_" + userId : "",
    persistSelectedRoleSkillId: false,
  });
  const [reverseLoading, setReverseLoading] = React.useState(false);
  const [reverseError, setReverseError] = React.useState<string | null>(null);
  const [reverseTasks, setReverseTasks] = React.useState<PromptReverseTaskItem[]>([]);
  const [promptPanelOpen, setPromptPanelOpen] = React.useState(false);
  const [promptEditorHost, setPromptEditorHost] = React.useState<HTMLDivElement | null>(null);
  const [promptPanelRect, setPromptPanelRect] = React.useState<FloatingPanelRect | null>(null);
  const promptRef = React.useRef(prompt);
  const reversePromptRef = React.useRef(reversePrompt);
  const activeReverseTaskIdRef = React.useRef(activeReverseTaskId);
  const loadingRef = React.useRef(loading);
  const generationSubmitInFlightRef = React.useRef(false);
  const resumedToolboxContinuationRef = React.useRef("");
  const promptSourceRef = React.useRef<HTMLDivElement | null>(null);
  const promptPanelRef = React.useRef<HTMLDivElement | null>(null);
  const parameterDockRef = React.useRef<HTMLDivElement | null>(null);
  const parameterPanelRef = React.useRef<HTMLDivElement | null>(null);
  const parameterModelListRef = React.useRef<HTMLDivElement | null>(null);
  const selectedModelOptionRef = React.useRef<HTMLButtonElement | null>(null);
  const modelPanelAutoScrolledRef = React.useRef(false);
  const parameterModelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const parameterParamsButtonRef = React.useRef<HTMLButtonElement | null>(null);
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
  const [localHistoryFocusId, setLocalHistoryFocusId] = React.useState<string | null>(null);
  const historyCount = sharedHistory?.historyCount ?? localHistoryCount;
  const setHistoryCount = sharedHistory?.setHistoryCount ?? setLocalHistoryCount;
  const historyFocusId = sharedHistory?.historyFocusId ?? localHistoryFocusId;
  const setHistoryFocusId = sharedHistory?.setHistoryFocusId ?? setLocalHistoryFocusId;

  const uploadingRef = React.useRef<WeakSet<File>>(new WeakSet());
  const importingUrlRef = React.useRef<Set<string>>(new Set());
  const itemsRef = React.useRef(items);
  const authenticatedUserId = user?.id ? String(user.id) : "";
  const authenticatedUserIdRef = React.useRef(authenticatedUserId);
  authenticatedUserIdRef.current = authenticatedUserId;
  const [workspaceDraftHydrated, setWorkspaceDraftHydrated] = React.useState(false);
  const [workspaceDraftWritable, setWorkspaceDraftWritable] = React.useState(false);
  const [workspaceDisplayCacheRestored, setWorkspaceDisplayCacheRestored] = React.useState(false);
  const workspaceBackupKey = userId ? `tool_workspace_draft_backup_v1:image:${userId}` : "";
  const workspaceDisplayCacheKey = userId ? `tool_workspace_display_cache_v1:image:${userId}` : "";
  const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable || !modelsConfirmed);
  const workspaceDraftOwnerRef = React.useRef("");
  const workspaceDraftVersionRef = React.useRef(0);
  const workspaceDraftFingerprintRef = React.useRef("");
  const workspaceDraftSnapshotRef = React.useRef<ImageWorkspaceSnapshot | null>(null);
  const workspaceDraftSaveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const workspaceMediaMutationQueueRef = React.useRef(createWorkspaceMediaQueue());
  const ephemeralMediaSessionRef = React.useRef("");
  const [toolMediaUploadCommits, setToolMediaUploadCommits] = React.useState<ToolMediaUploadCommit[]>([]);

  const aspectRatioOptions = React.useMemo(() => getAspectRatioOptions(model, resolution), [model, resolution]);
  const resolutionOptions = React.useMemo(() => getResolutionOptions(model, aspectRatio), [model, aspectRatio]);
  const modelOptions = React.useMemo(() => expandGptImage25ModelOptions(visibleModelOptions), [visibleModelOptions]);
  const selectedModelValue = getGptImage25SelectionValue(model, gptImage25Mode);
  React.useEffect(() => {
    if (!isGptImageVariantModel(model) || modelOptions.some((option) => option.value === selectedModelValue)) return;
    const available = modelOptions.map((option) => resolveGptImage25Selection(option.value)).find((option) => option.model === model);
    if (available?.gptImage25Mode) setGptImage25Mode(available.gptImage25Mode);
  }, [model, modelOptions, selectedModelValue]);
  const resolutionDisabled = false;
  const isSeedreamSelected =
    model === DOUBAO_SEEDREAM_5_PRO_MODEL || model === DOUBAO_SEEDREAM_5_LITE_MODEL || model === "doubao-seedream-4.5" || model === "doubao-seedream-4.0";
  const isSeedreamProSelected = model === DOUBAO_SEEDREAM_5_PRO_MODEL;
  const isSeedreamLiteSelected = model === DOUBAO_SEEDREAM_5_LITE_MODEL;
  const isSeedreamSequentialSelected = isSeedreamSelected && !isSeedreamProSelected;
  const gifOutput = supportsGptImage26Gif(model) && officialOutputFormat === "gif";
  const isGptImage25Selected = isGptImageVariantModel(model);
  const isGptImage2ApimartSelected = model === "gpt-image-2-apimart";
  const isJiekouGptImage2Selected = model === "gpt-image-2-jiekou";
  const isReapiGptImage2Selected = model === REAPI_GPT_IMAGE_2_MODEL_ID;
  const isAicomingHaiyaGptImage2Selected = model === AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID;
  const isGptImage2OfficialProviderSelected = isReapiGptImage2Selected || isAicomingHaiyaGptImage2Selected;
  const isEasyRouterImage2Selected = model === "image 2";
  const isTuziGptImage2Selected = model === TUZI_GPT_IMAGE_2_MODEL_ID;
  const isMidjourneyV8Selected = isMidjourneyV8Model(model);
  const isQwenImage3Selected = isQwenImage3Model(model);
  const isOfficialParamsSelected = (isOpenRouterImageModel(model) && getOpenRouterImageParams(model).qualities.length > 0) || isQwenImage3Selected || isGptImage25Selected || isGptImage2ApimartSelected || isJiekouGptImage2Selected || isEasyRouterImage2Selected || isGptImage2OfficialProviderSelected || isTuziGptImage2Selected;
  const officialQualityOptions = isOpenRouterImageModel(model) ? getOpenRouterImageParams(model).qualities : isQwenImage3Selected ? QWEN_IMAGE_3_QUALITIES : isGptImage25Selected ? getGptImage25QualityOptions(model) : isJiekouGptImage2Selected || isTuziGptImage2Selected
    ? [
        { label: "低", value: "low" },
        { label: "标准", value: "medium" },
        { label: "高", value: "high" },
      ]
    : [
        { label: "自适应", value: "auto" },
        { label: "低", value: "low" },
        { label: "标准", value: "medium" },
        { label: "高", value: "high" },
      ];
  const officialCountOptions = React.useMemo(
    () =>
      Array.from({ length: isTuziGptImage2Selected ? 1 : isJiekouGptImage2Selected ? 10 : 4 }, (_, index) => {
        const value = String(index + 1);
        return { label: value, value };
      }),
    [isJiekouGptImage2Selected, isTuziGptImage2Selected]
  );
  const officialOutputFormatOptions = isTuziGptImage2Selected
    ? [{ label: "PNG", value: "png" }]
    : isJiekouGptImage2Selected
    ? [
        { label: "PNG", value: "png" },
        { label: "JPEG", value: "jpeg" },
      ]
    : [
        { label: "PNG", value: "png" },
        { label: "JPEG", value: "jpeg" },
        { label: "WebP", value: "webp" },
      ];
  const { logAction } = useLogger();
  const generateHotkey = useGenerateHotkey();
  const generateHotkeySpec = React.useMemo(() => parseHotkeyString(generateHotkey), [generateHotkey]);
  const hasPendingUploads = React.useMemo(
    () => hasPendingToolMediaUploads(items, (it) => !it.mediaId && !it.file && needsImportToImports(it.url)),
    [items]
  );
  const hasFailedUploads = React.useMemo(
    () => hasFailedToolMediaUploads(items),
    [items]
  );
  const hasRunningReverseTask = React.useMemo(
    () => reverseTasks.some(isPromptReverseTaskRunning),
    [reverseTasks]
  );
  const effectiveSubmissionPhase =
    submissionPhase === "idle" && (reverseLoading || hasRunningReverseTask)
      ? "enhancing"
      : submissionPhase;
  const hasPromptOrSkill = Boolean(prompt.trim() || selectedRoleSkillId || (isSeedream55Model(model) && seedream55.layerDecomposition));
  const generateButtonState = React.useMemo(() => {
    if (!userId) return { disabled: true, label: "生成" };
    if (!modelOptions.length) return { disabled: true, label: "暂无可用模型" };
    const state = getToolMediaGenerateButtonState({
      items,
      phase: effectiveSubmissionPhase,
      hasPrompt: hasPromptOrSkill,
      isLegacyPending: (it) => !it.mediaId && !it.file && needsImportToImports(it.url),
    });
    if (modelsConfirmed && workspaceDraftHydrated && workspaceDraftWritable) return state;
    return {
      disabled: true,
      label: !modelsConfirmed ? "生成" : workspaceDraftHydrated ? "草稿服务暂时不可用" : "正在加载草稿…",
    };
  }, [effectiveSubmissionPhase, hasPromptOrSkill, items, modelOptions.length, modelsConfirmed, userId, workspaceDraftHydrated, workspaceDraftWritable]);
  const promptAssets = React.useMemo<PromptReferenceAsset[]>(
    () =>
      items
        .flatMap((item, index) => {
          const url = typeof item.url === "string" ? item.url : "";
          if (!url) return [];
          return [{
            id: "image-" + String(item.uploadRequestId || item.mediaId || url),
            token: "图片" + (index + 1),
            kind: "image" as const,
            url,
            name: item.file?.name || basenameFromPath(url) || "图片" + (index + 1),
          }];
        }),
    [items]
  );

  useIsoLayoutEffect(() => {
    setUserId(authenticatedUserId);
  }, [authenticatedUserId]);

  useIsoLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    const active = !studioNav || studioNav.activeTool === "image";
    if (!active) return;
    try {
      localStorage.setItem("studio_last_tool_v1", "image");
    } catch {}
  }, [studioNav]);
  const isActive = !studioNav || studioNav.activeTool === "image";
  const {
    skills: roleSkills,
    loading: roleSkillsLoading,
    error: roleSkillsError,
  } = useRoleSkillCatalog({
    authUserId: userId,
    enabled: isActive && Boolean(userId),
    mediaType: "image",
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
    let cancelled = false;
    if (!selectedRoleSkillId) {
      setToolboxRoleSkill(null);
      return () => {
        cancelled = true;
      };
    }
    if (toolboxRoleSkill?.id === selectedRoleSkillId) {
      return () => {
        cancelled = true;
      };
    }
    void listRoleSkills()
      .then((skills) => {
        if (cancelled) return;
        const selectedSkill = skills.find((skill) => (
          skill.id === selectedRoleSkillId && skill.mediaType === "image"
        ));
        if (selectedSkill) {
          setToolboxRoleSkill(selectedSkill);
        } else {
          clearToolboxRoleSkillSelection();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clearToolboxRoleSkillSelection, selectedRoleSkillId, toolboxRoleSkill?.id]);
  React.useEffect(() => {
    if (userId && isActive) {
      logAction("page_view", "visit image page", { page: "/image" });
    }
  }, [userId, isActive, logAction]);
  React.useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    setModelsSettled(false);
    setModelsConfirmed(false);
    const loadModels = async (initial: boolean) => {
      const currentRequestId = ++requestId;
      try {
        const json = await loadImageModelCatalog({ refresh: !initial });
        if (cancelled || currentRequestId !== requestId) return;
        const visibleModels = Array.isArray(json?.models) ? json.models : null;
        const visibleIds = visibleModels
          ? new Set(visibleModels.map((item: any) => String(item?.id || "").trim()).filter(Boolean))
          : null;
        const visibleLabels = new Map<string, string>(
          (visibleModels || []).map((item: any) => [
            String(item?.id || "").trim(),
            String(item?.label || "").trim(),
          ]),
        );
        if (!visibleIds) {
          if (initial) {
            setVisibleModelOptions([]);
            setModelsConfirmed(false);
          }
          return;
        }
        const nextOptions = MODEL_OPTIONS
          .filter((option) => visibleIds.has(option.value))
          .map((option) => ({
            ...option,
            label: visibleLabels.get(option.value) || option.label,
            gptImage25Variants: visibleModels?.find((item: any) => item.id === option.value)?.gptImage25Variants,
          }));
        setVisibleModelOptions(nextOptions);
        setModelsConfirmed(true);
        const currentUserId = authenticatedUserIdRef.current;
        const currentDisplayCacheKey = currentUserId ? `tool_workspace_display_cache_v1:image:${currentUserId}` : "";
        if (currentDisplayCacheKey) {
          try {
            updateImageWorkspaceDisplayCache(localStorage, currentDisplayCacheKey, {
              userId: currentUserId,
              visibleModelIds: nextOptions.map((option) => option.value),
            });
          } catch {}
        }
        if (nextOptions.length) setModel((current) => (
          nextOptions.some((option) => option.value === current)
            ? current
            : nextOptions[0].value as ImageModelValue
        ));
      } catch {
        if (cancelled || currentRequestId !== requestId) return;
        if (!initial) return;
        setVisibleModelOptions([]);
        setModelsConfirmed(false);
      } finally {
        if (!cancelled && currentRequestId === requestId) setModelsSettled(true);
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

  React.useEffect(() => {
    if (isImageWorkspaceDisplayReady({
      authLoading,
      userId,
      displayCacheRestored: workspaceDisplayCacheRestored,
      modelsSettled,
      workspaceDraftHydrated,
    })) onInitialReady?.();
  }, [authLoading, modelsSettled, onInitialReady, userId, workspaceDisplayCacheRestored, workspaceDraftHydrated]);

  const applyStoredImageTemplate = React.useCallback(() => {
    if (!userId || !workspaceDraftHydrated) return;
    try {
      const parsed = takeEphemeralToolTemplate<Record<string, any>>("image", userId);
      if (!parsed) return;
      clearToolboxRoleSkillSelection();
      if (typeof parsed?.prompt === "string") setPrompt(parsed.prompt);
      if (typeof parsed?.model === "string") {
        const ok = MODEL_OPTIONS.some((o) => o.value === parsed.model);
        if (ok) setModel(parsed.model as ImageModelValue);
      }
      if (typeof parsed?.aspectRatio === "string") {
        const ok = isImageAspectRatioValue(parsed.aspectRatio);
        if (ok) setAspectRatio(parsed.aspectRatio);
      }
      if (typeof parsed?.resolution === "string") {
        const ok = isImageResolutionValue(parsed.resolution);
        if (ok) setResolution(parsed.resolution);
      }
      if (typeof parsed?.customSize === "string") setCustomSize(parsed.customSize);
      if (typeof parsed?.taskStyle === "string" && TASK_STYLE_OPTIONS.some((option) => option.value === parsed.taskStyle)) {
        setTaskStyle(parsed.taskStyle);
      }
      if (typeof parsed?.parallelCount === "string" && PARALLEL_COUNT_OPTIONS.some((option) => option.value === parsed.parallelCount)) {
        setParallelCount(parsed.parallelCount);
      }
      if (parsed?.outputQuantity !== undefined) {
        setOutputQuantity(normalizeOutputQuantity(parsed.outputQuantity));
      }
      if (MIDJOURNEY_V8_SPEEDS.includes(parsed?.midjourneySpeed)) setMidjourneySpeed(parsed.midjourneySpeed);
      if (parsed?.midjourneyOptions) setMidjourneyOptions(normalizeMidjourneyV8Options(parsed.midjourneyOptions).options);
      if (parsed?.seedreamOutputMode === "single" || parsed?.seedreamOutputMode === "group") setSeedreamOutputMode(parsed.seedreamOutputMode);
      if (typeof parsed?.seedreamOutputCount === "string" && parsed.seedreamOutputCount) setSeedreamOutputCount(parsed.seedreamOutputCount);
      if (parsed?.gptImage25Mode === "flare" || parsed?.gptImage25Mode === "sunburst") setGptImage25Mode(parsed.gptImage25Mode);
      if (parsed?.officialQuality === "standard" || parsed?.officialQuality === "pro" || parsed?.officialQuality === "xhigh" || parsed?.officialQuality === "max" || parsed?.officialQuality === "auto" || parsed?.officialQuality === "low" || parsed?.officialQuality === "medium" || parsed?.officialQuality === "high") {
        setOfficialQuality(parsed.officialQuality);
      }
      if (typeof parsed?.officialOutputCount === "string" && parsed.officialOutputCount) setOfficialOutputCount(parsed.officialOutputCount);
      setGoogleThinkingLevel(typeof parsed?.googleThinkingLevel === "string" ? parsed.googleThinkingLevel : "");
      setGoogleSearchMode(typeof parsed?.googleSearchMode === "string" ? parsed.googleSearchMode : "off");
      if (parsed?.officialBackground === "transparent" || parsed?.officialBackground === "auto" || parsed?.officialBackground === "opaque") setOfficialBackground(parsed.officialBackground);
      if (parsed?.officialModeration === "auto" || parsed?.officialModeration === "low") setOfficialModeration(parsed.officialModeration);
      if (parsed?.officialOutputFormat === "png" || parsed?.officialOutputFormat === "jpeg" || parsed?.officialOutputFormat === "webp" || parsed?.officialOutputFormat === "gif") {
        setOfficialOutputFormat(parsed.officialOutputFormat);
        setGifSize(typeof parsed.gifSize === "string" ? parsed.gifSize : "512x512");
        setFrameCount(typeof parsed.frameCount === "number" ? parsed.frameCount : 9);
        setSeedream55(parsed.seedream55 || {});
        setFrameDurationMs(typeof parsed.frameDurationMs === "number" ? parsed.frameDurationMs : 200);
      }
      if (typeof parsed?.officialOutputCompression === "string" && parsed.officialOutputCompression) {
        setOfficialOutputCompression(parsed.officialOutputCompression);
      }
      if (typeof parsed?.nanoOfficialSeed === "string") setNanoOfficialSeed(parsed.nanoOfficialSeed);
      const imagePaths = Array.isArray(parsed?.imagePaths)
        ? parsed.imagePaths
        : typeof parsed?.imagePath === "string"
          ? [parsed.imagePath]
          : [];
      setItems(restoreToolMediaTemplateItems({
        inputMedia: parsed?.inputMedia,
        imagePaths,
      }));
    } catch {}
  }, [clearToolboxRoleSkillSelection, workspaceDraftHydrated, userId]);
  React.useEffect(() => {
    if (!isActive || !userId) return;
    applyStoredImageTemplate();
  }, [applyStoredImageTemplate, isActive, userId]);
  React.useEffect(() => {
    if (!userId) return;
    const onApplyTemplate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>)?.detail || {};
      if (detail.userId && detail.userId !== userId) return;
      applyStoredImageTemplate();
    };
    window.addEventListener("studio:apply-image-template", onApplyTemplate as EventListener);
    return () => {
      window.removeEventListener("studio:apply-image-template", onApplyTemplate as EventListener);
    };
  }, [applyStoredImageTemplate, userId]);
  React.useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);
  React.useEffect(() => {
    reversePromptRef.current = reversePrompt;
  }, [reversePrompt]);
  React.useEffect(() => {
    activeReverseTaskIdRef.current = activeReverseTaskId;
  }, [activeReverseTaskId]);
  React.useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const queueImageMediaReleases = React.useCallback((mediaIds: string[]) => {
    const draftSessionId = ephemeralMediaSessionRef.current;
    const uniqueMediaIds = Array.from(new Set(mediaIds.filter(Boolean)));
    if (!draftSessionId || !uniqueMediaIds.length) return workspaceMediaMutationQueueRef.current.idle;
    const mutation = async () => {
      await releaseEphemeralToolMedia({ draftSessionId, mediaIds: uniqueMediaIds });
    };
    const queued = workspaceMediaMutationQueueRef.current.enqueueMutation(mutation);
    return queued;
  }, []);

  const handleImageItemsChange = React.useCallback((nextItems: MultiUploadItem[]) => {
    if (!workspaceDraftHydrated) return;
    setItems((previousItems) => {
      const removedMediaIds = removedToolMediaIds(previousItems, nextItems);
      if (removedMediaIds.length) {
        void queueImageMediaReleases(removedMediaIds).catch(() => undefined);
      }
      return nextItems;
    });
  }, [queueImageMediaReleases, workspaceDraftHydrated]);

  React.useEffect(() => {
    if (userId) return;
    setItems([]);
    setPrompt("");
    setSystemPrompt("");
    setReversePrompt("");
    setReversePromptApplied(false);
    setReverseTasks([]);
    setActiveReverseTaskId(null);
    clearToolboxRoleSkillSelection();
    setResultRoleSkill(null);
  }, [clearToolboxRoleSkillSelection, userId]);

  const applyImageWorkspaceDraft = React.useCallback((draft: Pick<ToolWorkspaceDraftDto, "payload"> | null) => {
    const state = (draft?.payload?.state && typeof draft.payload.state === "object" && !Array.isArray(draft.payload.state))
      ? draft.payload.state as Record<string, unknown>
      : {};
    if (typeof state.model === "string" && MODEL_OPTIONS.some((option) => option.value === state.model)) setModel(state.model as ImageModelValue); else setModel("nano-banana-pro");
    if (typeof state.aspectRatio === "string" && isImageAspectRatioValue(state.aspectRatio)) setAspectRatio(state.aspectRatio); else setAspectRatio("auto");
    if (typeof state.resolution === "string" && isImageResolutionValue(state.resolution)) setResolution(state.resolution); else setResolution("2K");
    setCustomSize(typeof state.customSize === "string" ? state.customSize : "1024x1024");
    setTaskStyle(typeof state.taskStyle === "string" && TASK_STYLE_OPTIONS.some((option) => option.value === state.taskStyle) ? state.taskStyle : "medium");
    setParallelCount(typeof state.parallelCount === "string" && PARALLEL_COUNT_OPTIONS.some((option) => option.value === state.parallelCount) ? state.parallelCount : "1");
    setOutputQuantity(normalizeOutputQuantity(state.outputQuantity));
    setMidjourneySpeed(MIDJOURNEY_V8_SPEEDS.includes(state.midjourneySpeed as MidjourneyV8Speed) ? state.midjourneySpeed as MidjourneyV8Speed : "relax");
    setMidjourneyOptions(normalizeMidjourneyV8Options((state as { midjourneyOptions?: unknown }).midjourneyOptions).options);
    setSeedreamOutputMode(state.seedreamOutputMode === "group" ? "group" : "single");
    setSeedreamOutputCount(typeof state.seedreamOutputCount === "string" && state.seedreamOutputCount ? state.seedreamOutputCount : "4");
    setGptImage25Mode(state.gptImage25Mode === "sunburst" ? "sunburst" : "flare");
    setOfficialQuality(state.officialQuality === "standard" || state.officialQuality === "pro" || state.officialQuality === "xhigh" || state.officialQuality === "max" || state.officialQuality === "low" || state.officialQuality === "medium" || state.officialQuality === "high" ? state.officialQuality : "auto");
    setOfficialOutputCount(typeof state.officialOutputCount === "string" && state.officialOutputCount ? state.officialOutputCount : "1");
    setGoogleThinkingLevel(typeof state.googleThinkingLevel === "string" ? state.googleThinkingLevel : "");
    setGoogleSearchMode(typeof state.googleSearchMode === "string" ? state.googleSearchMode : "off");
    setOfficialBackground(state.officialBackground === "transparent" ? "transparent" : state.officialBackground === "opaque" ? "opaque" : "auto");
    setOfficialModeration(state.officialModeration === "auto" ? "auto" : "low");
    setOfficialOutputFormat(state.officialOutputFormat === "jpeg" || state.officialOutputFormat === "webp" || state.officialOutputFormat === "gif" ? state.officialOutputFormat : "png");
    setGifSize(typeof state.gifSize === "string" ? state.gifSize : "512x512");
    setFrameCount(typeof state.frameCount === "number" ? state.frameCount : 9);
    setSeedream55(state.seedream55 || {});
    setFrameDurationMs(typeof state.frameDurationMs === "number" ? state.frameDurationMs : 200);
    setOfficialOutputCompression(typeof state.officialOutputCompression === "string" && state.officialOutputCompression ? state.officialOutputCompression : "80");
    setNanoOfficialSeed(typeof state.nanoOfficialSeed === "string" ? state.nanoOfficialSeed : "");

  }, []);

  useIsoLayoutEffect(() => {
    setWorkspaceDisplayCacheRestored(false);
    if (!userId || !workspaceDisplayCacheKey) return;
    const cached = readImageWorkspaceDisplayCache(localStorage, workspaceDisplayCacheKey, userId);
    if (!cached) {
      applyImageWorkspaceDraft(null);
      setVisibleModelOptions([]);
      return;
    }
    applyImageWorkspaceDraft(cached.draft);
    const cachedModelIds = new Set(cached.visibleModelIds);
    setVisibleModelOptions(MODEL_OPTIONS.filter((option) => cachedModelIds.has(option.value)));
    setWorkspaceDisplayCacheRestored(true);
  }, [applyImageWorkspaceDraft, userId, workspaceDisplayCacheKey]);

  React.useEffect(() => {
    let cancelled = false;
    setWorkspaceDraftHydrated(false);
    setWorkspaceDraftWritable(false);
    setToolMediaUploadCommits([]);
    workspaceDraftOwnerRef.current = userId;
    workspaceDraftVersionRef.current = 0;
    workspaceDraftFingerprintRef.current = "";
    if (!userId) return () => { cancelled = true; };

    const desktopDraft = readDesktopInputDraft<ImageEphemeralInputDraft>(desktopMode, "toolbox:image", userId);
    const remembered = desktopDraft || ephemeralInputDraftRegistry.read<ImageEphemeralInputDraft>(
      "toolbox:image",
      userId,
    );
    const draftSessionId = remembered?.draftSessionId || createToolClientUuid();
    ephemeralMediaSessionRef.current = draftSessionId;
    setPrompt(remembered?.prompt || "");

    const restoreItems = (restoredItems: MultiUploadItem[]) => {
      setItems(restoredItems);
    };
    if (!desktopDraft) restoreItems(remembered?.items || []);
    const restoredMedia = desktopDraft
      ? recoverDesktopDraftMedia(draftSessionId, desktopDraft.items)
      : null;

    const hydrate = async () => {
      const pendingSave = pendingWorkspaceNavigationSave("image", userId);
      try {
        await pendingSave;
        let draft = pendingSave ? await fetchToolWorkspaceDraft("image") : await fetchImageDraftForEntry(userId);
        if (!draft) {
          const legacy = readLegacyToolWorkspaceMigration({
            tool: "image",
            userId,
            localStorage,
            sessionStorage,
          });
          if (legacy) {
            draft = await patchToolWorkspaceDraft("image", {
              accountGuardUserId: userId,
              expectedVersion: 0,
              payload: legacy.payload,
              media: legacy.media,
            });
          }
        }
        if (cancelled || authenticatedUserIdRef.current !== userId) return;
        applyImageWorkspaceDraft(desktopDraft?.workspacePayload ? { payload: desktopDraft.workspacePayload } : draft);
        if (workspaceDisplayCacheKey) {
          try {
            updateImageWorkspaceDisplayCache(localStorage, workspaceDisplayCacheKey, { userId, draft });
          } catch {}
        }
        workspaceDraftVersionRef.current = draft?.version || 0;
        workspaceDraftFingerprintRef.current = draft
          ? workspaceDraftFingerprint(
              draft.payload,
              draft.media.map((item) => ({ mediaId: item.mediaId, position: item.position })),
            )
          : "";
        setWorkspaceDraftWritable(true);
      } catch {
        if (cancelled || authenticatedUserIdRef.current !== userId) return;
        const displayCache = workspaceDisplayCacheKey
          ? readImageWorkspaceDisplayCache(localStorage, workspaceDisplayCacheKey, userId)
          : null;
        const backup = workspaceBackupKey ? readLocalWorkspaceDraftBackup(localStorage, workspaceBackupKey) : null;
        if (desktopDraft?.workspacePayload) {
          applyImageWorkspaceDraft({ payload: desktopDraft.workspacePayload });
        } else if (displayCache) {
          applyImageWorkspaceDraft(displayCache.draft);
          setWorkspaceDisplayCacheRestored(true);
        } else {
          applyImageWorkspaceDraft(backup ? { payload: backup.payload } : null);
        }
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
  }, [applyImageWorkspaceDraft, desktopMode, userId, workspaceBackupKey, workspaceDisplayCacheKey]);

  const loadPromptReverseTasks = React.useCallback(async (silent = false) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/prompt-reverse?limit=50&surface=toolbox_image", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || "角色提示词记录加载失败"));
      }
      const tasks = Array.isArray(data?.tasks) ? data.tasks as PromptReverseTaskItem[] : [];
      setReverseTasks(tasks);

      const activeId = activeReverseTaskIdRef.current;
      const activeTask = activeId ? tasks.find((task) => task.id === activeId) : null;
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

      if (!activeId) return;
    } catch (e: any) {
      if (!silent) setReverseError(String(e?.message || "角色提示词记录加载失败"));
    }
  }, [userId]);

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
      || continuation?.kind !== "toolbox_image_generation"
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

  React.useEffect(() => {
    if (!isActive || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextModel = params.get("model");
    const nextAspectRatio = params.get("aspectRatio");
    const nextResolution = params.get("resolution");

    if (isImageModelValue(nextModel)) setModel(nextModel);
    if (isImageAspectRatioValue(nextAspectRatio)) setAspectRatio(nextAspectRatio);
    if (isImageResolutionValue(nextResolution)) setResolution(nextResolution);
  }, [isActive]);

  React.useEffect(() => {
    const current = aspectRatioOptions.find((o) => o.value === aspectRatio);
    if (current && !current.disabled) return;
    const fallback = isQwenImage21Model(model) ? "3:4" : aspectRatioOptions.find((o) => !o.disabled)?.value || "1:1";
    if (fallback !== aspectRatio) setAspectRatio(fallback);
  }, [aspectRatio, aspectRatioOptions, model]);

  React.useEffect(() => {
    const current = resolutionOptions.find((o) => o.value === resolution);
    if (current && !current.disabled) return;
    const fallback = resolutionOptions.find((o) => !o.disabled)?.value || "1K";
    if (fallback !== resolution) setResolution(fallback);
  }, [resolution, resolutionOptions]);

  const renderAspectLeading = React.useCallback((opt: FrostedSelectOption, _ctx: FrostedSelectLeadingContext) => {
    const raw = opt.value;
    const compact = _ctx.placement === "button";
    const size = compact ? 14 : 20;
    const previewSize = getAspectRatioPreviewSize(raw, size);
    if (raw === "auto") {
      return (
        <span className={(compact ? "h-4 w-4" : "h-5 w-[32px]") + " flex items-center justify-center"}>
          <span
            style={previewSize}
            className="flex items-center justify-center rounded-[3px] border border-[var(--app-muted)] bg-transparent text-[10px] font-semibold text-[var(--app-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-white/20"
          />
        </span>
      );
    }
    return (
      <span className={(compact ? "h-4 w-4" : "h-5 w-[32px]") + " flex items-center justify-center"}>
        <span
          style={previewSize}
          className="block rounded-[3px] border border-[var(--app-muted)] bg-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-white/20"
        />
      </span>
    );
  }, []);

  useIsoLayoutEffect(() => {
    if (!parameterPanelOpen || typeof window === "undefined") {
      setParameterPanelStyle(null);
      return;
    }
    const anchor = parameterPanelOpen === "model"
      ? parameterModelButtonRef.current
      : parameterParamsButtonRef.current;
    if (!anchor) return;
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const dockRect = parameterDockRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = Math.min(parameterPanelOpen === "params" ? 380 : 320, Math.max(240, viewportWidth - 112));
      const left =
        parameterPanelOpen === "params"
          ? Math.min(Math.max(8, (dockRect?.right ?? rect.right) - width), viewportWidth - width - 8)
          : Math.min(Math.max(8, rect.left), viewportWidth - width - 8);
      setParameterPanelStyle({
        position: "fixed",
        left,
        bottom: Math.max(8, window.innerHeight - rect.top + 10),
        maxHeight: Math.max(0, rect.top - 18),
        width,
        zIndex: 90,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [parameterPanelOpen]);

  React.useEffect(() => {
    if (!parameterPanelOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && parameterDockRef.current?.contains(target)) return;
      if (target && parameterPanelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-frosted-select-menu]")) return;
      setParameterPanelOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setParameterPanelOpen(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [parameterPanelOpen]);

  React.useEffect(() => {
    if (parameterPanelOpen !== "model") {
      modelPanelAutoScrolledRef.current = false;
    }
  }, [parameterPanelOpen]);

  useIsoLayoutEffect(() => {
    if (parameterPanelOpen !== "model" || !parameterPanelStyle || typeof window === "undefined") return;
    if (modelPanelAutoScrolledRef.current) return;
    const list = parameterModelListRef.current;
    const selectedOption = selectedModelOptionRef.current;
    if (!list || !selectedOption) return;

    modelPanelAutoScrolledRef.current = true;
    window.requestAnimationFrame(() => {
      selectedModelOptionRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }, [parameterPanelOpen, parameterPanelStyle, model, modelOptions]);

  React.useEffect(() => {
    if (isSeedreamSelected) {
      if (!SEEDREAM_ASPECT_RATIO_VALUES.includes(aspectRatio as (typeof SEEDREAM_ASPECT_RATIO_VALUES)[number])) {
        setAspectRatio("1:1");
      }
      if (isSeedreamProSelected) {
        if (resolution !== "1K" && resolution !== "2K") setResolution("2K");
      } else if (isSeedreamLiteSelected) {
        if (resolution !== "2K" && resolution !== "3K") setResolution("2K");
      } else if (model === "doubao-seedream-4.5") {
        if (resolution !== "2K" && resolution !== "4K") setResolution("2K");
      } else if (resolution !== "1K" && resolution !== "2K" && resolution !== "4K") {
        setResolution("2K");
      }
      return;
    }
    if (resolution === "3K") setResolution("2K");
  }, [aspectRatio, isSeedreamLiteSelected, isSeedreamProSelected, isSeedreamSelected, model, resolution]);

  React.useEffect(() => {
    if (model !== "gpt-image-2") return;
    if (aspectRatio === "auto") {
      if (resolution !== "1K") setResolution("1K");
      return;
    }
    if (aspectRatio === "1:1" && resolution === "4K") {
      setResolution("2K");
    }
  }, [aspectRatio, model, resolution]);

  React.useEffect(() => {
    if (!isGptImage2OfficialProviderSelected) return;
    if (isGptImage2OfficialSizeComboValid(model, aspectRatio, resolution)) return;
    setAspectRatio(resolution === "4K" ? "16:9" : "1:1");
  }, [aspectRatio, isGptImage2OfficialProviderSelected, model, resolution]);

  React.useEffect(() => {
    if (!isJiekouGptImage2Selected) return;
    if (officialOutputFormat === "webp") setOfficialOutputFormat("png");
    if (officialQuality === "auto") setOfficialQuality(items.length > 0 ? "low" : "medium");
  }, [isJiekouGptImage2Selected, items.length, officialOutputFormat, officialQuality]);

  React.useEffect(() => {
    if ((isEasyRouterImage2Selected || isTuziGptImage2Selected) && officialOutputFormat !== "png") setOfficialOutputFormat("png");
  }, [isEasyRouterImage2Selected, isTuziGptImage2Selected, officialOutputFormat]);

  React.useEffect(() => {
    if (!isTuziGptImage2Selected || isTuziGptImage2SizeComboValid(aspectRatio, resolution)) return;
    setAspectRatio(resolution === "4K" ? "16:9" : "1:1");
  }, [aspectRatio, isTuziGptImage2Selected, resolution]);

  React.useEffect(() => {
    if (!isOfficialParamsSelected) return;
    if (isOpenRouterImageModel(model)) {
      const params = getOpenRouterImageParams(model);
      if (!params.qualities.some(item => item.value === officialQuality)) setOfficialQuality(params.defaultQuality as any);
      return;
    }
    if (isQwenImage3Selected) {
      if (officialQuality !== "standard" && officialQuality !== "pro") setOfficialQuality("standard");
      return;
    }
    if (officialQuality === "standard" || officialQuality === "pro") { setOfficialQuality("medium"); return; }
    if (officialQuality === "auto" || (isGptImage25Selected ? !getGptImage25QualityOptions(model).some((option) => option.value === officialQuality) : officialQuality === "xhigh" || officialQuality === "max")) setOfficialQuality("medium");
  }, [isOfficialParamsSelected, isQwenImage3Selected, isGptImage25Selected, model, officialQuality]);

  React.useEffect(() => {
    if (officialCountOptions.some((option) => option.value === officialOutputCount)) return;
    setOfficialOutputCount("1");
  }, [officialCountOptions, officialOutputCount]);

  React.useEffect(() => {
    if (!isOpenRouterImageModel(model)) return;
    if (!getOpenRouterImageParams(model).backgrounds.some(option => option.value === officialBackground)) setOfficialBackground("auto");
  }, [model, officialBackground]);

  const imageWorkspaceSnapshot = React.useMemo<ImageWorkspaceSnapshot>(() => {
    const payload = {
      schemaVersion: 1,
      tool: "image",
      state: {
        model,
        aspectRatio,
        resolution,
        customSize,
        taskStyle,
        parallelCount,
        outputQuantity,
        midjourneySpeed,
        midjourneyOptions,
        seedreamOutputMode,
        seedreamOutputCount,
        officialQuality,
        gptImage25Mode,
        officialOutputCount,
        officialBackground,
        googleThinkingLevel,
        googleSearchMode,
        officialModeration,
        officialOutputFormat, gifSize, frameCount, frameDurationMs, seedream55,
        officialOutputCompression,
        nanoOfficialSeed,
      },
    };
    const media: Array<{ mediaId: string; position: number }> = [];
    return {
      payload,
      media,
      fingerprint: workspaceDraftFingerprint(payload, media),
    };
  }, [googleThinkingLevel, googleSearchMode, aspectRatio, customSize, midjourneySpeed, midjourneyOptions, model, gptImage25Mode, nanoOfficialSeed, officialBackground, officialModeration, officialOutputCompression, officialOutputCount, officialOutputFormat, gifSize, frameCount, frameDurationMs, seedream55, officialQuality, outputQuantity, parallelCount, resolution, seedreamOutputCount, seedreamOutputMode, taskStyle]);

  useIsoLayoutEffect(() => {
    workspaceDraftSnapshotRef.current = imageWorkspaceSnapshot;
  }, [imageWorkspaceSnapshot]);

  useIsoLayoutEffect(() => {
    if (!userId || !workspaceDraftHydrated || !ephemeralMediaSessionRef.current || workspaceDraftOwnerRef.current !== userId) return;
    const stableItems = items.flatMap((item) => {
      const candidate = item.replacement?.previousItem || item;
      const url = String(candidate.url || "").trim();
      if (!url || candidate.file || candidate.uploadError) return [];
      return [{ ...candidate, file: null } as MultiUploadItem];
    });
    const inputDraft: ImageEphemeralInputDraft = {
      prompt,
      items: stableItems,
      draftSessionId: ephemeralMediaSessionRef.current,
    };
    ephemeralInputDraftRegistry.write("toolbox:image", userId, inputDraft);
    if (desktopMode) {
      writeDesktopInputDraft(true, "toolbox:image", userId, {
        ...inputDraft,
        items: desktopDraftMediaItems(stableItems),
        workspacePayload: imageWorkspaceSnapshot.payload,
        interruptedUpload: desktopDraftUploadWasPending(items),
      });
    }
  }, [desktopMode, items, prompt, userId, workspaceDraftHydrated, imageWorkspaceSnapshot.payload]);

  const saveImageWorkspaceDraftNow = React.useCallback(async (
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
          "image",
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
        const latest = await fetchToolWorkspaceDraft("image");
        if (authenticatedUserIdRef.current !== ownerUserId) return;
        applyImageWorkspaceDraft(latest);
        if (workspaceDisplayCacheKey) {
          try {
            updateImageWorkspaceDisplayCache(localStorage, workspaceDisplayCacheKey, {
              userId: ownerUserId,
              draft: latest,
            });
          } catch {}
        }
        workspaceDraftVersionRef.current = latest?.version || 0;
        workspaceDraftFingerprintRef.current = latest
          ? workspaceDraftFingerprint(
              latest.payload,
              latest.media.map((item) => ({ mediaId: item.mediaId, position: item.position })),
            )
          : "";
        await nextWorkspaceSnapshotFrame();
        return;
      }
      if (authenticatedUserIdRef.current !== ownerUserId) return;
      workspaceDraftVersionRef.current = saved.version;
      workspaceDraftFingerprintRef.current = snapshot.fingerprint;
      if (workspaceDisplayCacheKey) {
        try {
          updateImageWorkspaceDisplayCache(localStorage, workspaceDisplayCacheKey, {
            userId: ownerUserId,
            draft: saved,
          });
        } catch {}
      }
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
  }, [applyImageWorkspaceDraft, userId, workspaceBackupKey, workspaceDisplayCacheKey, workspaceDraftHydrated, workspaceDraftWritable]);

  React.useEffect(() => {
    if (!workspaceDraftHydrated || !workspaceDraftWritable || !userId) return;
    const timer = window.setTimeout(() => {
      void saveImageWorkspaceDraftNow().catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [imageWorkspaceSnapshot.fingerprint, saveImageWorkspaceDraftNow, userId, workspaceDraftHydrated, workspaceDraftWritable]);

  const flushWorkspaceDraftRef = React.useRef<() => void>(() => undefined);
  useIsoLayoutEffect(() => {
    flushWorkspaceDraftRef.current = () => {
      if (!userId || !workspaceDraftHydrated || !workspaceDraftWritable) return;
      const save = saveImageWorkspaceDraftNow({ keepalive: true });
      trackWorkspaceNavigationSave("image", userId, save);
    };
  }, [saveImageWorkspaceDraftNow, userId, workspaceDraftHydrated, workspaceDraftWritable]);
  React.useEffect(() => {
    const flush = () => flushWorkspaceDraftRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const uploadToolMediaFile = React.useCallback(
    async (
      file: File,
      requestKey: string,
      onStateChange: (state: "uploading" | "verifying") => void,
    ) => {
      if (!workspaceDraftHydrated || !workspaceDraftWritable || !authenticatedUserId || workspaceDraftOwnerRef.current !== authenticatedUserId) {
        throw new Error("素材工作草稿尚未就绪");
      }
      void requestKey;
      return uploadEphemeralToolMedia({
        draftSessionId: ephemeralMediaSessionRef.current,
        file,
        onStateChange,
      });
    },
    [authenticatedUserId, workspaceDraftHydrated, workspaceDraftWritable]
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
    logAction("upload_input", "upload input image", {
      filename: nextFile.name,
      size: nextFile.size,
      mimeType: nextFile.type,
      taskType: "image_edit",
      sourcePage: "/image"
    });
    const pendingItem = items[idx];
    const uploadRequestId = String(pendingItem.uploadRequestId || createToolClientUuid());
    const ownerUserId = authenticatedUserId;
    const uploadMutation = async () => {
      const pendingItemForUpload = {
        ...pendingItem,
        uploadRequestId,
        uploadState: "uploading" as const,
        uploadError: undefined,
      };
      setItems((prev) => prev.map((item) =>
        item.file === nextFile ? pendingItemForUpload : item
      ));
      const result = await settleToolMediaUpload({
        pendingItem: pendingItemForUpload,
        upload: async () => {
          return uploadToolMediaFile(
            nextFile,
            uploadRequestId,
            (state) => {
              if (authenticatedUserIdRef.current !== ownerUserId) return;
              setItems((prev) => prev.map((item) =>
                item.file === nextFile ? { ...item, uploadState: state } : item
              ));
            },
          );
        },
      });
      if (authenticatedUserIdRef.current !== ownerUserId) return;
        const readyItem = result.item;
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
          setError(normalizeApiFriendlyError({ error: (result.error as any)?.message }, "素材上传失败"));
        }
      await nextWorkspaceSnapshotFrame();
    };
    const queuedUpload = workspaceMediaMutationQueueRef.current.enqueueUpload(uploadMutation);
    void queuedUpload.finally(() => {
      uploadingRef.current.delete(nextFile);
    }).catch(() => undefined);
  }, [authenticatedUserId, items, uploadToolMediaFile, workspaceDraftHydrated, workspaceDraftWritable]);

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
      void queueImageMediaReleases(resolution.releaseMediaIds).catch(() => undefined);
    }
  }, [items, queueImageMediaReleases, toolMediaUploadCommits]);

  React.useEffect(() => {
    if (!userId) return;
    const target = items.find(
      (it) => !it.mediaId && !it.file && needsImportToImports(it.url) && !it.uploadError && !importingUrlRef.current.has(it.url as string)
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
        const uploadError = String(e?.message || "素材处理失败，请重新添加");
        setItems((prev) => prev.map((it) => (
          !it.file && it.url === srcUrl
            ? { ...it, uploadState: "failed", uploadError }
            : it
        )));
        setError(normalizeApiFriendlyError({ error: e?.message }, "素材上传失败"));
      });
  }, [items, userId]);

  const handleGenerate = async (resume?: ToolboxImageGenerationResume) => {
    if (!resume) {
      if (generationSubmitInFlightRef.current || reverseLoading || hasRunningReverseTask) return;
    } else if (generationSubmitInFlightRef.current) {
      return;
    }
    if (!user) {
      openLoginModal(() => { void handleGenerateRef.current(); });
      return
    }
    if (!userId) return;
    if (!workspaceDraftHydrated || !workspaceDraftWritable) {
      setInlineNotice("草稿服务暂时不可用，请刷新页面后重试。");
      return;
    }
    setInlineNotice(null);
    if (!resume && !prompt.trim() && !selectedRoleSkillId && !(isSeedream55Model(model) && seedream55.layerDecomposition)) {
      setInlineNotice("请先填写提示词");
      return;
    }
    if (hasPendingUploads) {
      setInlineNotice("素材仍在上传中，请稍后再生成");
      return;
    }
    if (hasFailedUploads) {
      setInlineNotice("有素材上传失败，请替换或删除后再生成");
      return;
    }
    if (isEasyRouterImage2Selected && aspectRatio === "custom") {
      const customSizeError = getEasyRouterCustomSizeError(customSize);
      if (customSizeError) {
        setInlineNotice(customSizeError);
        return;
      }
    }
    // Lock before the first await so slow draft saves cannot admit another click.
    generationSubmitInFlightRef.current = true;
    loadingRef.current = true;
    setSubmissionPhase("validating");
    setError(null);
    const submissionStartedAt = performance.now();
    let validationFinishedAt = submissionStartedAt;
    let responseReceivedAt: number | null = null;
    let requestSubmitted = false;
    let submitAccepted = false;
    const releaseSubmissionButton = () => {
      const finishedAt = responseReceivedAt ?? performance.now();
      void logAction("generation_submit_timing", "image generation submission timing", {
        taskType: "image_edit",
        validationMs: Math.max(0, Math.round(validationFinishedAt - submissionStartedAt)),
        submitMs: Math.max(0, Math.round(finishedAt - validationFinishedAt)),
        totalMs: Math.max(0, Math.round(finishedAt - submissionStartedAt)),
        requestSubmitted,
        accepted: submitAccepted,
      });
      generationSubmitInFlightRef.current = false;
      loadingRef.current = false;
      setSubmissionPhase("idle");
    };
    try {
      await saveImageWorkspaceDraftNow();
    } catch (saveError: any) {
      setInlineNotice(String(saveError?.message || "保存图片工作草稿失败，请重试"));
      validationFinishedAt = performance.now();
      releaseSubmissionButton();
      return;
    }
    let submission: ReturnType<typeof partitionToolMediaInputs>;
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      submission = partitionToolMediaInputs(items);
      validationFinishedAt = performance.now();
    } catch (e: any) {
      setInlineNotice(String(e?.message || "素材检查失败，请重新添加后再试"));
      validationFinishedAt = performance.now();
      releaseSubmissionButton();
      return;
    }
    const { manifest, toolMediaIds, legacyPaths: imagePaths } = submission;
    const inputCount = toolMediaIds.length + imagePaths.length;
    let generationPrompt = prompt;
    let skillUserPrompt = String(resume?.continuation.userPrompt || "").trim();
    let generationSkill = resume?.activeTask.skill || null;
    let continuationRequestKey = resume?.continuation.requestKey || "";
    if (resume) {
      generationPrompt = String(resume.activeTask.generatedPrompt || "").trim();
    } else if (selectedRoleSkillId) {
      setSubmissionPhase("enhancing");
      setReverseLoading(true);
      setReverseError(null);
      try {
        const skillPromptRequest = buildPromptWithAssetReferences(prompt, promptAssets);
        const startedTask = await startToolboxImageRoleSkillPrompt({
          roleSkillId: selectedRoleSkillId,
          userPrompt: skillPromptRequest.modelPrompt,
          mediaUrls: items.map((item) => String(item.url || "")).filter(Boolean),
        });
        const activeContinuation: ToolboxImageRoleContinuation = {
          kind: "toolbox_image_generation",
          taskId: startedTask.id,
          requestKey: createToolClientUuid(),
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
        const completedTask = await waitForToolboxImageRoleSkillPrompt({
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
        continuationRequestKey = activeContinuation.requestKey;
        void loadPromptReverseTasks(true);
      } catch (skillError: any) {
        const message = String(skillError?.message || "技能生成提示词失败，请重试");
        setReverseError(message);
        setInlineNotice(message);
        validationFinishedAt = performance.now();
        releaseSubmissionButton();
        return;
      } finally {
        setReverseLoading(false);
      }
    }
    validationFinishedAt = performance.now();
    const submittedQuality =
      isJiekouGptImage2Selected && officialQuality === "auto"
        ? inputCount > 0
          ? "low"
          : "medium"
        : officialQuality;
    const submittedOutputFormat =
      gifOutput ? "gif" : officialOutputFormat === "gif" || isOpenRouterImageModel(model) ? "png" : isJiekouGptImage2Selected && officialOutputFormat === "webp" ? "png" : officialOutputFormat;
    const submittedOutputCount = isOpenRouterImageModel(model) ? "1" : isQwenImage3Selected ? "1" : isGptImage25Selected ? "1" : isTuziGptImage2Selected ? "1" : isGptImage2OfficialProviderSelected ? "1" : officialOutputCount;
    const effectiveOutputQuantity = isMidjourneyV8Selected ? 1 : outputQuantity;

    setSubmissionPhase("submitting");
    logAction("submit_generation", "submit image generation", {
      taskType: "image_edit",
      prompt: generationPrompt.substring(0, 100),
      model,
      aspectRatio,
      resolution,
      customSize: (isEasyRouterImage2Selected || isSeedream55Model(model)) && aspectRatio === "custom" ? customSize : undefined,
      imageCount: inputCount,
      taskCount: effectiveOutputQuantity,
      sourcePage: "/image"
    });
    const batchId = continuationRequestKey || createToolClientUuid();
    const batchSubmittedAt = new Date().toISOString();
    const tempIds = historyRef.current?.addPendingItems({
      type: "image_edit",
      batchId,
      count: effectiveOutputQuantity,
      submittedAt: batchSubmittedAt,
      prompt: generationPrompt,
      model,
      params: { aspectRatio, ...(isMidjourneyV8Selected ? { speed: midjourneySpeed } : { resolution }), taskType: "image_edit" },
    }) || [];

    try {
      const form = new FormData();
      form.set("userId", userId);
      toolMediaIds.forEach((mediaId) => form.append("toolMediaId[]", mediaId));
      if (imagePaths.length) form.set("imagePaths", JSON.stringify(imagePaths));
      form.set("inputManifest", JSON.stringify(manifest));
      form.set("prompt", generationPrompt);
      if (skillUserPrompt) form.set("userPrompt", skillUserPrompt);
      if (generationSkill) form.set("skill", JSON.stringify(generationSkill));
      form.set("model", model);
      for (const [key, value] of Object.entries(googleSettings)) if (value) form.set(key, value);
      form.set("aspectRatio", aspectRatio);
      if (isMidjourneyV8Selected) {
        form.set("speed", midjourneySpeed);
        if (Object.keys(midjourneyOptions).length) form.set("midjourneyOptions", JSON.stringify(midjourneyOptions));
      }
      else form.set("resolution", resolution);
      if ((isEasyRouterImage2Selected || isSeedream55Model(model)) && aspectRatio === "custom") form.set("customSize", customSize.trim());
      form.set("taskCount", String(effectiveOutputQuantity));
      form.set("batchId", batchId);
      form.set("requestKey", batchId);
      form.set("batchSubmittedAt", batchSubmittedAt);
      if (!isMidjourneyV8Selected && !isSeedreamProSelected) {
        form.set("seedreamOutputMode", seedreamOutputMode);
        form.set("seedreamOutputCount", seedreamOutputCount);
      }
      if (isGptImage25Selected) {
        form.set("gptImage25Mode", gptImage25Mode);
        if (supportsImageBackground(model)) {
          form.set("background", officialBackground);
          form.set("outputFormat", gifOutput ? "gif" : "png");
        }
        form.set("quality", submittedQuality);
        form.set("n", "1");
      } else if (!isMidjourneyV8Selected) {
        form.set("quality", submittedQuality);
        form.set("n", submittedOutputCount);
        form.set("background", officialBackground === "transparent" && !supportsImageBackground(model) ? "auto" : officialBackground);
        form.set("moderation", officialModeration);
        form.set("outputFormat", submittedOutputFormat);
        if (!isJiekouGptImage2Selected && (officialOutputFormat === "jpeg" || officialOutputFormat === "webp")) {
          form.set("outputCompression", officialOutputCompression);
        }
      }
      if (isSeedream55Model(model)) form.set("seedream55", JSON.stringify(seedream55));
      if (gifOutput) {
        form.set("gifSize", gifSize);
        form.set("frameCount", String(frameCount));
        form.set("frameDurationMs", String(frameDurationMs));
      }
      if (nanoOfficialSeed.trim()) form.set("seed", nanoOfficialSeed.trim());
      requestSubmitted = true;
      const res = await fetch("/api/image-edit", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      const taskResults = Array.isArray(json?.data?.tasks)
        ? json.data.tasks
        : [{ batchIndex: 1, generationId: json?.data?.generationId, taskId: json?.data?.taskId, status: "running" }];
      responseReceivedAt = performance.now();
      submitAccepted = res.ok && taskResults.some((task: any) =>
        task?.status !== "failed" && Boolean(String(task?.generationId || "").trim()),
      );
      const settledTempIds = new Set<string>();
      for (const task of taskResults) {
        const batchIndex = Number(task?.batchIndex || 0);
        const tempId = tempIds[batchIndex - 1];
        if (!tempId) continue;
        const generationId = String(task?.generationId || "").trim();
        if (generationId) {
          historyRef.current?.resolvePendingItem(tempId, generationId);
          settledTempIds.add(tempId);
        } else if (task?.status === "failed") {
          historyRef.current?.failPendingItem(tempId, String(task?.error || "生成失败"));
          settledTempIds.add(tempId);
        } else {
          historyRef.current?.removePendingItem(tempId);
          settledTempIds.add(tempId);
        }
      }
      if (!res.ok) {
        setError(normalizeApiFriendlyError(json, "生成失败"));
        tempIds.filter((tempId) => !settledTempIds.has(tempId)).forEach((tempId) => historyRef.current?.removePendingItem(tempId));
        historyRef.current?.reload();
        return;
      }
      if (continuationRequestKey) {
        const cleared = await saveRoleDraftNow({
          activeReverseTaskId: null,
          continuation: null,
        });
        if (!cleared.success) setInlineNotice(cleared.error);
      }
      // 占位项已按当前选中状态迁移到真实任务，不覆盖提交期间用户切换的历史记录。
      historyRef.current?.reload();
      const failedCount = Number(json?.data?.failedCount || 0);
      if (failedCount > 0) setInlineNotice(`已提交 ${effectiveOutputQuantity - failedCount} 个任务，${failedCount} 个失败`);
    } catch (e: any) {
      setError(normalizeApiFriendlyError({ error: e?.message }, "生成失败"));
      tempIds.forEach((tempId) => historyRef.current?.removePendingItem(tempId));
      historyRef.current?.reload();
    } finally {
      releaseSubmissionButton();
    }
  };
  const handleGenerateRef = React.useRef(handleGenerate);
  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);
  const resumeToolboxImageContinuation = React.useCallback((
    activeTask: PromptReverseTaskItem,
    activeContinuation: ToolboxImageRoleContinuation,
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
      || continuation?.kind !== "toolbox_image_generation"
      || continuation.phase !== "ready"
      || hasPendingUploads
      || hasFailedUploads
      || generationSubmitInFlightRef.current
      || resumedToolboxContinuationRef.current === continuation.requestKey
    ) return;
    const activeTask = reverseTasks.find((task) => task.id === continuation.taskId);
    if (!activeTask || activeTask.status !== "success" || !activeTask.generatedPrompt) return;
    resumedToolboxContinuationRef.current = continuation.requestKey;
    resumeToolboxImageContinuation(activeTask, continuation);
  }, [
    continuation,
    hasFailedUploads,
    hasPendingUploads,
    isActive,
    resumeToolboxImageContinuation,
    reverseTasks,
    roleDraftHydrated,
    userId,
    workspaceDraftHydrated,
    workspaceDraftWritable,
  ]);
  React.useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!matchHotkey(e, generateHotkeySpec)) return;
      e.preventDefault();
      const disabled = loadingRef.current || (!promptRef.current.trim() && !selectedRoleSkillId && !(isSeedream55Model(model) && seedream55.layerDecomposition)) || hasPendingUploads || hasFailedUploads;
      if (disabled) return;
      void handleGenerateRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [generateHotkeySpec, hasFailedUploads, hasPendingUploads, isActive, selectedRoleSkillId]);

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
      height: 240,
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
    const stopDragging = (event: PointerEvent) => {
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
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      promptPanelDragRef.current = null;
      promptPanelResizeRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
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
      const disabled = loading || !hasPromptOrSkill || hasPendingUploads || hasFailedUploads;
      if (disabled) return;
      void handleGenerate();
    },
    [generateHotkeySpec, handleGenerate, hasFailedUploads, hasPendingUploads, hasPromptOrSkill, loading]
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
      const mediaUrls = items.map((it) => String(it.url || "")).filter(Boolean);
      const promptRequest = buildPromptWithAssetReferences(prompt, promptAssets);
      const res = await fetch("/api/prompt-reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          async: true,
          surface: "toolbox_image",
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
      setReverseTasks((prev) => [task, ...prev.filter((item) => item.id !== task.id)]);
      setReversePromptApplied(false);
      window.setTimeout(() => {
        void loadPromptReverseTasks(true);
      }, 1200);
    } catch (e: any) {
      setReverseError(String(e?.message || "生成专业提示词失败"));
    } finally {
      if (!taskStarted) setReverseLoading(false);
    }
  }, [hasPendingUploads, items, loadPromptReverseTasks, openLoginModal, prompt, promptAssets, saveRoleDraftNow, selectedRoleSkillId, userId]);

  const historyActions = (
    <UnifiedHistoryActions
      historyRef={historyRef}
      historyCount={historyCount}
      userId={userId}
      onFocusHistoryId={(id) => {
        setHistoryFocusId(null);
        setHistoryFocusId(id);
      }}
    />
  );

  const renderPromptEditor = (textareaClassName: string, expanded = false) => (
    <div className="relative h-full min-h-0">
      <UiProps ids={{"placeholder":["image.m13d95626fbc1"]}}><PromptRichEditor
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
        roleSkillsLoading={roleSkillsLoading}
        roleSkillsError={roleSkillsError}
        onRoleSkillSelect={selectToolboxRoleSkill}
        selectedRoleSkill={toolboxRoleSkill}
        onRoleSkillRemove={clearToolboxRoleSkillSelection}
        onValueChange={(nextValue) => {
          setPrompt(nextValue);
          if (inlineNotice) setInlineNotice(null);
        }}
        onKeyDown={handlePromptKeyDown}
        placeholder="image.m13d95626fbc1"
        className={textareaClassName}
        contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}
      /></UiProps>
      <PresetPromptsTrigger
        onApply={(c) => {
          if (!workspaceControlsDisabled) setPrompt(String(c || ""));
        }}
        mode="inline"
        triggerVariant="inline"
        hideTrigger={workspaceControlsDisabled}
        triggerLabel="预设提示词"
        className="absolute right-3 bottom-3"
      />
    </div>
  );

  const mainContent = (<div inert={workspaceControlsDisabled ? ("" as any) : undefined} className="h-full flex flex-col gap-3 transition-all duration-200">
      <div className="flex-shrink-0">
        <UiProps ids={{"title":["image.m9fbb4750bb39"]}}><MultiUploadDropzone
          title="image.m9fbb4750bb39"
          desc={text("createDynamic.me65b7c82d388")}
          accept="image/*"
          items={items}
          onItemsChange={handleImageItemsChange}
          maxFiles={isSeedream55Model(model) ? (seedream55.layerDecomposition ? 1 : 10) : model === KIE_NANO_BANANA_21_MODEL ? 10 : model === GOOGLE_NANO_BANANA_21_MODEL ? GOOGLE_NANO_BANANA_21_MAX_REFERENCES : isOpenRouterImageModel(model) ? getOpenRouterImageParams(model).maxReferences : isQwenImage3Selected ? 3 : isQwenImage21Model(model) ? 10 : isMidjourneyV8Selected ? 4 : isTuziGptImage2Selected ? 16 : isGptImage2OfficialProviderSelected ? 16 : isEasyRouterImage2Selected ? 16 : undefined}
          disabled={workspaceControlsDisabled}
          previewSize="video"
          replaceOnItemDrop
          staticVideoPreviews={embeddedInStudioShell}
        /></UiProps>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-2 mb-2 flex-shrink-0">
          <span><UiText id="image.mb52f59e63937" /></span>
          <RoleSkillTrigger
            onClick={() => { setSkillLibraryEntry({ view: "browse" }); setSystemPromptOpen(true); }}
            disabled={workspaceControlsDisabled}
            selected={Boolean(activeSelectedRoleSkillId)}
          />
        </div>
        <div ref={promptSourceRef} data-prompt-source className="flex-1 min-h-0 relative">
          <PromptEditorPortal target={promptEditorHost}>
            {renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)}
          </PromptEditorPortal>
          {promptPanelOpen ? (
            <div className="h-full w-full" aria-hidden="true" />
          ) : (
            <>
              <div ref={setPromptEditorHost} className="h-full w-full" />
              <UiProps ids={{"title":["image.maec5cc0d276f"],"aria-label":["image.maec5cc0d276f"]}}><button
                data-prompt-expand-corner
                type="button"
                onClick={openPromptPanel}
                title="image.maec5cc0d276f"
                aria-label="image.maec5cc0d276f"
                className="absolute right-0 top-0 z-10 inline-flex h-6 w-6 items-center justify-center bg-transparent text-[var(--app-muted)] transition-colors hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span aria-hidden="true" className="block h-2.5 w-2.5 border-r border-t border-current" />
              </button></UiProps>
            </>
          )}
        </div>
      </div>
    </div>);

  const expandedPromptPanel = isActive && promptPanelOpen && promptPanelRect && typeof document !== "undefined" ? createPortal(
    <div
      ref={promptPanelRef}
      data-prompt-panel
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
          <span className="truncate text-sm font-semibold"><UiText id="image.mb52f59e63937" /></span>
          <span className="shrink-0 text-xs font-normal text-[var(--app-muted)]">{prompt.length}<UiText id="image.mc55038b272b1" /></span>
        </div>
        <UiProps ids={{"aria-label":["image.m57004465b7d3"]}}><button
          type="button"
          onClick={closePromptPanel}
          aria-label="image.m57004465b7d3"
          className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
        >
          <X className="h-4 w-4" />
        </button></UiProps>
      </div>
      <div className="relative min-h-0 flex-1 p-3">
        <div ref={setPromptEditorHost} className="h-full" />
      </div>
      <UiProps ids={{"aria-label":["image.m58f002bafda0"],"title":["image.m6cf2895f0080"]}}><div
        role="separator"
        aria-label="image.m58f002bafda0"
        title="image.m6cf2895f0080"
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
      mediaType="image"
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
            <span><UiText id="image.m8ae2bac25454" /></span>
          </div>
          <UiProps ids={{"placeholder":["image.m3ddfd59a7642"]}}><textarea
            value={reversePrompt}
            onChange={(event) => {
              setReversePrompt(event.target.value);
              setActiveReverseTaskId(null);
              setReversePromptApplied(false);
            }}
            onBlur={() => void saveRoleDraftNow()}
            disabled={reverseLoading || hasRunningReverseTask}
            placeholder="image.m3ddfd59a7642"
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
            ><UiText id="image.me4b823dc13c3" /></button>
          </div>
        </div>
      )}
    />
  ) : null;

  const selectedModelOption = modelOptions.find((option) => option.value === selectedModelValue) || modelOptions[0];
  const selectedOfficialQualityLabel = parameterLabel(officialQualityOptions.find((option) => option.value === officialQuality)?.label || officialQuality);
  const seedreamSummaryMode = seedreamOutputMode === "group" ? text("createDynamic.m3c9bd6fde43c", { count: seedreamOutputCount }) : parameterLabel("单图");
  const selectedAspectRatioLabel = (isEasyRouterImage2Selected || isSeedream55Model(model)) && aspectRatio === "custom"
    ? customSize.trim() || parameterLabel("自定义")
    : parameterLabel(formatModelParamLabel(aspectRatio));
  const parameterSummary = gifOutput ? text("createDynamic.m20d284aad5d0", { size: gifSize, frames: frameCount, seconds: (frameCount * frameDurationMs / 1000).toFixed(2), count: imageCountLabel(outputQuantity) }) : getGoogleImageOptions(model) ? [selectedAspectRatioLabel, resolution, googleImageSettingsSummary(model, googleSettings).split(" · ").map(parameterLabel).join(" · "), imageCountLabel(outputQuantity)].filter(Boolean).join(" · ") : isOpenRouterImageModel(model)
    ? [selectedAspectRatioLabel, resolution === "auto" ? parameterLabel("自适应") : resolution, getOpenRouterImageParams(model).qualities.length ? selectedOfficialQualityLabel : "", supportsImageBackground(model) ? parameterLabel(GPT_IMAGE_25_BACKGROUND_OPTIONS.find(option => option.value === officialBackground)?.label || "") : "", imageCountLabel(outputQuantity)].filter(Boolean).join(" · ")
    : isMidjourneyV8Selected
    ? selectedAspectRatioLabel + " · " + (model === APIMART_MIDJOURNEY_V8_MODEL_ID ? midjourneyVersionLabel(midjourneyOptions.version) + " · " : "") + parameterLabel(({ relax: "慢速", fast: "快速", turbo: "极速" } as const)[midjourneySpeed]) + (midjourneyOptions.hd ? " · HD" : "") + " · " + imageCountLabel(4)
    : (
        isSeedreamSelected
          ? selectedAspectRatioLabel + " · " + resolution + (isSeedreamSequentialSelected ? " · " + seedreamSummaryMode : "")
          : isOfficialParamsSelected
            ? isQwenImage3Selected ? selectedAspectRatioLabel + " · " + selectedOfficialQualityLabel + " · " + (aspectRatio === "auto" ? parameterLabel("自动清晰度") : resolution) : selectedAspectRatioLabel + " · " + resolution + " · " + selectedOfficialQualityLabel
            : selectedAspectRatioLabel + " · " + resolution
      ) + (supportsImageBackground(model) ? " · " + parameterLabel(GPT_IMAGE_25_BACKGROUND_OPTIONS.find((option) => option.value === officialBackground)?.label || "自适应") : "") + " · " + imageCountLabel(outputQuantity);
  const selectedAspectRatioOption = aspectRatioOptions.find((option) => option.value === aspectRatio) || { label: selectedAspectRatioLabel, value: aspectRatio };
  const visibleOfficialQualityOptions = officialQualityOptions.filter((option) => option.value !== "auto");
  const paramCardKind = (title: string): ParamCardKind | undefined =>
    title === "比例" ? "ratio"
      : title === "画质" || title === "图片质量" ? "quality"
        : title === "分辨率" || title === "清晰度" ? "resolution"
          : title === "数量" ? "count" : undefined;
  const renderParamGrid = (
    title: string,
    value: string,
    options: FrostedSelectOption[],
    onChange: (value: string) => void,
    opts: { columns?: number; aspectIcon?: boolean } = {}
  ) => (
    <ParamCard title={parameterLabel(title)} card={paramCardKind(title)}>
      <ParamOptionGrid
        ariaLabel={parameterLabel(title)}
        options={options.map(option => ({ ...option, label: parameterLabel(option.label) }))}
        value={value}
        onChange={onChange}
        columns={opts.columns}
        renderAspect={opts.aspectIcon ? (option, selected) => renderAspectLeading(option, { placement: "option", selected, active: selected }) : undefined}
      />
    </ParamCard>
  );
  const renderParameterPanelBody = () => (
    <ParamCardSections
      className="text-[12px]"
      pairQualityResolution={!isMidjourneyV8Selected && isOfficialParamsSelected && !gifOutput}
      pairCountFormat={!isMidjourneyV8Selected && supportsGptImage26Gif(model)}
    >
      {isMidjourneyV8Selected ? (
        <>
          {renderParamGrid("比例", aspectRatio, sortAspectRatioOptions(aspectRatioOptions), setAspectRatio, { columns: 3, aspectIcon: true })}
          <MidjourneySettings
            canvas
            speed={midjourneySpeed}
            showVersion={model === APIMART_MIDJOURNEY_V8_MODEL_ID}
            options={midjourneyOptions}
            prompt={prompt}
            hasReferences={items.length > 0}
            disabled={workspaceControlsDisabled}
            onChange={patch => { if (patch.speed) setMidjourneySpeed(patch.speed); if (patch.options) setMidjourneyOptions(patch.options); }}
          />
          <UiProps ids={{"title":["image.m5e29d121dda0"]}}><ParamCard title="image.m5e29d121dda0" card="count">
            <ParamOptionGrid ariaLabel={parameterLabel("数量")} options={[{ value: "4", label: imageCountLabel(4) }]} value="4" onChange={() => undefined} />
          </ParamCard></UiProps>
        </>
      ) : (
        <>
          <GoogleImageSettings canvas model={model} settings={googleSettings} onChange={patch => { if (patch.googleThinkingLevel) setGoogleThinkingLevel(patch.googleThinkingLevel); if (patch.googleSearchMode) setGoogleSearchMode(patch.googleSearchMode); }} />
          {isOfficialParamsSelected
            ? renderParamGrid(isQwenImage3Selected ? "图片质量" : "画质", officialQuality, visibleOfficialQualityOptions, (v) => setOfficialQuality((v as any) || "medium"), { columns: Math.min(3, visibleOfficialQualityOptions.length) || 1 })
            : null}
          {!gifOutput && renderParamGrid(isQwenImage3Selected ? "清晰度" : "分辨率", resolution, (isOpenRouterImageModel(model) ? getOpenRouterResolutionDisplayOptions(model, aspectRatio) : resolutionOptions).map(option => isQwenImage3Selected && aspectRatio === "auto" ? { ...option, disabled: true } : option), setResolution, { columns: isOpenRouterImageModel(model) ? 3 : Math.min(3, resolutionOptions.length) || 1 })}
          {!gifOutput && !(isSeedream55Model(model) && seedream55.layerDecomposition) && renderParamGrid("比例", aspectRatio, sortAspectRatioOptions(aspectRatioOptions), setAspectRatio, { columns: 3, aspectIcon: true })}
          {isQwenImage3Selected && aspectRatio === "auto" ? <p className="text-xs text-[var(--app-muted)]"><UiText id="image.mf4ef031c8b95" /></p> : null}
          {(isEasyRouterImage2Selected || (isSeedream55Model(model) && !seedream55.layerDecomposition)) && aspectRatio === "custom" ? (
            <UiProps ids={{"title":["image.m8a2e28474a49"]}}><ParamCard title="image.m8a2e28474a49">
              <UiProps ids={{"aria-label":["image.m8a2e28474a49"]}}><input
                value={customSize}
                onChange={(event) => setCustomSize(event.target.value)}
                placeholder="1024x1024"
                inputMode="text"
                aria-label="image.m8a2e28474a49"
                className="canvas-task-parameter-input"
              /></UiProps>
            </ParamCard></UiProps>
          ) : null}
          {isSeedreamSequentialSelected ? (
            <>
              {renderParamGrid(
                "出图模式",
                seedreamOutputMode,
                [
                  { label: "单图", value: "single" },
                  { label: "系列图", value: "group" }
                ],
                (v) => setSeedreamOutputMode(v === "group" ? "group" : "single"),
                { columns: 2 }
              )}
              {renderParamGrid(
                "系列图张数",
                ["2", "3", "4", "5", "6", "7", "8"].some((value) => value === seedreamOutputCount) ? seedreamOutputCount : "2",
                ["2", "3", "4", "5", "6", "7", "8"].map((v) => ({ label: imageCountLabel(v), value: v, disabled: seedreamOutputMode !== "group" })),
                setSeedreamOutputCount,
                { columns: 4 }
              )}
            </>
          ) : null}
          <GptImage25OutputSettings canvas model={model} background={officialBackground} outputFormat={officialOutputFormat} gifSize={gifSize} frameCount={frameCount} frameDurationMs={frameDurationMs} seedream55={seedream55} onChange={(patch) => {
            if (patch.background) setOfficialBackground(patch.background as typeof officialBackground);
            if (patch.outputFormat) setOfficialOutputFormat(patch.outputFormat as typeof officialOutputFormat);
            if (patch.gifSize) setGifSize(patch.gifSize);
            if (patch.frameCount !== undefined) setFrameCount(patch.frameCount);
            if (patch.seedream55) setSeedream55(patch.seedream55);
            if (patch.frameDurationMs !== undefined) setFrameDurationMs(patch.frameDurationMs);
          }} />
          {renderParamGrid(
            "数量",
            String(outputQuantity),
            IMAGE_OUTPUT_QUANTITIES.map((quantity) => ({ label: imageCountLabel(quantity), value: String(quantity) })),
            (value) => setOutputQuantity(Number(value)),
            { columns: 3 }
          )}
        </>
      )}
    </ParamCardSections>
  );

  const parameterFloatingPanel = isActive && parameterPanelOpen && parameterPanelStyle && typeof document !== "undefined" ? createPortal(
    <div
      ref={parameterPanelRef}
      className="overflow-hidden rounded-[14px] border border-[var(--border-2)] bg-[var(--panel-bg)] text-[12px] shadow-[var(--shadow)]"
      style={parameterPanelStyle}
    >
      {parameterPanelOpen === "model" ? (
        <div className="max-h-[392px]">
          <div className="min-h-0 p-2">
            <div className="mb-2">
              <div className="text-[12px] font-semibold text-[var(--app-fg)]/90"><UiText id="image.mc98e118e0a43" /></div>
            </div>
            <div ref={parameterModelListRef} className="max-h-[336px] space-y-1 overflow-y-auto pr-1">
              {modelOptions.map((option) => {
                const selected = option.value === selectedModelValue;
                return (
                  <button
                    key={option.value}
                    ref={selected ? selectedModelOptionRef : undefined}
                    type="button"
                    onClick={() => {
                      const selection = resolveGptImage25Selection(option.value);
                      setModel(selection.model as ImageModelValue);
                      if (selection.gptImage25Mode) setGptImage25Mode(selection.gptImage25Mode);
                      setParameterPanelOpen(null);
                    }}
                    className={[
                      "flex w-full rounded-lg border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-[var(--border-2)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                        : "border-transparent text-[var(--app-fg)]/78 hover:border-[var(--border)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                    ].join(" ")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13px] font-semibold leading-snug">{option.label}</span>
                      </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-y-auto p-3 pr-2.5" style={{ maxHeight: Math.min(gifOutput ? 640 : 430, Number(parameterPanelStyle.maxHeight)) }}>{renderParameterPanelBody()}</div>
      )}
    </div>,
    document.body
  ) : null;

  const footerContent = (
    <div ref={parameterDockRef} inert={workspaceControlsDisabled ? ("" as any) : undefined} className="relative space-y-3">
      <div className="grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center overflow-visible rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-0 text-[var(--app-fg)] dark:rounded-[14px] dark:border-0 dark:bg-[var(--panel-bg)] dark:text-white dark:shadow-[0_14px_34px_rgba(0,0,0,0.28)] dark:ring-1 dark:ring-white/10">
        <div className="relative min-w-0">
          <button
            ref={parameterModelButtonRef}
            type="button"
            onClick={() => setParameterPanelOpen((v) => (v === "model" ? null : "model"))}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-l-xl px-3 text-left text-[11px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] dark:h-10 dark:rounded-l-[14px] dark:text-inherit dark:hover:bg-white/10"
          >
            <span className="min-w-0 flex-1 truncate">{selectedModelOption?.label || <UiText id="image.m0c4ff1cbb701" />}</span>
            <ChevronDown className={["h-4 w-4 shrink-0 opacity-55 transition-transform dark:opacity-80", parameterPanelOpen === "model" ? "rotate-180" : ""].join(" ")} />
          </button>
        </div>
        <div className="h-6 w-px bg-[var(--border)] dark:bg-white/30" />
        <div className="relative min-w-0">
          <button
            ref={parameterParamsButtonRef}
            type="button"
            onClick={() => setParameterPanelOpen((v) => (v === "params" ? null : "params"))}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-r-xl px-3 text-left text-[11px] font-normal text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] dark:h-10 dark:rounded-r-[14px] dark:font-medium dark:text-inherit dark:hover:bg-white/10"
          >
            {!gifOutput && <span className="shrink-0 opacity-80 dark:opacity-90">
              {renderAspectLeading(selectedAspectRatioOption, { placement: "button", selected: true, active: false })}
            </span>}
            <span className="min-w-0 flex-1 truncate">{parameterSummary}</span>
            <ChevronDown className={["h-4 w-4 shrink-0 opacity-55 transition-transform dark:opacity-80", parameterPanelOpen === "params" ? "rotate-180" : ""].join(" ")} />
          </button>
        </div>
      </div>
      {inlineNotice ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{localizeError(localizeLabel(inlineNotice))}</span>
        </div>
      ) : null}
      <button
        onClick={() => void handleGenerate()}
        disabled={generateButtonState.disabled}
        className="w-full h-12 text-base font-medium bg-[var(--primary-bg)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--border)] disabled:text-[var(--app-muted)] disabled:hover:bg-[var(--border)] rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {generationLabel(generateButtonState.label)}
      </button>
    </div>
  );

  if (sharedHistory) {
    return (
      <section
        className={embeddedInStudioShell ? "contents"
          : "h-full isolate rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden flex flex-col min-h-0"}
      >
        {!embeddedInStudioShell ? (
        <div className="p-[clamp(12px,1.8dvh,16px)] h-[64px] flex items-center border-b border-[var(--border)]">
          <div className="grid grid-cols-2 gap-2 w-full max-w-[520px] mx-auto">

            <button
              type="button"
              onClick={() => studioNav?.onSelectTool("image")}
              className={[
                "w-full flex items-center justify-center gap-2 px-3 h-10 rounded-2xl text-sm font-medium transition-all",
                studioNav?.activeTool === "image"
                  ? "bg-[var(--panel-2)] text-[var(--app-fg)] border border-[var(--border)]"
                  : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
              ].join(" ")}
            >
              <Image className="w-4 h-4" /><UiText id="image.md721fd5257b8" /></button>
            <button
              type="button"
              onClick={() => studioNav?.onSelectTool("video")}
              className={[
                "w-full flex items-center justify-center gap-2 px-3 h-10 rounded-2xl text-sm font-medium transition-all",
                studioNav?.activeTool === "video"
                  ? "bg-[var(--panel-2)] text-[var(--app-fg)] border border-[var(--border)]"
                  : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
              ].join(" ")}
            >
              <Video className="w-4 h-4" /><UiText id="image.m89174fe72eee" /></button>
          </div>
        </div>
        ) : null}
        <div className="flex-1 min-h-0 px-[clamp(14px,2.2dvh,20px)] pt-[clamp(14px,2.2dvh,20px)] pb-0">
          {mainContent}
        </div>
        <div className="relative z-20 mt-2 px-[clamp(14px,2.2dvh,20px)] pb-[clamp(14px,2.2dvh,20px)] pt-3">
          {footerContent}
        </div>
        {parameterFloatingPanel}
        {expandedPromptPanel}
        {systemPromptPanel}
      </section>
    );
  }

  return (
    <ToolShell
      tabs={
        studioNav
          ? [
              { key: "image", label: text("createDynamic.md721fd5257b8"), icon: <Image className="w-4 h-4" />, onSelect: () => studioNav.onSelectTool("image") },
              { key: "video", label: text("createDynamic.m89174fe72eee"), icon: <Video className="w-4 h-4" />, onSelect: () => studioNav.onSelectTool("video") }
            ]
          : [
              { key: "image", href: "/studio?tool=image", label: text("createDynamic.md721fd5257b8"), icon: <Image className="w-4 h-4" /> },
              { key: "video", href: "/studio?tool=video", label: text("createDynamic.m89174fe72eee"), icon: <Video className="w-4 h-4" /> }
            ]
      }
      activeKey="image"
      activeHref={undefined}
      historyError={error ? <FriendlyErrorBlock error={error} /> : null}
      history={<UnifiedHistoryPanel ref={historyRef} defaultType="all" focusId={historyFocusId} onItemCountChange={setHistoryCount} />}
      historyActions={historyActions}
      footer={footerContent}
    >
      {mainContent}
      {parameterFloatingPanel}
      {expandedPromptPanel}
      {systemPromptPanel}
    </ToolShell>
  );
}
