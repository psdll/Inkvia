"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

import { CanvasTaskParameterPopover } from "./CanvasTaskParameterPopover";
import {
  EMPTY_CANVAS_VOICE_FILTERS,
  type CanvasMiniMaxVoice,
  type CanvasVoiceAge,
  type CanvasVoiceFilters,
} from "@/lib/canvas/minimax-voice-library";

const LANGUAGE_LABELS: Record<string, string> = {
  zh: "中文",
  yue: "粤语",
  en: "英文",
  ja: "日文",
  ko: "韩文",
  es: "西班牙语",
  pt: "葡萄牙语",
  fr: "法语",
  id: "印度尼西亚语",
  de: "德语",
  ru: "俄语",
  it: "意大利语",
  ar: "阿拉伯语",
  tr: "土耳其语",
  uk: "乌克兰语",
  nl: "荷兰语",
  vi: "越南语",
  th: "泰语",
  pl: "波兰语",
  ro: "罗马尼亚语",
  el: "希腊语",
  cs: "捷克语",
  fi: "芬兰语",
  hi: "印地语",
  multi: "多语种",
};

const ACCENT_LABELS: Record<string, string> = {
  mandarin: "普通话",
};

const AGE_OPTIONS: Array<{ value: CanvasVoiceAge; label: string }> = [
  { value: "youth", label: "青年" },
  { value: "adult", label: "成年" },
  { value: "child", label: "儿童" },
  { value: "senior", label: "老年" },
];

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function VoiceFilterSelect({ label, value, options, onChange, open, onOpenChange }: {
  label: string; value: string[]; options: Array<{ value: string; label: string }>; onChange: (value: string[]) => void;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { text, locale, label: uiLabel } = useUiLocale();
  const anchor = React.useRef<HTMLButtonElement>(null);
  const all = locale === "en" ? text("common.m5c55a67935af") : `全部${label}`;
  const summary = value.length
    ? options.filter((option) => value.includes(option.value)).map((option) => uiLabel(option.label)).join(locale === "en" ? ", " : "、")
    : all;
  return <div className="canvas-voice-filter-field">
    <span>{uiLabel(label)}</span>
    <button ref={anchor} type="button" className="canvas-voice-filter-select" aria-label={uiLabel(label)} aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <span className="canvas-voice-filter-check" data-checked={value.length > 0 || undefined}>{value.length > 0 && <Check />}</span><span>{summary}</span><ChevronDown />
    </button>
    <CanvasTaskParameterPopover open={open} anchorRef={anchor} onClose={() => onOpenChange(false)} width={anchor.current?.offsetWidth || 220} maxHeight={400} side="bottom" align="start" className="canvas-voice-filter-menu">
      <div role="menu" aria-label={text("workspaceFollowup.mb0391ad6250d", { v0: label })}>
        {[{ value: "", label: all }, ...options].map((option) => {
          const selected = option.value ? value.includes(option.value) : value.length === 0;
          return <button type="button" key={option.value} role="menuitemcheckbox" aria-checked={selected} onClick={() => onChange(!option.value ? [] : selected ? value.filter((item) => item !== option.value) : [...value, option.value])}>
            <span className="canvas-voice-filter-check" data-checked={selected || undefined}>{selected && <Check />}</span>{uiLabel(option.label)}
          </button>;
        })}
      </div>
    </CanvasTaskParameterPopover>
  </div>;
}

export function CanvasMiniMaxVoiceFilterDialog({
  open,
  voices,
  applied,
  onApply,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  voices: CanvasMiniMaxVoice[];
  applied: CanvasVoiceFilters;
  onApply: (filters: CanvasVoiceFilters) => void;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement>;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const [draft, setDraft] = React.useState<CanvasVoiceFilters>(applied);
  const [openField, setOpenField] = React.useState<string | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    setDraft({ ...applied, ages: [...applied.ages] });
    setOpenField(null);
    requestAnimationFrame(() => closeRef.current?.focus());
  }, [applied, open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".canvas-voice-filter-menu")) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      queueMicrotask(() => returnFocusRef?.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, open, returnFocusRef]);

  if (!open || typeof document === "undefined") return null;

  const languages = unique(voices.map((voice) => voice.language));
  const accents = unique(
    voices
      .filter((voice) => !draft.language.length || draft.language.includes(voice.language || ""))
      .map((voice) => voice.accent),
  );
  const close = () => {
    onClose();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  };

  return createPortal(
    <div
      className="canvas-minimax-voice-secondary-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="canvas-minimax-voice-filter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="canvas-minimax-voice-secondary-header">
          <h3 id={titleId}><UiText id="canvas.mb5f15473fdc0" /></h3>
          <UiProps ids={{"aria-label":["canvas.m1eb6fcaa78d1"]}}><button ref={closeRef} type="button" aria-label="canvas.m1eb6fcaa78d1" onClick={close}>
            <X aria-hidden="true" />
          </button></UiProps>
        </header>
        <div className="canvas-minimax-voice-filter-body">
            <UiProps ids={{"label":["canvas.m9f6fee1aba17"]}}><VoiceFilterSelect
              label="canvas.m9f6fee1aba17"
              open={openField === "language"}
              onOpenChange={(next) => setOpenField(next ? "language" : null)}
              value={draft.language}
              onChange={(language) =>
                setDraft((current) => ({
                  ...current,
                  language,
                  accent: [],
                }))
              }
              options={[
                ...languages.map((value) => ({
                  value,
                  label: LANGUAGE_LABELS[value] || value,
                })),
              ]}
            /></UiProps>
            <UiProps ids={{"label":["canvas.m21a68f71eab3"]}}><VoiceFilterSelect
              label="canvas.m21a68f71eab3"
              open={openField === "accent"}
              onOpenChange={(next) => setOpenField(next ? "accent" : null)}
              value={draft.accent}
              onChange={(accent) =>
                setDraft((current) => ({ ...current, accent }))
              }
              options={[
                ...accents.map((value) => ({
                  value,
                  label: ACCENT_LABELS[value] || value,
                })),
              ]}
            /></UiProps>
            <UiProps ids={{"label":["canvas.ma752a7d8c127"]}}><VoiceFilterSelect
              label="canvas.ma752a7d8c127"
              open={openField === "gender"}
              onOpenChange={(next) => setOpenField(next ? "gender" : null)}
              value={draft.gender}
              onChange={(gender) =>
                setDraft((current) => ({
                  ...current,
                  gender: gender as CanvasVoiceFilters["gender"],
                }))
              }
              options={[
                { value: "male", label: text("workspaceFollowup.m4e79758a9900") },
                { value: "female", label: text("workspaceFollowup.m0ab4610b9257") },
                { value: "character", label: text("workspaceFollowup.mc47b54e84e79") },
                { value: "unknown", label: text("workspaceFollowup.m4d8c1c5b4283") },
              ]}
            /></UiProps>
          <fieldset>
            <legend><UiText id="canvas.m9ee831fcb82d" /></legend>
            <div className="canvas-minimax-voice-age-options">
              {AGE_OPTIONS.map((option) => {
                const selected = draft.ages.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        ages: selected
                          ? current.ages.filter((value) => value !== option.value)
                          : [...current.ages, option.value],
                      }))
                    }
                  >
                    {uiLabel(option.label)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <footer className="canvas-minimax-voice-secondary-footer">
          <button
            type="button"
            className="is-secondary"
            onClick={() =>
              setDraft({ ...EMPTY_CANVAS_VOICE_FILTERS, ages: [] })
            }
          ><UiText id="canvas.m432be5625e37" /></button>
          <button
            type="button"
            className="is-primary"
            onClick={() => {
              onApply({ ...draft, ages: [...draft.ages] });
              close();
            }}
          ><UiText id="canvas.mb5f15473fdc0" /></button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
