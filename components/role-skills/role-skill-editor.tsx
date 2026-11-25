"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { SkillMarkdownEditor } from "@/components/role-skills/skill-markdown-editor";
import { SystemSkillContentWorkspace } from "@/components/role-skills/system-skill-content-workspace";
import {
  deletePersonalRoleSkillCoverClient,
  deleteSystemRoleSkillCoverClient,
  uploadPersonalRoleSkillCover,
  uploadSystemRoleSkillCover,
} from "@/lib/role-skills/client";
import type {
  RoleSkillDetail,
  RoleSkillInput,
  RoleSkillMediaType,
  RoleSkillWorkspace,
} from "@/lib/role-skills/contracts";
import { getRoleSkillTextLimits, ROLE_SKILL_TEXT_LIMITS } from "@/lib/role-skills/contracts";
import { createDefaultSkillWorkspace } from "@/lib/role-skills/skill-workspace";
import {
  ROLE_SKILL_FEATURES,
  type RoleSkillFeatureKey,
} from "@/lib/role-skills/features";

export type RoleSkillEditorMode =
  | "personal-create"
  | "personal-edit"
  | "system-admin";

const MEDIA_TYPE_OPTIONS = [
  { value: "video", label: "createDynamic.mc20f7618d330" },
  { value: "image", label: "createDynamic.md24c10d37db0" },
  { value: "audio", label: "createDynamic.m296c632ec857" },
  { value: "text", label: "createDynamic.mdd81861811e5" },
] as const;

const EMPTY_VALUE: RoleSkillInput = {
  name: "",
  summary: "",
  category: "通用技能",
  coverUrl: null,
  content: "",
  usageScenario: "",
  usageGuide: "",
  workspace: createDefaultSkillWorkspace(),
};

function primaryWorkspaceContent(workspace: RoleSkillWorkspace) {
  return workspace.files.find((file) => file.path === workspace.primaryPath)?.content || "";
}

export function RoleSkillEditor({
  mode,
  initialValue,
  categoryOptions,
  mediaType = "image",
  onMediaTypeChange,
  featureKeys = [],
  onFeatureKeysChange,
  readOnly = false,
  hideHeader = false,
  settingsHeader,
  saveMessage,
  onSave,
  onCancel,
  onDirtyChange,
  onSavingChange,
}: {
  mode: RoleSkillEditorMode;
  initialValue?: Partial<RoleSkillDetail>;
  categoryOptions: string[];
  mediaType?: RoleSkillMediaType;
  onMediaTypeChange?: (value: RoleSkillMediaType) => void;
  featureKeys?: RoleSkillFeatureKey[];
  onFeatureKeysChange?: (value: RoleSkillFeatureKey[]) => void;
  readOnly?: boolean;
  hideHeader?: boolean;
  settingsHeader?: React.ReactNode;
  saveMessage?: string;
  onSave: (value: RoleSkillInput) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { text, error: localizeError } = useUiLocale();
  const mediaTypeGroupId = React.useId();
  const [value, setValue] = React.useState<RoleSkillInput>(EMPTY_VALUE);
  const [coverFile, setCoverFile] = React.useState<File | null>(null);
  const [coverPreview, setCoverPreview] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [settingsView, setSettingsView] = React.useState<"info" | "bindings">("info");
  const baselineRef = React.useRef({ value: EMPTY_VALUE, mediaType, featureKeys });
  const textLimits = getRoleSkillTextLimits(mode !== "personal-create" && initialValue?.id ? initialValue : undefined);
  const dirty = !readOnly && (coverFile !== null
    || JSON.stringify(value) !== JSON.stringify(baselineRef.current.value)
    || mediaType !== baselineRef.current.mediaType
    || [...featureKeys].sort().join(",") !== [...baselineRef.current.featureKeys].sort().join(","));

  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  React.useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);

  React.useEffect(() => {
    const workspace = initialValue?.workspace
      || createDefaultSkillWorkspace(initialValue?.content || "");
    const nextValue = {
      ...EMPTY_VALUE,
      ...initialValue,
      coverUrl: initialValue?.coverUrl || null,
      content: primaryWorkspaceContent(workspace),
      workspace,
    };
    baselineRef.current = { value: nextValue, mediaType, featureKeys };
    setValue(nextValue);
    setCoverFile(null);
    setCoverPreview("");
    setError(null);
  }, [initialValue, mode]);

  React.useEffect(() => {
    if (!coverFile) {
      setCoverPreview("");
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const update = <K extends keyof RoleSkillInput>(key: K, next: RoleSkillInput[K]) => {
    setValue((current) => ({ ...current, [key]: next }));
  };

  const updatePersonalContent = (content: string) => {
    setValue((current) => {
      const workspace = current.workspace?.primaryPath
        ? current.workspace
        : createDefaultSkillWorkspace(current.content);
      return {
        ...current,
        content,
        workspace: {
          ...workspace,
          files: workspace.files.map((file) =>
            file.path === workspace.primaryPath ? { ...file, content } : file,
          ),
        },
      };
    });
  };

  const submit = async () => {
    if (readOnly || saving) return;
    const required = [value.name, value.summary, value.category, value.content];
    if (required.some((item) => !String(item || "").trim())) {
      setSettingsView("info");
      setError("请完整填写名称、简介、分类和 Skill 内容");
      return;
    }
    if (value.name.trim().length > textLimits.name || value.summary.trim().length > textLimits.summary) {
      setSettingsView("info");
      setError(value.name.trim().length > textLimits.name
        ? `名称不能超过 ${textLimits.name} 个字符`
        : `一句话介绍不能超过 ${textLimits.summary} 个字符`);
      return;
    }
    setSaving(true);
    setError(null);
    let uploadedCoverUrl = "";
    try {
      if (coverFile) {
        uploadedCoverUrl = mode === "system-admin"
          ? await uploadSystemRoleSkillCover(coverFile)
          : await uploadPersonalRoleSkillCover(coverFile);
      }
      await onSave({
        ...value,
        coverUrl: uploadedCoverUrl || value.coverUrl?.trim() || null,
      });
    } catch (saveError) {
      if (uploadedCoverUrl) {
        const cleanup = mode === "system-admin"
          ? deleteSystemRoleSkillCoverClient
          : deletePersonalRoleSkillCoverClient;
        await cleanup(uploadedCoverUrl).catch(() => undefined);
      }
      setError(saveError instanceof Error ? saveError.message : "技能保存失败");
    } finally {
      setSaving(false);
    }
  };

  const cover = coverPreview || value.coverUrl || "";
  const isSystemAdmin = mode === "system-admin";
  const splitLayout = isSystemAdmin || !readOnly;
  const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--primary-bg)] disabled:cursor-default disabled:opacity-75";
  const contentEditor = readOnly ? (
    <div>
      <span className="mb-2 block text-xs font-medium text-[var(--app-fg)]"><UiText id="common.mde749b669a1e" /><span className="ml-1 text-red-500">*</span>
      </span>
      <SkillMarkdownEditor
        value={value.content}
        onChange={updatePersonalContent}
        disabled={readOnly}
        className="h-[28rem]"
      />
    </div>
  ) : (
    <SystemSkillContentWorkspace
      disabled={saving}
      fillHeight={splitLayout}
      value={value.workspace || createDefaultSkillWorkspace(value.content)}
      onChange={(workspace) => setValue((current) => ({
        ...current,
        content: primaryWorkspaceContent(workspace),
        workspace,
      }))}
    />
  );
  const mediaTypeField = (
    <fieldset disabled={readOnly} className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-[var(--app-fg)]"><UiText id="common.mc90fbf42ea10" /><span className="ml-1 text-red-500">*</span></legend>
      <div className="grid grid-cols-4 gap-2">
        {MEDIA_TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="relative min-w-0">
            <input
              type="radio"
              name={mediaTypeGroupId}
              value={option.value}
              checked={mediaType === option.value}
              onChange={() => onMediaTypeChange?.(option.value)}
              className="peer sr-only"
            />
            <span className="flex h-9 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] text-xs text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] peer-checked:border-[var(--primary-bg)] peer-checked:bg-[color-mix(in_srgb,var(--primary-bg)_12%,transparent)] peer-checked:text-[var(--primary-bg)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary-bg)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--panel-bg)] peer-disabled:cursor-default peer-disabled:opacity-75">
              {text(option.label)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const coverField = (
    <UiProps ids={{"label":["common.mb9b87543e792"]}}><EditorField label="common.mb9b87543e792">
      <div className="flex flex-wrap items-end gap-3">
        <label className={`relative flex aspect-video w-32 shrink-0 overflow-hidden rounded-2xl border border-dashed border-[var(--border)] ${readOnly ? "" : "cursor-pointer hover:bg-[var(--panel-2)]"}`}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <UiProps ids={{"alt":["common.m99fd5bdcd60e"]}}><img src={cover} alt="common.m99fd5bdcd60e" className="h-full w-full object-cover" /></UiProps>
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[var(--app-muted)]">
              <Plus className="h-4 w-4" />
            </span>
          )}
          {!readOnly ? (
            <UiProps ids={{"aria-label":["common.m1e24d57d8541"]}}><input
              type="file"
              aria-label="common.m1e24d57d8541"
              aria-required="true"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
              className="sr-only"
              onChange={(event) => setCoverFile(event.target.files?.[0] || null)}
            /></UiProps>
          ) : null}
        </label>
        <div className="pb-1">
          <p className="text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="common.m7051fa11b9e3" /></p>
          {!readOnly && cover ? (
            <button
              type="button"
              onClick={() => { setCoverFile(null); update("coverUrl", null); }}
              className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--app-muted)] hover:bg-red-500/10 hover:text-red-500"
            ><UiText id="common.mde2e34c35fc6" /></button>
          ) : null}
        </div>
      </div>
    </EditorField></UiProps>
  );

  return (
    <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-[var(--panel-bg)]">
      {hideHeader ? null : (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--app-fg)]">
              {readOnly
                ? <UiText id="common.mddb93d8df48d" />
                : mode === "system-admin"
                  ? initialValue?.id ? <UiText id="common.m17bbfbd1360d" /> : <UiText id="common.m04bcc5bd9b5e" />
                  : mode === "personal-create" ? <UiText id="common.m04bcc5bd9b5e" /> : <UiText id="common.m900d2baeb42c" />}
            </h2>
          </div>
          <UiProps ids={{"aria-label":["common.m7951c0e8608a"]}}><button type="button" onClick={onCancel} disabled={saving} aria-label="common.m7951c0e8608a" className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50">
            <X className="h-4 w-4" />
          </button></UiProps>
        </div>
      )}

      <div className={splitLayout
        ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]"
        : "flex min-h-0 flex-1 flex-col"
      }>
        {splitLayout ? (
          <UiProps ids={{"aria-label":["common.m79fda1c8392e"]}}><fieldset disabled={saving} aria-label="common.m79fda1c8392e" className="flex h-[36rem] min-h-0 min-w-0 shrink-0 flex-col p-4 lg:h-auto lg:p-6 lg:pr-4">
            {contentEditor}
          </fieldset></UiProps>
        ) : null}
        <div className={splitLayout
          ? "flex min-h-0 min-w-0 shrink-0 flex-col border-t border-[var(--border)] lg:border-l lg:border-t-0"
          : "flex min-h-0 flex-1 flex-col"
        }>
          {isSystemAdmin ? (
            <UiProps ids={{"aria-label":["common.m38e707b6c854"]}}><div role="group" aria-label="common.m38e707b6c854" className="flex shrink-0 gap-1 border-b border-[var(--border)] px-5 py-3">
              {([
                ["info", text("createDynamic.me17f2d2a06d2")],
                ["bindings", text("createDynamic.ma2b98aba667c")],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={settingsView === key}
                  onClick={() => setSettingsView(key)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] ${settingsView === key ? "bg-[var(--panel-3)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"}`}
                >
                  {label}{key === "bindings" && featureKeys.length > 0 ? ` · ${featureKeys.length}` : ""}
                </button>
              ))}
            </div></UiProps>
          ) : null}
          <UiProps ids={{"aria-label":["common.m5d3c8c44ac6f"]}}><fieldset disabled={saving} aria-label="common.m5d3c8c44ac6f" className={splitLayout
            ? "min-h-0 min-w-0 px-5 py-6 lg:flex-1 lg:overflow-y-auto"
            : "min-w-0 min-h-0 flex-1 overflow-y-auto px-5 py-5"
          }>
            <div className={splitLayout ? "min-w-0" : "mx-auto max-w-5xl"}>
              <div hidden={isSystemAdmin && settingsView !== "info"} className={splitLayout ? "space-y-6" : "space-y-4"}>
                {isSystemAdmin ? settingsHeader : null}
                <UiProps ids={{"label":["common.md44e9b3d3b31"]}}><EditorField label="common.md44e9b3d3b31" required>
                  <div className="relative">
                    <UiProps ids={{"aria-label":["common.md44e9b3d3b31"],"placeholder":["common.ma7a0242a1ae5"]}}><input aria-label="common.md44e9b3d3b31" value={value.name} disabled={readOnly} maxLength={textLimits.name} onChange={(event) => update("name", event.target.value)} className={`${inputClass} pr-16`} placeholder="common.ma7a0242a1ae5" /></UiProps>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] tabular-nums text-[var(--app-muted)]">{value.name.length} / {ROLE_SKILL_TEXT_LIMITS.name}</span>
                  </div>
                  {textLimits.name > ROLE_SKILL_TEXT_LIMITS.name && value.name.length > ROLE_SKILL_TEXT_LIMITS.name ? <p className="mt-1.5 text-[11px] text-[var(--app-muted)]"><UiText id="common.m4b81588b0e80" /></p> : null}
                </EditorField></UiProps>
                <UiProps ids={{"label":["common.m00e871947a6d"]}}><EditorField label="common.m00e871947a6d" required>
                  <div className="relative">
                    <UiProps ids={{"aria-label":["common.m00e871947a6d"],"placeholder":["common.mebf562705928"]}}><textarea aria-label="common.m00e871947a6d" rows={2} value={value.summary} disabled={readOnly} maxLength={textLimits.summary} onChange={(event) => update("summary", event.target.value)} className={`${inputClass} block resize-none pb-7`} placeholder="common.mebf562705928" /></UiProps>
                    <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-[var(--app-muted)]">{value.summary.length} / {ROLE_SKILL_TEXT_LIMITS.summary}</span>
                  </div>
                  {textLimits.summary > ROLE_SKILL_TEXT_LIMITS.summary && value.summary.length > ROLE_SKILL_TEXT_LIMITS.summary ? <p className="mt-1.5 text-[11px] text-[var(--app-muted)]"><UiText id="common.m4b81588b0e80" /></p> : null}
                </EditorField></UiProps>
                {splitLayout ? mediaTypeField : null}
                <UiProps ids={{"label":["common.m515559957fd3"]}}><EditorField label="common.m515559957fd3" required>
                  {readOnly ? (
                    <div className={inputClass}>{value.category}</div>
                  ) : (
                    <UiProps ids={{"placeholder":["common.m1a77ad7ee2ea"]}}><FrostedSelect
                      value={value.category}
                      onChange={(next) => update("category", next)}
                      options={Array.from(new Set([...categoryOptions, value.category].filter(Boolean))).map((category) => ({ value: category, label: category }))}
                      placeholder="common.m1a77ad7ee2ea"
                      disabled={saving}
                      showLeading={false}
                      showOptionLeading={false}
                      side="auto"
                      ariaLabel={text("createDynamic.mf2c3819122fa")}
                      menuTitle={text("createDynamic.m99a15fab9abe")}
                      buttonClassName="h-10 rounded-full px-3 text-[13px] shadow-none"
                      triggerIcon={<ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" />}
                    /></UiProps>
                  )}
                </EditorField></UiProps>
                {splitLayout ? null : contentEditor}
                {splitLayout ? coverField : null}
                <UiProps ids={{"label":["common.m100587977125"]}}><EditorField label="common.m100587977125">
                  <UiProps ids={{"placeholder":["common.mb6a8467c4174"]}}><textarea value={value.usageScenario} disabled={readOnly} onChange={(event) => update("usageScenario", event.target.value)} className={`${inputClass} min-h-24 resize-y`} placeholder="common.mb6a8467c4174" /></UiProps>
                </EditorField></UiProps>
                <UiProps ids={{"label":["common.m26eb7cff0f41"]}}><EditorField label="common.m26eb7cff0f41">
                  <UiProps ids={{"placeholder":["common.m1e5b4c413cf5"]}}><textarea value={value.usageGuide} disabled={readOnly} onChange={(event) => update("usageGuide", event.target.value)} className={`${inputClass} min-h-24 resize-y`} placeholder="common.m1e5b4c413cf5" /></UiProps>
                </EditorField></UiProps>
                {splitLayout ? null : mediaTypeField}
                {splitLayout ? null : coverField}
              </div>
              {isSystemAdmin ? (
                <div hidden={settingsView !== "bindings"}>
                  <span className="mb-2 block text-xs font-medium text-[var(--app-fg)]"><UiText id="common.m2f0e7ab8a64d" /></span>
                  <p className="mb-5 text-xs leading-5 text-[var(--app-muted)]"><UiText id="common.m502b58cef945" /></p>
                  <div className="space-y-2">
                    {ROLE_SKILL_FEATURES.map((feature) => {
                      const selected = featureKeys.includes(feature.key);
                      return (
                        <button
                          key={feature.key}
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          onClick={() => onFeatureKeysChange?.(
                            selected
                              ? featureKeys.filter((key) => key !== feature.key)
                              : [...featureKeys, feature.key],
                          )}
                          className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selected ? "border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_10%,var(--input-bg))]" : "border-[var(--border)] bg-[var(--input-bg)] hover:bg-[var(--panel-2)]"}`}
                        >
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border-2)] text-transparent"}`}>
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="mb-1 block text-[11px] text-[var(--app-muted)]">{feature.pageLabel}<UiText id="common.m452c7b10d57a" /></span>
                            <span className="block text-sm font-medium text-[var(--app-fg)]">{feature.featureLabel}</span>
                            <span className="mt-0.5 block text-xs text-[var(--app-muted)]"><UiText id="common.m4d695a9833c6" /></span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-5 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--app-muted)]"><UiText id="common.m44bf17c6a771" /></p>
                </div>
              ) : null}
            </div>
          </fieldset></UiProps>

          <div className={splitLayout
            ? "sticky bottom-0 z-10 flex shrink-0 flex-col gap-3 border-t border-[var(--border)] bg-[var(--panel-bg)] px-5 py-4 lg:static"
            : "flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3"
          }>
            <span role="status" className={`text-xs ${error ? "text-red-500" : "text-[var(--app-muted)]"}`}>{error ? localizeError(error) : (dirty ? <UiText id="common.m2fb2610a0955" /> : "")}</span>
            <div className="flex justify-end gap-2">
              {saveMessage && !dirty && !saving && !error ? (
                <span role="status" className="mr-auto self-center text-xs text-[var(--app-muted)]">{saveMessage}</span>
              ) : null}
              <Button variant="secondary" onClick={onCancel} disabled={saving}>{readOnly ? <UiText id="common.m3fd47edce45b" /> : <UiText id="common.m2cd0f3be8738" />}</Button>
              {!readOnly ? <Button onClick={() => void submit()} disabled={saving}>{saving ? <UiText id="common.m917b1c1f18d0" /> : <UiText id="common.mc6b2eecaf242" />}</Button> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-[var(--app-fg)]">{label}{required ? <span className="ml-1 text-red-500">*</span> : null}</span>
      {children}
    </label>
  );
}
