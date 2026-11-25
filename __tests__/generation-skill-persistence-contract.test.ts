import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("generation Skill persistence contract", () => {
  it("carries the completed Skill snapshot through image submissions", () => {
    const tool = source("app/image/image-tool.tsx");
    const service = source("lib/generation/image-service.ts");

    expect(tool).toContain('form.set("skill", JSON.stringify(generationSkill))');
    expect(service).toContain('skill: normalizeGenerationSkillSnapshot(formData.get("skill")) || undefined');
    expect(service).toContain("...generationSkillMetadata(input.skill)");
  });

  it("carries the completed Skill snapshot through every video provider path", () => {
    const tool = source("app/video/video-tool.tsx");
    const route = source("app/api/video-gen/route.ts");
    const service = source("lib/generation/video-service.ts");

    expect(tool).toContain('form.set("skill", JSON.stringify(generationSkill))');
    expect(route).toContain('skill: normalizeGenerationSkillSnapshot(formData.get("skill")) || undefined');
    expect(service).not.toContain("userPromptSnapshot(");
    expect(service.match(/\.\.\.generationContextSnapshot\(input\)/g)).toHaveLength(6);
  });

  it("keeps the Skill snapshot when creating a detached segmented-prompt batch", () => {
    const page = source("components/batch-workbench/batch-workbench-page.tsx");
    const route = source("app/api/image-batches/[batchId]/groups/route.ts");
    const service = source("lib/image-batch/service.ts");

    expect(page).toContain("const { generatedPrompt, skill } = await rolePositioning.generatePrompt");
    expect(page).toContain("createSegmentedPromptGroup(continuation, generatedPrompt, skill)");
    expect(route).toContain("skill: body?.skill");
    expect(service).toContain("...generationSkillMetadata(input.skill)");
  });
});
