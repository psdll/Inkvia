"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { isQwenImage3Model, QWEN_IMAGE_3_UPSTREAM_MODELS } from "@/lib/qwen-image-3-models";

import * as React from "react";
import { useAdminPageSelection } from "@/components/admin/useAdminPageSelection";
import { ProviderSidebar } from "@/components/admin/ProviderSidebar";
import { LlmModelModalities } from "@/components/admin/LlmModelModalities";
import { getProviderModelCapability } from "@/lib/providers/model-availability";
import { resolveGptImage25Selection } from "@/lib/gpt-image-25-models";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { publishToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";
import { ChevronDown, Image as ImageIcon, Loader2, Music2, Pencil, Save, Search, UserRound, Video, X } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ToolboxModelCategory = "image" | "video" | "audio" | "llm";
type ConfigurableResolution = "1080p" | "2k" | "4k";
type ResolutionVisibility = Record<string, Partial<Record<ConfigurableResolution, boolean>>>;

type ToolboxModel = {
  id: string;
  label: string;
  defaultLabel?: string;
  provider: string;
  providerName?: string;
  modelId?: string;
  category: ToolboxModelCategory;
  resolutionControls?: ConfigurableResolution[];
  durationControl?: boolean;
  visibilityControl?: boolean;
};

type Overview = {
  providers: { id: string; name: string; enabled: boolean }[];
  success?: boolean;
  models: ToolboxModel[];
  visibility: Record<string, boolean>;
  resolutionVisibility: ResolutionVisibility;
  durationVisibility: Record<string, boolean>;
  displayNames: Record<string, string>;
  error?: string;
};

const CATEGORY_META: Record<ToolboxModelCategory, { label: string; desc: string; icon: React.ElementType }> = {
  image: { label: "图片编辑", desc: "控制创作中图片编辑模型是否展示", icon: ImageIcon },
  video: { label: "视频生成", desc: "控制创作中视频生成模型是否展示", icon: Video },
  audio: { label: "音频生成", desc: "控制画布中音频生成模型是否展示", icon: Music2 },
  llm: { label: "LLM 文本模型", desc: "控制用户端 LLM 模型展示；同名模型按供应商分别设置，不改变后台默认调用配置", icon: UserRound },
};

const CATEGORY_ORDER: ToolboxModelCategory[] = ["image", "video", "audio", "llm"];

const PROVIDER_LABELS: Record<string, string> = {
  kie: "KIE",
  jiekou: "接口 AI",
  apimart: "APIMart",
  reapi: "reAPI",
  "aicoming-haiya": "海牙科技（AIComing）",
  easyrouter: "EasyRouter",
  tuzi: "兔子 API",
  "work-fisher": "FisherAI",
  volcengine: "火山引擎官方",
  "volcengine-speech": "火山引擎语音官方",
  "google-ai-studio": "Google AI Studio",
  minimax: "MiniMax",
  bailian: "阿里云百炼官方",
};

function formatResolutionControlLabel(resolution: ConfigurableResolution) {
  return resolution === "1080p" ? "1080P" : resolution.toUpperCase();
}

function getModelDisplayScope(model: ToolboxModel) {
  if (model.visibilityControl === false) return "—";
  if (model.category === "llm") return "画布";
  const modelId = model.category === "image" ? resolveGptImage25Selection(model.id).model : model.id;
  return getProviderModelCapability(model.provider, model.category, modelId).usages.join("、") || "—";
}

function buildDisplayNameDraft(models: ToolboxModel[], displayNames: Record<string, string>) {
  return Object.fromEntries(models.map((model) => [
    model.id,
    displayNames[model.id] ?? model.label,
  ]));
}

function ToggleSwitch({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
      className={[
        "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
        checked ? "border-emerald-400/30 bg-emerald-500/10" : "border-[var(--border)] bg-[var(--panel-2)]",
      ].join(" ")}
      aria-label={`${checked ? "关闭" : "开启"} ${label}`}
    >
      <span
        className={[
          "absolute top-0.5 h-5 w-5 rounded-full bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.28)] transition-all",
          checked ? "left-[25px]" : "left-[2px]",
        ].join(" ")}
      />
    </button>
  );
}

export default function ImageEditModelsPanel({ refreshSignal, active = true }: { refreshSignal?: number; active?: boolean } = {}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, label: uiLabel } = useUiLocale();
  const [providers, setProviders] = React.useState<Overview["providers"]>([]);
  const [models, setModels] = React.useState<ToolboxModel[]>([]);
  const [visibility, setVisibility] = React.useState<Record<string, boolean>>({});
  const [savedVisibility, setSavedVisibility] = React.useState<Record<string, boolean>>({});
  const [resolutionVisibility, setResolutionVisibility] = React.useState<ResolutionVisibility>({});
  const [savedResolutionVisibility, setSavedResolutionVisibility] = React.useState<ResolutionVisibility>({});
  const [durationVisibility, setDurationVisibility] = React.useState<Record<string, boolean>>({});
  const [savedDurationVisibility, setSavedDurationVisibility] = React.useState<Record<string, boolean>>({});
  const [displayNames, setDisplayNames] = React.useState<Record<string, string>>({});
  const [savedDisplayNames, setSavedDisplayNames] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, json } = await fetchJsonOnce<Overview>("/api/admin/settings/image-edit-models");
      if (!ok || !json?.success) throw new Error(json?.error || "HTTP error");
      const nextModels = Array.isArray(json.models) ? json.models : [];
      const nextDisplayNames = buildDisplayNameDraft(nextModels, json.displayNames || {});
      setModels(nextModels);
      setProviders(json.providers || []);
      setVisibility(json.visibility || {});
      setSavedVisibility(json.visibility || {});
      setResolutionVisibility(json.resolutionVisibility || {});
      setSavedResolutionVisibility(json.resolutionVisibility || {});
      setDurationVisibility(json.durationVisibility || {});
      setSavedDurationVisibility(json.durationVisibility || {});
      setDisplayNames(nextDisplayNames);
      setSavedDisplayNames(nextDisplayNames);
    } catch (e: any) {
      setError(String(e?.message || "加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggleModel = React.useCallback((id: string) => {
    setVisibility((current) => ({ ...current, [id]: current[id] === false }));
  }, []);

  const toggleResolution = React.useCallback((modelId: string, resolution: ConfigurableResolution) => {
    setResolutionVisibility((current) => ({
      ...current,
      [modelId]: {
        ...current[modelId],
        [resolution]: current[modelId]?.[resolution] === false,
      },
    }));
  }, []);

  const changeDisplayName = React.useCallback((modelId: string, label: string) => {
    setDisplayNames((current) => ({ ...current, [modelId]: label }));
  }, []);

  const save = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/image-edit-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility, resolutionVisibility, displayNames, durationVisibility }),
      });
      const json = (await res.json().catch(() => null)) as Overview | null;
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      const nextModels = Array.isArray(json.models) ? json.models : [];
      const nextDisplayNames = buildDisplayNameDraft(nextModels, json.displayNames || {});
      setModels(nextModels);
      setVisibility(json.visibility || {});
      setSavedVisibility(json.visibility || {});
      setResolutionVisibility(json.resolutionVisibility || {});
      setSavedResolutionVisibility(json.resolutionVisibility || {});
      setDurationVisibility(json.durationVisibility || {});
      setSavedDurationVisibility(json.durationVisibility || {});
      setDisplayNames(nextDisplayNames);
      setSavedDisplayNames(nextDisplayNames);
      publishToolboxModelVisibilityChanged();
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (e: any) {
      setError(String(e?.message || "保存失败"));
    } finally {
      setSaving(false);
    }
  }, [displayNames, resolutionVisibility, visibility, durationVisibility]);

  const [query, setQuery] = React.useState("");
  const [preferredCategory, setCategory] = React.useState<ToolboxModelCategory | "all">("all");
  const [preferredProvider, setProvider] = useAdminPageSelection<string>("display-provider", "");
  const [status, setStatus] = React.useState("all");
  const [onlyChanged, setOnlyChanged] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [reloadConfirm, setReloadConfirm] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  const changedIds = new Set(models.filter((model) => {
    const id = model.id;
    return (visibility[id] !== false) !== (savedVisibility[id] !== false)
      || (displayNames[id] ?? model.label) !== (savedDisplayNames[id] ?? model.label)
      || (durationVisibility[id] !== false) !== (savedDurationVisibility[id] !== false)
      || (model.resolutionControls || []).some((resolution) =>
        (resolutionVisibility[id]?.[resolution] !== false) !== (savedResolutionVisibility[id]?.[resolution] !== false));
  }).map((model) => model.id));
  const dirty = changedIds.size > 0;
  const providerName = (model: ToolboxModel) => providers.find(item => item.id === model.provider)?.name || model.providerName || PROVIDER_LABELS[model.provider] || model.provider;
  const providerOptions = providers.filter(item => models.some(model => model.provider === item.id)).map(item => ({ value: item.id, label: item.name, enabled: item.enabled }));
  const provider = providerOptions.some((option) => option.value === preferredProvider) ? preferredProvider : providerOptions[0]?.value;
  const providerModels = models.filter((model) => model.provider === provider);
  const availableCategories = CATEGORY_ORDER.filter((key) => providerModels.some((model) => model.category === key));
  const category = preferredCategory === "all" || availableCategories.includes(preferredCategory) ? preferredCategory : "all";
  const selectedProviderName = providerOptions.find((option) => option.value === provider)?.label || "暂无供应商";
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filteredModels = models.filter((model) => {
    const searchable = [displayNames[model.id], model.label, model.defaultLabel, model.id, model.modelId, model.provider, providerName(model), ...(isQwenImage3Model(model.id) ? Object.values(QWEN_IMAGE_3_UPSTREAM_MODELS) : [])].join(" ").toLocaleLowerCase();
    return (category === "all" || model.category === category)
      && (model.provider === provider)
      && (status === "all" || (visibility[model.id] !== false) === (status === "visible"))
      && (!onlyChanged || changedIds.has(model.id))
      && words.every((word) => searchable.includes(word));
  }).sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || (a.modelId || a.defaultLabel || a.label).localeCompare(b.modelId || b.defaultLabel || b.label)
    || providerName(a).localeCompare(providerName(b)));
  const hiddenChanges = changedIds.size - filteredModels.filter((model) => changedIds.has(model.id)).length;
  const hasFilters = !!query || status !== "all" || onlyChanged;
  const clearFilters = () => { setQuery(""); setStatus("all"); setOnlyChanged(false); };
  const selectProvider = (value: string) => { setProvider(value); clearFilters(); setExpanded(null); setEditing(null); };
  React.useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [query, category, provider, status, onlyChanged]);

  const lastRefreshSignal = React.useRef(refreshSignal);
  React.useEffect(() => {
    if (lastRefreshSignal.current === refreshSignal) return;
    lastRefreshSignal.current = refreshSignal;
    // 隐藏面板也保持挂载；只消费当前页面的刷新，不覆盖其他页面留下的草稿。
    if (!active || loading || saving) return;
    if (dirty) setReloadConfirm(true);
    else void load();
  }, [refreshSignal, active, loading, saving, dirty, load]);

  return (
    <div
      className="flex min-h-0 flex-col gap-5 text-[13px] font-normal leading-5 text-[var(--model-text)] lg:h-full"
      style={{
        fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
        "--model-text": "var(--app-fg)",
        "--model-accent": "color-mix(in srgb, #3b82f6 60%, var(--app-muted))",
        "--model-success": "color-mix(in srgb, #10b981 60%, var(--app-muted))",
      } as React.CSSProperties}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]"><ImageIcon className="h-4 w-4 text-blue-500" /><UiText id="admin.mfb4b3f3be29b" /></h3>
        </div>
        {loading && <span role="status" className="inline-flex items-center gap-1.5 text-xs text-[var(--app-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /><UiText id="admin.m783a7abcc766" /></span>}
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            <div className="flex h-8 w-72 max-w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 focus-within:border-blue-500/60">
              <Search className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
              <UiProps ids={{"aria-label":["admin.m93a8734cce30"],"placeholder":["admin.m6553a57f4031","admin.m364c261f030c"]}}><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="admin.m93a8734cce30"
                placeholder={category === "all" ? "admin.m6553a57f4031" : "admin.m364c261f030c"}
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[var(--model-text)] outline-none" /></UiProps>
              {query && <UiProps ids={{"aria-label":["admin.mb6f00afa6537"]}}><button type="button" aria-label="admin.mb6f00afa6537" onClick={() => setQuery("")}><X className="h-3.5 w-3.5 text-[var(--app-muted)]" /></button></UiProps>}
            </div>
            <FrostedSelect ariaLabel={tLabel("显示状态筛选")} showLeading={false} value={status} onChange={setStatus}
              options={[{ value: "all", label: tLabel("全部状态") }, { value: "visible", label: tLabel("显示") }, { value: "hidden", label: tLabel("隐藏") }]} className="w-28" buttonClassName="!h-8" compact />
            {(dirty || onlyChanged) && <button type="button" aria-pressed={onlyChanged} onClick={() => setOnlyChanged(!onlyChanged)}
              className={["rounded-lg px-2 py-1.5 text-xs", onlyChanged ? "bg-blue-500/10 text-[var(--model-accent)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]"].join(" ")}><UiText id="admin.m47b1e6203004" />{changedIds.size}</button>}
            {hasFilters && <button type="button" onClick={clearFilters} className="text-xs text-[var(--model-accent)] hover:underline"><UiText id="admin.md62e64a05006" /></button>}
          </div>
      </header>

      {error && <div role="alert" className="shrink-0 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-500">{uiError(error)}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:-ml-2 lg:grid-cols-[164px_minmax(0,1fr)] lg:gap-x-6">
        <UiProps ids={{"label":["admin.m4044def8b0b3"]}}><ProviderSidebar label="admin.m4044def8b0b3" selectedId={provider} onSelect={selectProvider}
          items={providerOptions.map(option => ({ id: option.value, name: option.label, enabled: option.enabled,
            count: models.filter(model => model.provider === option.value).length,
            dirty: models.some(model => model.provider === option.value && changedIds.has(model.id)),
          }))} /></UiProps>

        <section aria-label={tLabel(`${selectedProviderName}模型清单`)} className="flex min-h-0 min-w-0 flex-col">
          <h4 className="mb-5 shrink-0 text-lg font-semibold text-[var(--app-fg)]">{selectedProviderName}</h4>
          <div className="shrink-0">
            <UiProps ids={{"aria-label":["admin.m61f801e7608f"]}}><nav aria-label="admin.m61f801e7608f" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[var(--border)]">
              {(["all", ...availableCategories] as const).map((key) => {
                const count = key === "all" ? providerModels.length : providerModels.filter((model) => model.category === key).length;
                return <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}
                  className={["flex items-center gap-1.5 border-b-2 pb-3 text-[13px] leading-5", category === key ? "border-blue-500 font-medium text-[var(--app-fg)]" : "border-transparent text-[var(--app-muted)] hover:text-[var(--model-text)]"].join(" ")}>
                  {key === "all" ? <UiText id="admin.m267c4a7a86dd" /> : key === "llm" ? <UiText id="admin.md027815844af" /> : CATEGORY_META[key].label}
                  <span className="text-xs tabular-nums text-[var(--app-muted)]">{count}</span>
                </button>;
              })}
            </nav></UiProps>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <div className="sticky top-0 z-10 grid min-w-[580px] grid-cols-[minmax(220px,1fr)_80px_minmax(120px,180px)_112px] items-center gap-4 border-b border-[var(--border)] bg-[var(--panel-bg)] py-3 text-xs text-[var(--app-muted)] dark:bg-[#202020]"><span><UiText id="admin.mcb2f1709f983" /></span><span><UiText id="admin.mba40014ff496" /></span><span><UiText id="admin.mddba9bd90615" /></span><span className="text-right"><UiText id="admin.mea5f32c81c94" /></span></div>
            <fieldset disabled={loading || saving} className="min-w-0 disabled:opacity-60">
              <div className="min-w-[580px] divide-y divide-[var(--border)] border-b border-[var(--border)]">
                {filteredModels.map((model) => {
                  const displayName = displayNames[model.id] ?? model.label;
                  const enabled = visibility[model.id] !== false;
                  const changed = changedIds.has(model.id);
                  const hasParameters = !!model.resolutionControls?.length || model.durationControl;
                  const originalId = model.modelId || model.id;
                  const showId = originalId.toLocaleLowerCase() !== displayName.trim().toLocaleLowerCase();
                  return <article key={model.id} aria-label={`${displayName} · ${providerName(model)}`}
                    className="min-w-0 py-4">
                    <div className="grid grid-cols-[minmax(220px,1fr)_80px_minmax(120px,180px)_112px] items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-h-5 items-center gap-2">
                          <div className={model.category === "llm" || model.category === "audio" ? "grid shrink-0 grid-cols-[10rem_max-content] items-center gap-x-6" : "min-w-0"}>
                          {editing === model.id && model.visibilityControl !== false ? <input autoFocus value={displayName}
                            onChange={(event) => changeDisplayName(model.id, event.target.value)} onBlur={() => setEditing(null)}
                            onKeyDown={(event) => { if (event.key === "Enter") setEditing(null); }}
                            aria-label={tLabel(`前端显示名称 ${model.id}`)} placeholder={model.defaultLabel || model.label}
                            className="h-7 w-full rounded border border-blue-500/60 bg-[var(--input-bg)] px-2 text-[14px] outline-none" />
                            : model.visibilityControl === false ? <span title={originalId} className="min-w-0 truncate text-[13px] font-medium leading-5">{displayName}</span>
                              : <button type="button" onClick={() => setEditing(model.id)} aria-label={tLabel(`修改名称 ${displayName} ${model.provider}`)} className="group flex min-w-0 items-center gap-2 text-left text-[13px] font-medium leading-5">
                                <span className={model.category === "llm" || model.category === "audio" ? "min-w-0 truncate" : "break-words"} title={originalId}>{displayName}</span><Pencil className="h-3 w-3 shrink-0 text-[var(--app-muted)] opacity-50 group-hover:opacity-100" />
                              </button>}
                          {model.category === "llm" || model.category === "audio" ? <LlmModelModalities providerId={model.provider} modelId={originalId} /> : null}
                          </div>
                          {changed && <UiProps ids={{"title":["admin.mb8eabf48e188"],"aria-label":["admin.mb8eabf48e188"]}}><span title="admin.mb8eabf48e188" aria-label="admin.mb8eabf48e188" className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" /></UiProps>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 text-[var(--app-muted)]">


                          {isQwenImage3Model(model.id) ? (
                            <UiProps ids={{"aria-label":["admin.m34df0da2b9e7"]}}><span className="min-w-0 truncate" aria-label="admin.m34df0da2b9e7" title={`${QWEN_IMAGE_3_UPSTREAM_MODELS.standard} · ${QWEN_IMAGE_3_UPSTREAM_MODELS.pro}`}>
                              {QWEN_IMAGE_3_UPSTREAM_MODELS.standard} · {QWEN_IMAGE_3_UPSTREAM_MODELS.pro}
                            </span></UiProps>
                          ) : showId && <span title={originalId} className="min-w-0 truncate">{originalId}</span>}
                          {hasParameters && <button type="button" aria-label={tLabel(`参数设置 ${displayName} ${model.provider}`)} aria-expanded={expanded === model.id}
                            onClick={() => setExpanded(expanded === model.id ? null : model.id)} className="inline-flex items-center gap-1 text-[var(--model-accent)]"><UiText id="admin.m9634fb0832be" /><ChevronDown className={`h-3 w-3 transition-transform ${expanded === model.id ? "rotate-180" : ""}`} /></button>}
                        </div>
                      </div>
                      <span className="text-xs text-[var(--app-muted)]">{model.category === "llm" ? <UiText id="admin.mdd81861811e5" /> : CATEGORY_META[model.category].label}</span>
                      <span className="text-xs text-[var(--app-muted)]">{getModelDisplayScope(model)}</span>
                      <div className="flex shrink-0 items-center justify-end gap-2">
                        {model.visibilityControl === false ? <span className="text-xs text-[var(--app-muted)]"><UiText id="admin.m9aa0baf72ad9" /></span> : <>
                          <span className={enabled ? "text-xs text-[var(--model-success)]" : "text-xs text-[var(--app-muted)]"}>{enabled ? <UiText id="admin.m4e1449e7d5e5" /> : <UiText id="admin.m145219e726b8" />}</span>
                          <ToggleSwitch checked={enabled} label={`${displayName} ${model.provider}`} onClick={() => toggleModel(model.id)} />
                        </>}
                      </div>
                    </div>
                    {expanded === model.id && hasParameters && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--panel-2)] p-3 text-xs">
                      {model.resolutionControls?.map((resolution) => <label key={resolution} className="flex items-center gap-2">
                        {uiLabel(formatResolutionControlLabel(resolution))}<ToggleSwitch checked={resolutionVisibility[model.id]?.[resolution] !== false} label={`${displayName} ${formatResolutionControlLabel(resolution)}`} onClick={() => toggleResolution(model.id, resolution)} />
                      </label>)}
                      {model.durationControl && <label className="flex items-center gap-2"><UiText id="admin.md33b95709465" /><ToggleSwitch checked={durationVisibility[model.id] !== false} label={`${displayName} 30秒`} onClick={() => setDurationVisibility((current) => ({ ...current, [model.id]: current[model.id] === false }))} /></label>}
                      {!enabled && <p className="w-full text-[11px] text-[var(--app-muted)]"><UiText id="admin.mdd6d3f00a766" /></p>}
                    </div>}
                  </article>;
                })}
              </div>
            </fieldset>
            {!filteredModels.length && <div className="flex flex-col items-center gap-3 py-16 text-sm text-[var(--app-muted)]">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Search className="h-7 w-7 opacity-50" />}
              <span>{loading ? <UiText id="admin.m28dbf18ded56" /> : <UiText id="admin.m06c176edd4d7" />}</span>
              {!loading && hasFilters && <button type="button" onClick={clearFilters} className="text-xs text-[var(--model-accent)]"><UiText id="admin.mde59123193fe" /></button>}
            </div>}
          </div>
        </section>
      </div>
      {(dirty || saving || savedFlash) && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-2">
        <div role="status" className="flex items-center gap-2 text-xs text-[var(--app-muted)]">
          <span className={`h-1.5 w-1.5 rounded-full ${dirty ? "bg-blue-500" : "bg-emerald-500"}`} />
          {loading ? <UiText id="admin.m2946db108b0f" /> : dirty ? <UiText id="admin.m4380080f53ef" values={{v0: String(changedIds.size), v1: String(hiddenChanges ? `（其中 ${hiddenChanges} 个不在当前筛选结果中）` : "")}} /> : error ? <UiText id="admin.m07943ecd7a5d" /> : savedFlash ? <UiText id="admin.m1bd91a7d0c53" /> : <UiText id="admin.m461f9d9d19e2" />}
        </div>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving || loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--primary-bg)] px-4 text-[13px] font-medium text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<UiText id="admin.md4b86bf24245" />{dirty ? `（${changedIds.size}）` : ""}
        </button>
      </footer>}
      <UiProps ids={{"title":["admin.m03035392e344"],"confirmText":["admin.m13e9b40422ad"],"cancelText":["admin.mfd4b9e3b6c68"]}}><ConfirmDialog open={reloadConfirm} title="admin.m03035392e344" description={`有 ${changedIds.size} 个模型的修改尚未保存，重新加载会丢弃这些修改。`} confirmText="admin.m13e9b40422ad" cancelText="admin.mfd4b9e3b6c68" onClose={() => setReloadConfirm(false)} onConfirm={() => load()} /></UiProps>
    </div>
  );
}
