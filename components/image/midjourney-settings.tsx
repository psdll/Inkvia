"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, Dices, Minus, Plus, RotateCcw } from "lucide-react";
import {
  DEFAULT_MIDJOURNEY_VERSION,
  MIDJOURNEY_VERSIONS,
  midjourneyBlockedNegativeWord,
  midjourneyVersionCapabilities,
  MIDJOURNEY_V8_SPEEDS,
  parseMidjourneyV8PromptFlags,
  type MidjourneyV8Options,
  type MidjourneyV8ReferenceMode,
  type MidjourneyV8Speed,
} from "@/lib/midjourney-v8";
import { HelpTip } from "@/components/image/seedream-55-settings";

const SPEED_LABELS: Record<MidjourneyV8Speed, string> = { relax: "createDynamic.ma63d2ddd3f94", fast: "createDynamic.mdb945cfe9f9f", turbo: "createDynamic.m89bc4cb34d02" };
const REFERENCE_MODES: { value: MidjourneyV8ReferenceMode; label: string; hint: string }[] = [
  { value: "edits", label: "createDynamic.m8aa39da6eb15", hint: "createDynamic.m3bdb8aa3c0f0" },
  { value: "imagine", label: "createDynamic.mdcdff2bf7690", hint: "createDynamic.m68d9b517474a" },
  { value: "style", label: "createDynamic.m458113a12520", hint: "createDynamic.m081e9c14964d" },
];

type OptionKey = keyof MidjourneyV8Options;

/**
 * 滑杆 + 可直接输入的数值框 + 微调按钮。放在模块顶层（不是渲染函数里的内部组件），拖动时不会被重新挂载。
 * 数值框自己保存正在输入的文字，输到一半的「0.」不会被立刻改掉；回车或失焦时再校正范围和精度。
 */
function ParamSlider({ title, labelNode, value, fallback, min, max, step, nudge, decimals, hint, canReset, disabled, canvas, onChange, onReset }: {
  title: string; labelNode: React.ReactNode; value: number | undefined; fallback: number; min: number; max: number; step: number; nudge: number; decimals: number;
  hint: string; canReset: boolean; disabled: boolean; canvas: boolean; onChange: (value: number) => void; onReset: () => void;
}) {
  const { text } = useUiLocale();
  const current = value ?? fallback;
  const format = (n: number) => String(Number(n.toFixed(decimals)));
  const [draft, setDraft] = React.useState<string>();
  const clamp = (n: number) => Number(Math.min(max, Math.max(min, n)).toFixed(decimals));
  const commit = () => {
    if (draft === undefined) return;
    const parsed = Number(draft.trim());
    setDraft(undefined);
    if (draft.trim() !== "" && Number.isFinite(parsed) && clamp(parsed) !== current) onChange(clamp(parsed));
  };
  const bump = (direction: 1 | -1) => onChange(clamp(Math.round((current + direction * nudge) / nudge) * nudge));
  const fill = `${((current - min) / (max - min)) * 100}%`;
  const control = canvas ? "canvas-task-parameter-option" : "rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]/80 hover:bg-[var(--panel-3)]";
  return <section className={canvas ? "canvas-task-parameter-section" : "space-y-1.5"}>
    <div className="flex items-center justify-between gap-2">
      {labelNode}
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={text("createDynamic.m655f19cb6e3f", { title: title })} disabled={disabled || current <= min} onClick={() => bump(-1)}
          className={`${control} nodrag mj-param-step`}><Minus aria-hidden="true" /></button>
        <input inputMode="decimal" aria-label={text("createDynamic.m4468c4cb3490", { title: title })} disabled={disabled} value={draft ?? format(current)}
          onFocus={event => { setDraft(format(current)); event.currentTarget.select(); }}
          onChange={event => setDraft(event.target.value.replace(/[^\d.]/g, ""))}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
            else if (event.key === "Escape") { setDraft(undefined); event.currentTarget.blur(); }
            else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setDraft(undefined); bump(event.key === "ArrowUp" ? 1 : -1); }
          }}
          className={`${canvas ? "canvas-task-parameter-input" : "rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] outline-none focus:border-[var(--app-fg)]/50"} nodrag mj-param-number ${value === undefined ? "is-default" : ""}`} />
        <button type="button" aria-label={text("createDynamic.mf13a29f11269", { title: title })} disabled={disabled || current >= max} onClick={() => bump(1)}
          className={`${control} nodrag mj-param-step`}><Plus aria-hidden="true" /></button>
        <button type="button" aria-label={text("createDynamic.m4d38626740b0", { title: title })} title={text("createDynamic.mee76a29b6154", { value: format(fallback) })} disabled={disabled || !canReset} onClick={onReset}
          className="mj-param-reset nodrag"><RotateCcw aria-hidden="true" /></button>
      </div>
    </div>
    <input type="range" min={min} max={max} step={step} value={current} disabled={disabled} aria-label={title} title={text("createDynamic.mbede35ad40d2", { hint: hint })}
      style={{ "--fill": fill } as React.CSSProperties}
      onChange={event => { setDraft(undefined); onChange(clamp(Number(event.target.value))); }}
      onDoubleClick={() => canReset && !disabled && onReset()}
      className={`mj-range nodrag nowheel ${canvas ? "is-canvas" : ""}`} />
    <p className="text-[11px] text-[var(--app-muted)]">{value === undefined ? <UiText id="image.m1b05a49aefe2" values={{v0: String(format(fallback))}} /> : ""}{hint}</p>
  </section>;
}

/** 提示词里写了的参数：对应控件置灰并标注，以提示词为准。 */
export function useMidjourneyPromptFlags(prompt: string | undefined) {
  return React.useMemo(() => parseMidjourneyV8PromptFlags(prompt || ""), [prompt]);
}

/** 输入框下方的一行提示：已识别的 --参数，以及不支持的参数（红字）。 */
export function MidjourneyPromptFlagHint({ prompt, canvas = false }: { prompt: string | undefined; canvas?: boolean }) {
  const { error: localizeError } = useUiLocale();
  const parsed = useMidjourneyPromptFlags(prompt);
  const recognized = describeFlags(parsed);
  if (!recognized.length && !parsed.errors.length) return null;
  return <div data-midjourney-flag-hint className={`${canvas ? "nodrag px-1 pt-1" : "pt-1.5"} space-y-0.5 text-[11px] leading-relaxed`}>
    {recognized.length ? <p className="text-[var(--app-muted)]"><UiText id="image.m624a3d66a2d7" />{recognized.join(" · ")}</p> : null}
    {parsed.errors.map(error => <p key={error} className="text-[#e5484d]">{localizeError(error)}</p>)}
  </div>;
}

function describeFlags(parsed: ReturnType<typeof parseMidjourneyV8PromptFlags>) {
  const { options } = parsed;
  const items: string[] = [];
  if (parsed.size) items.push(`--ar ${parsed.size}`);
  if (options.stylize !== undefined) items.push(`--s ${options.stylize}`);
  if (options.chaos !== undefined) items.push(`--c ${options.chaos}`);
  if (options.weird !== undefined) items.push(`--w ${options.weird}`);
  if (options.seed !== undefined) items.push(`--seed ${options.seed}`);
  if (options.quality) items.push(`--q ${options.quality}`);
  if (options.raw) items.push("--raw");
  if (options.hd) items.push("--hd");
  if (options.draft) items.push("--draft");
  if (options.tile) items.push("--tile");
  if (options.negativePrompt) items.push(`--no ${options.negativePrompt}`);
  if (options.sref) items.push("--sref");
  if (options.sw !== undefined) items.push(`--sw ${options.sw}`);
  if (options.iw !== undefined) items.push(`--iw ${options.iw}`);
  if (options.extra) items.push(options.extra);
  return items;
}

export function MidjourneySettings({ speed, options, onChange, prompt, hasReferences = false, canvas = false, disabled = false, showVersion = true }: {
  speed: MidjourneyV8Speed;
  options: MidjourneyV8Options;
  onChange: (patch: { speed?: MidjourneyV8Speed; options?: MidjourneyV8Options }) => void;
  prompt?: string;
  hasReferences?: boolean;
  canvas?: boolean;
  disabled?: boolean;
  /** reAPI 线路只有 V8.2，不显示版本选择 */
  showVersion?: boolean;
}) {
  const { text, label: localizeLabel } = useUiLocale();
  const fromPrompt = useMidjourneyPromptFlags(prompt).options;
  const [moreOpen, setMoreOpen] = React.useState(() => ["chaos", "weird", "seed", "negativePrompt", "quality", "draft", "tile"].some(key => options[key as OptionKey] !== undefined));
  const set = (patch: Partial<MidjourneyV8Options>) => {
    const next: MidjourneyV8Options = { ...options, ...patch };
    for (const key of Object.keys(patch) as OptionKey[]) if (patch[key] === undefined || patch[key] === false || patch[key] === "") delete next[key];
    onChange({ options: next });
  };
  const locked = (key: OptionKey) => fromPrompt[key] !== undefined;
  const sectionClass = canvas ? "canvas-task-parameter-section" : "space-y-2";
  const labelClass = canvas ? "canvas-task-parameter-label" : "text-[12px] font-semibold text-[var(--app-fg)]/90";
  const optionClass = (selected: boolean) => canvas
    ? "canvas-task-parameter-option"
    : `h-9 min-w-0 rounded-lg border px-2 text-[12px] font-semibold transition disabled:opacity-40 ${selected ? "border-[var(--app-fg)] bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]/75 hover:bg-[var(--panel-3)]"}`;
  const inputClass = canvas
    ? "canvas-task-parameter-input"
    : "h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[12px] text-[var(--app-fg)] outline-none focus:border-[var(--app-fg)]/50 disabled:opacity-40";
  // Plain render helpers (not components) so inputs keep their identity while dragging.
  const label = (children: React.ReactNode, flag?: OptionKey) => <div className={`${labelClass} flex items-center justify-between gap-2`}>
    <span>{children}</span>
    {flag && locked(flag) ? <span className="text-[10px] font-normal text-[var(--app-muted)]"><UiText id="image.mf843ceca1388" /></span> : null}
  </div>;
  const version = fromPrompt.version ?? options.version ?? DEFAULT_MIDJOURNEY_VERSION;
  const can = midjourneyVersionCapabilities(version);
  // 只保留该版本真正能用的设置：不支持的选项不显示，存着的旧值也一起清掉，避免提交后失败
  const withoutUnsupported = (nextVersion: MidjourneyV8Options["version"], capsVersion: MidjourneyV8Options["version"] = nextVersion) => {
    const next = midjourneyVersionCapabilities(capsVersion ?? DEFAULT_MIDJOURNEY_VERSION);
    const cleaned: MidjourneyV8Options = { ...options, version: nextVersion };
    if (!nextVersion) delete cleaned.version;
    if (!next.hd) delete cleaned.hd;
    if (!next.draft) delete cleaned.draft;
    if (cleaned.quality && !next.qualities.includes(cleaned.quality)) delete cleaned.quality;
    if (cleaned.referenceMode === "edits" && !next.edits) delete cleaned.referenceMode;
    return { options: cleaned, ...(speed === "turbo" && !next.turbo ? { speed: "fast" as const } : {}) };
  };
  const stale = (options.hd && !can.hd) || (options.draft && !can.draft) || (options.quality && !can.qualities.includes(options.quality)) || (speed === "turbo" && !can.turbo);
  React.useEffect(() => {
    if (stale && !disabled) onChange(withoutUnsupported(options.version, version));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, disabled]);
  // 悬停某个版本时先预览它擅长什么，移开回到当前选中的版本
  const [previewVersion, setPreviewVersion] = React.useState<string>();
  const describedVersion = MIDJOURNEY_VERSIONS.find(item => item.value === (previewVersion ?? version)) ?? MIDJOURNEY_VERSIONS[0];
  const toggle = (flag: "raw" | "hd" | "draft" | "tile", caption: string, title: string) => {
    const on = Boolean(fromPrompt[flag] ?? options[flag]);
    return <button type="button" title={locked(flag) ? text("createDynamic.ma7b36c3e319f", { title: title }) : title} aria-pressed={on} data-selected={on}
      disabled={disabled || locked(flag)} onClick={() => set({ [flag]: !options[flag] })} className={optionClass(on)}>{caption}</button>;
  };
  const slider = (flag: "stylize" | "chaos" | "weird" | "iw" | "sw", title: string, min: number, max: number, step: number, fallback: number, hint: string, nudge = step) =>
    <ParamSlider key={flag} title={title} labelNode={label(title, flag)} value={(fromPrompt[flag] ?? options[flag]) as number | undefined} fallback={fallback}
      min={min} max={max} step={step} nudge={nudge} decimals={flag === "iw" ? 2 : 0} hint={hint} canvas={canvas}
      disabled={disabled || locked(flag)} canReset={options[flag] !== undefined}
      onChange={next => set({ [flag]: next })} onReset={() => set({ [flag]: undefined })} />;
  // 改写原图只有 V8.x 支持；其他版本默认按垫图参考
  const referenceMode = options.referenceMode ?? (can.edits ? "edits" : "imagine");
  const seedValue = fromPrompt.seed ?? options.seed;

  return <div data-midjourney-settings className={canvas ? "canvas-task-parameter-sections" : "space-y-3.5"}>
    <MidjourneyPromptFlagHint prompt={prompt} canvas={canvas} />
    {showVersion ? <section className={sectionClass}>
      {label(<span className="canvas-video-audio-label"><UiText id="image.m5f76b2bf82dd" /><UiProps ids={{"label":["image.m5f76b2bf82dd"]}}><HelpTip label="image.m5f76b2bf82dd">{MIDJOURNEY_VERSIONS.map(item => <span key={item.value} className="block">{text("createDynamic.m06aa207f5caf", { label: item.label, description: localizeLabel(item.strength) })}</span>)}<span className="block"><UiText id="image.macbea34f864e" /></span></HelpTip></UiProps></span>, "version")}
      <div className="grid grid-cols-5 gap-1.5" onMouseLeave={() => setPreviewVersion(undefined)}>
        {MIDJOURNEY_VERSIONS.map(item => <button key={item.value} type="button" disabled={disabled || locked("version")} aria-pressed={version === item.value} data-selected={version === item.value}
          onMouseEnter={() => setPreviewVersion(item.value)} onFocus={() => setPreviewVersion(item.value)} onBlur={() => setPreviewVersion(undefined)}
          onClick={() => {
            // 切到不支持的版本时，顺手关掉该版本用不了的选项，避免提交失败
            onChange(withoutUnsupported(item.value === DEFAULT_MIDJOURNEY_VERSION ? undefined : item.value));
          }} className={optionClass(version === item.value)}>{item.label}</button>)}
      </div>
      <p className="text-[11px] leading-[1.55] text-[var(--app-muted)]" aria-live="polite">
        <span className="font-semibold text-[var(--app-fg)]/80">{describedVersion.label}</span> {localizeLabel(describedVersion.strength)}
        <span className="block opacity-80">{localizeLabel(describedVersion.note)}</span>
      </p>
    </section> : null}
    <section className={sectionClass}>
      {label(text("createDynamic.m0e14d148b46b"))}
      <div className={`grid gap-1.5 ${can.turbo ? "grid-cols-3" : "grid-cols-2"}`}>
        {MIDJOURNEY_V8_SPEEDS.filter(value => value !== "turbo" || can.turbo).map(value => <button key={value} type="button" disabled={disabled} aria-pressed={speed === value} data-selected={speed === value}
          onClick={() => onChange({ speed: value })} className={optionClass(speed === value)}>{text(SPEED_LABELS[value])}</button>)}
      </div>
    </section>
    <section className={sectionClass}>
      {label(text("createDynamic.meb47ac880264"))}
      <div className={`grid gap-1.5 ${can.hd ? "grid-cols-2" : "grid-cols-1"}`}>
        {can.hd ? toggle("hd", text("createDynamic.m4c710293752e"), text("createDynamic.m62f254813201")) : null}
        {toggle("raw", text("createDynamic.me0ac88268dc0"), text("createDynamic.mcfcc0800dfb9"))}
      </div>
    </section>
    {slider("stylize", text("createDynamic.m4414d1e06d2b"), 0, 1000, 10, 100, text("createDynamic.m0646281ad5e6"))}
    {hasReferences ? <>
      <section className={sectionClass}>
        {label(text("createDynamic.md9986b232214"))}
        <div className={`grid gap-1.5 ${can.edits ? "grid-cols-3" : "grid-cols-2"}`}>
          {REFERENCE_MODES.filter(mode => mode.value !== "edits" || can.edits).map(mode => {
            return <button key={mode.value} type="button" title={text(mode.hint)} disabled={disabled} aria-pressed={referenceMode === mode.value} data-selected={referenceMode === mode.value}
              onClick={() => set({ referenceMode: mode.value === (can.edits ? "edits" : "imagine") ? undefined : mode.value })} className={optionClass(referenceMode === mode.value)}>{text(mode.label)}</button>;
          })}
        </div>
        <p className="text-[11px] text-[var(--app-muted)]">{REFERENCE_MODES.filter(mode => mode.value === referenceMode).map(mode => text(mode.hint))}</p>
      </section>
      {referenceMode === "imagine" ? slider("iw", text("createDynamic.m4613205a1d81"), 0, 3, 0.05, 1, text("createDynamic.m78ee195995cc"), 0.1) : null}
      {referenceMode === "style" ? slider("sw", text("createDynamic.m63c9fd8fc787"), 0, 1000, 10, 100, text("createDynamic.m31874903bfc4")) : null}
    </> : null}
    <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)}
      className={`nodrag flex w-full items-center justify-between rounded-lg px-1 py-1 text-[12px] ${canvas ? "text-[var(--canvas-controls-text-muted,var(--app-muted))]" : "text-[var(--app-muted)]"} hover:text-[var(--app-fg)]`}>
      <span><UiText id="image.mf57deccf47eb" /></span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
    </button>
    {moreOpen ? <>
      {slider("chaos", text("createDynamic.m7ace82415ecf"), 0, 100, 1, 0, text("createDynamic.ma4791c665546"), 5)}
      {slider("weird", text("createDynamic.m63e9b406f8e4"), 0, 3000, 50, 0, text("createDynamic.ma591298f4ba8"))}
      {can.qualities.length ? <section className={sectionClass}>
        {label(text("createDynamic.m55847d2e5bed"), "quality")}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${can.qualities.length + 1}, minmax(0, 1fr))` }}>
          {([undefined, ...can.qualities] as const).map(value => {
            const current = fromPrompt.quality ?? options.quality;
            return <button key={value ?? "default"} type="button" disabled={disabled || locked("quality")} aria-pressed={current === value} data-selected={current === value}
              onClick={() => set({ quality: value })} className={optionClass(current === value)}>{value ?? <UiText id="image.m844b8cc8dff7" />}</button>;
          })}
        </div>
        <p className="text-[11px] text-[var(--app-muted)]"><UiText id="image.m1989eef931ff" /></p>
      </section> : null}
      <section className={sectionClass}>
        {label(text("createDynamic.m5e20fc223736"), "seed")}
        <div className="flex items-center gap-1.5">
          <UiProps ids={{"placeholder":["image.m75ca4f921437"],"aria-label":["image.m5e20fc223736"]}}><input inputMode="numeric" placeholder="image.m75ca4f921437" value={seedValue ?? ""} disabled={disabled || locked("seed")} aria-label="image.m5e20fc223736"
            onChange={event => { const text = event.target.value.replace(/\D/g, "").slice(0, 10); set({ seed: text ? Math.min(Number(text), 4294967295) : undefined }); }}
            className={`${inputClass} nodrag flex-1`} /></UiProps>
          <UiProps ids={{"aria-label":["image.m30eca98dc1ab"],"title":["image.md0b4fb99c469"]}}><button type="button" aria-label="image.m30eca98dc1ab" title="image.md0b4fb99c469" disabled={disabled || locked("seed")} onClick={() => set({ seed: Math.floor(Math.random() * 4294967295) })}
            className={`${optionClass(false)} flex !w-9 shrink-0 items-center justify-center !px-0`}><Dices className="h-4 w-4" /></button></UiProps>
        </div>
        <p className="text-[11px] text-[var(--app-muted)]"><UiText id="image.m7302e07aac03" /></p>
      </section>
      <section className={sectionClass}>
        {label(text("createDynamic.m869957768094"), "negativePrompt")}
        {/* 内容多时自动变高，也可以拖右下角自己拉高；--no 是一行逗号分隔的词，回车和换行都转成逗号 */}
        <UiProps ids={{"placeholder":["image.m281d84227617"],"aria-label":["image.m869957768094"]}}><textarea rows={2} placeholder="image.m281d84227617" value={options.negativePrompt ?? ""} disabled={disabled} aria-label="image.m869957768094"
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
          onChange={event => set({ negativePrompt: event.target.value.replace(/\s*[\r\n]+\s*/g, ", ") || undefined })}
          className={`${inputClass.replace("h-9 ", "")} midjourney-negative-input nodrag nowheel`} /></UiProps>
        {midjourneyBlockedNegativeWord(options.negativePrompt)
          ? <p role="alert" className="text-[11px] leading-[1.5] text-[#ff8a80]">「{midjourneyBlockedNegativeWord(options.negativePrompt)}<UiText id="image.mda608cb4f047" /></p>
          : <p className="text-[11px] text-[var(--app-muted)]"><UiText id="image.m23eea09105bd" /></p>}
      </section>
      <section className={sectionClass}>
        {label(text("createDynamic.md2909f1647e7"))}
        <div className={`grid gap-1.5 ${can.draft ? "grid-cols-2" : "grid-cols-1"}`}>
          {can.draft ? toggle("draft", text("createDynamic.m31bdb08d6210"), text("createDynamic.mc67ab31f40eb")) : null}
          {toggle("tile", text("createDynamic.meaaeb1bfefd8"), text("createDynamic.m0eaf3466c279"))}
        </div>
      </section>
    </> : null}
  </div>;
}
