"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Check, Search, X } from "lucide-react";
import {
  countSelectedModels,
  mergeModelCandidates,
  type ProviderModelGroups,
} from "@/lib/providers/model-selection";
import { getProviderModelCapability, isBuiltinProviderModel } from "@/lib/providers/model-availability";

type ModelKind = keyof ProviderModelGroups;
type ModelFilter = "all" | ModelKind;

const MODEL_KINDS: { id: ModelKind; label: string }[] = [
  { id: "image", label: "生图" },
  { id: "chat", label: "LLM" },
  { id: "video", label: "视频" },
];

function cloneGroups(groups: ProviderModelGroups): ProviderModelGroups {
  return {
    image: [...groups.image],
    video: [...groups.video],
    chat: [...groups.chat],
  };
}

export function ProviderModelsModal({
  providerId,
  providerName,
  fetchedModels,
  selectedModels,
  supportsLlm,
  mutationsDisabled,
  canMutateDraft,
  onClose,
  onConfirm,
}: {
  providerId: string;
  providerName: string;
  fetchedModels: ProviderModelGroups;
  selectedModels: ProviderModelGroups;
  supportsLlm: boolean;
  mutationsDisabled: boolean;
  canMutateDraft: () => boolean;
  onClose: () => void;
  onConfirm: (models: ProviderModelGroups) => void;
}) {
  const { label: tLabel } = useUiLocale();
  const [activeFilter, setActiveFilter] = React.useState<ModelFilter>("all");
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<ProviderModelGroups>(() =>
    cloneGroups(selectedModels),
  );

  React.useEffect(() => {
    setActiveFilter("all");
    setQuery("");
    setDraft(cloneGroups(selectedModels));
  }, [providerId, providerName, selectedModels]);

  const candidates = React.useMemo(
    () => mergeModelCandidates(fetchedModels, draft),
    [draft, fetchedModels],
  );
  const totalModelCount = MODEL_KINDS.reduce(
    (total, kind) => total + candidates[kind.id].length,
    0,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleModels = (
    activeFilter === "all"
      ? MODEL_KINDS.flatMap((kind) =>
          candidates[kind.id].map((model) => ({ kind: kind.id, model })),
        )
      : candidates[activeFilter].map((model) => ({ kind: activeFilter, model }))
  ).filter(({ model }) => model.toLowerCase().includes(normalizedQuery));
  const selectedCount = countSelectedModels(draft);
  const unselectedCount = Math.max(totalModelCount - selectedCount, 0);
  const mutationAllowed = !mutationsDisabled && canMutateDraft();

  const toggle = (kind: ModelKind, model: string) => {
    if (mutationsDisabled || !canMutateDraft()) return;
    setDraft((current) => {
      const selected = current[kind];
      if (selected.includes(model) && isBuiltinProviderModel(providerId, kind, model)) return current;
      const next = selected.includes(model)
        ? selected.filter((item) => item !== model)
        : [...selected, model];
      return { ...current, [kind]: next };
    });
  };

  return (
    <div
      className="fixed inset-0 z-[260] grid place-items-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={tLabel(`${providerName} 模型选择`)}
        className="flex h-[min(86vh,880px)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div>
            <h4 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--app-fg)]"><UiText id="admin.m95e581b7c0ce" /></h4>
            <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" />{totalModelCount}<UiText id="admin.m93f5fab9205d" />{visibleModels.length}<UiText id="admin.m7aaf96ad52e0" /></p>
          </div>
          <UiProps ids={{"aria-label":["admin.m3fd47edce45b"]}}><button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-transparent bg-[var(--panel-2)] p-2 text-[var(--app-muted)] transition hover:border-[var(--border)] hover:text-[var(--app-fg)]"
            aria-label="admin.m3fd47edce45b"
          >
            <X className="h-4 w-4" />
          </button></UiProps>
        </header>

        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-6 py-4 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-muted)]" />
            <UiProps ids={{"placeholder":["admin.m696fa62761e8"]}}><input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="admin.m696fa62761e8"
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] py-2 pl-10 pr-3 text-[13px] text-[var(--app-fg)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--primary-bg)]"
            /></UiProps>
          </label>
          <UiProps ids={{"aria-label":["admin.m61f801e7608f"]}}><div
            className="flex w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-1 md:w-auto"
            role="tablist"
            aria-label="admin.m61f801e7608f"
          >
            {(
              [{ id: "all", label: "全部" }, ...MODEL_KINDS] as {
                id: ModelFilter;
                label: string;
              }[]
            ).map((filter) => {
              const modelCount =
                filter.id === "all"
                  ? totalModelCount
                  : candidates[filter.id].length;
              const selectedForFilter =
                filter.id === "all" ? selectedCount : draft[filter.id].length;
              const isActive = activeFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveFilter(filter.id)}
                  className={[
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition",
                    isActive
                      ? "bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-sm"
                      : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                  ].join(" ")}
                >
                  <span>{filter.label}</span>
                  <span className="rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--app-muted)]">
                    {selectedForFilter}/{modelCount}
                  </span>
                </button>
              );
            })}
          </div></UiProps>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {visibleModels.length ? (
            <div className="space-y-1.5">
              {visibleModels.map(({ kind, model }) => {
                const selected = draft[kind].includes(model);
                const lockedBuiltin = selected && isBuiltinProviderModel(providerId, kind, model);
                const capability = getProviderModelCapability(providerId, kind, model);
                const adapterBacked = kind === "chat" ? supportsLlm : capability.adapterBacked;
                return (
                  <UiProps key={`${kind}:${model}`} ids={{"title":["admin.m367bf78784e6"]}}><button

                    type="button"
                    disabled={!mutationAllowed || lockedBuiltin || (!selected && !adapterBacked)}
                    title={lockedBuiltin ? "admin.m367bf78784e6" : undefined}
                    onClick={() => toggle(kind, model)}
                    className={[
                      "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition",
                      selected
                        ? "border-[var(--primary-bg)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                        : adapterBacked
                          ? "border-transparent bg-[var(--input-bg)] text-[var(--app-fg)] hover:border-[var(--border-2)] hover:bg-[var(--panel-2)]"
                          : "cursor-not-allowed border-amber-500/30 bg-amber-500/5 text-[var(--app-muted)] opacity-80",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition",
                        selected
                          ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                          : "border-[var(--border-2)] bg-transparent text-transparent",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span
                      className="max-w-24 shrink-0 truncate rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--app-muted)]"
                      title={providerName}
                    >
                      {providerName}
                    </span>
                    {!adapterBacked ? (
                      <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"><UiText id="admin.m9596e7bfab7b" /></span>
                    ) : null}
                    <span className="min-w-0 truncate font-medium">
                      {model}
                    </span>
                  </button></UiProps>
                );
              })}
            </div>
          ) : (
            <p className="py-14 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.mb4f57abef650" /></p>
          )}
        </div>

        <footer className="border-t border-[var(--border)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--app-muted)]">
              <span><UiText id="admin.mf821b08327a9" /></span>
              {MODEL_KINDS.map((kind) => (
                <span
                  key={kind.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1 font-medium text-[var(--app-fg)]"
                >
                  {kind.label} {draft[kind.id].length}
                </span>
              ))}
            </div>
            <span className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4276233dc410" />{unselectedCount}
            </span>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--input-bg)]"
            ><UiText id="admin.m2cd0f3be8738" /></button>
            <button
              type="button"
              onClick={() => { if (!mutationsDisabled && canMutateDraft()) onConfirm(draft); }}
              disabled={!mutationAllowed}
              className="rounded-xl bg-[var(--primary-bg)] px-4 py-2 text-[12px] font-medium text-[var(--primary-fg)] transition hover:bg-[var(--primary-hover)]"
            ><UiText id="admin.m7f88605d4c8e" /></button>
          </div>
        </footer>
      </section>
    </div>
  );
}
