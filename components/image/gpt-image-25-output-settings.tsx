"use client";
import { UiProps, UiText } from "@/i18n/ui";

import { useCreateLocalization } from "@/components/studio/create-localization";
import { isSeedream55Model } from "@/lib/volcengine-seedream-55";

import { Seedream55SettingsPanel } from "@/components/image/seedream-55-settings";
import { type Seedream55Settings } from "@/lib/apimart-seedream-55";
import * as React from "react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { getImageBackgroundOptions, supportsImageBackground } from "@/lib/gpt-image-25-models";
import { buildGptImage26GifParams, getApimartGptImage26GifMaxSize, getGptImage26MaxFrames, supportsGptImage26Gif, type GptImage26AnimationSettings } from "@/lib/gpt-image-26-animation";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";

export type ImageOutputSettingsPatch = GptImage26AnimationSettings & { background?: string; outputFormat?: string; seedream55?: Seedream55Settings };

// UI shortcuts expressed in pixels; the provider accepts custom dimensions too.
const GIF_MEDIUM_FRAME_EDGE = 768;
const GIF_SIZE_PRESETS = [
  { value: "512x512", mediumValue: "768x768", ratio: "1:1" },
  { value: "512x288", mediumValue: "768x432", ratio: "16:9" },
  { value: "512x384", mediumValue: "768x576", ratio: "4:3" },
  { value: "288x512", mediumValue: "432x768", ratio: "9:16" },
  { value: "384x512", mediumValue: "576x768", ratio: "3:4" },
];

export function GptImage25OutputSettings({ model, background = "auto", outputFormat = "png", gifSize = "512x512", frameCount = 9, frameDurationMs = 200, seedream55, onChange, disabled = false, canvas = false, compact = false }: GptImage26AnimationSettings & {
  seedream55?: Seedream55Settings;
  model: string;
  background?: string;
  outputFormat?: string;
  onChange: (patch: ImageOutputSettingsPatch) => void;
  disabled?: boolean;
  canvas?: boolean;
  compact?: boolean;
}) {
  const { text, parameterLabel, locale, error: localizeError } = useCreateLocalization();
  const [customSizeSelected, setCustomSizeSelected] = React.useState(false);
  const supportsGif = supportsGptImage26Gif(model);
  const gif = supportsGif && outputFormat === "gif";
  const apimartPresetSize = model === APIMART_GPT_IMAGE_26_MODEL_ID;
  // Recognize saved presets from any frame count; arbitrary custom pixels stay unchanged.
  const selectedPreset = GIF_SIZE_PRESETS.find(option => option.value === gifSize || option.mediumValue === gifSize || (apimartPresetSize
    && Array.from({ length: 15 }, (_, index) => index + 2).some(frames => getApimartGptImage26GifMaxSize(option.ratio, frames) === gifSize
      || getApimartGptImage26GifMaxSize(option.ratio, frames, GIF_MEDIUM_FRAME_EDGE) === gifSize)));
  const customSize = customSizeSelected || !selectedPreset;
  const presetSize = selectedPreset ? (apimartPresetSize
    ? getApimartGptImage26GifMaxSize(selectedPreset.ratio, frameCount, GIF_MEDIUM_FRAME_EDGE)
    : selectedPreset.mediumValue) : null;
  React.useEffect(() => {
    if (gif && !customSize && !disabled && !compact && presetSize && presetSize !== gifSize) onChange({ gifSize: presetSize });
  }, [gif, customSize, disabled, compact, presetSize, gifSize, onChange]);
  if (!supportsImageBackground(model)) return null;
  const options = getImageBackgroundOptions(model).map(option => ({ ...option, label: parameterLabel(option.label) }));
  const sizePresets = GIF_SIZE_PRESETS.map(option => {
    const value = (apimartPresetSize ? getApimartGptImage26GifMaxSize(option.ratio, frameCount, GIF_MEDIUM_FRAME_EDGE) : null) || option.mediumValue;
    return { value, label: value.replace("x", " × "), ratio: option.ratio };
  });
  const [gifWidth = "", gifHeight = ""] = gifSize.toLowerCase().split("x");
  let animationError = "";
  if (gif) {
    try { buildGptImage26GifParams({ model, outputFormat, gifSize, frameCount, frameDurationMs, background }); }
    catch (error) { animationError = (error as Error).message; }
  }
  const sectionClass = canvas ? "canvas-task-parameter-section" : "space-y-2";
  const labelClass = canvas ? "canvas-task-parameter-label" : "text-[12px] font-semibold text-[var(--app-fg)]";
  const buttonClass = canvas ? "canvas-task-parameter-option" : "rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-2 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] aria-pressed:border-[var(--border-2)] aria-pressed:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-40";
  const inputClass = "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--app-fg)]";
  if (compact) return <FrostedSelect compact variant="toolbar" ariaLabel={text("createDynamic.m5d1d118214c5")} value={background} disabled={disabled} options={options}
    onChange={(background) => onChange({ background })} />;
  return <>
    {isSeedream55Model(model) ? <Seedream55SettingsPanel value={seedream55} onChange={value => onChange({ seedream55: value })} disabled={disabled} canvas={canvas} /> : null}
    {supportsGif ? <UiProps ids={{"aria-label":["image.m41d0e52f0a91"]}}><section className={sectionClass} aria-label="image.m41d0e52f0a91">
      <div className={labelClass}><UiText id="image.m41d0e52f0a91" /></div>
      <div className="grid grid-cols-2 gap-2">
        {[{ value: "png", label: text("createDynamic.mb5b4c8ebbe9a") }, { value: "gif", label: text("createDynamic.mbf6f203256b8") }].map(option =>
          <button key={option.value} type="button" aria-pressed={(gif ? "gif" : "png") === option.value}
            data-selected={(gif ? "gif" : "png") === option.value} disabled={disabled} className={buttonClass}
            onClick={() => onChange({ outputFormat: option.value, ...(option.value === "gif" ? { background: "auto" } : {}) })}>{option.label}</button>)}
      </div>
    </section></UiProps> : null}
    {gif ? <UiProps ids={{"aria-label":["image.m5493e2dfe42f"]}}><section className={`${sectionClass} gpt-image-gif-controls`} data-canvas={canvas} aria-label="image.m5493e2dfe42f">
      <UiProps ids={{"aria-label":["image.m376beb104949"]}}><div className="space-y-2" role="group" aria-label="image.m376beb104949">
        <div className={labelClass}><UiText id="image.m246df7d8db84" /></div>
        <div className="grid grid-cols-3 gap-2">
          {sizePresets.map(option => {
            let unavailable = false;
            try { buildGptImage26GifParams({ model, outputFormat: "gif", gifSize: option.value, frameCount }); }
            catch { unavailable = true; }
            const selected = !customSize && (presetSize || gifSize) === option.value;
            return <UiProps key={option.ratio} ids={{"title":["image.m8e39d4461559"]}}><button  type="button" className={`${buttonClass} gpt-image-gif-size`}
              aria-label={`${option.ratio} · ${option.label}`} title={unavailable ? "image.m8e39d4461559" : option.ratio}
              aria-pressed={selected} data-selected={selected} disabled={disabled || unavailable}
              onClick={() => { setCustomSizeSelected(false); onChange({ gifSize: option.value }); }}>{option.label}</button></UiProps>;
          })}
          <button type="button" className={`${buttonClass} gpt-image-gif-size`} aria-pressed={customSize} data-selected={customSize}
            disabled={disabled} onClick={() => setCustomSizeSelected(true)}><UiText id="image.m8a2e28474a49" /></button>
        </div>
      </div></UiProps>
      {customSize ? <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className={labelClass}><UiText id="image.m8e0c9f3bcb6a" /></span>
          <UiProps ids={{"aria-label":["image.m8334907310bd"]}}><input aria-label="image.m8334907310bd" className={inputClass} type="number" min={16} step={16} value={gifWidth}
            disabled={disabled} onChange={event => onChange({ gifSize: `${event.target.value}x${gifHeight}` })} /></UiProps>
        </label>
        <label className="space-y-1"><span className={labelClass}><UiText id="image.m6e7c067a14b4" /></span>
          <UiProps ids={{"aria-label":["image.mb6bbad9adb49"]}}><input aria-label="image.mb6bbad9adb49" className={inputClass} type="number" min={16} step={16} value={gifHeight}
            disabled={disabled} onChange={event => onChange({ gifSize: `${gifWidth}x${event.target.value}` })} /></UiProps>
        </label>
      </div> : null}
      {customSize ? <p className="text-[11px] text-[var(--app-muted)]"><UiText id="image.ma7fd7e9244c7" /></p> : null}
      {([
        { key: "frameCount", label: text("createDynamic.m64332ae340ca"), ariaLabel: text("createDynamic.m7b8632d39b1e"), value: frameCount, min: 2, max: getGptImage26MaxFrames(model), step: 1, unit: text("createDynamic.mb9d33622822b") },
        { key: "frameDurationMs", label: text("createDynamic.m0774bbbe7683"), ariaLabel: text("createDynamic.mb3a8edea0cdb"), value: frameDurationMs, min: 20, max: apimartPresetSize ? undefined : 2000, step: 10, unit: "ms" },
      ] as const).map(control => {
        const sliderMax = control.max ?? Math.max(2000, control.value);
        const progress = Math.max(0, Math.min(100, (control.value - control.min) / (sliderMax - control.min) * 100));
        return <div key={control.key} className="gpt-image-gif-slider-row">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>{control.label}</span>
            <label className="gpt-image-gif-value">
              <input aria-label={control.ariaLabel} type="number" min={control.min} max={control.max} step={control.step}
                value={control.value} disabled={disabled} onChange={event => onChange({ [control.key]: Number(event.target.value) })} />
              <span>{control.unit}</span>
            </label>
          </div>
          <input type="range" className="gpt-image-gif-slider nodrag nopan" aria-label={text("createDynamic.mf58237404956", { label: control.ariaLabel })}
            aria-valuetext={locale === "en" ? `${control.value} ${control.unit}` : `${control.value}${control.unit}`} min={control.min} max={sliderMax} step={control.step} value={control.value}
            style={{ "--gif-slider-progress": `${progress}%` } as React.CSSProperties} disabled={disabled}
            onChange={event => onChange({ [control.key]: Number(event.target.value) })} />
        </div>;
      })}
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass}><UiText id="image.m87d30b49521b" /></span>
        <UiProps ids={{"aria-label":["image.m1a0390399cd6"]}}><output aria-label="image.m1a0390399cd6" className="text-[12px] tabular-nums text-[var(--app-muted)]">{(frameCount * frameDurationMs / 1000).toFixed(2)}<UiText id="image.m00fe8dda1fd7" /></output></UiProps>
      </div>
      {animationError ? <p role="alert" className="text-[11px] text-[color:var(--danger,#ef4444)]">{localizeError(animationError)}</p> : null}
    </section></UiProps> : isSeedream55Model(model) && seedream55?.layerDecomposition ? null : <UiProps ids={{"aria-label":["image.mf4b669c55756"]}}><section className={sectionClass} aria-label="image.mf4b669c55756">
      <div className={canvas ? "canvas-task-parameter-label" : "text-[12px] font-semibold text-[var(--app-fg)]"}><UiText id="image.mf4b669c55756" /></div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => <button key={option.value} type="button" aria-pressed={background === option.value} data-selected={background === option.value}
          disabled={disabled}
          onClick={() => onChange({ background: option.value })}
          className={canvas ? "canvas-task-parameter-option" : "rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-2 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] aria-pressed:border-[var(--border-2)] aria-pressed:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-40"}
        >{option.label}</button>)}
      </div>
  </section></UiProps>}
  </>;
}
