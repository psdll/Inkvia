"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { GoogleImageSettings } from "@/components/image/google-image-settings";
import { googleImageSettingsSummary, type GoogleImageSettings as GoogleSettings } from "@/lib/google-image-settings";
import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import { isOpenRouterImageModel, getOpenRouterImageParams, getOpenRouterResolutionDisplayOptions } from "@/lib/openrouter-image-params";

import { QWEN_IMAGE_3_QUALITIES, isQwenImage3Model } from "@/lib/qwen-image-3-models";

import { supportsGptImage26Gif, type GptImage26AnimationSettings } from "@/lib/gpt-image-26-animation";
import { GptImage25OutputSettings, type ImageOutputSettingsPatch } from "@/components/image/gpt-image-25-output-settings";

import { GPT_IMAGE_25_BACKGROUND_OPTIONS, supportsImageBackground, expandGptImage25ModelOptions, getGptImage25SelectionValue, getGptImage25QualityOptions, isGptImageVariantModel } from "@/lib/gpt-image-25-models";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { ImageEditModel } from "@/components/batch-workbench/types";
import { getAspectRatioPreviewSize } from "@/lib/aspect-ratio-preview";

type ParameterPanel = "model" | "params" | null;

type ParameterOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function AspectRatioPreview({
  value,
  compact = false,
}: {
  value: string;
  compact?: boolean;
}) {
  const size = compact ? 14 : 20;
  const previewSize = getAspectRatioPreviewSize(value, size);

  return (
    <span
      className={
        (compact ? "h-4 w-4" : "h-5 w-[32px]") +
        " flex items-center justify-center"
      }
    >
      <span
        style={previewSize}
        className="block rounded-[3px] border border-[var(--app-muted)] bg-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-white/20"
      />
    </span>
  );
}

export function BatchParameterDock({
  model,
  customSize, onCustomSizeChange,
  aspectRatio,
  resolution,
  models,
  ratioOptions,
  resolutionOptions,
  disabled,
  variant = "default",
  onModelChange,
  onAspectRatioChange,
  onResolutionChange,
  quality = "medium",
  gptImage25Mode = "flare",
  onQualityChange,
  background,
  outputFormat, gifSize, frameCount, frameDurationMs, seedream55,
  onOutputSettingsChange,
  googleSettings = {},
  onGoogleSettingsChange,
}: GptImage26AnimationSettings & {
  model: string;
  customSize?: string; onCustomSizeChange?: (value: string)=>void;
  aspectRatio: string;
  resolution: string;
  models: ImageEditModel[];
  ratioOptions: ParameterOption[];
  resolutionOptions: ParameterOption[];
  disabled: boolean;
  variant?: "default" | "groupHeader";
  onModelChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
  quality?: string;
  gptImage25Mode?: string;
  onQualityChange?: (value: string) => void;
  background?: string;
  outputFormat?: string;
  seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings;
  googleSettings?: GoogleSettings;
  onGoogleSettingsChange?: (patch: GoogleSettings) => void;
  onOutputSettingsChange?: (patch: ImageOutputSettingsPatch) => void;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const gifOutput = supportsGptImage26Gif(model) && outputFormat === "gif";
  const groupHeader = variant === "groupHeader";
  const [openPanel, setOpenPanel] = React.useState<ParameterPanel>(null);
  const [panelStyle, setPanelStyle] =
    React.useState<React.CSSProperties | null>(null);
  const dockRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const modelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const paramsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const selectedModelRef = React.useRef<HTMLButtonElement | null>(null);
  const modelPanelAutoScrolledRef = React.useRef(false);

  const modelOptions = expandGptImage25ModelOptions(models.map((option) => ({ ...option, value: option.id })));
  const selectedValue = getGptImage25SelectionValue(model, gptImage25Mode);
  const selectedModel = modelOptions.find((option) => option.value === selectedValue) || modelOptions[0];
  const selectedRatio = ratioOptions.find(
    (option) => option.value === aspectRatio,
  ) || {
    value: aspectRatio,
    label: aspectRatio === "auto" ? text("workspaceFollowup.m7eb336e42cb5") : aspectRatio,
  };
  const qualityLabel =
    isQwenImage3Model(model) ? (quality === "pro" ? "Pro" : "标准")
    : isOpenRouterImageModel(model) ? getOpenRouterImageParams(model).qualities.find(option => option.value === quality)?.label
    : isGptImageVariantModel(model) ? getGptImage25QualityOptions(model).find(option => option.value === quality)?.label
    : undefined;
  const backgroundLabel = supportsImageBackground(model)
    ? GPT_IMAGE_25_BACKGROUND_OPTIONS.find(option => option.value === (background || "auto"))?.label
    : undefined;
  const parameterSummary = [
    uiLabel(selectedRatio.label),
    resolution,
    googleImageSettingsSummary(model, googleSettings, uiLabel),
    uiLabel(qualityLabel),
    uiLabel(backgroundLabel),
  ].filter(Boolean).join(" · ");

  React.useEffect(() => {
    if (!openPanel || typeof window === "undefined") {
      setPanelStyle(null);
      return;
    }

    const anchor = openPanel === "model"
      ? modelButtonRef.current
      : paramsButtonRef.current;
    if (!anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const dockRect = dockRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = groupHeader
        ? Math.min(320, Math.max(0, viewportWidth - 16))
        : Math.min(
            dockRect?.width ?? rect.width,
            Math.max(0, viewportWidth - 16),
          );
      const left = Math.min(
        Math.max(8, dockRect?.left ?? rect.left),
        viewportWidth - width - 8,
      );

      setPanelStyle({
        position: "fixed",
        left,
        ...(groupHeader
          ? { top: rect.bottom + 10 }
          : { bottom: Math.max(8, window.innerHeight - rect.top + 10) }),
        maxHeight: Math.max(0, groupHeader ? window.innerHeight - rect.bottom - 18 : rect.top - 18),
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
  }, [groupHeader, openPanel]);

  React.useEffect(() => {
    if (disabled) setOpenPanel(null);
  }, [disabled]);

  React.useEffect(() => {
    if (!openPanel) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && dockRef.current?.contains(target)) return;
      if (target && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-frosted-select-menu]")) return;
      setOpenPanel(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPanel]);

  React.useEffect(() => {
    if (openPanel !== "model") {
      modelPanelAutoScrolledRef.current = false;
    }
  }, [openPanel]);

  React.useEffect(() => {
    if (openPanel !== "model" || !panelStyle) return;
    if (modelPanelAutoScrolledRef.current) return;

    modelPanelAutoScrolledRef.current = true;
    window.requestAnimationFrame(() => {
      selectedModelRef.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    });
  }, [model, openPanel, panelStyle]);

  const renderOptionGrid = (
    title: string,
    value: string,
    options: ParameterOption[],
    onChange: (nextValue: string) => void,
    aspectIcons = false,
  ) => (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold text-[var(--app-fg)]/90">
        {title}
      </div>
      <div
        className={aspectIcons ? "grid justify-center gap-2" : "grid gap-1.5"}
        style={{
          gridTemplateColumns: aspectIcons
            ? "repeat(auto-fill, 60px)"
            : `repeat(${Math.min(3, Math.max(1, options.length))}, minmax(0, 1fr))`,
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => !option.disabled && onChange(option.value)}
              className={[
                "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold outline-none transition",
                aspectIcons ? "h-[60px] w-[60px] flex-col gap-1 px-0" : "",
                selected
                  ? "border-[var(--app-fg)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]/75 hover:border-[var(--border-2)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
              ].join(" ")}
            >
              {aspectIcons ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-center leading-none">
                  <AspectRatioPreview value={option.value} />
                  <span className="block w-full text-center text-[11px] leading-none">
                    {uiLabel(option.label)}
                  </span>
                </span>
              ) : (
                <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderModelOptions = (closeOnSelect: boolean, maxHeight: string) => (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold text-[var(--app-fg)]/90"><UiText id="batch.mc98e118e0a43" /></div>
      <div className={`${maxHeight} space-y-1 overflow-y-auto pr-1`}>
        {modelOptions.map((option) => {
          const selected = option.value === selectedValue;
          return (
            <button
              key={option.value}
              ref={selected ? selectedModelRef : undefined}
              type="button"
              onClick={() => {
                onModelChange(option.value);
                if (closeOnSelect) setOpenPanel(null);
              }}
              className={[
                "flex w-full rounded-lg border px-3 py-2.5 text-left transition",
                selected
                  ? "border-[var(--border-2)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                  : "border-transparent text-[var(--app-fg)]/78 hover:border-[var(--border)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13px] font-semibold leading-snug">
                  {option.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const floatingPanel =
    openPanel && panelStyle && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="overflow-hidden rounded-[14px] border border-[var(--border-2)] bg-[var(--panel-bg)] text-[12px] shadow-[var(--shadow)]"
            style={panelStyle}
          >
            {openPanel === "model" ? (
              <div className="max-h-[392px] p-2">
                {renderModelOptions(true, "max-h-[336px]")}
              </div>
            ) : (
              <div className="space-y-3.5 overflow-y-auto p-3 pr-2.5 text-[12px]" style={{ maxHeight: Math.min(outputFormat === "gif" ? 640 : 430, Number(panelStyle.maxHeight)) }}>
                {isQwenImage3Model(model) && onQualityChange ? renderOptionGrid("图片质量", quality === "pro" ? "pro" : "standard", QWEN_IMAGE_3_QUALITIES, onQualityChange) : null}
                {isQwenImage3Model(model) && aspectRatio === "auto" ? <p className="text-xs text-[var(--app-muted)]"><UiText id="batch.mf4ef031c8b95" /></p> : null}
                {onGoogleSettingsChange ? <GoogleImageSettings model={model} settings={googleSettings} onChange={onGoogleSettingsChange} disabled={disabled} /> : null}
                {isOpenRouterImageModel(model) && getOpenRouterImageParams(model).qualities.length > 0 && onQualityChange ? renderOptionGrid("画质", quality, getOpenRouterImageParams(model).qualities, onQualityChange) : null}
                {isGptImageVariantModel(model) && onQualityChange ? renderOptionGrid("画质", quality, getGptImage25QualityOptions(model), onQualityChange) : null}
                {!gifOutput ? renderOptionGrid(
                  isQwenImage3Model(model) ? "清晰度" : "分辨率",
                  resolution,
                  (isOpenRouterImageModel(model) ? getOpenRouterResolutionDisplayOptions(model, aspectRatio) : resolutionOptions).map(option => isQwenImage3Model(model) && aspectRatio === "auto" ? { ...option, disabled: true } : option),
                  onResolutionChange,
                ) : null}
                {!gifOutput && !(isSeedream55Model(model) && seedream55?.layerDecomposition) ? renderOptionGrid(
                  "比例",
                  aspectRatio,
                  sortAspectRatioOptions(ratioOptions),
                  onAspectRatioChange,
                  true,
                ) : null}
                {isSeedream55Model(model) && !seedream55?.layerDecomposition && aspectRatio === "custom" ? <UiProps ids={{"aria-label":["batch.md77f7b7fc756"],"placeholder":["batch.m8955348e764e"]}}><input aria-label="batch.md77f7b7fc756" placeholder="batch.m8955348e764e" value={customSize || ""} disabled={disabled} onChange={e=>onCustomSizeChange?.(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-xs" /></UiProps> : null}
                {onOutputSettingsChange ? <GptImage25OutputSettings model={model} background={background} outputFormat={outputFormat} gifSize={gifSize} frameCount={frameCount} frameDurationMs={frameDurationMs} seedream55={seedream55} onChange={onOutputSettingsChange} disabled={disabled} /> : null}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={dockRef} className="relative">
        {groupHeader ? (
          <div className="grid w-[148px] grid-cols-[minmax(0,1fr)_1px_40px] items-center overflow-visible rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)]">
            <UiProps ids={{"aria-label":["batch.m2b1402271bac"]}}><button
              ref={modelButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.m2b1402271bac"
              aria-expanded={openPanel === "model"}
              onClick={() =>
                setOpenPanel((value) => (value === "model" ? null : "model"))
              }
              className="flex h-9 min-w-0 items-center gap-1.5 rounded-l-xl px-3 text-left text-[11px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">
                {groupHeader ? <UiText id="batch.m7122a29a7508" /> : selectedModel?.label || model}
              </span>
              <ChevronDown
                className={[
                  "h-4 w-4 shrink-0 opacity-55 transition-transform dark:opacity-80",
                  openPanel === "model" ? "rotate-180" : "",
                ].join(" ")}
              />
            </button></UiProps>
            <div className="h-5 w-px bg-[var(--border)]" />
            <UiProps ids={{"aria-label":["batch.m9c5547268f35"],"title":["batch.m9c5547268f35"]}}><button
              ref={paramsButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.m9c5547268f35"
              title="batch.m9c5547268f35"
              aria-expanded={openPanel === "params"}
              onClick={() =>
                setOpenPanel((value) => (value === "params" ? null : "params"))
              }
              className="flex h-9 items-center justify-center rounded-r-xl text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button></UiProps>
          </div>
        ) : (
          <div className="grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center overflow-visible rounded-[14px] bg-[#f4f4f8] p-0 text-[#1c1c21] shadow-[0_10px_26px_rgba(15,23,42,0.10)] ring-1 ring-black/10 dark:bg-[var(--panel-bg)] dark:text-white dark:shadow-[0_14px_34px_rgba(0,0,0,0.28)] dark:ring-white/10">
            <button
              ref={modelButtonRef}
              type="button"
              disabled={disabled}
              aria-expanded={openPanel === "model"}
              onClick={() =>
                setOpenPanel((value) => (value === "model" ? null : "model"))
              }
              className="flex h-10 min-w-0 items-center gap-2 rounded-l-[14px] px-3 text-left text-[11px] font-medium text-[var(--app-fg)]/75 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-inherit dark:hover:bg-white/10"
            >
              <span
                title={selectedModel?.label || model}
                onWheel={(event) => {
                  const target = event.currentTarget;
                  if (target.scrollWidth <= target.clientWidth) return;
                  event.preventDefault();
                  target.scrollLeft += event.deltaX || event.deltaY;
                }}
                className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {selectedModel?.label || model}
              </span>
              <ChevronDown
                className={[
                  "h-4 w-4 shrink-0 opacity-55 transition-transform dark:opacity-80",
                  openPanel === "model" ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>
            <div className="h-6 w-px bg-black/10 dark:bg-white/30" />
            <button
              ref={paramsButtonRef}
              type="button"
              disabled={disabled}
              aria-expanded={openPanel === "params"}
              onClick={() =>
                setOpenPanel((value) => (value === "params" ? null : "params"))
              }
              className="flex h-10 min-w-0 items-center gap-2 rounded-r-[14px] px-3 text-left text-[11px] font-medium text-[var(--app-fg)]/75 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:text-inherit dark:hover:bg-white/10"
            >
              {!gifOutput && <span className="shrink-0 opacity-80 dark:opacity-90">
                <AspectRatioPreview value={selectedRatio.value} compact />
              </span>}
              <span className="min-w-0 flex-1 truncate">
                {gifOutput ? <UiText id="batch.m2cc28174dd1d" values={{v0: String(gifSize || "512x512"), v1: String(frameCount ?? 9)}} /> : parameterSummary}
              </span>
              <ChevronDown
                className={[
                  "h-4 w-4 shrink-0 opacity-55 transition-transform dark:opacity-80",
                  openPanel === "params" ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>
          </div>
        )}
      </div>
      {floatingPanel}
    </>
  );
}
