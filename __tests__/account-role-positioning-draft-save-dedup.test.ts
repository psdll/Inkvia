import { describe, expect, it } from "vitest";
import {
  createDraftSaveDeduper,
  type AccountRolePositioningDraft,
} from "@/hooks/use-account-role-positioning-draft";

const draft: AccountRolePositioningDraft = {
  systemPrompt: "keep the current experience",
  reversePrompt: "",
  reversePromptApplied: false,
  activeReverseTaskId: null,
  continuation: null,
  selectedRoleSkillId: "personal:9",
  resultRoleSkill: null,
};

describe("account role-positioning draft save deduplication", () => {
  it("skips only an unchanged snapshot that was saved successfully", () => {
    const deduper = createDraftSaveDeduper();

    expect(deduper.shouldSave("user-1:batch_workbench", draft)).toBe(true);
    expect(deduper.shouldSave("user-1:batch_workbench", draft)).toBe(true);

    deduper.markSaved("user-1:batch_workbench", draft);

    expect(deduper.shouldSave("user-1:batch_workbench", draft)).toBe(false);
    expect(
      deduper.shouldSave("user-1:batch_workbench", {
        ...draft,
        reversePrompt: "changed",
      }),
    ).toBe(true);
    expect(deduper.shouldSave("user-2:batch_workbench", draft)).toBe(true);
    expect(deduper.shouldSave("user-1:toolbox_image", draft)).toBe(true);
  });
});
