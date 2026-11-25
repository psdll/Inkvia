"use client";
import { UiText } from "@/i18n/ui";
import { useCreateLocalization } from "@/components/studio/create-localization";


import * as React from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { getGoogleImageOptions, normalizeGoogleImageSettings, type GoogleImageSettings as Settings } from "@/lib/google-image-settings";

const qualityHelp: Record<string, string> = {
  minimal: "createDynamic.mf496655bca1a",
  medium: "createDynamic.mdc6259310d8f",
  high: "createDynamic.m1fa4d19c4349",
};
const searchHelp: Record<string, string> = {
  off: "createDynamic.ma8e473da2469",
  web: "createDynamic.m20ea31ecf56f",
  image: "createDynamic.m4621d74ca83c",
  web_image: "createDynamic.m032a43b4595b",
};

function SettingsHelp({ title, items, quality }: { title: string; items: readonly { value: string; label: string }[]; quality: boolean }) {
  const { text, parameterLabel } = useCreateLocalization();
  const id = React.useId();
  const [position, setPosition] = React.useState<{ left: number; top: number; above: boolean } | null>(null);
  const show = (event: React.SyntheticEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.top > 280;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 316)), top: above ? rect.top - 8 : rect.bottom + 8, above });
  };
  React.useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [position]);
  return <>
    <button type="button" aria-label={text("createDynamic.m6ddbbccd0759", { title: title })} aria-describedby={position ? id : undefined}
      className="nodrag nopan inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--app-muted)] outline-none hover:text-[var(--app-fg)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
      onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); } }}>
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    {position && createPortal(<div id={id} role="tooltip"
      className="pointer-events-none fixed z-[10000] w-[304px] max-w-[calc(100vw-24px)] space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-[11px] font-normal leading-relaxed text-[var(--app-fg)] shadow-[var(--shadow)]"
      style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}>
      <div className="text-xs font-medium">{text("createDynamic.m6ddbbccd0759", { title: title })}</div>
      {items.map(item => <p key={item.value}><span className="font-medium">{text("createDynamic.m6783c924ee01", { label: parameterLabel(item.label) })}</span>{text((quality ? qualityHelp : searchHelp)[item.value])}</p>)}
      <p className="border-t border-[var(--border)] pt-2 text-[var(--app-muted)]">{quality ? <UiText id="image.m0792efda9cae" /> : <UiText id="image.mf06f87e90f1b" />}</p>
    </div>, document.body)}
  </>;
}

export function GoogleImageSettings({ model, settings, onChange, disabled = false, canvas = false }: {
  model: string;
  settings: Settings;
  onChange: (patch: Settings) => void;
  disabled?: boolean;
  canvas?: boolean;
}) {
  const { text, parameterLabel } = useCreateLocalization();
  const options = getGoogleImageOptions(model);
  if (!options) return null;
  const selected = normalizeGoogleImageSettings(model, settings);
  return <div className={canvas ? "canvas-task-parameter-sections" : "space-y-3.5"}>
    {([
      [text("createDynamic.m77ccdb7ba817"), "googleThinkingLevel", options.thinking],
      [text("createDynamic.m44ce7ae909bb"), "googleSearchMode", options.search],
    ] as const).map(([title, key, items]) => items.length ? <section key={key} aria-label={title} className={canvas ? "canvas-task-parameter-section" : "space-y-2"}>
      <div className={`${canvas ? "canvas-task-parameter-label" : "text-[12px] font-semibold text-[var(--app-fg)]/90"} flex items-center gap-1`}>
        <span>{title}</span><SettingsHelp title={title} items={items} quality={key === "googleThinkingLevel"} />
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(option => <button key={option.value} type="button" disabled={disabled} aria-pressed={selected[key] === option.value} data-selected={selected[key] === option.value}
          onClick={() => onChange({ [key]: option.value })}
          className={canvas ? "canvas-task-parameter-option" : `h-9 min-w-0 rounded-lg border px-2 text-[12px] font-semibold transition disabled:opacity-40 ${selected[key] === option.value ? "border-[var(--app-fg)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]/75 hover:bg-[var(--panel-3)]"}`}
        >{parameterLabel(option.label)}</button>)}
      </div>
    </section> : null)}
  </div>;
}
