"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Pencil, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePromptPresets } from "@/components/presets/use-prompt-presets";
import type { PromptPresetDto } from "@/lib/prompt-presets/contracts";
import Portal from "./Portal";

type Props = {
  onClose: () => void;
  onApply: (content: string) => void;
};

export default function PromptTemplatePicker({ onClose, onApply }: Props) {
  const { text } = useUiLocale();
  const {
    presets,
    loading,
    error,
    createPreset,
    updatePreset,
    deletePreset,
  } = usePromptPresets();
  const [category, setCategory] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<PromptPresetDto | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<PromptPresetDto | null>(null);
  const [name, setName] = React.useState("");
  const [editorCategory, setEditorCategory] = React.useState("");
  const [content, setContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [editorError, setEditorError] = React.useState<string | null>(null);

  const categories = React.useMemo(
    () =>
      Array.from(
        new Set(
          presets
            .map((preset) => preset.category.trim())
            .filter(Boolean),
        ),
      ),
    [presets],
  );

  React.useEffect(() => {
    if (category !== "all" && !categories.includes(category)) {
      setCategory("all");
    }
  }, [categories, category]);

  const filtered = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return presets.filter((preset) => {
      if (category !== "all" && preset.category !== category) return false;
      if (!keyword) return true;
      return `${preset.name}\n${preset.category}\n${preset.content}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [category, presets, query]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setEditorCategory(category === "all" ? "" : category);
    setContent("");
    setEditorError(null);
  };

  const openEdit = (preset: PromptPresetDto) => {
    setEditing(preset);
    setName(preset.name);
    setEditorCategory(preset.category);
    setContent(preset.content);
    setEditorError(null);
  };

  const save = async () => {
    const value = {
      name: name.trim(),
      category: editorCategory.trim(),
      content: content.trim(),
    };
    if (!value.name || !value.category || !value.content) {
      setEditorError(text("workspaceFollowup.m1a2e9b51ba8e"));
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      if (editing) await updatePreset(editing, value);
      else await createPreset(value);
      openCreate();
    } catch (nextError) {
      setEditorError(
        nextError instanceof Error ? nextError.message : text("workspaceFollowup.m1c4e78e72ba7"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] p-4"
        onClick={onClose}
      >
        <div
          className="flex h-[560px] w-[860px] max-w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border)]">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <Wand2 className="h-4 w-4 text-[var(--primary-bg)]" />
              <span className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="canvas.mf6123ab92cbe" /></span>
              <UiProps ids={{"aria-label":["canvas.mdf610db74509"]}}><button
                type="button"
                onClick={openCreate}
                className="ml-auto rounded-lg p-1.5 text-[var(--app-muted)] hover:bg-[var(--panel-2)]"
                aria-label="canvas.mdf610db74509"
              >
                <Plus className="h-4 w-4" />
              </button></UiProps>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-[var(--app-muted)]" />
              <UiProps ids={{"placeholder":["canvas.mff438d1cf4ae"]}}><input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="canvas.mff438d1cf4ae"
                className="w-full bg-transparent text-[12px] text-[var(--app-fg)] outline-none"
              /></UiProps>
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {["all", ...categories].map((categoryName) => (
                <button
                  key={categoryName}
                  type="button"
                  onClick={() => setCategory(categoryName)}
                  className={[
                    "rounded-lg px-2 py-0.5 text-[11px]",
                    category === categoryName
                      ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                      : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]",
                  ].join(" ")}
                >
                  {categoryName === "all" ? <UiText id="canvas.m5c55a67935af" /> : categoryName}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              {loading ? (
                <div className="mt-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="canvas.m9dc0825fba54" /></div>
              ) : null}
              {!loading && filtered.length === 0 ? (
                <div className="mt-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="canvas.mdbf9ea691dc7" /></div>
              ) : null}
              {filtered.map((preset) => (
                <div
                  key={preset.id}
                  className="group flex items-center rounded-lg hover:bg-[var(--panel-2)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onApply(preset.content);
                      onClose();
                    }}
                    className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[12px] text-[var(--app-fg)]"
                    title={preset.content}
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(preset)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--panel-3)]"
                    aria-label={text("workspaceFollowup.m1c7938d19d7a", { v0: preset.name })}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(preset)}
                    className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--app-muted)] hover:bg-[var(--panel-3)]"
                    aria-label={text("workspaceFollowup.m33977a385c8d", { v0: preset.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center border-b border-[var(--border)] px-3 py-2">
              <span className="truncate text-[13px] font-medium text-[var(--app-fg)]">
                {editing ? <UiText id="canvas.mb52f59e63937" /> : <UiText id="canvas.mdf610db74509" />}
              </span>
              <UiProps ids={{"aria-label":["canvas.m3fd47edce45b"]}}><button
                type="button"
                onClick={onClose}
                className="ml-auto rounded-lg p-1.5 text-[var(--app-muted)] hover:bg-[var(--panel-2)]"
                aria-label="canvas.m3fd47edce45b"
              >
                <X className="h-4 w-4" />
              </button></UiProps>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-[12px]">
              <div className="space-y-1">
                <span className="font-medium text-[var(--app-fg)]"><UiText id="canvas.m5e7c625a046d" /></span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={128}
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)]"
                />
              </div>
              <div className="space-y-1">
                <span className="font-medium text-[var(--app-fg)]"><UiText id="canvas.m56a12564a014" /></span>
                <UiProps ids={{"placeholder":["canvas.mfd2fda1530e3"]}}><input
                  value={editorCategory}
                  onChange={(event) => setEditorCategory(event.target.value)}
                  placeholder="canvas.mfd2fda1530e3"
                  maxLength={64}
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)]"
                /></UiProps>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((categoryName) => (
                    <button
                      key={categoryName}
                      type="button"
                      onClick={() => setEditorCategory(categoryName)}
                      className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                    >
                      {categoryName}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex min-h-0 flex-1 flex-col gap-1">
                <span className="font-medium text-[var(--app-fg)]"><UiText id="canvas.m53d3e6546e1b" /></span>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={10000}
                  className="min-h-[220px] flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-3 text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)]"
                />
              </label>
              {error || editorError ? (
                <div className="text-[var(--app-muted)]">
                  {editorError || error}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-2.5">
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
              ><UiText id="canvas.m1ef3de06b32e" /></button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-[var(--primary-bg)] px-3 py-1.5 text-[12px] text-[var(--primary-fg)] disabled:opacity-50"
              >
                {saving ? <UiText id="canvas.m917b1c1f18d0" /> : <UiText id="canvas.ma3030bf8f16d" />}
              </button>
            </div>
          </div>
        </div>
      </div>
      <UiProps ids={{"title":["canvas.m2e69ccb0f8dd"],"confirmText":["canvas.ma3ea3c17b401"],"cancelText":["canvas.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!deleteTarget}
        title="canvas.m2e69ccb0f8dd"
        description={
          deleteTarget ? text("workspaceFollowup.m8e9ec0a9e710", { v0: deleteTarget.name }) : ""
        }
        confirmText="canvas.ma3ea3c17b401"
        cancelText="canvas.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setSaving(true);
          try {
            await deletePreset(deleteTarget);
            setDeleteTarget(null);
            if (editing?.id === deleteTarget.id) openCreate();
          } catch (nextError) {
            setEditorError(
              nextError instanceof Error ? nextError.message : "提示词删除失败",
            );
          } finally {
            setSaving(false);
          }
        }}
      /></UiProps>
    </Portal>
  );
}
