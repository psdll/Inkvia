"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import type { BatchMediaRelation } from "@/components/batch-workbench/types";
import { relationPreviewUrl } from "@/components/batch-workbench/types";
import {
  basenameFromPath,
  buildPromptWithAssetReferences,
  type PromptReferenceAsset,
} from "@/lib/prompt-asset-references";
import {
  resolveBatchRoleUserPrompt,
  startBatchRolePrompt,
  waitForBatchRolePromptTask,
  type PromptReverseTaskItem,
} from "@/lib/batch-role-positioning-client";
import {
  useAccountRolePositioningDraft,
  type AccountRolePositioningDraft,
} from "@/hooks/use-account-role-positioning-draft";
import type {
  BatchSegmentedPromptRoleContinuation,
} from "@/lib/role-positioning-continuation";
import { listRoleSkills } from "@/lib/role-skills/client";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

export type GenerateBatchRolePromptInput = {
  prompt: string;
  media: BatchMediaRelation[];
  pendingMedia: boolean;
  continuation?: Omit<
    BatchSegmentedPromptRoleContinuation,
    "taskId" | "phase"
  >;
};

export type GenerateBatchRolePromptResult = {
  generatedPrompt: string;
  skill: NonNullable<PromptReverseTaskItem["skill"]> | null;
};

type SaveResult =
  | { success: true }
  | { success: false; error: string };

export type BatchRolePositioningController = {
  open: boolean;
  hydrated: boolean;
  busy: boolean;
  authUserId: string;
  legacySystemPrompt: string;
  selectedRoleSkillId: string | null;
  selectedRoleSkill: RoleSkillListItem | null;
  resultRoleSkill: PromptReverseTaskItem["skill"];
  reversePrompt: string;
  continuation: BatchSegmentedPromptRoleContinuation | null;
  providerLabel: string;
  error: string | null;
  setOpen: (open: boolean) => void;
  setReversePrompt: (value: string) => void;
  selectRoleSkill: (skill: RoleSkillListItem) => void;
  clearRoleSkillSelection: () => void;
  clearResult: () => void;
  clearError: () => void;
  openWithError: (message: string) => void;
  saveNow: (
    update?: Partial<AccountRolePositioningDraft>,
  ) => Promise<SaveResult>;
  generatePrompt: (
    input: GenerateBatchRolePromptInput,
  ) => Promise<GenerateBatchRolePromptResult>;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function taskProviderLabel(task: PromptReverseTaskItem) {
  return [task.llmProviderId, task.model].filter(Boolean).join(" / ");
}

function buildPromptAssets(media: BatchMediaRelation[]) {
  return media
    .filter((relation) => relation.role === "product" && !relation.pending)
    .flatMap<PromptReferenceAsset>((relation, index) => {
      const url = relationPreviewUrl(relation);
      if (!url) return [];
      return [{
        id: relation.id,
        token: `图片${index + 1}`,
        kind: "image",
        url,
        name: relation.media.originalName || basenameFromPath(url) || `图片${index + 1}`,
      }];
    });
}

export function useBatchRolePositioningController(): BatchRolePositioningController {
  const { text } = useUiLocale();
  const { user, openLoginModal } = useAuth();
  const userId = user?.id ? String(user.id) : "";
  const draft = useAccountRolePositioningDraft({
    userId,
    surface: "batch_workbench",
    legacyStorageKey: userId ? `prompt_reverse_panel_v1_${userId}` : "",
    persistSelectedRoleSkillId: false,
  });
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [controllerError, setControllerError] = React.useState<string | null>(null);
  const [providerLabel, setProviderLabel] = React.useState("");
  const [selectedRoleSkill, setSelectedRoleSkill] = React.useState<RoleSkillListItem | null>(null);
  const inFlightRef = React.useRef(false);
  const runIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const resumedTaskIdRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    runIdRef.current += 1;
    abortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const selectedRoleSkillId = draft.selectedRoleSkillId;
    if (!selectedRoleSkillId) {
      setSelectedRoleSkill(null);
      return () => {
        cancelled = true;
      };
    }
    if (selectedRoleSkill?.id === selectedRoleSkillId) {
      return () => {
        cancelled = true;
      };
    }
    void listRoleSkills()
      .then((skills) => {
        if (cancelled) return;
        setSelectedRoleSkill(
          skills.find((skill) => skill.id === selectedRoleSkillId) || null,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draft.selectedRoleSkillId, selectedRoleSkill?.id]);

  const generatePrompt = React.useCallback(async (
    input: GenerateBatchRolePromptInput,
  ) => {
    if (inFlightRef.current) {
      throw new Error("生成分段提示词正在进行中，请稍候");
    }
    if (!userId) {
      openLoginModal();
      throw new Error("请先登录");
    }
    if (!draft.selectedRoleSkillId) {
      const message = "请先选择一个 Skill";
      setControllerError(message);
      setOpen(true);
      throw new Error(message);
    }
    if (input.pendingMedia) {
      const message = "素材仍在上传中，请稍后重试";
      setControllerError(message);
      throw new Error(message);
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    inFlightRef.current = true;
    setBusy(true);
    setControllerError(null);

    try {
      const promptAssets = buildPromptAssets(input.media);
      const promptRequest = buildPromptWithAssetReferences(input.prompt, promptAssets);
      const task = await startBatchRolePrompt({
        roleSkillId: draft.selectedRoleSkillId,
        userPrompt: resolveBatchRoleUserPrompt(
          promptRequest.modelPrompt,
          promptAssets.length,
        ),
        mediaUrls: promptAssets.map((asset) => String(asset.url || "")).filter(Boolean),
      });
      if (runIdRef.current !== runId) {
        throw new DOMException("Aborted", "AbortError");
      }
      setProviderLabel(taskProviderLabel(task));
      const activeContinuation: BatchSegmentedPromptRoleContinuation | null =
        input.continuation
          ? {
              ...input.continuation,
              taskId: task.id,
              phase: "waiting",
            }
          : null;
      const activeSave = await draft.saveNow({
        activeReverseTaskId: task.id,
        reversePromptApplied: false,
        continuation: activeContinuation,
      });
      if (!activeSave.success) throw new Error(activeSave.error);
      if (runIdRef.current !== runId) {
        throw new DOMException("Aborted", "AbortError");
      }

      const completedTask = await waitForBatchRolePromptTask({
        taskId: task.id,
        signal: abortController.signal,
      });
      if (runIdRef.current !== runId) {
        throw new DOMException("Aborted", "AbortError");
      }
      const generatedPrompt = String(completedTask.generatedPrompt || "").trim();
      setProviderLabel(taskProviderLabel(completedTask));
      const resultSave = await draft.saveNow({
        reversePrompt: generatedPrompt,
        reversePromptApplied: false,
        activeReverseTaskId: activeContinuation ? completedTask.id : null,
        continuation: activeContinuation
          ? { ...activeContinuation, phase: "ready" }
          : null,
        resultRoleSkill: completedTask.skill || null,
      });
      if (!resultSave.success) throw new Error(resultSave.error);
      if (runIdRef.current !== runId) {
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        generatedPrompt,
        skill: completedTask.skill || null,
      };
    } catch (error) {
      if (!isAbortError(error) && runIdRef.current === runId) {
        setControllerError(
          error instanceof Error ? error.message : text("workspaceFollowup.mbb69cf9c15bc"),
        );
      }
      throw error;
    } finally {
      if (runIdRef.current === runId) {
        inFlightRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    }
  }, [draft, openLoginModal, userId]);

  React.useEffect(() => {
    const taskId = draft.activeReverseTaskId;
    const continuation = draft.continuation?.kind === "batch_segmented_prompts"
      ? draft.continuation
      : null;
    if (!draft.hydrated || !taskId || inFlightRef.current) return;
    if (continuation && continuation.taskId !== taskId) return;
    if (continuation?.phase === "ready") return;
    if (resumedTaskIdRef.current === taskId) return;
    resumedTaskIdRef.current = taskId;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    inFlightRef.current = true;
    setBusy(true);
    setControllerError(null);

    void waitForBatchRolePromptTask({
      taskId,
      signal: abortController.signal,
    }).then(async (task) => {
      if (runIdRef.current !== runId) return;
      const generatedPrompt = String(task.generatedPrompt || "").trim();
      setProviderLabel(taskProviderLabel(task));
      const result = await draft.saveNow({
        reversePrompt: generatedPrompt,
        reversePromptApplied: false,
        activeReverseTaskId: continuation ? task.id : null,
        continuation: continuation
          ? { ...continuation, phase: "ready" }
          : null,
        resultRoleSkill: task.skill || null,
      });
      if (runIdRef.current !== runId) return;
      if (!result.success) throw new Error(result.error);
    }).catch((error) => {
      if (!isAbortError(error) && runIdRef.current === runId) {
        setControllerError(
          error instanceof Error ? error.message : text("workspaceFollowup.mff059db2756f"),
        );
        if (!continuation) void draft.saveNow({ activeReverseTaskId: null });
      }
    }).finally(() => {
      if (runIdRef.current === runId) {
        inFlightRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    });
  }, [draft]);

  return {
    open,
    hydrated: draft.hydrated,
    busy,
    authUserId: userId,
    legacySystemPrompt: draft.systemPrompt,
    selectedRoleSkillId: draft.selectedRoleSkillId,
    selectedRoleSkill,
    resultRoleSkill: draft.resultRoleSkill,
    reversePrompt: draft.reversePrompt,
    continuation: draft.continuation?.kind === "batch_segmented_prompts"
      ? draft.continuation
      : null,
    providerLabel,
    error: controllerError || draft.saveError,
    setOpen,
    setReversePrompt: draft.setReversePrompt,
    selectRoleSkill: (skill) => {
      setControllerError(null);
      setSelectedRoleSkill(skill);
      void draft.saveNow({
        selectedRoleSkillId: skill.id,
        reversePromptApplied: false,
      });
    },
    clearRoleSkillSelection: () => {
      setControllerError(null);
      setSelectedRoleSkill(null);
      void draft.saveNow({
        selectedRoleSkillId: null,
        reversePromptApplied: false,
      });
    },
    clearResult: () => {
      setControllerError(null);
      void draft.saveNow({
        reversePrompt: "",
        reversePromptApplied: false,
        activeReverseTaskId: null,
        continuation: null,
        resultRoleSkill: null,
      });
    },
    clearError: () => setControllerError(null),
    openWithError: (message: string) => {
      setControllerError(message);
      setOpen(true);
    },
    saveNow: draft.saveNow,
    generatePrompt,
  };
}
