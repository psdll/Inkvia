"use client";
import { UiText, UiProps } from "@/i18n/ui";


import { RoleSkillTrigger } from "@/components/role-skills/role-skill-trigger";
import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog";
import type { BatchMediaRelation } from "@/components/batch-workbench/types";
import type { BatchRolePositioningController } from "@/hooks/use-batch-role-positioning-controller";

export function BatchRolePositioning({
  controller,
  prompt,
  media,
  pendingMedia,
  disabled,
}: {
  controller: BatchRolePositioningController;
  prompt: string;
  media: BatchMediaRelation[];
  pendingMedia: boolean;
  disabled: boolean;
}) {
  return (
    <>
      <RoleSkillTrigger
        onClick={() => controller.setOpen(true)}
        disabled={disabled}
        selected={Boolean(controller.selectedRoleSkillId)}
      />

      <RoleSkillDialog
        open={controller.open}
        authUserId={controller.authUserId}
        selectedRoleSkillId={controller.selectedRoleSkillId}
        resultRoleSkillId={controller.resultRoleSkill?.id || null}
        legacySystemPrompt={controller.legacySystemPrompt}
        generating={controller.busy}
        generateDisabledReason={pendingMedia ? "素材仍在上传中，请稍后再生成。" : undefined}
        showApplyResult={false}
        onClose={() => {
          void controller.saveNow();
          controller.setOpen(false);
        }}
        onSelect={(skill) => {
          controller.selectRoleSkill(skill);
          controller.setOpen(false);
        }}
        onGenerate={() => {
          void controller.generatePrompt({ prompt, media, pendingMedia }).catch(
            () => undefined,
          );
        }}
        onApplyResult={() => undefined}
        result={(
          <div className="flex h-full min-h-[220px] flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
              <span><UiText id="batch.m03a015df9aec" /></span>
            </div>
            <UiProps ids={{"placeholder":["batch.m3ddfd59a7642"]}}><textarea
              value={controller.reversePrompt}
              onChange={(event) => controller.setReversePrompt(event.target.value)}
              onBlur={() => void controller.saveNow()}
              disabled={controller.busy}
              placeholder="batch.m3ddfd59a7642"
              className="min-h-0 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-3 text-sm leading-relaxed text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-60"
            /></UiProps>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-red-500">{controller.error}</span>
              <button type="button" onClick={controller.clearResult} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-bg)] hover:text-[var(--app-fg)]"><UiText id="batch.me4b823dc13c3" /></button>
            </div>
          </div>
        )}
      />
    </>
  );
}
