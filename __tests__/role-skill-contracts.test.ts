import { describe, expect, it } from "vitest";
import {
  normalizeRoleSkillInput,
  normalizeRoleSkillMediaType,
  parseRoleSkillPublicId,
  toRoleSkillPublicId,
} from "@/lib/role-skills/contracts";

describe("role skill contracts", () => {
  it("round-trips source-prefixed public ids", () => {
    expect(parseRoleSkillPublicId(toRoleSkillPublicId("system", BigInt(12)))).toEqual({
      source: "system",
      id: BigInt(12),
    });
    expect(parseRoleSkillPublicId("personal:456")).toEqual({
      source: "personal",
      id: BigInt(456),
    });
  });

  it("rejects invalid, zero, and postgres-bigint-overflow ids", () => {
    for (const value of [
      "custom:1",
      "system:0",
      "personal:01",
      "personal:not-a-number",
      "system:9223372036854775808",
    ]) {
      expect(() => parseRoleSkillPublicId(value)).toThrow();
    }
  });

  it("normalizes every persisted field and accepts controlled covers", () => {
    expect(normalizeRoleSkillInput({
      name: "  商品精修  ",
      summary: "  电商产品图统一质感  ",
      category: "  商业广告  ",
      coverUrl: " /uploads/role_skill_covers/users/7/a.webp ",
      content: "  你是商品视觉专家  ",
      usageScenario: "  产品多角度图  ",
      usageGuide: "  上传参考图后生成  ",
    })).toEqual({
      name: "商品精修",
      summary: "电商产品图统一质感",
      category: "商业广告",
      coverUrl: "/uploads/role_skill_covers/users/7/a.webp",
      content: "你是商品视觉专家",
      usageScenario: "产品多角度图",
      usageGuide: "上传参考图后生成",
      workspace: {
        files: [{ path: "SKILL.md", content: "你是商品视觉专家" }],
        directories: [],
        primaryPath: "SKILL.md",
      },
    });
  });

  it("enforces field limits, required text, reserved categories, and cover roots", () => {
    const valid = {
      name: "商品精修",
      summary: "简介",
      category: "商业广告",
      coverUrl: null,
      content: "系统提示词",
      usageScenario: "商品图",
      usageGuide: "上传参考图",
    };
    expect(() => normalizeRoleSkillInput({ ...valid, name: "" })).toThrow();
    expect(() => normalizeRoleSkillInput({ ...valid, name: "n".repeat(65) })).toThrow();
    expect(() => normalizeRoleSkillInput({ ...valid, summary: "s".repeat(201) })).toThrow();
    expect(() => normalizeRoleSkillInput({ ...valid, category: "all" })).toThrow();
    expect(() => normalizeRoleSkillInput({ ...valid, content: "c".repeat(200_001) })).toThrow();
    expect(() => normalizeRoleSkillInput({ ...valid, coverUrl: "/uploads/other/a.png" })).toThrow();
  });

  it("defaults the required system Skill media type to image and rejects unknown values", () => {
    expect(normalizeRoleSkillMediaType(undefined)).toBe("image");
    expect(normalizeRoleSkillMediaType(null)).toBe("image");
    expect(normalizeRoleSkillMediaType("")).toBe("image");
    expect(normalizeRoleSkillMediaType("image")).toBe("image");
    expect(normalizeRoleSkillMediaType("video")).toBe("video");
    expect(normalizeRoleSkillMediaType("audio")).toBe("audio");
    expect(normalizeRoleSkillMediaType("text")).toBe("text");
    expect(() => normalizeRoleSkillMediaType("document")).toThrow("技能类型无效");
  });
});
