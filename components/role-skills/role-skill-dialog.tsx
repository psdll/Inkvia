"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RoleSkillCard } from "@/components/role-skills/role-skill-card";
import { RoleSkillDetailView } from "@/components/role-skills/role-skill-detail-view";
import { RoleSkillEditor } from "@/components/role-skills/role-skill-editor";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import { useRoleSkillFavorites } from "@/hooks/use-role-skill-favorites";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  createPersonalRoleSkillClient,
  deletePersonalRoleSkillClient,
  getCachedRoleSkillData,
  getPersonalRoleSkillClient,
  getSystemRoleSkillClient,
  updatePersonalRoleSkillClient,
} from "@/lib/role-skills/client";
import type {
  RoleSkillDetail,
  RoleSkillInput,
  RoleSkillListItem,
  RoleSkillMediaType,
} from "@/lib/role-skills/contracts";

export type RoleSkillDialogProps = {
  open: boolean;
  initialView?: "browse" | "create" | "edit" | "detail";
  initialSkill?: RoleSkillListItem | null;
  purpose?: "prompt" | "agent";
  authUserId: string;
  mediaType?: RoleSkillMediaType;
  selectedRoleSkillId: string | null;
  resultRoleSkillId: string | null;
  legacySystemPrompt: string;
  result: React.ReactNode;
  generating: boolean;
  generateDisabledReason?: string;
  showApplyResult?: boolean;
  onClose(): void;
  onSelect(skill: RoleSkillListItem): void;
  onEditSkill?(skill: RoleSkillListItem): void;
  onDeleteSkill?(skill: RoleSkillListItem): void;
  onClearSelection?(): void;
  onGenerate(): void;
  onApplyResult(): void;
};

type EditorState = null | {
  mode: "personal-create" | "personal-edit";
  initialValue?: Partial<RoleSkillDetail>;
  revision?: number;
  readOnly?: boolean;
};

type DetailState = null | {
  skill: RoleSkillListItem | RoleSkillDetail;
  loading: boolean;
};

export function RoleSkillDialog(props: RoleSkillDialogProps) {
  const { text, error: localizeError } = useUiLocale();
  const { user } = useAuth();
  const { favoriteSkillIds, toggleFavoriteSkill, removeFavoriteSkill } = useRoleSkillFavorites(props.authUserId);
  const {
    skills,
    loading,
    error: catalogError,
    refresh,
  } = useRoleSkillCatalog({
    authUserId: props.authUserId,
    enabled: props.open,
    mediaType: props.mediaType,
  });
  const [mounted, setMounted] = React.useState(false);
  const [source, setSource] = React.useState<"system" | "favorites" | "personal">("system");
  const [category, setCategory] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [editor, setEditor] = React.useState<EditorState>(null);
  const [editorDirty, setEditorDirty] = React.useState(false);
  const [editorSaving, setEditorSaving] = React.useState(false);
  const leave = useUnsavedChanges(Boolean(editor && (editorDirty || editorSaving)));
  const closeEditor = React.useCallback(() => {
    if (!editorSaving) leave.requestLeave(() => {
      if (props.initialView === "create" || props.initialView === "edit") props.onClose();
      else setEditor(null);
    });
  }, [editorSaving, leave.requestLeave, props.initialView, props.onClose]);
  React.useEffect(() => {
    setEditorDirty(false);
    setEditorSaving(false);
  }, [editor]);
  const [editorMediaType, setEditorMediaType] =
    React.useState<RoleSkillMediaType>(props.mediaType || "image");
  const [detailState, setDetailState] = React.useState<DetailState>(null);
  const [sidePanelOpen, setSidePanelOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pendingDeleteSkill, setPendingDeleteSkill] =
    React.useState<RoleSkillListItem | null>(null);
  const [legacyDismissed, setLegacyDismissed] = React.useState(false);
  const detailRequestIdRef = React.useRef(0);
  const closeActiveView = React.useCallback(() => {
    if (leave.confirmOpen || pendingDeleteSkill) return;
    if (detailState) {
      detailRequestIdRef.current += 1;
      if (props.initialView === "detail") props.onClose();
      else setDetailState(null);
    } else if (editor) closeEditor();
    else props.onClose();
  }, [leave.confirmOpen, pendingDeleteSkill, detailState, editor, closeEditor, props.initialView, props.onClose]);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (props.open && props.initialView === "create") {
      setEditorMediaType(props.mediaType || "image");
      setEditor({ mode: "personal-create" });
    }
  }, [props.open, props.initialView, props.mediaType]);
  React.useEffect(() => {
    if (!props.open) {
      setEditor(null);
      detailRequestIdRef.current += 1;
      setDetailState(null);
      setSidePanelOpen(false);
      setPendingDeleteSkill(null);
      setActionError(null);
    }
  }, [props.open]);

  React.useEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeActiveView();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.open, closeActiveView]);

  const sourceSkills = React.useMemo(
    () => skills.filter((skill) => source === "favorites" ? favoriteSkillIds.includes(skill.id) : skill.source === source),
    [favoriteSkillIds, skills, source],
  );
  const categories = React.useMemo(
    () => Array.from(new Set(sourceSkills.map((skill) => skill.category))).sort(),
    [sourceSkills],
  );
  const activeCategory = categories.includes(category) ? category : "";
  const switchSource = (nextSource: "system" | "favorites" | "personal") => {
    setCategory("");
    setSource(nextSource);
  };
  const filteredSkills = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sourceSkills.filter((skill) => {
      if (activeCategory && skill.category !== activeCategory) return false;
      if (!keyword) return true;
      return [
        skill.name,
        skill.summary,
        skill.category,
        skill.usageScenario,
      ].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [activeCategory, query, sourceSkills]);

  const selectedSkill =
    skills.find((skill) => skill.id === props.selectedRoleSkillId) || null;
  const resultSkill =
    skills.find((skill) => skill.id === props.resultRoleSkillId) || null;
  const categoryOptions = React.useMemo(
    () => Array.from(new Set(skills.map((skill) => skill.category))).sort(),
    [skills],
  );

  const createSkill = (initialValue?: Partial<RoleSkillDetail>) => {
    setActionError(null);
    detailRequestIdRef.current += 1;
    setDetailState(null);
    setEditorMediaType(initialValue?.mediaType || props.mediaType || "image");
    setEditor({ mode: "personal-create", initialValue });
  };

  const openDetail = async (skill: RoleSkillListItem) => {
    setActionError(null);
    const requestId = ++detailRequestIdRef.current;
    setEditor(null);
    const cached = getCachedRoleSkillData<{ skill: RoleSkillDetail }>(`/api/role-skills/${skill.source}/${encodeURIComponent(skill.id)}`)?.skill;
    if (cached && cached.revision === skill.revision) {
      setDetailState({ skill: cached, loading: false });
    } else {
      setDetailState({ skill, loading: true });
    }
    try {
      const loaded =
        skill.source === "system"
          ? await getSystemRoleSkillClient(skill.id)
          : await getPersonalRoleSkillClient(skill.id);
      if (requestId !== detailRequestIdRef.current) return;
      setDetailState({ skill: loaded, loading: false });
    } catch (loadError) {
      if (requestId !== detailRequestIdRef.current) return;
      setDetailState(null);
      setActionError(
        loadError instanceof Error ? loadError.message : "技能加载失败",
      );
    }
  };

  const openPersonal = async (skill: RoleSkillListItem) => {
    setActionError(null);
    const requestId = ++detailRequestIdRef.current;
    try {
      const loaded = await getPersonalRoleSkillClient(skill.id);
      if (requestId !== detailRequestIdRef.current) return;
      setDetailState(null);
      setEditorMediaType(loaded.mediaType || "image");
      setEditor({
        mode: "personal-edit",
        initialValue: loaded,
        revision: loaded.revision,
      });
    } catch (loadError) {
      if (requestId !== detailRequestIdRef.current) return;
      setActionError(
        loadError instanceof Error ? loadError.message : "个人技能加载失败",
      );
    }
  };

  React.useEffect(() => {
    if (props.open && props.initialView === "edit" && props.initialSkill?.source === "personal") {
      setDetailState(null);
      void openPersonal(props.initialSkill);
    } else if (props.open && props.initialView === "detail" && props.initialSkill) {
      void openDetail(props.initialSkill);
    }
  }, [props.open, props.initialView, props.initialSkill]);

  const saveEditor = async (value: RoleSkillInput) => {
    if (!editor) return;
    const saved =
      editor.mode === "personal-create"
        ? await createPersonalRoleSkillClient({
            ...value,
            mediaType: editorMediaType,
          })
        : await updatePersonalRoleSkillClient(
            String(editor.initialValue?.id || ""),
            { ...value, mediaType: editorMediaType },
            Number(editor.revision),
          );
    await refresh();
    props.onSelect(saved);
    setEditor(null);
  };

  const deleteSkill = async (skill: RoleSkillListItem) => {
    setActionError(null);
    try {
      await deletePersonalRoleSkillClient(skill.id, skill.revision);
      removeFavoriteSkill(skill.id);
      detailRequestIdRef.current += 1;
      setDetailState(null);
      if (props.initialView === "detail") props.onClose();
      await refresh();
      if (props.selectedRoleSkillId === skill.id) {
        const next = skills.find((item) => item.id !== skill.id);
        if (next) props.onSelect(next);
      }
      return true;
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "个人技能删除失败",
      );
      return false;
    }
  };

  const fullWidthEditor = Boolean(editor && !editor.readOnly && !detailState);

  if (!mounted || !props.open) return null;
  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[170] flex justify-center bg-[var(--overlay)] ${fullWidthEditor ? "items-end pt-[min(72px,8dvh)]" : "items-center p-3 sm:p-5"}`}
        style={{ zIndex: props.purpose === "agent" ? 190 : undefined }}
        onPointerDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) closeActiveView();
        }}
      >
        <UiProps ids={{"aria-label":["common.mbb846c69627f"]}}><section
          data-role-skill-dialog=""
          role="dialog"
          aria-modal="true"
          aria-label="common.mbb846c69627f"
          className={[
            "flex min-h-0 flex-col overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)]",
            fullWidthEditor
              ? "h-full w-full rounded-t-[24px]"
              : "rounded-[24px]",
            fullWidthEditor ? "" : detailState
              ? "h-[min(940px,92vh)] w-[min(1080px,96vw)]"
              : "h-[min(820px,92vh)] w-[min(1280px,96vw)]",
          ].join(" ")}
        >
          {detailState ? (
            <RoleSkillDetailView
              skill={detailState.skill}
              loading={detailState.loading}
              protectContent={detailState.skill.source === "system"}
              error={actionError}
              onEdit={detailState.skill.source === "personal" ? () => {
                if (props.onEditSkill) props.onEditSkill(detailState.skill);
                else void openPersonal(detailState.skill);
              } : undefined}
              onDelete={detailState.skill.source === "personal" ? () => {
                if (props.onDeleteSkill) props.onDeleteSkill(detailState.skill);
                else setPendingDeleteSkill(detailState.skill);
              } : undefined}
              favorite={favoriteSkillIds.includes(detailState.skill.id)}
              onToggleFavorite={props.authUserId ? () => toggleFavoriteSkill(detailState.skill.id) : undefined}
              onClose={() => {
                detailRequestIdRef.current += 1;
                if (props.initialView === "detail") props.onClose();
                else setDetailState(null);
              }}
            />
          ) : editor ? (
            <RoleSkillEditor
              mode={editor.mode}
              initialValue={editor.initialValue}
              categoryOptions={
                categoryOptions.length ? categoryOptions : ["通用技能"]
              }
              mediaType={editorMediaType}
              onMediaTypeChange={setEditorMediaType}
              onSave={saveEditor}
              onCancel={closeEditor}
              onDirtyChange={setEditorDirty}
              onSavingChange={setEditorSaving}
            />
          ) : props.initialView === "edit" || props.initialView === "detail" ? (
            <div className="p-5">
              <p role={actionError ? "alert" : "status"}>{actionError ? localizeError(actionError) : <UiText id="common.ma55be937c92f" />}</p>
              <Button onClick={props.onClose}><UiText id="common.m3fd47edce45b" /></Button>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-4">
                <h2 className="sr-only"><UiText id="common.m99aea2f9131a" /></h2>
                <button
                  type="button"
                  aria-pressed={source === "system"}
                  onClick={() => switchSource("system")}
                  className={`rounded-md py-1 text-base font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] ${source === "system" ? "text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:text-[var(--app-fg)]"}`}
                >
                  Skill
                </button>
                <div className="flex items-center gap-2">
                  <UiProps ids={{"aria-label":["common.m8bbf69eeb1d5"]}}><div role="group" aria-label="common.m8bbf69eeb1d5" className="mr-1 flex items-center gap-1">
                    {([
                      { value: "favorites", label: text("createDynamic.m60a53514eb92") },
                      { value: "personal", label: text("createDynamic.m7f1d9dd04cd1") },
                    ] as const).map((item) => (
                      <UiProps key={item.value} ids={{"title":["common.m7f2ca802fd8d"]}}><button

                        type="button"
                        aria-pressed={source === item.value}
                        onClick={() => switchSource(source === item.value ? "system" : item.value)}
                        title={source === item.value ? "common.m7f2ca802fd8d" : undefined}
                        className={`inline-flex h-8 items-center rounded-[9px] px-3 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] ${source === item.value ? "bg-[var(--canvas-controls-hover,var(--panel-2))] font-medium text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)]"}`}
                      >
                        {item.label}
                      </button></UiProps>
                    ))}
                  </div></UiProps>
                  <UiProps ids={{"aria-label":["common.m04bcc5bd9b5e"]}}><button
                    type="button"
                    onClick={() => createSkill()}
                    aria-label="common.m04bcc5bd9b5e"
                    style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent px-3 text-[13px] font-normal leading-5 text-[var(--canvas-controls-text,var(--app-fg))] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
                  >
                    <Plus size={15} strokeWidth={1.5} /><UiText id="common.mcde2cd071d25" /></button></UiProps>
                  <UiProps ids={{"aria-label":["common.mb1b344e7e2ed"]}}><button
                    type="button"
                    onClick={props.onClose}
                    aria-label="common.mb1b344e7e2ed"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent text-[var(--canvas-controls-text,var(--app-fg))] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
                  >
                    <X size={15} strokeWidth={1.5} />
                  </button></UiProps>
                </div>
              </header>

              {props.selectedRoleSkillId === null &&
              props.legacySystemPrompt.trim() &&
              !legacyDismissed ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel-2)] px-5 py-3">
                  <div>
                    <p className="text-sm font-medium"><UiText id="common.macd2736617e1" /></p>
                    <p className="mt-0.5 text-xs text-[var(--app-muted)]"><UiText id="common.m522b62fdf81c" /></p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setLegacyDismissed(true)}
                    ><UiText id="common.mfb1c97956dae" /></Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        createSkill({ content: props.legacySystemPrompt })
                      }
                    ><UiText id="common.m4bffc7dd28dc" /></Button>
                  </div>
                </div>
              ) : null}

              {props.purpose === "agent" && (catalogError || actionError) ? <p role="alert" className="px-5 py-2 text-sm text-red-500">{localizeError(actionError || catalogError)}</p> : null}
              <div
                className={[
                  "relative grid min-h-0 flex-1 lg:grid-rows-[auto_minmax(0,1fr)]",
                  props.purpose === "agent" ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_48px]",
                ].join(" ")}
              >
                <div className="flex min-h-0 flex-col border-b border-[var(--border)] lg:contents">
                  <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 pb-4 pt-2 lg:col-start-1 lg:row-start-1">
                    <UiProps ids={{"aria-label":["common.m63443790ce09"]}}><div role="group" aria-label="common.m63443790ce09" className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                      {["", ...categories].map((item) => (
                        <button
                          key={item}
                          type="button"
                          aria-pressed={activeCategory === item}
                          onClick={() => setCategory(item)}
                          className={[
                            "shrink-0 rounded-lg border px-3 py-2 text-xs transition",
                            activeCategory === item
                              ? "border-[var(--border)] bg-[var(--panel-3)] text-[var(--app-fg)]"
                              : "border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
                          ].join(" ")}
                        >
                          {item || <UiText id="common.m5c55a67935af" />}
                        </button>
                      ))}
                    </div></UiProps>
                    <label className="ml-auto flex w-full shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-3 sm:w-[260px]">
                      <UiProps ids={{"aria-label":["common.m43b9d66b88a8"],"placeholder":["common.madb3dcb1d5e3"]}}><input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label="common.m43b9d66b88a8"
                        placeholder="common.madb3dcb1d5e3"
                        className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--app-muted)]"
                      /></UiProps>
                      <Search className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
                    </label>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:col-start-1 lg:row-start-2">
                    {loading && skills.length === 0 ? (
                      <div className="py-16 text-center text-sm text-[var(--app-muted)]"><UiText id="common.m01a4064b27c2" /></div>
                    ) : null}
                    {!loading && filteredSkills.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-14 text-center">
                        <p className="text-sm font-medium">{source === "favorites" && sourceSkills.length === 0 ? <UiText id="common.mf3252214e807" /> : <UiText id="common.m578e81dc489c" />}</p>
                        <p className="mt-1 text-xs text-[var(--app-muted)]">
                          {source === "favorites" && sourceSkills.length === 0 ? <UiText id="common.mbb4238ca3429" /> : <UiText id="common.m9ed398d07805" />}
                        </p>
                      </div>
                    ) : null}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-x-4 gap-y-4">
                      {filteredSkills.map((skill) => (
                        <RoleSkillCard
                          key={skill.id}
                          skill={skill.source === "personal" && user && String(user.id) === props.authUserId
                            ? { ...skill, ownerName: user.username }
                            : skill}
                          selected={skill.id === props.selectedRoleSkillId}
                          onSelect={() => props.onSelect(skill)}
                          onView={() => void openDetail(skill)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {props.purpose !== "agent" && (sidePanelOpen ? (
                  <UiProps ids={{"aria-label":["common.mfff8530d4bc8"]}}><aside aria-label="common.mfff8530d4bc8" className="absolute inset-y-0 right-0 z-20 flex w-[min(440px,100%)] min-h-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--panel-2)] shadow-[-12px_0_32px_rgba(0,0,0,0.16)]">
                  <div className="shrink-0 border-b border-[var(--border)] bg-[var(--panel-2)] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-[var(--app-muted)]">
                        <Sparkles className="h-3.5 w-3.5" /><UiText id="common.m5ddff4afab27" /></div>
                      <UiProps ids={{"aria-label":["common.mf23caabde760"],"title":["common.mf23caabde760"]}}><button
                        type="button"
                        onClick={() => setSidePanelOpen(false)}
                        aria-label="common.mf23caabde760"
                        title="common.mf23caabde760"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)]"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button></UiProps>
                    </div>
                    {selectedSkill ? (
                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="min-w-0 truncate font-semibold">
                            {selectedSkill.name}
                          </h3>
                          {props.onClearSelection ? (
                            <button
                              type="button"
                              onClick={props.onClearSelection}
                              className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--app-muted)] transition hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)]"
                            ><UiText id="common.m2d7eb2d955c1" /></button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-3 py-6 text-center text-xs text-[var(--app-muted)]"><UiText id="common.m5ad30439ee07" /></div>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--panel-2)] p-4">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium">
                      <span><UiText id="common.ma78c1924def7" /></span>
                      {props.resultRoleSkillId &&
                      props.resultRoleSkillId !== props.selectedRoleSkillId ? (
                        <span className="text-[var(--app-muted)]"><UiText id="common.m02ff5364ef1d" />{resultSkill ? `：${resultSkill.name}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-h-0 flex-1">{props.result}</div>
                    {actionError || catalogError ? (
                      <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                        {localizeError(actionError || catalogError)}
                      </div>
                    ) : null}
                    {props.generateDisabledReason ? (
                      <p className="mt-2 text-xs text-[var(--app-muted)]">
                        {localizeError(props.generateDisabledReason)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {props.showApplyResult !== false ? (
                        <Button
                          variant="secondary"
                          onClick={props.onApplyResult}
                        ><UiText id="common.m382c41a1a627" /></Button>
                      ) : null}
                      <Button
                        onClick={props.onGenerate}
                        disabled={
                          props.generating ||
                          !selectedSkill ||
                          Boolean(props.generateDisabledReason)
                        }
                      >
                        {props.generating ? <UiText id="common.m51d3629e97b9" /> : <UiText id="common.m89e1e816113b" />}
                      </Button>
                    </div>
                  </div>
                  </aside></UiProps>
                ) : (
                  <aside className="flex min-h-0 items-center justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1">
                    <UiProps ids={{"aria-label":["common.m874688ad2a6d"],"title":["common.m874688ad2a6d"]}}><button
                      type="button"
                      onClick={() => setSidePanelOpen(true)}
                      aria-label="common.m874688ad2a6d"
                      title="common.m874688ad2a6d"
                      className="flex flex-col items-center justify-center gap-2 px-2 py-3 text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="text-[11px] [writing-mode:vertical-rl]"><UiText id="common.m827d81187a2d" /></span>
                    </button></UiProps>
                  </aside>
                ))}
              </div>
            </>
          )}
        </section></UiProps>
      </div>
      <UiProps ids={{"title":["common.m01aeaa37eede"],"description":["common.md06808a0cb05"],"confirmText":["common.mccb06b8a183b"],"cancelText":["common.mfd4b9e3b6c68"]}}><ConfirmDialog zIndex={props.purpose === "agent" ? 200 : undefined} open={leave.confirmOpen} title="common.m01aeaa37eede" description="common.md06808a0cb05" danger confirmText="common.mccb06b8a183b" cancelText="common.mfd4b9e3b6c68" onConfirm={leave.discardAndLeave} onClose={leave.cancelLeave} /></UiProps>
      <UiProps ids={{"title":["common.m630198f17587"],"confirmText":["common.m2f9daa828907"],"cancelText":["common.m2cd0f3be8738"]}}><ConfirmDialog
        zIndex={props.purpose === "agent" ? 200 : undefined}
        open={Boolean(pendingDeleteSkill)}
        title="common.m630198f17587"
        description={
          pendingDeleteSkill
            ? text("createDynamic.m96482b647b88", { name: pendingDeleteSkill.name })
            : ""
        }
        confirmText="common.m2f9daa828907"
        cancelText="common.m2cd0f3be8738"
        danger
        onClose={() => setPendingDeleteSkill(null)}
        onConfirm={() =>
          pendingDeleteSkill ? deleteSkill(pendingDeleteSkill) : false
        }
      /></UiProps>
    </>,
    document.body,
  );
}
