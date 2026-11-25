"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  normalizeLiveVideoModelSettings,
  type LiveVideoModel,
  type LiveVideoSettings,
} from "@/hooks/use-live-video-batch-workspace";
import { getAspectRatioPreviewSize } from "@/lib/aspect-ratio-preview";

type ParameterPanel = "model" | "params" | null;

type ParameterOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

function AspectRatioPreview({ value, compact = false }: { value: string; compact?: boolean }) {
  const size = compact ? 14 : 20;
  return (
    <span className={compact ? "flex h-4 w-4 items-center justify-center" : "flex h-5 w-8 items-center justify-center"}>
      <span
        style={getAspectRatioPreviewSize(value, size)}
        className="block rounded-[3px] border border-[var(--app-muted)] bg-transparent"
      />
    </span>
  );
}

function DurationSlider({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange(value: number): void;
}) {
  const selectedIndex = Math.max(0, options.indexOf(value));
  const current = options[selectedIndex] ?? value;
  const min = options[0] ?? value;
  const max = options[options.length - 1] ?? value;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="batch.m271665640dc3" /></span>
        <span className="text-xs text-[var(--app-fg)]">{current}s</span>
      </div>
      <UiProps ids={{"aria-label":["batch.m03c114243e39"]}}><input
        type="range"
        min={0}
        max={Math.max(0, options.length - 1)}
        step={1}
        value={selectedIndex}
        disabled
        aria-label="batch.m03c114243e39"
        onChange={(event) => {
          const duration = options[Number(event.target.value)];
          if (duration !== undefined) onChange(duration);
        }}
        className="h-1.5 w-full cursor-pointer accent-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-40"
      /></UiProps>
      <div className="flex justify-between text-[10px] text-[var(--app-muted)]">
        <span>{min}s</span>
        <span>{max}s</span>
      </div>
    </div>
  );
}

export function LiveVideoParameterDock({
  settings,
  models,
  disabled,
  variant = "default",
  onChange,
}: {
  settings: LiveVideoSettings;
  models: LiveVideoModel[];
  disabled: boolean;
  variant?: "default" | "groupHeader";
  onChange(value: LiveVideoSettings): void;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const groupHeader = variant === "groupHeader";
  const [openPanel, setOpenPanel] = React.useState<ParameterPanel>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties | null>(null);
  const dockRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const modelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const paramsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const model = models.find((entry) => entry.id === settings.model) || models[0];

  React.useEffect(() => {
    if (!openPanel || typeof window === "undefined") {
      setPanelStyle(null);
      return;
    }
    const anchor = openPanel === "model" ? modelButtonRef.current : paramsButtonRef.current;
    if (!anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const dockRect = dockRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = groupHeader
        ? Math.min(340, Math.max(0, viewportWidth - 16))
        : Math.min(dockRect?.width ?? rect.width, Math.max(0, viewportWidth - 16));
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

  const selectModel = (modelId: string) => {
    const nextModel = models.find((entry) => entry.id === modelId);
    if (!nextModel) return;
    onChange(normalizeLiveVideoModelSettings(nextModel, settings));
    setOpenPanel(null);
  };

  const setPanel = (panel: Exclude<ParameterPanel, null>) => {
    setOpenPanel((current) => current === panel ? null : panel);
  };

  const renderOptionGrid = (
    title: string,
    value: string,
    options: ParameterOption[],
    onSelect: (value: string) => void,
    aspectIcons = false,
  ) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-[var(--app-fg)]">{title}</div>
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
              onClick={() => onSelect(option.value)}
              className={[
                "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-40",
                aspectIcons ? "h-[60px] w-[60px] flex-col gap-1 px-0" : "",
                selected
                  ? "border-[var(--app-fg)] bg-[var(--panel-3)] text-[var(--app-fg)]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:border-[var(--border-2)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
              ].join(" ")}
            >
              {aspectIcons ? <AspectRatioPreview value={option.value} /> : null}
              <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const ratioOptions = (model?.supportedRatios || []).map((value) => ({
    value,
    label: value === "adaptive" ? text("workspaceFollowup.m7eb336e42cb5") : value,
  }));
  const resolutionOptions = (model?.supportedResolutions || []).map((value) => ({ value, label: value }));
  const durationOptions = model?.durationOptions || [];
  const audioSupported = Boolean(model?.supportsGenerateAudio);
  const audioOptions: ParameterOption[] = [
    { value: "off", label: text("workspaceFollowup.m3fd47edce45b") },
    { value: "on", label: audioSupported ? text("workspaceFollowup.m8da97ddda990") : text("workspaceFollowup.mb5d72118a10a"), disabled: !audioSupported },
  ];

  const floatingPanel = openPanel && panelStyle && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={panelRef}
        className="max-h-[calc(100vh-32px)] overflow-y-auto rounded-[14px] border border-[var(--border-2)] bg-[var(--panel-bg)] p-3 text-xs shadow-[var(--shadow)]"
        style={panelStyle}
      >
        {openPanel === "model" ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="batch.mc98e118e0a43" /></div>
            <div className="max-h-[336px] space-y-1 overflow-y-auto pr-1">
              {models.map((entry) => {
                const selected = entry.id === settings.model;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => selectModel(entry.id)}
                    className={[
                      "flex w-full rounded-lg border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-[var(--border-2)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[var(--shadow-2)]"
                        : "border-transparent text-[var(--app-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
                    ].join(" ")}
                  >
                    <span className="block break-words text-[13px] font-semibold leading-snug">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {renderOptionGrid(
              "分辨率",
              settings.resolution,
              resolutionOptions,
              (resolution) => onChange({ ...settings, resolution }),
            )}
            {renderOptionGrid(
              "尺寸/比例",
              settings.ratio,
              sortAspectRatioOptions(ratioOptions),
              (ratio) => onChange({ ...settings, ratio }),
              true,
            )}
            <DurationSlider
              value={settings.duration}
              options={durationOptions}
              onChange={(duration) => onChange({ ...settings, duration })}
            />
            {renderOptionGrid(
              "声音",
              settings.generateAudio ? "on" : "off",
              audioOptions,
              (generateAudio) => onChange({
                ...settings,
                generateAudio: audioSupported && generateAudio === "on",
              }),
            )}
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  const summaryRatio = settings.ratio === "adaptive" ? text("workspaceFollowup.m7eb336e42cb5") : settings.ratio;
  const summary = text("workspaceFollowup.m032a466043f6", { v0: summaryRatio, v1: settings.resolution, v2: settings.duration, v3: settings.generateAudio ? text("workspaceFollowup.m3d85e020e1e3") : text("workspaceFollowup.mf9e2ebfa3cbb") });

  return (
    <>
      <div ref={dockRef} className="relative">
        {groupHeader ? (
          <div className="grid w-[148px] grid-cols-[minmax(0,1fr)_1px_40px] items-center rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)]">
            <UiProps ids={{"aria-label":["batch.m845703fc4f24"]}}><button
              ref={modelButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.m845703fc4f24"
              aria-expanded={openPanel === "model"}
              onClick={() => setPanel("model")}
              className="flex h-9 min-w-0 items-center gap-1.5 rounded-l-xl px-3 text-left text-[11px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate"><UiText id="batch.m7122a29a7508" /></span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openPanel === "model" ? "rotate-180" : ""}`} />
            </button></UiProps>
            <div className="h-5 w-px bg-[var(--border)]" />
            <UiProps ids={{"aria-label":["batch.m6366022f4170"]}}><button
              ref={paramsButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.m6366022f4170"
              title={summary}
              aria-expanded={openPanel === "params"}
              onClick={() => setPanel("params")}
              className="flex h-9 items-center justify-center rounded-r-xl text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button></UiProps>
          </div>
        ) : (
          <div className="grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center rounded-[14px] border border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-fg)] shadow-[var(--shadow-2)]">
            <UiProps ids={{"aria-label":["batch.mef8bd8d3b57c"]}}><button
              ref={modelButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.mef8bd8d3b57c"
              aria-expanded={openPanel === "model"}
              onClick={() => setPanel("model")}
              className="flex h-10 min-w-0 items-center gap-2 rounded-l-[14px] px-3 text-left text-[11px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate" title={model?.label || settings.model}>
                {model?.label || settings.model || <UiText id="batch.m1afed6a81a25" />}
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openPanel === "model" ? "rotate-180" : ""}`} />
            </button></UiProps>
            <div className="h-6 w-px bg-[var(--border)]" />
            <UiProps ids={{"aria-label":["batch.m2c3c66d25e6b"]}}><button
              ref={paramsButtonRef}
              type="button"
              disabled={disabled}
              aria-label="batch.m2c3c66d25e6b"
              aria-expanded={openPanel === "params"}
              onClick={() => setPanel("params")}
              className="flex h-10 min-w-0 items-center gap-2 rounded-r-[14px] px-3 text-left text-[11px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AspectRatioPreview value={settings.ratio} compact />
              <span className="min-w-0 flex-1 truncate" title={summary}>{summary}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${openPanel === "params" ? "rotate-180" : ""}`} />
            </button></UiProps>
          </div>
        )}
      </div>
      {floatingPanel}
    </>
  );
}
