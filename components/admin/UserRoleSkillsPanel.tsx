"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { Search } from "lucide-react";
import { SkillModuleIcon } from "@/components/ui/creation-icons";
import { SkillDownloadButton } from "@/components/admin/SkillDownloadButton";
import { RoleSkillCard } from "@/components/role-skills/role-skill-card";
import { RoleSkillDetailDialog } from "@/components/role-skills/role-skill-detail-dialog";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";

export default function UserRoleSkillsPanel({ skills, username }: { skills: RoleSkillDetail[] | null; username?: string | null }) {
  const [query, setQuery] = React.useState("");
  const [detailSkill, setDetailSkill] =
    React.useState<RoleSkillDetail | null>(null);
  const list = skills || [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = list.filter((skill) => {
    if (!normalizedQuery) return true;
    return [skill.name, skill.category, skill.summary, skill.content]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-fg)]">
              <SkillModuleIcon className="h-4 w-4" /><UiText id="admin.m40d60971b1b4" /></h3>
          </div>
          <div className="ml-auto flex max-w-full items-center gap-3">
            <label className="flex w-60 min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--app-muted)]">
              <Search className="h-4 w-4 shrink-0" />
              <UiProps ids={{"aria-label":["admin.m43b9d66b88a8"],"placeholder":["admin.m43b9d66b88a8"]}}><input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="admin.m43b9d66b88a8"
                placeholder="admin.m43b9d66b88a8"
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]"
              /></UiProps>
            </label>
            <span className="shrink-0 text-xs text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" />{visible.length}<UiText id="admin.m6fb2840d568a" /></span>
          </div>
        </div>

        {visible.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-x-4 gap-y-4">
            {visible.map((skill) => (
              <RoleSkillCard
                key={skill.id}
                skill={skill.source === "personal" ? { ...skill, ownerName: username || skill.ownerName } : skill}
                onView={() => setDetailSkill(skill)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--border)] py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m578e81dc489c" /></div>
        )}
      </div>
      <RoleSkillDetailDialog
        skill={detailSkill}
        downloadAction={detailSkill ? <SkillDownloadButton getSkill={() => detailSkill} /> : undefined}
        onClose={() => setDetailSkill(null)}
      />
    </>
  );
}
