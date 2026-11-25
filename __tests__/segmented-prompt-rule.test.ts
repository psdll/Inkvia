import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as null | { key: string; value: string; updatedAt: Date },
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import {
  DEFAULT_SEGMENTED_PROMPT_RULE_TEXT,
  SegmentedPromptRuleError,
  appendSegmentedPromptRule,
  getSegmentedPromptRule,
  resetSegmentedPromptRule,
  resolveSegmentedPromptSystemPrompt,
  saveSegmentedPromptRule,
} from "@/lib/image-batch/segmented-prompt-rule";

describe("global segmented prompt rule", () => {
  beforeEach(() => {
    mocks.row = null;
    vi.clearAllMocks();
    mocks.findUnique.mockImplementation(async () => mocks.row);
    mocks.upsert.mockImplementation(async ({ create, update }: any) => {
      mocks.row = {
        key: create.key,
        value: mocks.row ? update.value : create.value,
        updatedAt: new Date("2026-08-06T09:00:00.000Z"),
      };
      return mocks.row;
    });
    mocks.deleteMany.mockImplementation(async () => {
      const count = mocks.row ? 1 : 0;
      mocks.row = null;
      return { count };
    });
  });

  it("uses a title-optional default when no global override exists", async () => {
    const config = await getSegmentedPromptRule();

    expect(config).toMatchObject({
      revision: 1,
      source: "default",
      ruleText: DEFAULT_SEGMENTED_PROMPT_RULE_TEXT,
    });
    expect(config.ruleText).toContain("标题可选");
    expect(config.ruleText).toContain("【标题】");
    expect(config.ruleText).toContain("[标题]");
    expect(config.ruleText).toContain("每个非空行");
  });

  it("persists one global rule and increments its revision", async () => {
    const saved = await saveSegmentedPromptRule({
      ruleText: "没有标题时，每个非空行作为一个分段。",
      expectedRevision: 1,
    });

    expect(saved).toMatchObject({
      revision: 2,
      source: "custom",
      ruleText: "没有标题时，每个非空行作为一个分段。",
    });
    await expect(getSegmentedPromptRule()).resolves.toMatchObject(saved);
  });

  it("rejects empty, oversized, and stale writes", async () => {
    await expect(saveSegmentedPromptRule({
      ruleText: "   ",
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: "RULE_EMPTY" } satisfies Partial<SegmentedPromptRuleError>);

    await expect(saveSegmentedPromptRule({
      ruleText: "x".repeat(10_001),
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: "RULE_TOO_LONG" } satisfies Partial<SegmentedPromptRuleError>);

    await saveSegmentedPromptRule({ ruleText: "规则 A", expectedRevision: 1 });
    await expect(saveSegmentedPromptRule({
      ruleText: "规则 B",
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: "RULE_REVISION_CONFLICT" } satisfies Partial<SegmentedPromptRuleError>);
  });

  it("resets a custom rule back to the system default", async () => {
    await saveSegmentedPromptRule({ ruleText: "规则 A", expectedRevision: 1 });

    const reset = await resetSegmentedPromptRule({ expectedRevision: 2 });

    expect(reset).toMatchObject({
      revision: 1,
      source: "default",
      ruleText: DEFAULT_SEGMENTED_PROMPT_RULE_TEXT,
    });
  });

  it("appends the rule as a higher-priority custom-batch output contract", () => {
    const prompt = appendSegmentedPromptRule("原技能内容", "每个非空行作为一个分段");

    expect(prompt).toContain("原技能内容");
    expect(prompt).toContain("全局分段输出规则（优先于技能内冲突的输出格式）");
    expect(prompt).toContain("每个非空行作为一个分段");
    expect(prompt).toContain("标题可选");
    expect(prompt).toContain("最多 50 个");
  });

  it("applies the global rule only to the custom-batch prompt surface", async () => {
    await saveSegmentedPromptRule({
      ruleText: "没有标题时逐行分段",
      expectedRevision: 1,
    });

    await expect(resolveSegmentedPromptSystemPrompt({
      surface: "batch_workbench",
      systemPrompt: "技能内容",
    })).resolves.toContain("没有标题时逐行分段");
    await expect(resolveSegmentedPromptSystemPrompt({
      surface: "toolbox_image",
      systemPrompt: "技能内容",
    })).resolves.toBe("技能内容");
  });
});
