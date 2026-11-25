"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { FileText, Pencil, Trash2 } from "lucide-react";
import type { PromptPresetDto } from "@/lib/prompt-presets/contracts";
import { fetchJsonOnce } from "@/lib/client/inflight-json";

type BuiltinPreset = PromptPresetDto & { source: "builtin" };

export type BuiltinPresetsSectionHandle = {
  refresh: () => Promise<void>;
  getRevision: (presetId: string) => number | undefined;
};

type BuiltinPresetsSectionProps = {
  onRequestDelete: (
    compatibilityScope: string,
    presetId: string,
    presetName: string,
  ) => void;
};

const BuiltinPresetsSection = React.forwardRef<
  BuiltinPresetsSectionHandle,
  BuiltinPresetsSectionProps
>(function BuiltinPresetsSection({ onRequestDelete }, ref) {
  const [presets, setPresets] = React.useState<BuiltinPreset[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [content, setContent] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingRevision, setEditingRevision] = React.useState<number | null>(
    null,
  );

  const categorySuggestions = React.useMemo(
    () =>
      Array.from(
        new Set(
          presets
            .map((preset) => preset.category.trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [presets],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { ok, json: body } = await fetchJsonOnce<{ presets?: BuiltinPreset[] }>("/api/admin/presets")
        .catch(() => ({ ok: false, json: null }));
      if (!ok) {
        setPresets([]);
        return;
      }
      setPresets(Array.isArray(body?.presets) ? body.presets : []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      refresh: load,
      getRevision: (presetId) =>
        presets.find((preset) => preset.id === presetId)?.revision,
    }),
    [load, presets],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setEditingRevision(null);
    setName("");
    setCategory("");
    setContent("");
  };

  const startEditing = (preset: BuiltinPreset) => {
    setEditingId(preset.id);
    setEditingRevision(preset.revision);
    setName(preset.name);
    setCategory(preset.category);
    setContent(preset.content);
  };

  const save = async () => {
    const value = {
      name: name.trim(),
      category: category.trim(),
      content: content.trim(),
    };
    if (!value.name || !value.category || !value.content) return;

    setSaving(true);
    try {
      const response = await fetch("/api/admin/presets", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editingId
            ? {
                presetId: editingId,
                expectedRevision: editingRevision,
                ...value,
              }
            : value,
        ),
      }).catch(() => null);
      if (!response?.ok) return;
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="sys-presets"
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm"
    >
      <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
        <FileText className="h-4 w-4" /><UiText id="admin.md93013894045" /></h3>

      <div className="space-y-3">
        <UiProps ids={{"placeholder":["admin.m5dfa2f9050e4"]}}><input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="admin.m5dfa2f9050e4"
          className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--primary-bg)]"
        /></UiProps>
        <div className="space-y-2">
          <UiProps ids={{"placeholder":["admin.me0a81a30843c"]}}><input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="admin.me0a81a30843c"
            className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--primary-bg)]"
          /></UiProps>
          {categorySuggestions.length ? (
            <UiProps ids={{"aria-label":["admin.m2deff738a89f"]}}><div className="flex flex-wrap gap-2" aria-label="admin.m2deff738a89f">
              {categorySuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setCategory(suggestion)}
                  className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1 text-[11px] text-[var(--app-muted)] transition hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
                >
                  {suggestion}
                </button>
              ))}
            </div></UiProps>
          ) : null}
        </div>
        <UiProps ids={{"placeholder":["admin.mcc1ab53aea16"]}}><textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="admin.mcc1ab53aea16"
          className="min-h-[120px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] leading-relaxed text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--primary-bg)]"
        /></UiProps>
        <div className="flex items-center justify-end gap-2">
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[12px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            ><UiText id="admin.m4b29ce8e4093" /></button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving
              || !name.trim()
              || !category.trim()
              || !content.trim()
              || (editingId !== null && editingRevision === null)
            }
            className="h-9 rounded-xl bg-[var(--primary-bg)] px-4 text-[12px] font-medium text-[var(--primary-fg)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <UiText id="admin.mff509c9ba052" /> : editingId ? <UiText id="admin.m991bb7cfe5a8" /> : <UiText id="admin.m936ee5e200c0" />}
          </button>
        </div>
      </div>

      <div className="mt-8 border-t border-[var(--border)] pt-6">
        <div className="mb-4 text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.mb5e01a1e9ca4" />{presets.length})
        </div>
        {loading ? (
          <div className="py-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m4927a53bcc88" /></div>
        ) : presets.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {presets.map((preset) => (
              <article
                key={preset.id}
                className="group relative rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3"
              >
                <div className="truncate pr-16 text-[13px] font-semibold text-[var(--app-fg)]">
                  {preset.name}
                </div>
                <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                  {preset.category}
                </div>
                <div className="mt-2 line-clamp-2 text-[11px] text-[var(--app-muted)]">
                  {preset.content}
                </div>
                <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`编辑 ${preset.name}`}
                    onClick={() => startEditing(preset)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${preset.name}`}
                    onClick={() =>
                      onRequestDelete("", preset.id, preset.name)
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--primary-bg)] hover:text-[var(--primary-fg)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-2)] py-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.me207fc469357" /></div>
        )}
      </div>
    </section>
  );
});

export default BuiltinPresetsSection;
