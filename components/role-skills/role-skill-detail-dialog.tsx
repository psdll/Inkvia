"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { RoleSkillDetailView } from "@/components/role-skills/role-skill-detail-view";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";

export function RoleSkillDetailDialog({
  skill,
  onClose,
  downloadAction,
  onEdit,
  onDelete,
  onRestore,
  metadata,
  error,
}: {
  skill: RoleSkillDetail | null;
  onClose(): void;
  downloadAction?: React.ReactNode;
  onEdit?(): void;
  onDelete?(): void;
  onRestore?(): void;
  metadata?: React.ReactNode;
  error?: string | null;
}) {
  React.useEffect(() => {
    if (!skill) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, skill]);

  if (!skill) return null;
  return createPortal(
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-[var(--overlay)] p-3 sm:p-5">
      <UiProps ids={{"aria-label":["common.mbb846c69627f"]}}><section
        role="dialog"
        aria-modal="true"
        aria-label="common.mbb846c69627f"
        className="flex h-[min(940px,92vh)] w-[min(1080px,96vw)] min-h-0 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)]"
      >
        <RoleSkillDetailView skill={skill} onClose={onClose} downloadAction={downloadAction} onEdit={onEdit} onDelete={onDelete} onRestore={onRestore} metadata={metadata} error={error} />
      </section></UiProps>
    </div>,
    document.body,
  );
}
