import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readChineseUiSource(path.join(process.cwd(), file), "utf8");
}

describe("batch role skill integration", () => {
  it("mounts the shared catalog only inside multi-prompt mode", () => {
    const settings = source("components/batch-workbench/batch-settings-panel.tsx");
    const skillComponent = source("components/batch-workbench/batch-role-positioning.tsx");
    const skillTrigger = source("components/role-skills/role-skill-trigger.tsx");
    expect(settings).toMatch(/batch\.mode === "multi_prompt" \? \([\s\S]*?<BatchRolePositioning/);
    expect(skillComponent).toContain("<RoleSkillDialog");
    expect(skillComponent).toContain("<RoleSkillTrigger");
    expect(skillTrigger).toContain('title="技能 / Skill"');
    const styleBranch = settings.slice(
      settings.indexOf('batch.mode === "style_replication"'),
      settings.indexOf('batch.mode === "style_replication"') + 500,
    );
    expect(styleBranch).not.toContain("RoleSkillDialog");
  });

  it("uses the selected skill id without changing task polling or media references", () => {
    const controller = source("hooks/use-batch-role-positioning-controller.ts");
    expect(controller).toContain("roleSkillId: draft.selectedRoleSkillId");
    expect(controller).not.toContain("systemPrompt: currentSystemPrompt");
    expect(controller).toContain("buildPromptWithAssetReferences");
    expect(controller).toContain("waitForBatchRolePromptTask");
    expect(controller).toContain("activeReverseTaskId: task.id");
    expect(controller).toContain("resultRoleSkill: completedTask.skill || null");
  });

  it("returns the completed task Skill snapshot to segmented batch creation", () => {
    const controller = source("hooks/use-batch-role-positioning-controller.ts");
    const page = source("components/batch-workbench/batch-workbench-page.tsx");

    expect(controller).toContain("skill: completedTask.skill || null");
    expect(page).toContain("const { generatedPrompt, skill } = await rolePositioning.generatePrompt");
    expect(page).toContain("createSegmentedPromptGroup(continuation, generatedPrompt, skill)");
    expect(page).toMatch(/skill,\s*mediaSnapshots:/);
    expect(page).not.toContain(
      "skill: rolePositioning.resultRoleSkill || rolePositioning.selectedRoleSkill",
    );
  });

  it("resumes a persisted segmented-prompt continuation after returning to the page", () => {
    const controller = source("hooks/use-batch-role-positioning-controller.ts");
    const page = source("components/batch-workbench/batch-workbench-page.tsx");

    expect(controller).toContain("continuation: activeContinuation");
    expect(controller).toContain("phase: \"ready\"");
    expect(page).toContain('kind: "batch_segmented_prompts"');
    expect(page).toContain("resumeSegmentedPromptContinuation");
    expect(page).toContain("continuation.requestKey");
    expect(page).toContain("continuation: null");
  });

  it("keeps batch and image Skill selections page-session-only on separate surfaces", () => {
    const controller = source("hooks/use-batch-role-positioning-controller.ts");
    const image = source("app/image/image-tool.tsx");
    expect(controller).toContain('surface: "batch_workbench"');
    expect(controller).toContain("persistSelectedRoleSkillId: false");
    expect(image).toContain('surface: "toolbox_image"');
    expect(image).toContain("persistSelectedRoleSkillId: false");
  });

  it("preserves the existing generated-result editing area", () => {
    const skillComponent = source("components/batch-workbench/batch-role-positioning.tsx");
    expect(skillComponent).toContain("value={controller.reversePrompt}");
    expect(skillComponent).toContain("controller.setReversePrompt");
    expect(skillComponent).toContain("controller.clearResult");
  });

  it("shows the selected skill as a removable token only inside the custom-batch prompt", () => {
    const settings = source("components/batch-workbench/batch-settings-panel.tsx");
    const skillComponent = source("components/batch-workbench/batch-role-positioning.tsx");
    const controller = source("hooks/use-batch-role-positioning-controller.ts");
    const promptEditor = source("components/ui/expandable-prompt-textarea.tsx");

    expect(controller).toContain("selectedRoleSkill: RoleSkillListItem | null");
    expect(controller).toContain("listRoleSkills()");
    expect(controller).toContain("clearRoleSkillSelection");
    expect(controller).toContain("selectedRoleSkillId: null");
    expect(skillComponent).toContain(
      "selected={Boolean(controller.selectedRoleSkillId)}",
    );
    expect(skillComponent).toContain("controller.setOpen(false)");
    expect(settings).toContain(
      'selectedRoleSkill={batch.mode === "multi_prompt"',
    );
    expect(settings).toContain(
      'onRoleSkillRemove={batch.mode === "multi_prompt"',
    );
    expect(settings).not.toContain('data-batch-role-skill-token=""');
    expect(promptEditor).toContain("selectedRoleSkill?: RoleSkillListItem | null");
    expect(promptEditor).toContain("onRoleSkillRemove?: () => void");
    expect(settings).toContain("value={batch.sharedPrompt}");
  });
});
