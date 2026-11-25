"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { LlmModelModalities } from "@/components/admin/LlmModelModalities";
import { canAddFetchedChatModel } from "@/lib/providers/model-fetch-cache";
import {
  ProviderLlmUsageTags,
  type InlineRouteAction,
} from "@/components/admin/ProviderLlmUsageTags";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { AdminLlmBinding, AdminLlmScenarioView } from "@/lib/providers/admin-ui";
import {
  getProviderModelCapability,
  isBuiltinProviderModel,
  type ProviderModelKind,
} from "@/lib/providers/model-availability";

type Props = {
  compact?: boolean;
  searchQuery?: string;
  providerId: string;
  imageModels: string[];
  audioModels?: string[];
  chatModels: string[];
  videoModels: string[];
  chatModelDraft: string;
  chatModelOptions: string[];
  canManageChat: boolean;
  savedChatModels: string[];
  scenarios: AdminLlmScenarioView[];
  routeDrafts?: Record<string, AdminLlmBinding>;
  routeActions: Record<string, InlineRouteAction>;
  routesDisabled: boolean;
  mutationsDisabled: boolean;
  onChatModelDraftChange: (value: string) => void;
  onAddChatModel: () => void;
  onActivateRoute: (scenarioId: string, binding: AdminLlmBinding) => void;
  onRemove: (kind: ProviderModelKind, modelId: string) => void;
};

const GROUPS: { kind: ProviderModelKind; label: string; hint: string }[] = [
  { kind: "image", label: "providersDynamic.m011315642510", hint: "providersDynamic.m04d368bce3c5" },
  { kind: "audio", label: "providersDynamic.m2aad9b7e45f8", hint: "providersDynamic.md8927f9c652f" },
  { kind: "chat", label: "providersDynamic.m1115f083641e", hint: "providersDynamic.m1187805e2264" },
  { kind: "video", label: "providersDynamic.ma0afda31af33", hint: "providersDynamic.m04d368bce3c5" },
];

export function ProviderModelUsageGroups({
  compact = false,
  searchQuery = "",
  providerId,
  imageModels,
  audioModels = [],
  chatModels,
  videoModels,
  chatModelDraft,
  chatModelOptions,
  canManageChat,
  savedChatModels,
  scenarios,
  routeDrafts = {},
  routeActions,
  routesDisabled,
  mutationsDisabled,
  onChatModelDraftChange,
  onAddChatModel,
  onActivateRoute,
  onRemove,
}: Props) {
  const { label: tLabel, text, locale } = useUiLocale();
  const number = (value: number) => locale === "en" ? value.toLocaleString("en") : value;
  const usageText = (usages: readonly string[]) => usages.map(tLabel).join(locale === "en" ? ", " : "、");
  const groupTitle = (kind: ProviderModelKind) => text(GROUPS.find(group => group.kind === kind)!.label);
  const removeLabel = (kind: ProviderModelKind, model: string) => kind === "chat"
    ? text("providersDynamic.removeChat", { model })
    : text("providersDynamic.mca1658b661c2", { kind: groupTitle(kind), model });
  const [selectedKind, setSelectedKind] = React.useState<ProviderModelKind | "all">("all");
  React.useEffect(() => { setSelectedKind("all"); }, [searchQuery]);
  const modelsByKind: Record<ProviderModelKind, string[]> = {
    image: imageModels,
    audio: audioModels,
    chat: chatModels,
    video: videoModels,
  };

  if (compact) {
    const kinds = GROUPS.filter((group) => modelsByKind[group.kind].length > 0);
    const activeKind = kinds.some((group) => group.kind === selectedKind) ? selectedKind : "all";
    const labels = { image: "图片", video: "视频", audio: "音频", chat: "文本" };
    const matching = (kind: ProviderModelKind) => modelsByKind[kind].filter((model) => model.toLowerCase().includes(searchQuery.toLowerCase()));
    const rows = kinds.flatMap(({ kind }) => activeKind === "all" || activeKind === kind ? matching(kind).map((model) => ({ kind, model })) : []);
    return <section className="mt-5 flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden">
      <UiProps ids={{"aria-label":["admin.m61f801e7608f"]}}><div aria-label="admin.m61f801e7608f" className="flex shrink-0 flex-wrap gap-5 border-b border-[var(--border)]">
        {(["all", ...kinds.map((group) => group.kind)] as const).map((kind) => <button key={kind} type="button" aria-pressed={activeKind === kind} onClick={() => setSelectedKind(kind)}
          className={`border-b-2 pb-3 text-[13px] ${activeKind === kind ? "border-[var(--primary-bg)] font-medium text-[var(--app-fg)]" : "border-transparent text-[var(--app-muted)] hover:text-[var(--app-fg)]"}`}>
          {kind === "all" ? <UiText id="admin.m0164f80178a2" /> : tLabel(labels[kind])}<span className="ml-1.5 text-xs text-[var(--app-muted)]">{number(kind === "all" ? kinds.reduce((total, group) => total + matching(group.kind).length, 0) : matching(kind).length)}</span>
        </button>)}
      </div></UiProps>
      {canManageChat && chatModelOptions.length > 0 && (activeKind === "all" || activeKind === "chat") && <div className="my-3 flex shrink-0 max-w-lg gap-2">
        <UiProps ids={{"placeholder":["admin.m08cc0e7b391b"]}}><FrostedSelect value={chatModelDraft} onChange={onChatModelDraftChange} options={chatModelOptions.map((id) => ({ value: id, label: id }))} placeholder="admin.m08cc0e7b391b" ariaLabel={tLabel("选择拉取到的 LLM 模型")} disabled={mutationsDisabled} showLeading={false} compact className="min-w-0 flex-1" /></UiProps>
        <button type="button" onClick={onAddChatModel} disabled={mutationsDisabled || !canAddFetchedChatModel(chatModelDraft, chatModelOptions)} className="rounded-lg border border-[var(--border)] px-3 text-xs"><UiText id="admin.m7a8a11ead507" /></button>
      </div>}
      <UiProps ids={{"aria-label":["admin.m1e125a9747d8"]}}><div aria-label="admin.m1e125a9747d8" className="min-h-0 max-h-[65vh] overflow-auto overscroll-contain lg:max-h-none lg:flex-1">
        <table className="w-full min-w-[620px] text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-[var(--provider-surface,var(--app-bg))] text-xs text-[var(--app-muted)]"><tr className="border-b border-[var(--border)]">
            <th className="py-3 pr-4 font-normal"><UiText id="admin.mcb2f1709f983" /></th><th className="w-16 py-3 pr-4 font-normal"><UiText id="admin.mba40014ff496" /></th><th className="w-28 py-3 pr-4 font-normal"><UiText id="admin.m15d431a5bb64" /></th><th className="w-[280px] py-3 pr-4 font-normal"><UiText id="admin.m8eca1f481d7d" /></th><th className="w-16 py-3 text-right font-normal"><UiText id="admin.med31fbb483ee" /></th>
          </tr></thead>
          <tbody>
            {rows.map(({ kind, model }) => {
              const capability = getProviderModelCapability(providerId, kind, model);
              const saved = kind !== "chat" || savedChatModels.includes(model);
              const ready = kind === "chat" ? saved : capability.adapterBacked;
              const key = `${kind}:${model}`;
              return <React.Fragment key={key}>
                <tr className="border-b border-[var(--border)] hover:bg-[var(--panel-bg)]">
                  <td className="py-4 pr-4">
                    <div className={`grid items-center gap-x-6 ${kind === "chat" || kind === "audio" ? "grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)]" : "grid-cols-1"}`}>
                      <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere] font-medium text-[var(--app-fg)]" title={model}>{model}</span>
                      {kind === "chat" || kind === "audio" ? <LlmModelModalities providerId={providerId} modelId={model} /> : null}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-[var(--app-muted)]">{tLabel(labels[kind])}</td>
                  <td className="py-4 pr-4"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${ready ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{kind === "chat" ? saved ? <UiText id="admin.mfa1876770899" /> : <UiText id="admin.m75b554d94fb4" /> : ready ? <UiText id="admin.mfa1876770899" /> : <UiText id="admin.m9596e7bfab7b" />}</span></td>
                  <td className="py-4 pr-4 text-xs text-[var(--app-muted)]">{kind === "chat" ? <ProviderLlmUsageTags locale={locale} compact align="start" providerId={providerId} modelId={model} scenarios={scenarios} disabled={routesDisabled} draftBindings={routeDrafts} allowDraftSelection={!saved} actionByScenario={routeActions} onActivate={onActivateRoute} /> : usageText(capability.usages) || "—"}</td>
                  <td className="py-4 text-right">{!isBuiltinProviderModel(providerId, kind, model) && <button type="button" disabled={mutationsDisabled} onClick={() => onRemove(kind, model)} aria-label={removeLabel(kind, model)} className="text-xs text-[var(--app-muted)] hover:text-red-500 disabled:opacity-40"><UiText id="admin.m6135d4159e89" /></button>}</td>
                </tr>

              </React.Fragment>;
            })}
            {!rows.length && <tr><td colSpan={5} className="py-16 text-center text-sm text-[var(--app-muted)]">{searchQuery ? <UiText id="admin.m4b5e0ae1288a" /> : <UiText id="admin.ma7fd62f5e09e" />}</td></tr>}
          </tbody>
        </table>
      </div></UiProps>
    </section>;
  }

  return (
    <section className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="mb-3">
        <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mea4bf042d1bc" /></div>
        <div className="mt-0.5 text-[11px] text-[var(--app-muted)]"><UiText id="admin.me212b5f66cfa" /></div>
      </div>

      <div className="space-y-3">
        {GROUPS.map((group) => {
          const models = modelsByKind[group.kind];
          return (
            <div key={group.kind} className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--app-fg)]">{text(group.label)}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">{text(group.hint)}</div>
                </div>
                {group.kind === "chat" && canManageChat ? (
                  <div className="flex min-w-[220px] flex-1 gap-2 sm:max-w-md">
                    <UiProps ids={{"placeholder":["admin.m35f46f2dc7b4","admin.m94695e829e03"]}}><FrostedSelect
                      value={chatModelDraft}
                      onChange={onChatModelDraftChange}
                      options={chatModelOptions.map((modelId) => ({ value: modelId, label: modelId }))}
                      placeholder={chatModelOptions.length ? "admin.m35f46f2dc7b4" : "admin.m94695e829e03"}
                      ariaLabel={tLabel("选择拉取到的 LLM 模型")}
                      disabled={mutationsDisabled || !chatModelOptions.length}
                      showLeading={false}
                      side="auto"
                      compact
                      className="min-w-0 flex-1"
                    /></UiProps>
                    <button
                      type="button"
                      onClick={onAddChatModel}
                      disabled={mutationsDisabled || !canAddFetchedChatModel(chatModelDraft, chatModelOptions)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)]"
                    >
                      <Plus className="h-3.5 w-3.5" /><UiText id="admin.m7a8a11ead507" /></button>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                {models.length ? (
                  models.map((model) => {
                    const capability = getProviderModelCapability(providerId, group.kind, model);
                    const saved = group.kind !== "chat" || savedChatModels.includes(model);
                    return (
                      <div key={model} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere] font-mono text-[12px] text-[var(--app-fg)]" title={model}>{model}</span>
                          {group.kind === "chat" || group.kind === "audio" ? <LlmModelModalities providerId={providerId} modelId={model} /> : null}
                        </div>
                        {group.kind === "chat" ? (
                          <span className={[
                            "rounded-md border px-2 py-1 text-[10px] font-medium",
                            saved
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-600",
                          ].join(" ")}>
                            {saved ? <UiText id="admin.mfa1876770899" /> : <UiText id="admin.m75b554d94fb4" />}
                          </span>
                        ) : (
                          <span className={[
                            "rounded-md border px-2 py-1 text-[10px] font-medium",
                            capability.adapterBacked
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                          ].join(" ")}>
                            {capability.adapterBacked ? <UiText id="admin.mfa1876770899" /> : <UiText id="admin.m9596e7bfab7b" />}
                          </span>
                        )}
                        {group.kind !== "chat" ? capability.usages.map((usage) => (
                          <span key={usage} className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[10px] text-[var(--app-muted)]">{tLabel(usage)}</span>
                        )) : null}
                        {group.kind === "chat" ? (
                          <ProviderLlmUsageTags
                            locale={locale}
                            providerId={providerId}
                            modelId={model}
                            scenarios={scenarios}
                            disabled={routesDisabled}
                            draftBindings={routeDrafts}
                            allowDraftSelection={!saved}
                            actionByScenario={routeActions}
                            onActivate={onActivateRoute}
                          />
                        ) : null}
                        {!isBuiltinProviderModel(providerId, group.kind, model) && <UiProps ids={{"title":["admin.m11c67ef20336"]}}><button
                          type="button"
                          onClick={() => onRemove(group.kind, model)}
                          disabled={mutationsDisabled}
                          className="rounded-md p-1.5 text-[var(--app-muted)] transition hover:bg-red-500/10 hover:text-red-500"
                          aria-label={removeLabel(group.kind, model)}
                          title="admin.m11c67ef20336"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button></UiProps>}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--app-muted)]"><UiText id="admin.m2865604fb350" /></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
