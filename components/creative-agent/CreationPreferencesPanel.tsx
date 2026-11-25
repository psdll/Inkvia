"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Scan, X } from "lucide-react";
import { LLM_THINKING_LABELS, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";
import { getImageModelParams, type ImageModelParams, type SelectOption } from "@/lib/generation/image-model-params";
import { expandGptImage25ModelOptions, resolveGptImage25Selection, type GptImage25VariantOptions } from "@/lib/gpt-image-25-models";
import type { Sora2ModelSpec } from "@/lib/sora2";
import type { CreativeAgentImagePreference, CreativeAgentVideoPreference } from "@/lib/creative-agent/preferences";
import type { CreationPreferences } from "./creation-preferences-cache";
import { etaLabel, formatTokens, imageProfile, videoProfile, IMAGE_MODEL_PROFILES, VIDEO_MODEL_PROFILES } from "@/lib/creative-agent/v3/model-profiles";
import styles from "./creation-preferences.module.css";

/** 模型下方的一句话定位与大致耗时（来自实测画像；没有画像的模型不显示，避免编造） */
function modelDetail(kind: "image" | "video", id: string) {
  const base = resolveGptImage25Selection(id).model || id;
  if (kind === "image") return IMAGE_MODEL_PROFILES[base] ? `${imageProfile(base).note} · ${etaLabel(imageProfile(base).speed)}` : undefined;
  return VIDEO_MODEL_PROFILES[base] ? `${videoProfile(base).note}` : undefined;
}

export type CreationPreferenceTab = "chat" | "video" | "image";
export type CreationModelCatalog = {
  chat: { providerId: string; modelId: string; label?: string; supportsVision?: boolean; contextWindow?: number; thinkingLevels?: LlmThinkingLevel[]; thinkingDefault?: LlmThinkingLevel }[];
  image: ({ id: string; label: string; params: ImageModelParams } & GptImage25VariantOptions)[];
  video: { id: string; label: string; params: Sora2ModelSpec }[];
};
const chatKey = (model: { providerId: string; modelId: string }) => `${model.providerId}::${model.modelId}`;
const videoRatios = (spec: Sora2ModelSpec) => spec.supportedRatios ?? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const videoDurations = (spec: Sora2ModelSpec) => spec.durationOptions ?? Array.from({ length: spec.maxDurationSeconds - spec.minDurationSeconds + 1 }, (_, index) => spec.minDurationSeconds + index);
const supports = (value: string | undefined, options: SelectOption[]) => value === undefined || options.some(option => option.value === value && !option.disabled);
const imageConfig = (model: CreationModelCatalog["image"][number], params?: CreativeAgentImagePreference["params"]): ImageModelParams => {
  const linked = getImageModelParams(model.id, params?.resolution, params?.aspectRatio);
  const intersect = (visible: SelectOption[], supported: SelectOption[]) => visible.filter(option => supported.some(item => item.value === option.value)).map(option => ({...option, disabled: Boolean(option.disabled || supported.find(item => item.value === option.value)?.disabled)}));
  return {...model.params, aspectRatios:intersect(model.params.aspectRatios,linked.aspectRatios), resolutions:intersect(model.params.resolutions,linked.resolutions), qualities:intersect(model.params.qualities,linked.qualities), backgrounds:intersect(model.params.backgrounds ?? [],linked.backgrounds ?? [])};
};
const imageOptions = (catalog: CreationModelCatalog | null) => expandGptImage25ModelOptions((catalog?.image ?? []).map(model => ({...model,value:model.id})));
const selectedImage = (model: CreationModelCatalog["image"][number], value?: string, catalog?: CreationModelCatalog | null) => resolveGptImage25Selection(value ?? "").model === model.id && imageOptions(catalog ?? null).some(option => option.value === value);
const union = (options: SelectOption[][]) => [...new Set(options.flat().map(option => option.value))].map(value => {
  const choices = options.flat().filter(option => option.value === value);
  return { ...choices[0], disabled: choices.every(option => option.disabled) };
});
const option = (value: string | number): SelectOption => ({ value: String(value), label: String(value) });

export function creationPreferencesConflict(value: CreationPreferences, catalog: CreationModelCatalog | null): string[] {
  if (!catalog) return [];
  const conflicts: string[] = [];
  const selected = value.model;
  const chat = catalog.chat.find(model => chatKey(model) === selected);
  if (value.model && !chat) conflicts.push("对话模型已不可用，请在模型页重新选择。");
  if (chat && !(chat.thinkingLevels ?? ["default"]).includes(value.thinkingLevel)) conflicts.push("当前对话模型不支持已保存的思考强度，请恢复默认或重新选择。");
  const image = value.media.image;
  if (image) {
    const candidates = catalog.image.filter(model => image.mode === "auto" || selectedImage(model,image.model,catalog));
    if (!candidates.length) conflicts.push("图片模型已不可用，请在图片偏好中选择可用模型。");
    else if (!candidates.some(model => {
      const config = imageConfig(model, image.params);
      return supports(image.params?.aspectRatio, config.aspectRatios) && supports(image.params?.resolution, config.resolutions)
        && supports(image.params?.quality, config.qualities) && supports(image.params?.background, config.backgrounds ?? []);
    })) conflicts.push("图片固定参数与可用模型冲突，请调整冲突参数或恢复智能。");
  }
  const video = value.media.video;
  if (video) {
    const candidates = catalog.video.filter(model => video.mode === "auto" || model.id === video.model);
    if (!candidates.length) conflicts.push("视频模型已不可用，请在视频偏好中选择可用模型。");
    else if (!candidates.some(({ params: spec }) => (video.params?.ratio === undefined || videoRatios(spec).includes(video.params.ratio))
      && (video.params?.resolution === undefined || spec.supportedResolutions.includes(video.params.resolution as never))
      && (video.params?.duration === undefined || videoDurations(spec).includes(video.params.duration))
      && (video.params?.generateAudio !== true || spec.supportsGenerateAudio))) conflicts.push("视频固定参数与可用模型冲突，请调整冲突参数或恢复智能。");
  }
  return conflicts;
}

function Parameter({ label, value, options, onChange, variant }: { label: string; value?: string; options: SelectOption[]; onChange: (value: string) => void; variant?: "ratio" | "duration" }) {
  const { label: uiLabel } = useUiLocale();
  const choicesRef = React.useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = React.useState(false);
  if (!options.length && value === undefined) return null;
  const invalid = value !== undefined && !options.some(option => option.value === value && !option.disabled);
  const choices = [
    { value: "", label: "智能" },
    ...(value !== undefined && !options.some(option => option.value === value) ? [{ value, label: `${value}（不可用）`, disabled: true }] : []),
    ...options,
  ];
  return <div className={styles.field} role="group" aria-label={label} aria-invalid={invalid}>
    <span>{variant === "ratio" ? <UiText id="common.m5c6d39030a4a" /> : variant === "duration" ? <UiText id="common.m04a95e0654d3" /> : label}{invalid && <small><UiText id="common.m69116a3b3454" /></small>}</span>
    {variant === "duration" ? <>
      <div className={styles.segments}>
        <button type="button" aria-pressed={value === undefined} onClick={() => onChange("")}><UiText id="common.m929ef3eb0315" /></button>
        <button type="button" aria-pressed={value !== undefined} disabled={!options.some(option => !option.disabled)} onClick={() => onChange(value ?? options.find(option => !option.disabled)!.value)}><UiText id="common.m1f57562b4779" /></button>
      </div>
      {value !== undefined && <select aria-label={label} aria-invalid={invalid} value={value} onChange={event => onChange(event.target.value)}>
        {!options.some(option => option.value === value) && <option value={value}>{value} 秒（当前模型不支持）</option>}
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{uiLabel(option.label)} 秒{option.disabled ? <UiText id="common.mae9000ea21ca" /> : ""}</option>)}
      </select>}
    </> : <div className={variant === "ratio" ? styles.ratioControl : undefined}>
      <div ref={choicesRef} className={variant === "ratio" ? styles.ratios : styles.segments} onScroll={variant === "ratio" ? event => setCanScrollBack(event.currentTarget.scrollLeft > 1) : undefined}>
        {choices.map(option => {
          const ratio = option.value.match(/^(\d+):(\d+)$/);
          const scale = ratio ? Number(ratio[1]) / Number(ratio[2]) : 1;
          return <UiProps key={option.value} ids={{"title":["common.m40b6e8e8f35a"]}}><button type="button"  data-value={option.value} aria-pressed={(value ?? "") === option.value} disabled={option.disabled} title={option.disabled ? "common.m40b6e8e8f35a" : undefined} onClick={() => onChange(option.value)}>
            {variant === "ratio" && (ratio ? <span aria-hidden="true" className={styles.ratioIcon} style={{ width: Math.round(14 * Math.min(scale, 1)), height: Math.round(14 / Math.max(scale, 1)) }} /> : <Scan size={14} aria-hidden="true" />)}
            <span>{uiLabel(option.label)}</span>
          </button></UiProps>;
        })}
      </div>
      {variant === "ratio" && canScrollBack && <button type="button" className={`${styles.ratioNext} ${styles.ratioPrevious}`} aria-label={`向左滚动${label}`} onClick={() => choicesRef.current?.scrollBy({ left: -120, behavior: "smooth" })}><ChevronLeft size={14} /></button>}
      {variant === "ratio" && choices.length > 4 && <button type="button" className={styles.ratioNext} aria-label={`向右滚动${label}`} onClick={() => choicesRef.current?.scrollBy({ left: 120, behavior: "smooth" })}><ChevronRight size={14} /></button>}
    </div>}
  </div>;
}

export default function CreationPreferencesPanel({ anchorRef, composerRef, value, catalog, loading, error, onChange, onClose, initialTab = "chat", onTabChange, onRetryCatalog }: {
  anchorRef: React.RefObject<HTMLButtonElement>; composerRef: React.RefObject<HTMLFormElement>;
  value: CreationPreferences; catalog: CreationModelCatalog | null; loading: boolean; error: string;
  onChange: (value: CreationPreferences) => void; onClose: () => void;
  initialTab?: CreationPreferenceTab; onTabChange?: (tab: CreationPreferenceTab) => void;
  onRetryCatalog?: () => void;
}) {
  const { error: uiError } = useUiLocale();
  const updatePreferences = (update: (current: CreationPreferences) => CreationPreferences) => onChange(update(value));
  const [tab, setTab] = React.useState<CreationPreferenceTab>(initialTab);
  const dialog = React.useRef<HTMLElement>(null);
  const [position, setPosition] = React.useState<React.CSSProperties>();
  const titleId = React.useId();
  React.useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const composer = composerRef.current;
    if (!anchor || !composer) return;
    let frame = 0;
    const updatePosition = () => {
      // 与输入框同宽、左右对齐；三个分类共用一个固定高度，切换时面板不跳动
      const box = composer.getBoundingClientRect();
      const width = Math.min(box.width, window.innerWidth - 24);
      const bottomEdge = Math.max(12, Math.min(anchor.getBoundingClientRect().top - 8, window.innerHeight - 12));
      const next = {
        width,
        left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        bottom: window.innerHeight - bottomEdge,
        height: Math.min(470, bottomEdge - 12),
      };
      setPosition(current => current?.width === next.width && current.left === next.left && current.bottom === next.bottom && current.height === next.height ? current : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(composer);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [anchorRef, composerRef]);
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const conflicts = creationPreferencesConflict(value, catalog);
  const selectedChatKey = value.model;
  const selectedChat = catalog?.chat.find(model => chatKey(model) === selectedChatKey);
  const thinkingLevels = (selectedChat?.thinkingLevels ?? ["default"]).filter(level => level !== "none");
  const media = tab === "chat" ? undefined : value.media[tab] ?? { mode: "auto" as const };
  const chooseMedia = (model: string) => {
    if (tab === "chat") return;
    updatePreferences(current => ({ ...current, media: { ...current.media, [tab]: { mode: model ? "explicit" : "auto", ...(model ? { model } : {}), ...(current.media[tab]?.params ? { params: { ...current.media[tab]!.params } } : {}) } } }));
  };
  const setParam = (key: string, value: string | number | boolean | undefined) => {
    if (tab === "chat") return;
    updatePreferences(current => {
      const preference = current.media[tab] ?? { mode: "auto" as const };
      const params = { ...preference.params, [key]: value };
      if (value === undefined) delete params[key as keyof typeof params];
      return { ...current, media: { ...current.media, [tab]: { ...preference, params } } };
    });
  };
  const row = (key: string, label: string, selected: boolean, onClick: () => void, detail?: string) => <button key={key} type="button" data-model-choice aria-pressed={selected} className={styles.model} onClick={onClick}><span className={styles.modelMark} aria-hidden="true">{selected ? <Check size={14} /> : <span />}</span><span>{label}{detail && <small>{detail}</small>}</span></button>;
  const imageModels = catalog?.image.filter(model => value.media.image?.mode !== "explicit" || selectedImage(model,value.media.image?.model,catalog)) ?? [];
  const imageConfigs = imageModels.map(model => imageConfig(model, value.media.image?.params));
  const videoModels = catalog?.video.filter(model => value.media.video?.mode !== "explicit" || model.id === value.media.video?.model) ?? [];
  return createPortal(<div className={styles.backdrop} data-creation-preferences-backdrop onPointerDown={event => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose();
  }} onWheel={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <UiProps ids={{"aria-label":["common.m88facbb4c728"]}}><section ref={dialog} role="dialog" aria-modal="true" aria-label="common.m88facbb4c728" aria-labelledby={titleId} className={styles.dialog} style={position}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.srOnly}><UiText id="common.m88facbb4c728" /></h2>
        <UiProps ids={{"aria-label":["common.mc73a034c339c"]}}><div className={styles.tabs} role="tablist" aria-label="common.mc73a034c339c">{([["video", "视频偏好"], ["image", "图片偏好"], ["chat", "推理模型"]] as const).map(([key, label]) => <button key={key} id={`${titleId}-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`${titleId}-content`} onClick={() => { setTab(key); onTabChange?.(key); }}>{label}</button>)}</div></UiProps>
        <UiProps ids={{"aria-label":["common.m61ef0f85280d"]}}><button type="button" aria-label="common.m61ef0f85280d" className={styles.close} onClick={onClose}><X size={16} /></button></UiProps>
      </header>
      <div className={styles.scroll}>
        {(loading || error) && <div className={styles.status} role="status"><span>{loading ? <UiText id="common.m28dbf18ded56" /> : uiError(error)}</span>{!loading && error && onRetryCatalog && <button type="button" className={styles.reset} onClick={onRetryCatalog}><UiText id="common.m4c855bfdf335" /></button>}</div>}
        <div role="tabpanel" id={`${titleId}-content`} aria-labelledby={`${titleId}-${tab}`} className={styles.columns}>
          <UiProps ids={{"aria-label":["common.meb399b119559","common.me2ebc59779f0"]}}><div className={styles.models} aria-label={tab === "chat" ? "common.meb399b119559" : "common.me2ebc59779f0"}>
            <p className={styles.heading}><UiText id="common.m6bdfb23aa459" /></p>
            {tab === "chat" ? <>
              {catalog?.chat.map(model => row(chatKey(model), model.label?.replace(/^.+? · /, "") || model.modelId, value.model === chatKey(model), () => updatePreferences(current => ({ ...current, model: chatKey(model), thinkingLevel: "default" })), model.contextWindow ? `${formatTokens(model.contextWindow)} 上下文${model.supportsVision ? " · 支持看图" : ""}` : undefined))}
            </> : <>
              {row("auto", "智能匹配模型", media?.mode === "auto", () => chooseMedia(""), tab === "image" ? "按任务自动挑选：改图选主体一致性好的，海报选文字准的，多方向草稿选出图快的；结果卡上会标出用了哪个模型" : "默认选出片快且稳的模型，要求电影感、大片质感时换高质量模型")}
              {(tab === "image" ? imageOptions(catalog).map(model => ({...model,id:model.value})) : catalog?.video ?? []).map(model => row(model.id, model.label, media?.mode === "explicit" && media.model === model.id, () => chooseMedia(model.id), modelDetail(tab === "image" ? "image" : "video", model.id)))}
              {media?.mode === "explicit" && <p className={styles.hint}><UiText id="common.m5ebee8895e9c" />{tab === "image" ? <UiText id="common.md24c10d37db0" /> : <UiText id="common.mc20f7618d330" />}<UiText id="common.m8e17665b3419" /></p>}
            </>}
          </div></UiProps>
          <div className={styles.parameters}>
            {tab === "chat" ? <>
              <p className={styles.heading}><UiText id="common.m9c41b3a9e12a" /></p>
              <UiProps ids={{"aria-label":["common.m9c41b3a9e12a"]}}><div className={styles.efforts} role="group" aria-label="common.m9c41b3a9e12a">{thinkingLevels.map(level => <button type="button" key={level} aria-pressed={value.thinkingLevel === level} onClick={() => updatePreferences(current => ({ ...current, thinkingLevel: level }))}>{LLM_THINKING_LABELS[level]}</button>)}</div></UiProps>
              <p className={styles.hint}><UiText id="common.me147e6ef8ac0" /></p>
              {!thinkingLevels.some(level => level === value.thinkingLevel) && <button type="button" className={styles.reset} onClick={() => updatePreferences(current => ({ ...current, thinkingLevel: "default" }))}><UiText id="common.m40d5b1cbe835" /></button>}
            </> : <>
              {media && (tab === "image" ? <>
                <UiProps ids={{"label":["common.mf69028ee0d49"]}}><Parameter label="common.mf69028ee0d49" variant="ratio" value={value.media.image?.params?.aspectRatio} options={union(imageConfigs.map(config => config.aspectRatios))} onChange={value => setParam("aspectRatio", value || undefined)} /></UiProps>
                <UiProps ids={{"label":["common.m14c27c5b1b1e"]}}><Parameter label="common.m14c27c5b1b1e" value={value.media.image?.params?.resolution} options={union(imageConfigs.map(config => config.resolutions))} onChange={value => setParam("resolution", value || undefined)} /></UiProps>
                <UiProps ids={{"label":["common.m0ab5629be565"]}}><Parameter label="common.m0ab5629be565" value={value.media.image?.params?.quality} options={union(imageConfigs.map(config => config.qualities))} onChange={value => setParam("quality", value || undefined)} /></UiProps>
                <UiProps ids={{"label":["common.m5d1d118214c5"]}}><Parameter label="common.m5d1d118214c5" value={value.media.image?.params?.background} options={union(imageConfigs.map(config => config.backgrounds ?? []))} onChange={value => setParam("background", value || undefined)} /></UiProps>
              </> : <>
                <UiProps ids={{"label":["common.mf66a521fb530"]}}><Parameter label="common.mf66a521fb530" variant="ratio" value={value.media.video?.params?.ratio} options={union(videoModels.map(({ params }) => videoRatios(params).map(value => ({ value, label: value === "adaptive" || value === "auto" ? "自适应" : value }))))} onChange={value => setParam("ratio", value || undefined)} /></UiProps>
                <UiProps ids={{"label":["common.m458920ec58f7"]}}><Parameter label="common.m458920ec58f7" value={value.media.video?.params?.resolution} options={union(videoModels.map(({ params }) => params.supportedResolutions.map(option)))} onChange={value => setParam("resolution", value || undefined)} /></UiProps>
                <UiProps ids={{"label":["common.mf31965ea0789"]}}><Parameter label="common.mf31965ea0789" variant="duration" value={value.media.video?.params?.duration?.toString()} options={union(videoModels.map(({ params }) => videoDurations(params).map(option)))} onChange={value => setParam("duration", value ? Number(value) : undefined)} /></UiProps>
                <UiProps ids={{"label":["common.mc504de5735ef"]}}><Parameter label="common.mc504de5735ef" value={value.media.video?.params?.generateAudio?.toString()} options={videoModels.length ? [option("false"), ...(videoModels.some(({ params }) => params.supportsGenerateAudio) ? [option("true")] : [])].map(item => ({ ...item, label: item.value === "true" ? "生成声音" : "不生成声音" })) : []} onChange={value => setParam("generateAudio", value === "" ? undefined : value === "true")} /></UiProps>
              </>)}
              {media && <button type="button" className={styles.reset} onClick={() => updatePreferences(current => ({ ...current, media: { ...current.media, [tab]: { ...(current.media[tab] ?? { mode: "auto" }), params: {} } } }))}><UiText id="common.mf3e1336db232" /></button>}
            </>}
          </div>
        </div>
        {conflicts.length > 0 && <div role="alert" className={styles.conflicts}>{conflicts.map(conflict => <p key={conflict}>{conflict}</p>)}</div>}
      </div>
    </section></UiProps>
  </div>, document.body);
}
