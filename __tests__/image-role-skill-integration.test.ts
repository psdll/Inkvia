import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app/image/image-tool.tsx"),
  "utf8",
);
const promptEditorSource = fs.readFileSync(
  path.join(process.cwd(), "components/ui/prompt-rich-editor.tsx"),
  "utf8",
);

describe("image tool role skill integration", () => {
  it("replaces the old role textarea modal with the shared skill dialog", () => {
    expect(source).toContain('dynamic(() => import("@/components/role-skills/role-skill-dialog")');
    expect(source).toContain("<RoleSkillDialog");
    expect(source).toContain("<RoleSkillTrigger");
    expect(source).toContain("legacySystemPrompt={systemPrompt}");
  });

  it("sends only the selected skill id while preserving the existing request context", () => {
    const handler = source.slice(
      source.indexOf("const handlePromptReverse"),
      source.indexOf("const historyActions"),
    );
    expect(handler).toContain("roleSkillId: selectedRoleSkillId");
    expect(handler).not.toContain("systemPrompt:");
    expect(handler).toContain("async: true");
    expect(handler).toContain('surface: "toolbox_image"');
    expect(handler).toContain("userPrompt: promptRequest.modelPrompt");
    expect(handler).toContain("mediaUrls");
    expect(handler).toContain("await saveRoleDraftNow({");
    expect(handler).toContain("activeReverseTaskId: task.id");
  });

  it("keeps the generated Skill result in the Skill panel without exposing an apply-to-prompt action", () => {
    expect(source).toContain("setReversePrompt(activeTask.generatedPrompt)");
    expect(source).toContain("setResultRoleSkill(activeTask.skill || null)");
    expect(source).toContain("value={reversePrompt}");
    expect(source).toContain("showApplyResult={false}");
    expect(source).toContain("onApplyResult={() => undefined}");
    expect(source).not.toContain("const applyReversePrompt");
  });

  it("keeps the selected Skill only for the current toolbox page session", () => {
    expect(source).toContain("persistSelectedRoleSkillId: false");
    expect(source).toContain(
      "const [toolboxRoleSkill, setToolboxRoleSkill] = React.useState<RoleSkillListItem | null>(null)",
    );
    expect(source).toContain("selectedRoleSkillId,");
    expect(source).toContain("listRoleSkills()");
    expect(source).toContain("selectedRoleSkillId: null");
    expect(source).not.toContain("persistSelectedRoleSkillId: true");
    expect(source).not.toContain("if (!isActive) clearToolboxRoleSkillSelection()");
    expect(source).not.toContain('window.addEventListener("pagehide", clearToolboxRoleSkillSelection)');
  });

  it("shows the selected Skill as a removable inline reference inside the toolbox prompt", () => {
    expect(source).toContain("selectedRoleSkill={toolboxRoleSkill}");
    expect(source).toContain("onRoleSkillRemove={clearToolboxRoleSkillSelection}");
    expect(source).not.toContain("leadingToken={toolboxRoleSkill ? (");
    expect(source).not.toContain('data-toolbox-role-skill-token=""');
    expect(source).toContain("setToolboxRoleSkill(skill)");
  });

  it("places the Skill in the same editable inline flow as asset references", () => {
    const skillView = promptEditorSource.slice(
      promptEditorSource.indexOf("function RoleSkillMentionView"),
      promptEditorSource.indexOf("function createRoleSkillMentionExtension"),
    );
    expect(promptEditorSource).toContain('data-role-skill-mention=""');
    expect(promptEditorSource).toContain("ROLE_SKILL_MENTION_NODE_NAME");
    expect(promptEditorSource).toContain("deleteAdjacentInlineReference");
    expect(promptEditorSource).toContain("promptTextToEditorDoc(value, stableAssets, selectedRoleSkill, inlinePresets)");
    expect(skillView).not.toContain("<button");
    expect(skillView).not.toContain("<X");
    expect(skillView).toContain("roleSkillTagClassName");
    const tag = fs.readFileSync("components/role-skills/role-skill-tag.tsx", "utf8");
    expect(tag).toContain("text-[var(--primary-bg)]");
    expect(skillView).toContain('aria-hidden="true"');
    expect(skillView).toContain("h-[1.15em] w-0");
    expect(tag).toContain("max-w-full");
    expect(tag).toContain("whitespace-normal");
    expect(skillView).not.toContain('className="truncate"');
    expect(promptEditorSource).toContain('"max-w-[112px] gap-0.5"');
    expect(promptEditorSource).not.toContain("max-w-[180px]");
    expect(tag).toContain("min-h-[calc(1.15em+4px)]");
  });

  it("closes the Skill panel immediately after selecting a Skill", () => {
    const selectionHandler = source.slice(
      source.indexOf("onSelect={(skill: RoleSkillListItem) =>"),
      source.indexOf("onGenerate={() => void handlePromptReverse()}")
    );
    expect(selectionHandler).toContain("selectToolboxRoleSkill(skill)");
    expect(source).toContain("setToolboxRoleSkill(skill)");
    expect(selectionHandler).toContain("setSystemPromptOpen(false)");
  });

  it("uses the selected Skill result internally without replacing the user prompt", () => {
    const handler = source.slice(
      source.indexOf("const handleGenerate"),
      source.indexOf("const handleGenerateRef"),
    );
    const skillStart = handler.indexOf("startToolboxImageRoleSkillPrompt");
    const skillWait = handler.indexOf("waitForToolboxImageRoleSkillPrompt");
    const resultDisplay = handler.indexOf("setReversePrompt(generatedPrompt)");
    const imageRequest = handler.indexOf('fetch("/api/image-edit"');

    expect(skillStart).toBeGreaterThan(-1);
    expect(skillWait).toBeGreaterThan(skillStart);
    expect(resultDisplay).toBeGreaterThan(skillWait);
    expect(imageRequest).toBeGreaterThan(resultDisplay);
    expect(handler).toContain("generationPrompt = generatedPrompt");
    expect(handler).not.toContain("setPrompt(generatedPrompt)");
    expect(handler).toContain('form.set("prompt", generationPrompt)');
    expect(handler).toContain("userPrompt: skillPromptRequest.displayPrompt");
    expect(handler).toContain('form.set("userPrompt", skillUserPrompt)');
  });

  it("persists the running Skill task before waiting so it can resume after route changes", () => {
    const handler = source.slice(
      source.indexOf("const handleGenerate"),
      source.indexOf("const handleGenerateRef"),
    );
    const skillStart = handler.indexOf("startToolboxImageRoleSkillPrompt");
    const taskPersist = handler.indexOf("activeReverseTaskId: startedTask.id");
    const skillWait = handler.indexOf("waitForToolboxImageRoleSkillPrompt");

    expect(taskPersist).toBeGreaterThan(skillStart);
    expect(skillWait).toBeGreaterThan(taskPersist);
    expect(source).toContain("effectiveSubmissionPhase");
    expect(source).toContain('submissionPhase === "idle" && (reverseLoading || hasRunningReverseTask)');
    expect(source).toContain("phase: effectiveSubmissionPhase");
  });

  it("resumes the persisted Skill continuation into the final image request after remount", () => {
    expect(source).toContain('kind: "toolbox_image_generation"');
    expect(source).toContain("resumeToolboxImageContinuation");
    expect(source).toContain("continuation.requestKey");
    expect(source).toContain("activeTask.status === \"success\"");
    expect(source).toContain("activeReverseTaskId: null");
    expect(source).toContain("continuation: null");
  });

  it("keeps the original generation path when no Skill is selected", () => {
    const handler = source.slice(
      source.indexOf("const handleGenerate"),
      source.indexOf("const handleGenerateRef"),
    );

    expect(handler).toContain("let generationPrompt = prompt");
    expect(handler).toContain("if (selectedRoleSkillId)");
    expect(handler).toContain('form.set("prompt", generationPrompt)');
  });

  it("keeps the Skill entry visible without the legacy visibility endpoint", () => {
    expect(source).toContain("<RoleSkillTrigger");
    expect(source).not.toContain("rolePositioningVisible");
    expect(source).not.toContain('/api/role-positioning/status');
  });

  it("clears the current Skill before applying a regenerated image task", () => {
    const applyTemplate = source.slice(
      source.indexOf("const applyStoredImageTemplate"),
      source.indexOf("React.useEffect(() => {", source.indexOf("const applyStoredImageTemplate")),
    );

    expect(applyTemplate).toContain("clearToolboxRoleSkillSelection();");
  });
});
