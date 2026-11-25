import { describe, expect, it } from "vitest";
import {
  getGenerationSkillDetailEntry,
  normalizeGenerationSkillSnapshot,
} from "@/lib/generation/skill-metadata";

describe("generation skill metadata", () => {
  it("normalizes a canonical Skill snapshot for generation persistence", () => {
    expect(normalizeGenerationSkillSnapshot(JSON.stringify({
      id: "system:12",
      name: " 商品精修 ",
      revision: 3,
    }))).toEqual({
      id: "system:12",
      name: "商品精修",
      revision: 3,
    });
    expect(normalizeGenerationSkillSnapshot({ id: "system:12" })).toBeNull();
  });

  it("builds one shared detail entry and stays empty for tasks without a Skill", () => {
    expect(getGenerationSkillDetailEntry({
      skill: { id: "personal:8", name: "人物写真", revision: 2 },
    })).toEqual({ label: "使用技能", value: "人物写真" });
    expect(getGenerationSkillDetailEntry({ skillName: "旧版商品棚拍" })).toEqual({
      label: "使用技能",
      value: "旧版商品棚拍",
    });
    expect(getGenerationSkillDetailEntry({ model: "doubao-seedream" })).toBeNull();
    expect(getGenerationSkillDetailEntry(null)).toBeNull();
  });
});
