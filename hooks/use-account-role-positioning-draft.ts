"use client";

import * as React from "react";
import {
  putAccountRolePositioningDraft,
  type AccountRolePositioningDraftPayload,
} from "@/lib/account-role-positioning-draft-client";
import type { RolePositioningSurface } from "@/lib/role-positioning-surface";
import { safeRolePositioningContinuation } from "@/lib/role-positioning-continuation";
import { ephemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { readDesktopInputDraft, writeDesktopInputDraft } from "@/lib/desktop-input-draft";

export type AccountRolePositioningDraft = AccountRolePositioningDraftPayload;

export type DraftSaveResult =
  | { success: true }
  | { success: false; error: string };

export function createDraftSaveDeduper() {
  let lastSavedKey = "";
  let lastSavedSnapshot = "";

  return {
    shouldSave(key: string, draft: AccountRolePositioningDraft) {
      return key !== lastSavedKey || JSON.stringify(draft) !== lastSavedSnapshot;
    },
    markSaved(key: string, draft: AccountRolePositioningDraft) {
      lastSavedKey = key;
      lastSavedSnapshot = JSON.stringify(draft);
    },
  };
}

const EMPTY_DRAFT: AccountRolePositioningDraft = {
  systemPrompt: "",
  reversePrompt: "",
  reversePromptApplied: false,
  activeReverseTaskId: null,
  continuation: null,
  selectedRoleSkillId: null,
  resultRoleSkill: null,
};

function normalizedDraft(
  value: any,
  surface: RolePositioningSurface,
): AccountRolePositioningDraft {
  return {
    systemPrompt:
      typeof value?.systemPrompt === "string" ? value.systemPrompt : "",
    reversePrompt:
      typeof value?.reversePrompt === "string" ? value.reversePrompt : "",
    reversePromptApplied: value?.reversePromptApplied === true,
    activeReverseTaskId:
      Number.isInteger(value?.activeReverseTaskId) &&
      value.activeReverseTaskId > 0
        ? value.activeReverseTaskId
        : null,
    continuation: safeRolePositioningContinuation(value?.continuation, surface),
    selectedRoleSkillId:
      typeof value?.selectedRoleSkillId === "string"
        ? value.selectedRoleSkillId
        : null,
    resultRoleSkill:
      value?.resultRoleSkill
      && typeof value.resultRoleSkill.id === "string"
      && typeof value.resultRoleSkill.name === "string"
      && Number.isInteger(value.resultRoleSkill.revision)
        ? {
            id: value.resultRoleSkill.id,
            name: value.resultRoleSkill.name,
            revision: value.resultRoleSkill.revision,
          }
        : null,
  };
}

function migratedSystemPrompt(legacyStorageKey: string) {
  if (!legacyStorageKey || typeof window === "undefined") return "";
  try {
    const value = JSON.parse(window.localStorage.getItem(legacyStorageKey) || "null");
    return typeof value?.systemPrompt === "string" ? value.systemPrompt : "";
  } catch {
    return "";
  }
}

export function useAccountRolePositioningDraft({
  userId,
  surface,
  legacyStorageKey,
  persistSelectedRoleSkillId = true,
}: {
  userId: string;
  surface: RolePositioningSurface;
  legacyStorageKey?: string;
  persistSelectedRoleSkillId?: boolean;
}) {
  const [draft, setDraft] = React.useState<AccountRolePositioningDraft>(EMPTY_DRAFT);
  const [hydratedKey, setHydratedKey] = React.useState("");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const draftRef = React.useRef(draft);
  const activeKeyRef = React.useRef("");
  const saveDeduperRef = React.useRef(createDraftSaveDeduper());
  const saveChainRef = React.useRef<Promise<DraftSaveResult>>(
    Promise.resolve({ success: true }),
  );
  const accountKey = userId ? `${userId}:${surface}` : "";
  const ephemeralSkillSurface = `role-skill:${surface}`;
  const desktopMode = useDesktopMode();
  activeKeyRef.current = accountKey;

  const rememberSelectedSkill = React.useCallback((selectedRoleSkillId: string | null) => {
    const selection = { selectedRoleSkillId };
    ephemeralInputDraftRegistry.write(ephemeralSkillSurface, userId, selection);
    writeDesktopInputDraft(desktopMode, ephemeralSkillSurface, userId, selection);
  }, [desktopMode, ephemeralSkillSurface, userId]);

  const updateDraft = React.useCallback(
    (update: Partial<AccountRolePositioningDraft>) => {
      setDraft((current) => {
        const next = { ...current, ...update };
        if (!persistSelectedRoleSkillId && "selectedRoleSkillId" in update) {
          rememberSelectedSkill(next.selectedRoleSkillId);
        }
        draftRef.current = next;
        return next;
      });
    },
    [persistSelectedRoleSkillId, rememberSelectedSkill],
  );

  const persistSnapshot = React.useCallback(
    async (
      snapshot: AccountRolePositioningDraft,
      key: string,
      keepalive = false,
    ): Promise<DraftSaveResult> => {
      if (!userId || activeKeyRef.current !== key) return { success: true };
      const persistedSnapshot = persistSelectedRoleSkillId
        ? snapshot
        : { ...snapshot, selectedRoleSkillId: null };
      if (!saveDeduperRef.current.shouldSave(key, persistedSnapshot)) {
        return { success: true };
      }
      const result = await putAccountRolePositioningDraft({
        surface,
        draft: persistedSnapshot,
        keepalive,
      });
      if (activeKeyRef.current !== key) return result;
      if (result.success) {
        saveDeduperRef.current.markSaved(key, persistedSnapshot);
      }
      setSaveError(result.success ? null : result.error);
      return result;
    },
    [persistSelectedRoleSkillId, surface, userId],
  );

  const enqueueSave = React.useCallback(
    (update?: Partial<AccountRolePositioningDraft>) => {
      const key = accountKey;
      if (!key) return Promise.resolve<DraftSaveResult>({ success: true });
      const snapshot = update
        ? { ...draftRef.current, ...update }
        : draftRef.current;
      if (update) {
        if (!persistSelectedRoleSkillId && "selectedRoleSkillId" in update) {
          rememberSelectedSkill(snapshot.selectedRoleSkillId);
        }
        draftRef.current = snapshot;
        setDraft(snapshot);
      }
      saveChainRef.current = saveChainRef.current.then(
        () => persistSnapshot(snapshot, key),
        () => persistSnapshot(snapshot, key),
      );
      return saveChainRef.current;
    },
    [accountKey, persistSelectedRoleSkillId, persistSnapshot, rememberSelectedSkill],
  );

  React.useEffect(() => {
    let cancelled = false;
    draftRef.current = EMPTY_DRAFT;
    setDraft(EMPTY_DRAFT);
    setHydratedKey("");
    setSaveError(null);
    if (!accountKey) return () => {
      cancelled = true;
    };

    void fetch(
      `/api/role-positioning/draft?surface=${encodeURIComponent(surface)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false) {
          throw new Error(String(data?.error || "角色定位草稿加载失败"));
        }
        if (cancelled || activeKeyRef.current !== accountKey) return;

        const normalizedStored = data?.draft
          ? normalizedDraft(data.draft, surface)
          : null;
        const stored = normalizedStored && !persistSelectedRoleSkillId
          ? { ...normalizedStored, selectedRoleSkillId: null }
          : normalizedStored;
        const legacyPrompt = stored
          ? ""
          : migratedSystemPrompt(String(legacyStorageKey || ""));
        const persistentDraft = stored || {
          ...EMPTY_DRAFT,
          systemPrompt: legacyPrompt,
        };
        const ephemeralSkill = !persistSelectedRoleSkillId
          ? readDesktopInputDraft<{ selectedRoleSkillId: string | null }>(desktopMode, ephemeralSkillSurface, userId)
            || ephemeralInputDraftRegistry.read<{ selectedRoleSkillId: string | null }>(ephemeralSkillSurface, userId)
          : null;
        const next = ephemeralSkill
          ? { ...persistentDraft, selectedRoleSkillId: ephemeralSkill.selectedRoleSkillId }
          : persistentDraft;
        if (stored) saveDeduperRef.current.markSaved(accountKey, stored);
        draftRef.current = next;
        setDraft(next);
        setHydratedKey(accountKey);
        setSaveError(null);
        if (!stored && legacyPrompt) void enqueueSave(next);
      })
      .catch((error) => {
        if (!cancelled && activeKeyRef.current === accountKey) {
          setSaveError(
            error instanceof Error
              ? error.message
              : "角色定位草稿加载失败，请稍后重试",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountKey, desktopMode, enqueueSave, ephemeralSkillSurface, legacyStorageKey, persistSelectedRoleSkillId, surface, userId]);

  React.useEffect(() => {
    if (!accountKey || hydratedKey !== accountKey) return;
    const timer = window.setTimeout(() => {
      void enqueueSave(draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [accountKey, draft, enqueueSave, hydratedKey]);

  React.useEffect(() => {
    if (!accountKey || hydratedKey !== accountKey) return;
    const handlePageHide = () => {
      void persistSnapshot(draftRef.current, accountKey, true).catch(
        () => undefined,
      );
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [accountKey, hydratedKey, persistSnapshot]);

  // Consumers use these actions in Effects; new functions on every render can
  // turn a completed request into another request indefinitely.
  const actions = React.useMemo(() => ({
    setSystemPrompt: (systemPrompt: string) => updateDraft({ systemPrompt }),
    setReversePrompt: (reversePrompt: string) => updateDraft({ reversePrompt }),
    setReversePromptApplied: (reversePromptApplied: boolean) =>
      updateDraft({ reversePromptApplied }),
    setActiveReverseTaskId: (activeReverseTaskId: number | null) =>
      updateDraft({ activeReverseTaskId }),
    setSelectedRoleSkillId: (selectedRoleSkillId: string | null) =>
      updateDraft({ selectedRoleSkillId }),
    setResultRoleSkill: (
      resultRoleSkill: AccountRolePositioningDraft["resultRoleSkill"],
    ) => updateDraft({ resultRoleSkill }),
  }), [updateDraft]);

  return {
    ...draft,
    ...actions,
    saveError,
    hydrated: Boolean(accountKey && hydratedKey === accountKey),
    saveNow: enqueueSave,
  };
}
