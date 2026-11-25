"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { RoleSkillEditor } from "@/components/role-skills/role-skill-editor";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  createSystemRoleSkillAdmin,
  getSystemRoleSkillAdmin,
  listSystemRoleSkillsAdmin,
  updateSystemRoleSkillAdmin,
} from "@/lib/role-skills/client";
import type {
  AdminRoleSkillDetail,
  RoleSkillMediaType,
  RoleSkillInput,
  RoleSkillStatus,
} from "@/lib/role-skills/contracts";
import type { RoleSkillFeatureKey } from "@/lib/role-skills/features";

const STATUS_OPTIONS = [
  { value: "published", label: "发布" },
  { value: "hidden", label: "隐藏" },
];

const ADMIN_SKILLS_URL = "/admin?tab=system&section=rolePositioning";

export function SystemRoleSkillEditorPage() {
  const { label: tLabel } = useUiLocale();
  const searchParams = useSearchParams();
  const skillId = searchParams.get("skillId");
  const [status, setStatus] = React.useState<RoleSkillStatus>("published");
  const [mediaType, setMediaType] = React.useState<RoleSkillMediaType>("image");
  const [featureKeys, setFeatureKeys] = React.useState<RoleSkillFeatureKey[]>([]);
  const [initialSkill, setInitialSkill] = React.useState<AdminRoleSkillDetail | null>(null);
  const [categoryOptions, setCategoryOptions] = React.useState(["通用技能"]);
  const [loading, setLoading] = React.useState(Boolean(skillId));
  const [catalogSettled, setCatalogSettled] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [editorKey, setEditorKey] = React.useState(0);
  const [message, setMessage] = React.useState("");
  const [editorDirty, setEditorDirty] = React.useState(false);
  const [editorSaving, setEditorSaving] = React.useState(false);
  const [savedStatus, setSavedStatus] = React.useState<RoleSkillStatus>("published");
  const leave = useUnsavedChanges(editorDirty || status !== savedStatus || editorSaving);

  React.useEffect(() => {
    let active = true;
    setLoadError("");
    setMessage("");
    setInitialSkill(null);

    void listSystemRoleSkillsAdmin()
      .then((skills) => {
        if (!active) return;
        const categories = Array.from(new Set(skills.map((skill) => skill.category))).sort();
        setCategoryOptions(categories.length ? categories : ["通用技能"]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCatalogSettled(true);
      });

    if (!skillId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    void getSystemRoleSkillAdmin(skillId)
      .then((skill) => {
        if (!active) return;
        setInitialSkill(skill);
        setStatus(skill.status);
        setSavedStatus(skill.status);
        setMediaType(skill.mediaType);
        setFeatureKeys(skill.featureKeys || []);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "系统技能加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [skillId]);

  const save = async (value: RoleSkillInput) => {
    setMessage("");
    const systemValue = { ...value, mediaType };
    if (initialSkill) {
      const updated = await updateSystemRoleSkillAdmin(
        initialSkill.id,
        systemValue,
        status,
        initialSkill.revision,
        featureKeys,
      );
      setInitialSkill(updated);
      setStatus(updated.status);
      setSavedStatus(updated.status);
      setFeatureKeys(updated.featureKeys || []);
      setMediaType(updated.mediaType);
      setMessage("已保存");
    } else {
      await createSystemRoleSkillAdmin(systemValue, status, featureKeys);
      setMessage("已创建");
      setMediaType("image");
      setFeatureKeys([]);
      setSavedStatus(status);
    }
    setEditorDirty(false);
    setEditorSaving(false);
    setEditorKey((current) => current + 1);
  };

  const closePage = () => {
    if (editorSaving) return;
    leave.requestLeave(() => {
      window.close();
      window.setTimeout(() => {
        if (!window.closed) window.location.replace(ADMIN_SKILLS_URL);
      }, 100);
    });
  };

  const editing = Boolean(skillId);
  const blocked = editing && !initialSkill;

  return (
    <AtomicPageReveal ready={!loading && catalogSettled}>
    <main className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-bg)] text-[var(--app-fg)]">
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel-2)] px-5 py-3">
          <div>
            <h1 className="text-sm font-semibold">{editing ? <UiText id="admin.m17bbfbd1360d" /> : <UiText id="admin.m04bcc5bd9b5e" />}</h1>
          </div>
          <div className="flex items-center gap-3">
            <UiProps ids={{"aria-label":["admin.mf987295ab05d"],"title":["admin.mbb1b83ccabfc"]}}><button
              type="button"
              onClick={closePage}
              disabled={editorSaving}
              aria-label="admin.mf987295ab05d"
              title="admin.mbb1b83ccabfc"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
            >
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
        </div>
        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--app-muted)]"><UiText id="admin.m50cc74efa2b1" /></div>
        ) : blocked ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
            <p className="text-sm text-red-500">{loadError}</p>
            <button type="button" onClick={closePage} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-sm hover:bg-[var(--panel-3)]"><UiText id="admin.mbb1b83ccabfc" /></button>
          </div>
        ) : (
          <>
            {loadError ? <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-500">{loadError}</div> : null}
            <div className="flex min-h-0 flex-1">
              <RoleSkillEditor
                key={editorKey}
                mode="system-admin"
                initialValue={initialSkill || undefined}
                categoryOptions={categoryOptions}
                mediaType={mediaType}
                onMediaTypeChange={setMediaType}
                featureKeys={featureKeys}
                onFeatureKeysChange={setFeatureKeys}
                hideHeader
                saveMessage={status === savedStatus ? message : undefined}
                settingsHeader={
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-[var(--app-muted)]"><UiText id="admin.m5100f029e0c5" /></span>
                    <FrostedSelect
                      value={status}
                      onChange={(value) => setStatus(value as RoleSkillStatus)}
                      options={STATUS_OPTIONS}
                      showLeading={false}
                      compact
                      disabled={editorSaving}
                      className="w-full"
                      ariaLabel={tLabel("发布状态")}
                      side="bottom"
                    />
                  </div>
                }
                onSave={save}
                onCancel={closePage}
                onDirtyChange={setEditorDirty}
                onSavingChange={setEditorSaving}
              />
            </div>
          </>
        )}
      </section>
      <UiProps ids={{"title":["admin.m01aeaa37eede"],"description":["admin.ma3456d403b84"],"confirmText":["admin.mccb06b8a183b"],"cancelText":["admin.mfd4b9e3b6c68"]}}><ConfirmDialog open={leave.confirmOpen} title="admin.m01aeaa37eede" description="admin.ma3456d403b84" danger confirmText="admin.mccb06b8a183b" cancelText="admin.mfd4b9e3b6c68" onConfirm={leave.discardAndLeave} onClose={leave.cancelLeave} /></UiProps>
    </main>
    </AtomicPageReveal>
  );
}
