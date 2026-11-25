"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Plus } from "lucide-react";
import { SkillDownloadButton } from "@/components/admin/SkillDownloadButton";
import { RoleSkillCard } from "@/components/role-skills/role-skill-card";
import { RoleSkillDetailDialog } from "@/components/role-skills/role-skill-detail-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkillModuleIcon } from "@/components/ui/creation-icons";
import { FrostedSelect } from "@/components/ui/frosted-select";
import {
  deleteSystemRoleSkillAdmin,
  getCachedRoleSkillData,
  invalidateRoleSkillCache,
  getSystemRoleSkillAdmin,
  listSystemRoleSkillsAdmin,
  restoreSystemRoleSkillAdmin,
} from "@/lib/role-skills/client";
import type {
  AdminRoleSkillDetail,
  AdminRoleSkillListItem,
} from "@/lib/role-skills/contracts";

const FILTER_OPTIONS = [
  { value: "active", label: "全部有效" },
  { value: "published", label: "已发布" },
  { value: "hidden", label: "已隐藏" },
  { value: "deleted", label: "已删除" },
];

const cachedSystemSkills = () => getCachedRoleSkillData<{ skills: AdminRoleSkillListItem[] }>("/api/admin/role-skills/system?includeDeleted=1")?.skills;

export default function SystemRoleSkillsPanel() {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const [skills, setSkills] = React.useState<AdminRoleSkillListItem[]>(() => cachedSystemSkills() || []);
  const [loading, setLoading] = React.useState(() => !cachedSystemSkills());
  const [initialized, setInitialized] = React.useState(() => Boolean(cachedSystemSkills()));
  const [filter, setFilter] = React.useState("active");
  const [error, setError] = React.useState<string | null>(null);
  const [detailSkill, setDetailSkill] =
    React.useState<AdminRoleSkillDetail | null>(null);
  const [pendingDeleteSkill, setPendingDeleteSkill] =
    React.useState<AdminRoleSkillListItem | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(!cachedSystemSkills());
    setError(null);
    try {
      setSkills(await listSystemRoleSkillsAdmin());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "系统技能加载失败");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("role-skills:changed", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("role-skills:changed", refreshOnFocus);
    };
  }, [refresh]);

  const visibleSkills = skills.filter((skill) => {
    if (filter === "deleted") return Boolean(skill.deletedAt);
    if (skill.deletedAt) return false;
    if (filter === "published" || filter === "hidden") return skill.status === filter;
    return true;
  });
  const initialLoading = loading && !initialized;

  const handleFailure = async (actionError: unknown) => {
    const typed = actionError as Error & { code?: string };
    if (typed?.code === "SKILL_REVISION_CONFLICT") {
      invalidateRoleSkillCache();
      await refresh();
      setError("技能已被其他管理员更新，列表已刷新，请重新操作。");
      return;
    }
    setError(typed instanceof Error ? typed.message : "系统技能操作失败");
  };

  const run = async (operation: () => Promise<unknown>) => {
    setError(null);
    try {
      await operation();
      await refresh();
      return true;
    } catch (operationError) {
      await handleFailure(operationError);
      return false;
    }
  };

  const openDetail = async (skill: AdminRoleSkillListItem) => {
    setError(null);
    setDetailSkill(getCachedRoleSkillData<{ skill: AdminRoleSkillDetail }>(`/api/admin/role-skills/system/${encodeURIComponent(skill.id)}`)?.skill || null);
    try {
      setDetailSkill(await getSystemRoleSkillAdmin(skill.id));
    } catch (detailError) {
      await handleFailure(detailError);
    }
  };

  const openEditorPage = (skillId?: string) => {
    setError(null);
    const pendingTab = window.open("", "_blank");
    if (!pendingTab) {
      setError("浏览器阻止了新标签页，请允许此站点打开弹出式窗口后重试。");
      return;
    }
    pendingTab.opener = null;
    const editorUrl = skillId
      ? `/admin/role-skills/editor?skillId=${encodeURIComponent(skillId)}`
      : "/admin/role-skills/editor";
    pendingTab.location.replace(editorUrl);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
          <SkillModuleIcon className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.m0d27eaf21f60" /></h3>
        <div className="flex items-center gap-2" style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
          <FrostedSelect
            value={filter}
            onChange={setFilter}
            options={FILTER_OPTIONS}
            showLeading={false}
            compact
            className="w-28"
            buttonClassName="!h-8 !rounded-[9px] !border-[var(--canvas-controls-border,var(--border))] !bg-transparent !px-3 !text-[13px] font-normal !text-[var(--canvas-controls-text,var(--app-fg))] !shadow-none hover:!bg-[var(--canvas-controls-hover,var(--panel-2))]"
            side="bottom"
            ariaLabel={tLabel("筛选系统技能状态")}
          />
          <UiProps ids={{"aria-label":["admin.m04bcc5bd9b5e"]}}><button
            type="button"
            onClick={() => openEditorPage()}
            aria-label="admin.m04bcc5bd9b5e"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent px-3 text-[13px] font-normal leading-5 text-[var(--canvas-controls-text,var(--app-fg))] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
          >
            <Plus size={15} strokeWidth={1.5} /><UiText id="admin.mcde2cd071d25" /></button></UiProps>
        </div>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-500">{uiError(error)}</div> : null}
      {initialLoading ? <div className="py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m50cc74efa2b1" /></div> : null}
      {initialized && visibleSkills.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m3ac6c13f2b73" /></div> : null}

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-x-4 gap-y-4">
        {visibleSkills.map((skill) => (
          <RoleSkillCard
            key={skill.id}
            skill={skill}
            badge={
              skill.deletedAt
                ? "已删除"
                : skill.status === "published"
                  ? "已发布"
                  : "已隐藏"
            }
            onView={() => void openDetail(skill)}
          />
        ))}
      </div>
      <RoleSkillDetailDialog
        skill={detailSkill}
        error={uiError(error)}
        metadata={detailSkill ? <span>revision {detailSkill.revision}</span> : undefined}
        onEdit={detailSkill && !detailSkill.deletedAt ? () => openEditorPage(detailSkill.id) : undefined}
        onDelete={detailSkill && !detailSkill.deletedAt ? () => setPendingDeleteSkill(detailSkill) : undefined}
        onRestore={detailSkill?.deletedAt ? () => void run(async () => {
          await restoreSystemRoleSkillAdmin(detailSkill.id, detailSkill.revision);
          setDetailSkill(null);
        }) : undefined}
        downloadAction={detailSkill ? <SkillDownloadButton getSkill={() => detailSkill} /> : undefined}
        onClose={() => setDetailSkill(null)}
      />
      <UiProps ids={{"title":["admin.mfa04d3ea5da1"],"confirmText":["admin.m2f9daa828907"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={Boolean(pendingDeleteSkill)}
        title="admin.mfa04d3ea5da1"
        description={
          pendingDeleteSkill
            ? `删除系统技能“${pendingDeleteSkill.name}”？删除后可在 30 天内从“已删除”筛选中恢复，超过 30 天将永久删除。`
            : ""
        }
        confirmText="admin.m2f9daa828907"
        cancelText="admin.m2cd0f3be8738"
        danger
        onClose={() => setPendingDeleteSkill(null)}
        onConfirm={() =>
          pendingDeleteSkill
            ? run(async () => {
                await deleteSystemRoleSkillAdmin(
                  pendingDeleteSkill.id,
                  pendingDeleteSkill.revision,
                );
                setDetailSkill(null);
              })
            : false
        }
      /></UiProps>
    </div>
  );
}
