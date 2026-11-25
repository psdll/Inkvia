"use client";
import { useUiLocale } from "@/i18n/ui";
import { UiText, UiProps } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { SEEDREAM_55_RATIOS, SEEDREAM_55_RESOLUTIONS } from "@/lib/apimart-seedream-55";
import { GoogleImageSettings } from "@/components/image/google-image-settings";
import { getGoogleImageOptions, normalizeGoogleImageSettings } from "@/lib/google-image-settings";

import { KIE_NANO_BANANA_21_MODEL, NANO_BANANA_21_RATIOS, NANO_BANANA_21_RESOLUTIONS, isProviderNanoBanana21 } from "@/lib/nano-banana-21-providers";
import { GOOGLE_NANO_BANANA_21_MODEL, GOOGLE_NANO_BANANA_21_MAX_REFERENCES } from "@/lib/google-nano-banana-21";
import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import { isOpenRouterImageModel, getOpenRouterImageParams, getOpenRouterResolutionDisplayOptions } from "@/lib/openrouter-image-params";

import { QWEN_IMAGE_3_RATIOS, QWEN_IMAGE_3_RESOLUTIONS, QWEN_IMAGE_3_QUALITIES, isQwenImage3Model } from "@/lib/qwen-image-3-models";

import { QWEN_IMAGE_21_RATIOS, QWEN_IMAGE_21_RESOLUTIONS, isQwenImage21Model } from "@/lib/work-fisher-image-params";
import { supportsGptImage26Gif } from "@/lib/gpt-image-26-animation";
import { GptImage25OutputSettings } from "@/components/image/gpt-image-25-output-settings";

import { supportsImageBackground, REAPI_GPT_IMAGE_25_MODEL_ID, expandGptImage25ModelOptions, getGptImage25SelectionValue, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";
import { REAPI_GPT_IMAGE_25_RATIOS } from "@/lib/reapi-gpt-image-25";
import { isAicomingGptImage25Model, AICOMING_GPT_IMAGE_25_RATIOS } from "@/lib/aicoming-gpt-image-25";
import { GPT_IMAGE_25_RATIOS, isApimartGptImageVariantModel } from "@/lib/apimart-gpt-image-25";

import { Plus, Sparkles } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { ParamCard, ParamCardSections, ParamOptionGrid } from "@/components/parameters/param-cards";
import { CanvasAspectRatioIcon } from "@/components/canvas/CanvasAspectRatioIcon";
import { ExpandablePromptTextarea } from "@/components/ui/expandable-prompt-textarea";
import {
  BatchMediaGallery,
  type BatchProductLibraryDrop,
} from "@/components/batch-workbench/batch-media-gallery";
import { BatchParameterDock } from "@/components/batch-workbench/batch-parameter-dock";
import { BatchRolePositioning } from "@/components/batch-workbench/batch-role-positioning";
import { GenerateActionButton } from "@/components/batch-workbench/generate-action-button";
import { PresetPromptsTrigger } from "@/components/presets/preset-prompts";
import type { BatchRolePositioningController } from "@/hooks/use-batch-role-positioning-controller";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import {
  buildBatchPromptAssets,
  type BatchMediaRelation,
  type ImageBatch,
  type ImageEditModel,
} from "@/components/batch-workbench/types";
import {
  IMAGE_BATCH_LIMITS,
  isGroupedImageBatchMode,
} from "@/lib/image-batch/contracts";
import {
  REAPI_GPT_IMAGE_2_MODEL_ID,
  getGptImage2OfficialRatios,
  isGptImage2OfficialProviderModel,
  isGptImage2OfficialSizeComboValid,
  normalizeGptImage2OfficialParams,
} from "@/lib/gpt-image-2-official";
import {
  TUZI_GPT_IMAGE_2_RESOLUTIONS,
  getTuziGptImage2Ratios,
  isTuziGptImage2Model,
  isTuziGptImage2SizeComboValid,
  normalizeTuziGptImage2Params,
} from "@/lib/tuzi-image-params";
import {
  APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES,
  APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES,
  isApimartNanoBananaProModel,
} from "@/lib/apimart-image-models";

export const RATIO_OPTIONS = [
  "auto",
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
].map((value) => ({
  value,
  label: value === "auto" ? "自动" : value,
}));

export const RESOLUTION_OPTIONS = ["1K", "2K", "4K"].map((value) => ({
  value,
  label: value,
}));

export function getGptImage2OfficialBatchOptions(
  model: string,
  resolution: string,
  aspectRatio: string,
) {
  if (isProviderNanoBanana21(model)) return { ratioOptions: NANO_BANANA_21_RATIOS.map(value => ({ value, label: value === "auto" ? "自适应" : value })), resolutionOptions: RESOLUTION_OPTIONS };
  const google = getGoogleImageOptions(model);
  if (google) return { ratioOptions: google.ratios.map(value => ({ value, label: value === "auto" ? "自适应" : value })), resolutionOptions: google.resolutions.map(value => ({ value, label: value === "512" ? "512 (0.5K)" : value })) };
  if (isOpenRouterImageModel(model)) { const params = getOpenRouterImageParams(model, aspectRatio); return { ratioOptions: params.aspectRatios, resolutionOptions: params.resolutions }; }
  if (isQwenImage3Model(model)) return { ratioOptions: QWEN_IMAGE_3_RATIOS.map(value => ({ value, label: value === "auto" ? "自适应" : value })), resolutionOptions: QWEN_IMAGE_3_RESOLUTIONS.map(value => ({ value, label: value })) };
  if (isQwenImage21Model(model)) return { ratioOptions: QWEN_IMAGE_21_RATIOS.map((value) => ({ value, label: value })), resolutionOptions: RESOLUTION_OPTIONS };
  if (model === REAPI_GPT_IMAGE_25_MODEL_ID) {
    return { ratioOptions: REAPI_GPT_IMAGE_25_RATIOS.map((value) => ({ value, label: value })), resolutionOptions: RESOLUTION_OPTIONS };
  }
  if (isAicomingGptImage25Model(model)) {
    return { ratioOptions: AICOMING_GPT_IMAGE_25_RATIOS.map((value) => ({ value, label: value })), resolutionOptions: RESOLUTION_OPTIONS };
  }
  if (isApimartGptImageVariantModel(model)) {
    return {
      ratioOptions: GPT_IMAGE_25_RATIOS.map((value) => ({ value, label: value === "auto" ? "自动" : value })),
      resolutionOptions: RESOLUTION_OPTIONS,
    };
  }
  if (isSeedream55Model(model)) return { ratioOptions: [...SEEDREAM_55_RATIOS, "custom"].map(value => ({value,label:value === "auto" ? "自适应" : value === "custom" ? "自定义" : value})), resolutionOptions: SEEDREAM_55_RESOLUTIONS.map(value => ({value,label:value})) };
  if (isApimartNanoBananaProModel(model)) {
    return {
      ratioOptions: APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES.map((value) => ({
        value,
        label: value === "auto" ? "自动" : value,
      })),
      resolutionOptions: APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES.map((value) => ({
        value,
        label: value,
      })),
    };
  }
  if (!isGptImage2OfficialProviderModel(model)) {
    return { ratioOptions: RATIO_OPTIONS, resolutionOptions: RESOLUTION_OPTIONS };
  }
  return {
    ratioOptions: getGptImage2OfficialRatios(model, resolution).map((value) => ({
      value,
      label: value === "auto" ? "自动" : value,
      disabled: !isGptImage2OfficialSizeComboValid(model, value, resolution),
    })),
    resolutionOptions: RESOLUTION_OPTIONS.map((option) => ({
      ...option,
      disabled: !isGptImage2OfficialSizeComboValid(model, aspectRatio, option.value),
    })),
  };
}

export function normalizeGptImage2OfficialBatchSettings(
  model: string,
  resolution: string,
  aspectRatio: string,
  currentModel?: string,
): { model: string; resolution?: string; aspectRatio?: string; quality?: string; gptImage25Mode?: string; background?: string; outputFormat?: string } {
  if (isProviderNanoBanana21(model)) return { model, aspectRatio: NANO_BANANA_21_RATIOS.includes(aspectRatio) ? aspectRatio : "auto", resolution: NANO_BANANA_21_RESOLUTIONS.includes(resolution) ? resolution : "2K", quality: "" };
  if (isOpenRouterImageModel(model)) {
  if (getGoogleImageOptions(model)) { const options = getGoogleImageOptions(model)!; return { model, ...normalizeGoogleImageSettings(model, {}), aspectRatio: options.ratios.includes(aspectRatio) ? aspectRatio : "auto", resolution: options.resolutions.includes(resolution) ? resolution : "1K" }; }
 const params = getOpenRouterImageParams(model, aspectRatio); return { model, background: "auto", outputFormat: "png", quality: params.defaultQuality, aspectRatio: params.aspectRatios.some(item => item.value === aspectRatio) ? aspectRatio : params.defaultAspectRatio, resolution: params.resolutions.some(item => item.value === resolution) ? resolution : params.defaultResolution }; }
  if (isQwenImage3Model(model)) return { model, quality: "standard", aspectRatio: QWEN_IMAGE_3_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1", resolution: QWEN_IMAGE_3_RESOLUTIONS.includes(resolution) ? resolution : "2K" };
  if (isQwenImage21Model(model)) return { model, aspectRatio: QWEN_IMAGE_21_RATIOS.includes(aspectRatio as never) ? aspectRatio : "3:4", resolution: QWEN_IMAGE_21_RESOLUTIONS.includes(resolution as never) ? resolution : "2K" };
  const selection = resolveGptImage25Selection(model);
  if (supportsGptImage26Gif(currentModel) && !supportsGptImage26Gif(selection.model)) {
    return { ...normalizeGptImage2OfficialBatchSettings(selection.model, resolution, aspectRatio), ...selection, background: "auto", outputFormat: "png" };
  }
  if (supportsImageBackground(currentModel) && !supportsImageBackground(selection.model)) {
    return { ...normalizeGptImage2OfficialBatchSettings(model, resolution, aspectRatio), background: "auto", outputFormat: "png" };
  }
  if (selection.gptImage25Mode) {
    if (selection.model === currentModel) return selection;
    return { ...normalizeGptImage2OfficialBatchSettings(selection.model, resolution, aspectRatio), gptImage25Mode: selection.gptImage25Mode };
  }
  if (model === REAPI_GPT_IMAGE_25_MODEL_ID) {
    return { model, quality: "medium", gptImage25Mode: "flare", resolution: ["1K", "2K", "4K"].includes(resolution) ? resolution : "2K", aspectRatio: (REAPI_GPT_IMAGE_25_RATIOS as readonly string[]).includes(aspectRatio) ? aspectRatio : "1:1" };
  }
  if (isAicomingGptImage25Model(model)) {
    return { model, quality: "medium", gptImage25Mode: "flare", resolution: ["1K", "2K", "4K"].includes(resolution) ? resolution : "2K", aspectRatio: AICOMING_GPT_IMAGE_25_RATIOS.includes(aspectRatio as never) ? aspectRatio : "1:1" };
  }
  if (isApimartGptImageVariantModel(model)) {
    return { model, resolution: ["1K", "2K", "4K"].includes(resolution) ? resolution : "2K", aspectRatio: (GPT_IMAGE_25_RATIOS as readonly string[]).includes(aspectRatio) ? aspectRatio : "auto" };
  }
  if (isSeedream55Model(model)) return { model, resolution: SEEDREAM_55_RESOLUTIONS.includes(resolution) ? resolution : "2K", aspectRatio: [...SEEDREAM_55_RATIOS, "custom"].includes(aspectRatio) ? aspectRatio : "auto" };
  if (isApimartNanoBananaProModel(model)) {
    return {
      model,
      resolution: APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES.includes(resolution as never)
        ? resolution
        : "1K",
      aspectRatio: APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES.includes(aspectRatio as never)
        ? aspectRatio
        : "1:1",
    };
  }
  if (!isGptImage2OfficialProviderModel(model)) return { model };
  const normalized = normalizeGptImage2OfficialParams({
    model,
    resolution,
    aspectRatio,
    allowAuto: model === REAPI_GPT_IMAGE_2_MODEL_ID,
  });
  return {
    model,
    resolution: normalized.resolution,
    aspectRatio: normalized.aspectRatio,
  };
}

export function getTuziGptImage2BatchOptions(
  model: string,
  resolution: string,
  aspectRatio: string,
) {
  if (!isTuziGptImage2Model(model)) {
    return { ratioOptions: RATIO_OPTIONS, resolutionOptions: RESOLUTION_OPTIONS };
  }
  return {
    ratioOptions: getTuziGptImage2Ratios(resolution).map((value) => ({
      value,
      label: value === "auto" ? "自动" : value,
      disabled: !isTuziGptImage2SizeComboValid(value, resolution),
    })),
    resolutionOptions: TUZI_GPT_IMAGE_2_RESOLUTIONS.map((value) => ({
      value,
      label: value,
      disabled: !isTuziGptImage2SizeComboValid(aspectRatio, value),
    })),
  };
}

export function normalizeTuziGptImage2BatchSettings(
  model: string,
  resolution: string,
  aspectRatio: string,
) {
  if (!isTuziGptImage2Model(model)) return { model };
  const normalized = normalizeTuziGptImage2Params({ resolution, aspectRatio });
  return {
    model,
    resolution: normalized.resolution,
    aspectRatio: normalized.aspectRatio,
  };
}

function normalizeBatchModelSettings(model: string, resolution: string, aspectRatio: string, currentModel?: string) {
  return {
    ...normalizeGptImage2OfficialBatchSettings(model, resolution, aspectRatio, currentModel),
    ...(isTuziGptImage2Model(model) ? normalizeTuziGptImage2BatchSettings(model, resolution, aspectRatio) : {}),
  };
}

export function BatchSettingsPanel({
  batch,
  models,
  uploading,
  uploadingRole,
  clearingRole,
  mediaMutationPending,
  disabled,
  authenticated,
  switchingMode,
  generatePending,
  segmentedPromptPending,
  rolePositioning,
  onBatchChange,
  onModeChange,
  onOpenLiveVideo,
  onUpload,
  onImportProductLibraryItem,
  onRemoveMedia,
  onClearMedia,
  onLimitExceeded,
  onAddTask,
  onGenerateGroups,
  onGenerateSegmentedPrompts,
  onOpenPromptSplit,
}: {
  batch: ImageBatch;
  models: ImageEditModel[];
  uploading: boolean;
  uploadingRole: "product" | "reference" | null;
  clearingRole: "product" | "reference" | null;
  mediaMutationPending: boolean;
  disabled: boolean;
  authenticated: boolean;
  switchingMode: boolean;
  generatePending: boolean;
  segmentedPromptPending: boolean;
  rolePositioning: BatchRolePositioningController;
  onBatchChange: (patch: Partial<ImageBatch>) => void;
  onModeChange: (mode: ImageBatch["mode"]) => void | Promise<void>;
  onOpenLiveVideo: () => void;
  onUpload: (
    role: "product" | "reference",
    files: File[],
  ) => void | Promise<void>;
  onImportProductLibraryItem: (
    role: "product" | "reference",
    drop: BatchProductLibraryDrop,
  ) => void | Promise<void>;
  onRemoveMedia: (relation: BatchMediaRelation) => void | Promise<void>;
  onClearMedia: (role: "product" | "reference") => void | Promise<void>;
  onLimitExceeded: (message: string) => void;
  onAddTask: () => void | Promise<void>;
  onGenerateGroups: () => void | Promise<void>;
  onGenerateSegmentedPrompts: () => void | Promise<void>;
  onOpenPromptSplit: () => void;
}) {
  const products = batch.media.filter(
    (entry) => entry.itemId === null && entry.role === "product",
  );
  const references = batch.media.filter(
    (entry) => entry.itemId === null && entry.role === "reference",
  );
  const settings = batch.sharedSettings || {};
  const batchModel = settings.model || models[0]?.id || "";
  const generationBlocked = !authenticated
    || disabled
    || switchingMode
    || uploading
    || mediaMutationPending
    || batch.media.some((entry) => entry.itemId === null && entry.pending)
    || !settings.model
    || !models.some((model) => model.id === settings.model);
  const batchAspectRatio = settings.aspectRatio || "3:4";
  const batchResolution = settings.resolution || "2K";
  const batchParameterOptions = isTuziGptImage2Model(batchModel)
    ? getTuziGptImage2BatchOptions(batchModel, batchResolution, batchAspectRatio)
    : getGptImage2OfficialBatchOptions(batchModel, batchResolution, batchAspectRatio);
  const groupedWorkflow = isGroupedImageBatchMode(batch.mode);
  const batchPromptAssets = buildBatchPromptAssets(products);
  const {
    skills: roleSkills,
    loading: roleSkillsLoading,
    error: roleSkillsError,
  } = useRoleSkillCatalog({
    authUserId: rolePositioning.authUserId,
    enabled: batch.mode === "multi_prompt" && Boolean(rolePositioning.authUserId),
  });

  const updateSettings = (patch: Record<string, unknown>) => {
    onBatchChange({ sharedSettings: { ...settings, ...patch } });
  };

  const { text } = useUiLocale();
  return (<aside className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0">
        <div className="mb-4">
          <span className="mb-3 block text-[13px] font-semibold leading-5 text-[var(--app-fg)]"><UiText id="batch.md550103a12fa" /></span>
          <FrostedSelect
            value={batch.mode}
            disabled={disabled || switchingMode || segmentedPromptPending}
            onChange={(value) => {
              if (value === "live_video") {
                onOpenLiveVideo();
                return;
              }
              void onModeChange(value as ImageBatch["mode"]);
            }}
            options={[
              { value: "style_replication", label: text("batch.modeReplication") },
              { value: "multi_prompt", label: text("batch.modeMulti") },
              { value: "live_video", label: text("batch.modeLive") },
            ]}
            showLeading={false}
            side="bottom"
            ariaLabel={text("workspaceFollowup.me4b76edd446f")}
          />
        </div>

        <div className="space-y-4">
          {batch.mode === "style_replication" ? (<UiProps ids={{"hint":["batch.mf53b15615091"]}}><BatchMediaGallery
              label="参考图"
              relations={references}
              busy={uploading && uploadingRole === "reference"}
              clearing={clearingRole === "reference"}
              disabled={disabled || uploading || clearingRole !== null}
              multiple
              dropzone
              maxFiles={isSeedream55Model(batchModel) ? (settings.seedream55?.layerDecomposition ? 1 : 10) : batchModel === KIE_NANO_BANANA_21_MODEL ? 10 : batchModel === GOOGLE_NANO_BANANA_21_MODEL ? GOOGLE_NANO_BANANA_21_MAX_REFERENCES : isQwenImage3Model(batchModel) ? 3 : isQwenImage21Model(batchModel) ? 10 : isApimartNanoBananaProModel(batchModel) ? 14 : isTuziGptImage2Model(batchModel) ? 16 : isGptImage2OfficialProviderModel(batchModel) ? 16 : undefined}
              onUpload={(files) => onUpload("reference", files)}
              onImportProductLibraryItem={(drop) => onImportProductLibraryItem("reference", drop)}
              onLimitExceeded={onLimitExceeded}
              onRemove={onRemoveMedia}
              onClear={() => onClearMedia("reference")}
              hint="batch.mf53b15615091"
            /></UiProps>
          ) : null}
          <UiProps ids={{"hint":["batch.m0989372c0070","batch.m14a81b2fa6a0"]}}><BatchMediaGallery
            label="产品图"
            relations={products}
            busy={uploading && uploadingRole === "product"}
            clearing={clearingRole === "product"}
            disabled={disabled || uploading || clearingRole !== null}
            multiple={groupedWorkflow}
            dropzone={groupedWorkflow}
            dropzoneSize={batch.mode === "multi_prompt" ? "large" : "default"}
            compactHeaderActions={batch.mode === "multi_prompt"}
            showSummary={batch.mode === "style_replication"}
            maxFiles={
              batchModel === KIE_NANO_BANANA_21_MODEL && batch.mode === "multi_prompt" ? 10 : isQwenImage3Model(batchModel) && batch.mode === "multi_prompt" ? 3 : isQwenImage21Model(batchModel) && batch.mode === "multi_prompt" ? 10 : isApimartNanoBananaProModel(batchModel) && batch.mode === "multi_prompt"
                ? 14
                : isTuziGptImage2Model(batchModel) && batch.mode === "multi_prompt"
                ? 16
                : isGptImage2OfficialProviderModel(batchModel) && batch.mode === "multi_prompt"
                ? 16
                : groupedWorkflow
                ? IMAGE_BATCH_LIMITS.maxStyleProductImages
                : 1
            }
            onUpload={(files) =>
              onUpload(
                "product",
                groupedWorkflow ? files : files.slice(0, 1),
              )
            }
            onImportProductLibraryItem={(drop) => onImportProductLibraryItem("product", drop)}
            onLimitExceeded={onLimitExceeded}
            onRemove={onRemoveMedia}
            onClear={() => onClearMedia("product")}
            hint={batch.mode === "multi_prompt"
              ? "batch.m0989372c0070"
              : "batch.m14a81b2fa6a0"}
          /></UiProps>
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
            <span className="text-[13px] font-semibold leading-5 text-[var(--app-fg)]"><UiText id="batch.m4b47dbae97ba" /></span>
            {batch.mode === "multi_prompt" ? (
              <BatchRolePositioning
                controller={rolePositioning}
                prompt={batch.sharedPrompt}
                media={products}
                pendingMedia={uploading}
                disabled={disabled}
              />
            ) : null}
          </div>
          <div className="relative flex min-h-0 flex-1">
            <UiProps ids={{"placeholder":["batch.m13d95626fbc1","batch.m4a11a83a4d3c"]}}><ExpandablePromptTextarea
              value={batch.sharedPrompt}
              assets={batchPromptAssets}
              roleSkills={batch.mode === "multi_prompt" ? roleSkills : []}
              roleSkillsLoading={batch.mode === "multi_prompt" && roleSkillsLoading}
              roleSkillsError={batch.mode === "multi_prompt" ? roleSkillsError : null}
              onRoleSkillSelect={batch.mode === "multi_prompt"
                ? rolePositioning.selectRoleSkill
                : undefined}
              selectedRoleSkill={batch.mode === "multi_prompt"
                ? rolePositioning.selectedRoleSkill
                : null}
              onRoleSkillRemove={batch.mode === "multi_prompt"
                ? rolePositioning.clearRoleSkillSelection
                : undefined}
              disabled={disabled}
              onChange={(value) => onBatchChange({ sharedPrompt: value })}
              maxLength={2000}
              placeholder={batch.mode === "multi_prompt"
                ? "batch.m13d95626fbc1"
                : "batch.m4a11a83a4d3c"}
              className="min-h-0 flex-1"
            /></UiProps>
            <PresetPromptsTrigger
              mode="inline"
              triggerVariant="inline"
              triggerLabel={text("workspaceFollowup.mb46a606b401c")}
              className="absolute right-3 bottom-3 !h-6 !gap-1 !rounded-md !px-1.5 !py-1 !text-[10px] [&_svg]:!h-3 [&_svg]:!w-3"
              onApply={(content) => onBatchChange({ sharedPrompt: content })}
            />
          </div>
        </div>

        {!groupedWorkflow ? (
          <>
            <div className="mt-4 space-y-3">
              <div>
                <span className="mb-2 block text-xs font-medium text-[var(--app-fg)]"><UiText id="batch.mc98e118e0a43" /></span>
                <UiProps ids={{"placeholder":["batch.m621e846d2bce"]}}><FrostedSelect
                  value={getGptImage25SelectionValue(batchModel, settings.gptImage25Mode)}
                  disabled={disabled}
                  onChange={(value) => updateSettings(normalizeBatchModelSettings(
                    value,
                    batchResolution,
                    batchAspectRatio,
                    batchModel,
                  ))}
                  options={expandGptImage25ModelOptions(models.map((model) => ({
                    ...model,
                    value: model.id,
                    label: model.label,
                  })))}
                  placeholder="batch.m621e846d2bce"
                  showLeading={false}
                  side="auto"
                  ariaLabel={text("workspaceFollowup.m1e2933c6b813")}
                /></UiProps>
              </div>
              <ParamCardSections
                pairQualityResolution={(isQwenImage3Model(batchModel) || (isOpenRouterImageModel(batchModel) && getOpenRouterImageParams(batchModel).qualities.length > 0)) && !(supportsGptImage26Gif(batchModel) && settings.outputFormat === "gif")}
              >
                <GoogleImageSettings canvas model={batchModel} settings={settings} onChange={updateSettings} disabled={disabled} />
                {!(supportsGptImage26Gif(batchModel) && settings.outputFormat === "gif") && !(isSeedream55Model(batchModel) && settings.seedream55?.layerDecomposition) ? (
                  <UiProps ids={{"title":["batch.m5c6d39030a4a"]}}><ParamCard title="batch.m5c6d39030a4a" card="ratio">
                    <ParamOptionGrid
                      ariaLabel={text("workspaceFollowup.m259bf7d13ddb")}
                      value={batchAspectRatio}
                      disabled={disabled}
                      onChange={(value) => updateSettings({ aspectRatio: value, ...(isOpenRouterImageModel(batchModel) ? { resolution: getOpenRouterImageParams(batchModel, value).resolutions.some(o => o.value === settings.resolution) ? settings.resolution : getOpenRouterImageParams(batchModel, value).defaultResolution } : {}) })}
                      options={sortAspectRatioOptions(batchParameterOptions.ratioOptions)}
                      renderAspect={(option) => <CanvasAspectRatioIcon value={option.value} />}
                    />
                  </ParamCard></UiProps>
                ) : null}
                {isOpenRouterImageModel(batchModel) && getOpenRouterImageParams(batchModel).qualities.length > 0 ? (
                  <UiProps ids={{"title":["batch.m77ccdb7ba817"]}}><ParamCard title="batch.m77ccdb7ba817" card="quality">
                    <ParamOptionGrid ariaLabel={text("workspaceFollowup.me24692471157")} value={settings.quality || "medium"} disabled={disabled} onChange={(quality) => updateSettings({ quality })} options={getOpenRouterImageParams(batchModel).qualities} />
                  </ParamCard></UiProps>
                ) : null}
                {isQwenImage3Model(batchModel) ? (
                  <UiProps ids={{"title":["batch.m0ab5629be565"]}}><ParamCard title="batch.m0ab5629be565" card="quality">
                    <ParamOptionGrid ariaLabel={text("workspaceFollowup.m0ab5629be565")} value={settings.quality === "pro" ? "pro" : "standard"} disabled={disabled} onChange={(quality) => updateSettings({ quality })} options={QWEN_IMAGE_3_QUALITIES} columns={2} />
                  </ParamCard></UiProps>
                ) : null}
                {!(supportsGptImage26Gif(batchModel) && settings.outputFormat === "gif") ? (
                  <UiProps ids={{"title":["batch.mb92421822c21"]}}><ParamCard title="batch.mb92421822c21" card="resolution">
                    <ParamOptionGrid
                      ariaLabel={text("workspaceFollowup.m459fdf6b4664")}
                      value={batchResolution}
                      disabled={disabled}
                      onChange={(value) => updateSettings({ resolution: value })}
                      options={isOpenRouterImageModel(batchModel) ? getOpenRouterResolutionDisplayOptions(batchModel, batchAspectRatio) : batchParameterOptions.resolutionOptions}
                    />
                  </ParamCard></UiProps>
                ) : null}
                {isQwenImage3Model(batchModel) && batchAspectRatio === "auto" ? <p className="text-xs text-[var(--app-muted)]"><UiText id="batch.mf4ef031c8b95" /></p> : null}
  <GptImage25OutputSettings canvas model={batchModel} background={settings.background} outputFormat={settings.outputFormat} gifSize={settings.gifSize} frameCount={settings.frameCount} frameDurationMs={settings.frameDurationMs} seedream55={settings.seedream55} onChange={updateSettings} disabled={disabled} />
                {isSeedream55Model(batchModel) && !settings.seedream55?.layerDecomposition && batchAspectRatio === "custom" ? (
                  <UiProps ids={{"title":["batch.m8a2e28474a49"]}}><ParamCard title="batch.m8a2e28474a49">
                    <UiProps ids={{"aria-label":["batch.md77f7b7fc756"],"placeholder":["batch.m8955348e764e"]}}><input aria-label="batch.md77f7b7fc756" placeholder="batch.m8955348e764e" value={settings.customSize || ""} disabled={disabled} onChange={e => updateSettings({ customSize: e.target.value })} className="canvas-task-parameter-input" /></UiProps>
                  </ParamCard></UiProps>
                ) : null}
              </ParamCardSections>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onAddTask()}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--panel-3)]"
              >
                <Plus className="h-3.5 w-3.5" /><UiText id="batch.mbbbded824125" /></button>
              <button
                type="button"
                onClick={onOpenPromptSplit}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-bg)] px-3 text-xs font-medium text-[var(--primary-fg)] transition-opacity hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /><UiText id="batch.m3d9e914059f4" /></button>
            </div>
          </>
        ) : null}
      </div>

      {groupedWorkflow ? (
        <div className="shrink-0 space-y-3 bg-[var(--panel-bg)] px-4 pb-4 pt-2">
          <span className="block text-[13px] font-semibold leading-5 text-[var(--app-fg)]"><UiText id="batch.m6abcd1436548" /></span>
          <BatchParameterDock
            customSize={settings.customSize} onCustomSizeChange={customSize=>updateSettings({customSize})}
            model={batchModel}
            quality={settings.quality || "medium"}
            gptImage25Mode={settings.gptImage25Mode || "flare"}
            background={settings.background} outputFormat={settings.outputFormat} gifSize={settings.gifSize} frameCount={settings.frameCount} frameDurationMs={settings.frameDurationMs} seedream55={settings.seedream55}

            googleSettings={settings}
            onGoogleSettingsChange={updateSettings}
            onOutputSettingsChange={updateSettings}
            onQualityChange={(quality) => updateSettings({ quality })}
            aspectRatio={batchAspectRatio}
            resolution={batchResolution}
            models={models}
            ratioOptions={batchParameterOptions.ratioOptions}
            resolutionOptions={batchParameterOptions.resolutionOptions}
            disabled={disabled}
            onModelChange={(value) => updateSettings(normalizeBatchModelSettings(
              value,
              batchResolution,
              batchAspectRatio,
              batchModel,
            ))}
            onAspectRatioChange={(value) =>
              updateSettings({ aspectRatio: value, ...(isOpenRouterImageModel(batchModel) ? { resolution: getOpenRouterImageParams(batchModel, value).resolutions.some(o => o.value === settings.resolution) ? settings.resolution : getOpenRouterImageParams(batchModel, value).defaultResolution } : {}) })
            }
            onResolutionChange={(value) =>
              updateSettings({ resolution: value })
            }
          />
          {batch.mode === "style_replication" ? (
            <GenerateActionButton
              variant="primary"
              onClick={() => void onGenerateGroups()}
              disabled={generationBlocked || generatePending || !batch.sharedPrompt.trim()}
              busy={generatePending}
              className="h-12 w-full px-3"
            >
              {generatePending ? <UiText id="batch.m9742824011de" /> : <UiText id="batch.m31c010d4482f" />}
            </GenerateActionButton>
          ) : (
            <GenerateActionButton
              variant="primary"
              onClick={() => void onGenerateSegmentedPrompts()}
              disabled={
                generationBlocked
                || segmentedPromptPending
                || rolePositioning.busy
                || !rolePositioning.hydrated
                || !rolePositioning.selectedRoleSkillId
              }
              busy={segmentedPromptPending}
              className="h-12 w-full px-3"
            >
              {segmentedPromptPending
                ? <UiText id="batch.ma9ca3aad64dd" />
                : <UiText id="batch.maa09d2768853" />}
            </GenerateActionButton>
          )}
        </div>
      ) : null}
    </aside>);
}
