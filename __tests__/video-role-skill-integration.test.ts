import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/video/video-tool.tsx", "utf8");

describe("video tool role Skill integration", () => {
  it("uses the video catalog and isolated ephemeral draft", () => {
    expect(source).toContain('surface: "toolbox_video"');
    expect(source).toContain("persistSelectedRoleSkillId: false");
    expect(source).toContain('mediaType: "video"');
    expect(source).toContain('mediaType="video"');
  });

  it("connects the shared trigger, slash menu, inline selection, and dialog", () => {
    expect(source).toContain("<RoleSkillTrigger");
    expect(source).toContain("<RoleSkillDialog");
    expect(source).toContain("roleSkills={roleSkills}");
    expect(source).toContain("onRoleSkillSelect={selectToolboxRoleSkill}");
    expect(source).toContain("selectedRoleSkill={toolboxRoleSkill}");
    expect(source).toContain("onRoleSkillRemove={clearToolboxRoleSkillSelection}");
    expect(source).toContain("setSystemPromptOpen(false)");
  });

  it("runs manual Skill generation on the video surface without an apply action", () => {
    const handler = source.slice(
      source.indexOf("const handlePromptReverse"),
      source.indexOf("const renderUploadSection"),
    );
    expect(handler).toContain("roleSkillId: selectedRoleSkillId");
    expect(handler).toContain('surface: "toolbox_video"');
    expect(handler).toContain("userPrompt: promptRequest.modelPrompt");
    expect(source).toContain("showApplyResult={false}");
    expect(source).toContain("onApplyResult={() => undefined}");
  });

  it("enhances before submitting video without replacing the visible prompt", () => {
    const handler = source.slice(
      source.indexOf("const handleGenerate"),
      source.indexOf("const clampPromptPanelRect"),
    );
    const start = handler.indexOf("startToolboxRoleSkillPrompt");
    const persist = handler.indexOf("activeReverseTaskId: startedTask.id");
    const wait = handler.indexOf("waitForToolboxRoleSkillPrompt");
    const submit = handler.indexOf('fetch("/api/video-gen"');
    expect(start).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(start);
    expect(wait).toBeGreaterThan(persist);
    expect(submit).toBeGreaterThan(wait);
    expect(handler).toContain("generationPrompt = generatedPrompt");
    expect(handler).not.toContain("setPrompt(generatedPrompt)");
    expect(handler).toContain('form.set("prompt", generationPrompt)');
    expect(handler).toContain('form.set("userPrompt", skillUserPrompt)');
  });

  it("keeps the original path without a Skill and resumes with one request key", () => {
    expect(source).toContain("let generationPrompt = prompt");
    expect(source).toContain("if (selectedRoleSkillId)");
    expect(source).toContain('kind: "toolbox_video_generation"');
    expect(source).toContain("resumeToolboxVideoContinuation");
    expect(source).toContain("continuation.requestKey");
    expect(source).toContain("resumedToolboxContinuationRef.current");
  });

  it("shows the word count only in the expanded prompt panel", () => {
    expect(source.match(/\{prompt\.length\}字/g)).toHaveLength(1);
    const expandedPanel = source.slice(
      source.indexOf("const expandedPromptPanel"),
      source.indexOf("const activeReverseTask"),
    );
    expect(expandedPanel).toContain("{prompt.length}字");
  });
});
