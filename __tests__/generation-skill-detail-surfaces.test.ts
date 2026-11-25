import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation Skill detail surfaces", () => {
  it("shows the shared Skill detail entry in the works detail modal", () => {
    const source = readFileSync("components/works/work-detail-modal.tsx", "utf8");

    expect(source).toContain('import { getGenerationSkillDetailEntry } from "@/lib/generation/skill-metadata"');
    expect(source).toContain("const skillDetail = getGenerationSkillDetailEntry(p)");
    expect(source).toContain("if (skillDetail) bp(skillDetail.label, skillDetail.value)");
  });

  it("keeps Skill in task details without exposing it or internal task types in the result summary", () => {
    const source = readFileSync("components/history/unified-history-panel.tsx", "utf8");

    expect(source).toContain('import { getGenerationSkillDetailEntry } from "@/lib/generation/skill-metadata"');
    expect(source.match(/getGenerationSkillDetailEntry\(params\)/g)).toHaveLength(1);
    const summary = source.slice(source.indexOf("function buildMetaSummary("), source.indexOf("\nfunction ", source.indexOf("function buildMetaSummary(") + 1));
    expect(summary).not.toContain("skillText");
    expect(summary).not.toContain('"taskType"');
    expect(source).toContain("...(skillDetail ? [skillDetail] : [])");
  });
});
