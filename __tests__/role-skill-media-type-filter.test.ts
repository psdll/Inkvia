import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterRoleSkillsByMediaType } from "@/hooks/use-role-skill-catalog";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

const base = {
  source: "system" as const,
  summary: "summary",
  category: "通用技能",
  coverUrl: null,
  usageScenario: "scenario",
  usageGuide: "guide",
  revision: 1,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

const skills: RoleSkillListItem[] = [
  { ...base, id: "system:1", name: "图片 Skill", mediaType: "image" },
  { ...base, id: "system:2", name: "视频 Skill", mediaType: "video" },
];

describe("role Skill media type filtering", () => {
  it("derives page catalogs from one account catalog", () => {
    expect(filterRoleSkillsByMediaType(skills, "image").map((item) => item.id))
      .toEqual(["system:1", "system:2"]);
    expect(filterRoleSkillsByMediaType(skills, "video").map((item) => item.id))
      .toEqual(["system:1", "system:2"]);
    expect(filterRoleSkillsByMediaType(skills)).toEqual(skills);
  });

  it("wires image editing to the image catalog", () => {
    const imageSource = readFileSync("app/image/image-tool.tsx", "utf8");
    expect(imageSource).toContain('mediaType: "image"');
    expect(imageSource).toContain('mediaType="image"');
  });

  it("makes the shared dialog page-type aware", () => {
    const dialog = readFileSync("components/role-skills/role-skill-dialog.tsx", "utf8");
    expect(dialog).toContain("mediaType?: RoleSkillMediaType");
    expect(dialog).toContain("mediaType: props.mediaType");
    expect(dialog).toContain("initialValue?.mediaType || props.mediaType");
    expect(dialog).not.toContain("saved.mediaType === props.mediaType");
    expect(dialog).toContain("props.onSelect(saved)");
  });
});
