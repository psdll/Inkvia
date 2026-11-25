"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  BookOpen,
  Copy,
  Download,
  FileText,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePromptPresets } from "@/components/presets/use-prompt-presets";
import type {
  PromptPresetDto,
  PromptPresetInput,
} from "@/lib/prompt-presets/contracts";

export type PresetPrompt = PromptPresetDto;

function safeParsePresets(text: string): PromptPresetInput[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: any): PromptPresetInput | null => {
        const name = String(x?.name || "").trim();
        const content = String(x?.content || "").trim();
        const category = String(x?.category || "").trim();
        if (!name || !category || !content) return null;
        return {
          name,
          content,
          category,
        };
      })
      .filter((x): x is PromptPresetInput => x !== null);
  } catch {
    return [];
  }
}

async function copyText(text: string) {
  const s = String(text || "");
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PresetPromptsTrigger({
  onApply,
  className,
  mode = "inline",
  triggerVariant = "icon",
  triggerLabel,
  presentation = "presets",
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  onApply: (content: string) => void;
  className?: string;
  mode?: "inline" | "bottom_sheet";
  triggerVariant?: "icon" | "inline";
  triggerLabel?: string;
  presentation?: "presets" | "assistant";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const { text, label: localizeLabel, error: localizeError } = useUiLocale();
  const displayTriggerLabel = triggerLabel === undefined || triggerLabel === "预设提示词" ? text("createDynamic.mb46a606b401c") : triggerLabel;
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
  const {
    presets,
    loading,
    error,
    reload,
    createPreset,
    updatePreset,
    deletePreset,
  } = usePromptPresets();
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<PresetPrompt | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PresetPrompt | null>(
    null,
  );
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState("all");
  const [categoryErr, setCategoryErr] = React.useState(false);
  const [nameErr, setNameErr] = React.useState(false);
  const [contentErr, setContentErr] = React.useState(false);
  const [persisting, setPersisting] = React.useState(false);
  const [persistError, setPersistError] = React.useState<string | null>(null);
  const [persistSuccess, setPersistSuccess] = React.useState<string | null>(
    null,
  );
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    void reload().catch(() => undefined);
  }, [open, reload]);

  React.useEffect(() => {
    if (error) setPersistError(error);
  }, [error]);

  React.useEffect(() => {
    if (!persistSuccess) return;
    const timer = window.setTimeout(() => setPersistSuccess(null), 2200);
    return () => window.clearTimeout(timer);
  }, [persistSuccess]);

  const assistantCategories = React.useMemo(
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
    if (
      activeCategory !== "all" &&
      !assistantCategories.includes(activeCategory)
    ) {
      setActiveCategory("all");
    }
  }, [activeCategory, assistantCategories]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = presets.filter((p) => {
      if (activeCategory === "all") return true;
      return p.category === activeCategory;
    });
    if (!s) return base;
    return base.filter((p) =>
      `${p.name}\n${p.category}\n${p.content}`.toLowerCase().includes(s),
    );
  }, [activeCategory, presets, q]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setContent("");
    setCategory(activeCategory === "all" ? "" : activeCategory);
    setCategoryErr(false);
    setNameErr(false);
    setContentErr(false);
    setEditorOpen(true);
  };

  const openEdit = (p: PresetPrompt) => {
    setEditing(p);
    setName(p.name);
    setContent(p.content);
    setCategory(p.category);
    setCategoryErr(false);
    setNameErr(false);
    setContentErr(false);
    setEditorOpen(true);
  };

  const savePreset = async () => {
    const n = name.trim();
    const c = content.trim();
    const group = category.trim();
    const groupErr = !group;
    const nErr = !n;
    const cErr = !c;
    setCategoryErr(groupErr);
    setNameErr(nErr);
    setContentErr(cErr);
    if (groupErr || nErr || cErr) return;

    setPersisting(true);
    setPersistError(null);
    setPersistSuccess(null);
    try {
      const value = { name: n, category: group, content: c };
      if (editing) await updatePreset(editing, value);
      else await createPreset(value);
      setPersistSuccess(editing ? "提示词已更新" : "提示词已创建");
      setEditorOpen(false);
    } catch (nextError) {
      setPersistError(
        nextError instanceof Error ? nextError.message : "提示词保存失败",
      );
    } finally {
      setPersisting(false);
    }
  };

  const removePreset = async (target: PresetPrompt) => {
    setPersisting(true);
    setPersistError(null);
    try {
      await deletePreset(target);
      setDeleteTarget(null);
      if (editing?.id === target.id) {
        setEditorOpen(false);
        setEditing(null);
      }
    } catch (nextError) {
      setPersistError(
        nextError instanceof Error ? nextError.message : "提示词删除失败",
      );
    } finally {
      setPersisting(false);
    }
  };

  const handleExport = () => {
    const data = presets
      .filter((preset) => preset.source === "custom")
      .map((preset) => ({
        name: preset.name,
        category: preset.category,
        content: preset.content,
      }));
    downloadJson("prompt-presets.json", data);
  };

  const handleImportClick = () => {
    fileRef.current?.click();
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text().catch(() => "");
    const incoming = safeParsePresets(text);
    if (!incoming.length) {
      setPersistError("导入文件中没有分类、标题和内容完整的提示词");
      return;
    }
    setPersisting(true);
    setPersistError(null);
    try {
      for (const preset of incoming) {
        await createPreset(preset);
      }
      setPersistSuccess(`已导入 ${incoming.length} 条提示词`);
    } catch (nextError) {
      setPersistError(
        nextError instanceof Error ? nextError.message : "提示词导入失败",
      );
    } finally {
      setPersisting(false);
    }
  };

  const presetPanel = (
    <>
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border)] flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] flex items-center justify-center text-[var(--app-fg)]">
          <FileText className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="common.mb46a606b401c" /></div>
        </div>
        <UiProps ids={{"aria-label":["common.m7ecc56d77c57"],"title":["common.m7ecc56d77c57"]}}><button
          type="button"
          onClick={handleExport}
          className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
          aria-label="common.m7ecc56d77c57"
          title="common.m7ecc56d77c57"
        >
          <Download className="h-3.5 w-3.5" />
        </button></UiProps>
        <UiProps ids={{"aria-label":["common.m24d9d2e891a8"],"title":["common.m24d9d2e891a8"]}}><button
          type="button"
          onClick={handleImportClick}
          className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
          aria-label="common.m24d9d2e891a8"
          title="common.m24d9d2e891a8"
        >
          <Upload className="h-3.5 w-3.5" />
        </button></UiProps>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            void handleImportFile(f);
            e.currentTarget.value = "";
          }}
        />
        <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
          type="button"
          onClick={() => setOpen(false)}
          className="h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
          aria-label="common.m3fd47edce45b"
        >
          <X className="h-3.5 w-3.5" />
        </button></UiProps>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
        {["all", ...assistantCategories].map((categoryName) => (
          <button
            key={categoryName}
            type="button"
            onClick={() => setActiveCategory(categoryName)}
            className={[
              "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
              activeCategory === categoryName
                ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                : "bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
            ].join(" ")}
          >
            {categoryName === "all" ? <UiText id="common.m5c55a67935af" /> : categoryName}
          </button>
        ))}
      </div>

      <div className="px-3 pt-2.5 pb-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0 relative">
          <Search className="h-3.5 w-3.5 text-[var(--app-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <UiProps ids={{"placeholder":["common.m79706e246b01"]}}><input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="common.m79706e246b01"
            className="h-9 w-full pl-9 pr-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[12px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
          /></UiProps>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={persisting}
          className="h-9 px-3.5 rounded-xl bg-black text-white text-[12px] font-semibold hover:bg-black/90 transition flex items-center gap-2"
        >
          <Plus className="h-3.5 w-3.5" /><UiText id="common.m50ef2f4cf6a4" /></button>
      </div>
      {persistError ? (
        <div className="px-3 pb-2 text-[12px] text-rose-500">
          {localizeError(persistError)}
        </div>
      ) : null}
      {!persistError && persistSuccess ? (
        <div className="px-3 pb-2 text-[12px] text-emerald-600">
          {localizeLabel(persistSuccess)}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 px-3 pb-4 overflow-auto">
        {filtered.length ? (
          <div className="space-y-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="relative group rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2.5 hover:bg-[var(--panel-2)] transition"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApply(p.content);
                    setOpen(false);
                  }}
                  className="w-full text-left"
                >
                  <div className="text-[13px] font-semibold text-[var(--app-fg)]">
                    {p.name}
                  </div>
                  <div className="mt-1 line-clamp-4 text-[12px] text-[var(--app-muted)] leading-relaxed whitespace-pre-wrap break-words">
                    {p.content}
                  </div>
                </button>
                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow-2)] px-1 py-1">
                    <UiProps ids={{"aria-label":["common.m63d90d977348"],"title":["common.m63d90d977348"]}}><button
                      type="button"
                      onClick={() => void copyText(p.content)}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label="common.m63d90d977348"
                      title="common.m63d90d977348"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"aria-label":["common.m37090f456516"],"title":["common.m37090f456516"]}}><button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label="common.m37090f456516"
                      title="common.m37090f456516"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"aria-label":["common.m2f9daa828907"],"title":["common.m2f9daa828907"]}}><button
                      type="button"
                      onClick={() => setDeleteTarget(p)}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label="common.m2f9daa828907"
                      title="common.m2f9daa828907"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button></UiProps>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="h-14 w-14 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] flex items-center justify-center text-[var(--app-muted)]">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="mt-4 text-sm font-medium text-[var(--app-fg)]"><UiText id="common.m0c75be1d0155" /></div>
            <div className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="common.m6b687e462e49" /></div>
          </div>
        )}
      </div>
    </>
  );

  const assistantPanel = (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-[var(--border)] px-4">
        <h2 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="common.mcf70d62ae6cd" /></h2>
        <UiProps ids={{"aria-label":["common.m5cf21d90b0e5"]}}><button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
          aria-label="common.m5cf21d90b0e5"
        >
          <X className="h-3.5 w-3.5" />
        </button></UiProps>
      </div>

      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={[
              "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
              activeCategory === "all"
                ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                : "bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
            ].join(" ")}
          ><UiText id="common.m5c55a67935af" /></button>
          {assistantCategories.map((categoryName) => (
            <button
              key={categoryName}
              type="button"
              onClick={() => setActiveCategory(categoryName)}
              className={[
                "h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                activeCategory === categoryName
                  ? "bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                  : "bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
              ].join(" ")}
            >
              {categoryName}
            </button>
          ))}
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-muted)]" />
          <UiProps ids={{"placeholder":["common.m81a6145e32f6"]}}><input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="common.m81a6145e32f6"
            className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] pl-9 pr-3 text-xs text-[var(--app-fg)] outline-none transition focus:border-[var(--primary-bg)]"
          /></UiProps>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <button
          type="button"
          onClick={openCreate}
          disabled={persisting}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[11px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--panel-3)] disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /><UiText id="common.mdf610db74509" /></button>

        {persistError ? (
          <div className="mt-3 text-xs text-rose-500">{localizeError(persistError)}</div>
        ) : null}
        {!persistError && persistSuccess ? (
          <div className="mt-3 text-xs text-emerald-500">{localizeLabel(persistSuccess)}</div>
        ) : null}

        {filtered.length ? (
          <div className="mt-2.5 space-y-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="relative group rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2.5 hover:bg-[var(--panel-2)] transition"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApply(p.content);
                    setOpen(false);
                  }}
                  className="w-full text-left"
                  title={text("createDynamic.m62dee21ab402", { title: p.name })}
                >
                  <div className="text-[13px] font-semibold text-[var(--app-fg)]">
                    {p.name}
                  </div>
                  <div className="mt-1 line-clamp-4 text-[12px] text-[var(--app-muted)] leading-relaxed whitespace-pre-wrap break-words">
                    {p.content}
                  </div>
                </button>
                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow-2)] px-1 py-1">
                    <UiProps ids={{"title":["common.m63d90d977348"]}}><button
                      type="button"
                      onClick={() => void copyText(p.content)}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label={text("createDynamic.m49060bd31763", { title: p.name })}
                      title="common.m63d90d977348"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"title":["common.m051836569928"]}}><button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(p);
                      }}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label={text("createDynamic.md0a62cf9098f", { title: p.name })}
                      title="common.m051836569928"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button></UiProps>
                    <UiProps ids={{"title":["common.m2f9daa828907"]}}><button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(p);
                      }}
                      className="h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                      aria-label={text("createDynamic.m9d74d55b9228", { title: p.name })}
                      title="common.m2f9daa828907"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button></UiProps>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-2)] text-[var(--app-muted)]">
              <BookOpen className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-medium text-[var(--app-fg)]"><UiText id="common.mdbf9ea691dc7" /></p>
            <p className="mt-1 text-xs text-[var(--app-muted)]"><UiText id="common.m661685ed896d" /></p>
          </div>
        )}
      </div>
    </>
  );

  const panel = presentation === "assistant" ? assistantPanel : presetPanel;

  const editor = editorOpen ? (
    <div
      className={
        mode === "inline"
          ? "absolute inset-0 z-[40] flex items-center justify-center p-4"
          : "absolute inset-0 z-[110] flex items-center justify-center p-4"
      }
    >
      <div
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={() => setEditorOpen(false)}
      />
      <div
        className={[
          "relative w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-[var(--shadow-2)]",
          presentation === "assistant" ? "max-w-[500px]" : "max-w-[1100px]",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[15px] font-semibold text-[var(--app-fg)]">
            {presentation === "assistant"
              ? editing
                ? <UiText id="common.mb52f59e63937" />
                : <UiText id="common.mdf610db74509" />
              : editing
                ? <UiText id="common.me7edbe8c5ae1" />
                : <UiText id="common.ma61bc16ca0f6" />}
          </div>
          <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
            type="button"
            onClick={() => setEditorOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            aria-label="common.m3fd47edce45b"
          >
            <X className="h-3.5 w-3.5" />
          </button></UiProps>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="common.m6007c2c41799" /><span className="text-rose-500">*</span>
            </div>
            <UiProps ids={{"placeholder":["common.m3d9aeb28c634"]}}><input
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setCategoryErr(false);
              }}
              placeholder="common.m3d9aeb28c634"
              maxLength={64}
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-fg)] outline-none transition focus:border-[var(--primary-bg)]"
            /></UiProps>
            <div className="flex flex-wrap gap-1.5">
              {assistantCategories.map((categoryName) => (
                <button
                  key={categoryName}
                  type="button"
                  onClick={() => {
                    setCategory(categoryName);
                    setCategoryErr(false);
                  }}
                  className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                >
                  {categoryName}
                </button>
              ))}
            </div>
            {categoryErr ? (
              <div className="text-[12px] text-rose-500"><UiText id="common.m1bb945714fcb" /></div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--app-fg)]">
              {presentation === "assistant" ? <UiText id="common.mc3405f8c7d9d" /> : <UiText id="common.m5fe110aa6d1d" />}{" "}
              <span className="text-rose-500">*</span>
            </div>
            <UiProps ids={{"placeholder":["common.mc79c2c22135f","common.m2c09021a1635"]}}><input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                presentation === "assistant"
                  ? "common.mc79c2c22135f"
                  : "common.m2c09021a1635"
              }
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-fg)] outline-none transition focus:border-[var(--primary-bg)]"
            /></UiProps>
            {nameErr ? (
              <div className="text-[12px] text-rose-500">
                {presentation === "assistant"
                  ? <UiText id="common.m015edb6a8f1a" />
                  : <UiText id="common.m1e396cf6fce0" />}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--app-fg)]">
              {presentation === "assistant" ? <UiText id="common.mcc1ab53aea16" /> : <UiText id="common.med2f68fe489c" />}{" "}
              <span className="text-rose-500">*</span>
            </div>
            <UiProps ids={{"placeholder":["common.mb832436a5deb","common.mb0f305918d99"]}}><textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                presentation === "assistant"
                  ? "common.mb832436a5deb"
                  : "common.mb0f305918d99"
              }
              maxLength={10000}
              className={[
                "w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--app-fg)] outline-none transition focus:border-[var(--primary-bg)]",
                presentation === "assistant"
                  ? "min-h-[180px]"
                  : "min-h-[260px]",
              ].join(" ")}
            /></UiProps>
            <div className="flex items-center justify-between">
              <div>
                {contentErr ? (
                  <div className="text-[12px] text-rose-500">
                    {presentation === "assistant"
                      ? <UiText id="common.m801c549a257c" />
                      : <UiText id="common.m06afc87da891" />}
                  </div>
                ) : null}
              </div>
              <div className="text-[12px] text-[var(--app-muted)]">
                {content.length}/10000
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              {presentation === "assistant" && editing ? (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(editing)}
                  disabled={persisting}
                  className="h-9 rounded-xl bg-rose-500/10 px-3.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
                ><UiText id="common.m2f9daa828907" /></button>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                disabled={persisting}
                className="h-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3.5 text-[12px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
              ><UiText id="common.m2cd0f3be8738" /></button>
              <button
                type="button"
                onClick={() => void savePreset()}
                disabled={persisting}
                className="h-9 rounded-xl bg-[var(--primary-bg)] px-4 text-[12px] font-semibold text-[var(--primary-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {persisting
                  ? <UiText id="common.m917b1c1f18d0" />
                  : presentation === "assistant"
                    ? <UiText id="common.ma3030bf8f16d" />
                    : editing
                      ? <UiText id="common.ma3030bf8f16d" />
                      : <UiText id="common.mcde2cd071d25" />}
              </button>
            </div>
          </div>
          {persistError ? (
            <div className="text-[12px] text-rose-500">{localizeError(persistError)}</div>
          ) : null}
          {!persistError && persistSuccess ? (
            <div className="text-[12px] text-emerald-600">{localizeLabel(persistSuccess)}</div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={[
            triggerVariant === "inline"
              ? presentation === "assistant"
                ? "inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[11px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-45"
                : "h-auto rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--app-muted)] shadow-none backdrop-blur-0 transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] flex items-center gap-1"
              : "h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]/80 backdrop-blur-xl shadow-[var(--shadow-2)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center",
            className || "",
          ].join(" ")}
          aria-label={displayTriggerLabel}
          title={displayTriggerLabel}
          disabled={loading}
        >
          {triggerVariant === "inline" ? (
            <>
              <MessageSquareText className="h-3.5 w-3.5" />
              <span>{displayTriggerLabel}</span>
            </>
          ) : (
            <MessageSquareText className="h-4 w-4" />
          )}
        </button>
      ) : null}

      {open ? (
        mode === "inline" ? (
          <div className="fixed inset-0 z-[100]">
            <div
              className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div
                className={[
                  "flex w-full flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]",
                  presentation === "assistant"
                    ? "h-[min(500px,72vh)] max-w-[680px]"
                    : "h-[82vh] max-w-[920px]",
                ].join(" ")}
              >
                {panel}
              </div>
            </div>
            {editor}
          </div>
        ) : (
          <div className="fixed inset-0 z-[100]">
            <div
              className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-3xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]">
              {panel}
            </div>
            {editor}
          </div>
        )
      ) : null}
      <UiProps ids={{"title":["common.m2e69ccb0f8dd","common.m3a73764274da"],"confirmText":["common.ma3ea3c17b401"],"cancelText":["common.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!deleteTarget}
        title={presentation === "assistant" ? "common.m2e69ccb0f8dd" : "common.m3a73764274da"}
        description={
          deleteTarget
            ? presentation === "assistant"
              ? text("createDynamic.m933ffd5f382d", { title: deleteTarget.name })
              : text("createDynamic.m493e80e2cb12", { title: deleteTarget.name })
            : ""
        }
        confirmText="common.ma3ea3c17b401"
        cancelText="common.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removePreset(deleteTarget);
        }}
      /></UiProps>
    </>
  );
}
