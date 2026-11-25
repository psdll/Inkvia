"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { Database, FileImage, FileText, Frame, Images, ReceiptText } from "lucide-react";
import { SkillModuleIcon } from "@/components/ui/creation-icons";

export type UserDetailTab = "canvases" | "analysis" | "billing" | "works" | "materials" | "presets" | "skills";

type UserDetailTabBarProps = {
  active: UserDetailTab;
  onSelect: (tab: UserDetailTab) => void;
  onPrefetch?: (tab: UserDetailTab) => void;
  actions?: React.ReactNode;
};

function TabBtn({ active, onClick, onPrefetch, icon, label }: { active: boolean; onClick: () => void; onPrefetch?: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={[
        "h-[42px] shrink-0 px-[18px] rounded-xl border transition-all duration-200 flex items-center gap-2.5 whitespace-nowrap text-[12.5px] font-medium backdrop-blur-sm",
        active
          ? "border-white/15 bg-[var(--panel-2)] text-[var(--app-fg)] shadow-[0_6px_18px_rgba(0,0,0,0.16)]"
          : "border-transparent bg-[var(--panel-bg)] text-[var(--app-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

export default function UserDetailTabBar({ active, onSelect, onPrefetch, actions }: UserDetailTabBarProps) {
  return (
    <div className="relative z-30 flex max-w-full shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)]/90 p-2.5 backdrop-blur-xl">
      <div className="no-scrollbar flex max-w-full flex-wrap items-center gap-2.5 overflow-x-auto">
        <UiProps ids={{"label":["admin.m5d8ec6f62009"]}}><TabBtn active={active === "analysis"} onClick={() => onSelect("analysis")} onPrefetch={() => onPrefetch?.("analysis")} icon={<Database className="h-[17px] w-[17px]" />} label="admin.m5d8ec6f62009" /></UiProps>
        <UiProps ids={{"label":["admin.mafb0b9059f5a"]}}><TabBtn active={active === "works"} onClick={() => onSelect("works")} onPrefetch={() => onPrefetch?.("works")} icon={<FileImage className="h-[17px] w-[17px]" />} label="admin.mafb0b9059f5a" /></UiProps>
        <UiProps ids={{"label":["admin.md3cd5d44facb"]}}><TabBtn active={active === "canvases"} onClick={() => onSelect("canvases")} onPrefetch={() => onPrefetch?.("canvases")} icon={<Frame className="h-[17px] w-[17px]" />} label="admin.md3cd5d44facb" /></UiProps>
        <UiProps ids={{"label":["admin.m161f125e686e"]}}><TabBtn active={active === "materials"} onClick={() => onSelect("materials")} onPrefetch={() => onPrefetch?.("materials")} icon={<Images className="h-[17px] w-[17px]" />} label="admin.m161f125e686e" /></UiProps>
        <UiProps ids={{"label":["admin.mb46a606b401c"]}}><TabBtn active={active === "presets"} onClick={() => onSelect("presets")} onPrefetch={() => onPrefetch?.("presets")} icon={<FileText className="h-[17px] w-[17px]" />} label="admin.mb46a606b401c" /></UiProps>
        <UiProps ids={{"label":["admin.m99aea2f9131a"]}}><TabBtn active={active === "skills"} onClick={() => onSelect("skills")} onPrefetch={() => onPrefetch?.("skills")} icon={<SkillModuleIcon className="h-[17px] w-[17px]" />} label="admin.m99aea2f9131a" /></UiProps>
        <UiProps ids={{"label":["admin.m16c52da94c33"]}}><TabBtn active={active === "billing"} onClick={() => onSelect("billing")} onPrefetch={() => onPrefetch?.("billing")} icon={<ReceiptText className="h-[17px] w-[17px]" />} label="admin.m16c52da94c33" /></UiProps>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
