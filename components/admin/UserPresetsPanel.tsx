"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Trash2 } from "lucide-react";
import type { PromptPresetDto } from "@/lib/prompt-presets/contracts";

type UserPresetsPanelProps = {
  presets: PromptPresetDto[] | null;
  onRequestDelete: (preset: PromptPresetDto) => void;
};

function isPublicPromptId(id: string) {
  return /^(?:custom|builtin):[1-9]\d*$/.test(id);
}

export default function UserPresetsPanel({
  presets,
  onRequestDelete,
}: UserPresetsPanelProps) {
  const { label: tLabel } = useUiLocale();
  const list = presets || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb1b77fd905b6" /></div>
        <span className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" />{list.length}<UiText id="admin.m6fb2840d568a" /></span>
      </div>

      {list.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((preset) => {
            const canDelete = isPublicPromptId(preset.id);
            const sourceLabel =
              preset.source === "builtin" ? "内置" : "用户自定义";
            return (
              <article
                key={preset.id}
                className="group relative rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4"
              >
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <h4 className="truncate text-[13px] font-semibold text-[var(--app-fg)]">
                      {preset.name}
                    </h4>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--app-muted)]">
                        {preset.category}
                      </span>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]">
                        {sourceLabel}
                        {!canDelete ? <UiText id="admin.m74139b01302b" /> : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed text-[var(--app-muted)]">
                  {preset.content}
                </p>

                {canDelete ? (
                  <button
                    type="button"
                    aria-label={tLabel(`删除 ${preset.name}`)}
                    onClick={() => onRequestDelete(preset)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] opacity-0 transition hover:bg-[var(--primary-bg)] hover:text-[var(--primary-fg)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] py-10 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.m1f798e0c5670" /></div>
      )}
    </div>
  );
}
