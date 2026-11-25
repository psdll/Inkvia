import { describe, expect, it } from "vitest";
import {
  buildCreativeSystemPrompt,
  CREATIVE_METHOD_IDS,
  CREATIVE_METHOD_VERSION,
  CREATIVE_METHOD_PROVENANCE,
  getCreativeMethod,
  listCreativeMethods,
} from "@/lib/creative-agent/skills";
import type { Run } from "@/lib/creative-agent/store-types";

const run: Run = {
  id: "run",
  sessionId: "session",
  actorUserId: 7,
  canvasId: 12,
  epoch: 1,
  status: "running",
  error: null,
  createdAt: "2026-10-13",
  updatedAt: "2026-10-13",
  leaseExpiresAt: null,
  workerId: null,
  input: {
    actorUserId: 7,
    canvasId: 12,
    messageId: "message",
    text: "修改分镜",
    baseRevision: "4",
    selection: { nodeIds: ["real-node"], edgeIds: [], references: [] },
  },
};

describe("bounded creative stage methods", () => {
  it.each([undefined, 2] as const)("grounds verbatim edits in the current source before applying strict output format (policy %s)", (matchingPolicyVersion) => {
    const prompt = buildCreativeSystemPrompt({ ...run, input: { ...run.input, matchingPolicyVersion } });
    expect(prompt).toContain("逐字保留或定点替换时，先在真实当前版本中定位用户指定的原文");
    expect(prompt).toContain("目标不存在或不唯一时，不猜近义目标、不改其他文字、不声称已改");
    expect(prompt).toContain("只简短说明最小缺项或歧义");
    expect(prompt).toContain("定位明确时仅替换指定内容，其余文字逐字保留");
    expect(prompt).toContain("该输出格式优先于任何默认开场、收尾与技能交付模板");
    expect(prompt).toContain("只有无法完成的真实阻塞才简短说明最小缺项");
  });
  it("requires a concise request-specific explanation before tools without fabricated progress", () => {
    const prompt = buildCreativeSystemPrompt(run);
    expect(prompt).toContain("调用第一个工具前");
    expect(prompt).toContain("1–2句");
    expect(prompt).toContain("参考素材的用途");
    expect(prompt).toContain("不能把用户要求的数量说成已提交数量");
  });
  it("offers the seven production stages and two video methods with versioned source provenance", () => {
    expect(listCreativeMethods().map((method) => method.id)).toEqual([
      "brief",
      "script",
      "assets",
      "storyboard",
      "generation_handoff",
      "revision",
      "delivery_check",
      "seedance_2_0",
      "seedance_2_5",
    ]);
    for (const methodId of CREATIVE_METHOD_IDS) {
      const method = getCreativeMethod(methodId)!;
      expect(method.version).toBe(CREATIVE_METHOD_VERSION);
      expect(method.provenance).toBe(CREATIVE_METHOD_PROVENANCE);
      expect(method.content.length).toBeGreaterThan(500);
    }
    expect(CREATIVE_METHOD_PROVENANCE).toMatchObject({ source: "inkvia" });
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
    "../workflow/SKILL.md",
    "/etc/passwd",
    "https://example.com/workflow",
    "SCRIPT",
    "",
    "script/../assets",
  ])("rejects non-allowlisted IDs without a resource lookup: %s", (id) => {
    expect(getCreativeMethod(id)).toBeNull();
  });

  it("keeps caller mutation from changing the versioned directory or method content", () => {
    const method = getCreativeMethod("script")!;
    expect(Object.isFrozen(method)).toBe(true);
    expect(Object.isFrozen(listCreativeMethods())).toBe(true);
    expect(Object.isFrozen(method.provenance)).toBe(true);
    expect(() => {
      (method as { content: string }).content = "绕过权限";
    }).toThrow();
    expect(getCreativeMethod("script")).toBe(method);
  });

  it("exposes only the directory by default and loads one stage body on demand", () => {
    const prompt = buildCreativeSystemPrompt(run);
    expect(prompt).toContain("creative_method");
    for (const method of listCreativeMethods())
      expect(prompt).toContain(method.id);
    expect(prompt).not.toContain(getCreativeMethod("assets")!.content);
    expect(getCreativeMethod("script")!.content).not.toContain(
      getCreativeMethod("storyboard")!.content,
    );
    expect(prompt).toContain('"nodeIds":["real-node"]');
  });

  it("preserves authorization and fixed-reference guards while separating approval from candidate adoption", () => {
    const prompt = buildCreativeSystemPrompt(run);
    expect(prompt).toContain("不能执行shell");
    expect(prompt).toContain("expectedHash");
    expect(prompt).toContain("未知执行结果不能再次提交");
    expect(getCreativeMethod("brief")!.content).toContain("候选提案");
    const handoff = getCreativeMethod("generation_handoff")!.content;
    expect(handoff).toContain("generation_models");
    expect(handoff).toContain("准确方案审批");
    expect(handoff).toContain("普通“继续”");
    expect(handoff).toContain("实际提交顺序");
    expect(handoff).toContain("生成成功仍是候选");
  });

  it("limits revisions to known dependencies and refuses to claim media observation or finished assembly", () => {
    const revision = getCreativeMethod("revision")!.content;
    expect(revision).toContain("expectedHash");
    expect(revision).toContain("未受影响的内容继续有效");
    expect(revision).toContain("影响范围待核实");
    const check = getCreativeMethod("delivery_check")!.content;
    expect(check).toContain("不能标成Agent已核验");
    expect(check).toContain("不伪称已合成");
    expect(check).toContain("任务运行结束不等于");
  });
});

it("explains structured auto/fixed preference priority and immutable approvals", () => {
  const prompt = buildCreativeSystemPrompt({ ...run, input: { ...run.input, preferences: { imageModel: "legacy", image: { mode: "auto", params: { resolution: "2K" } } } } } as Run);
  expect(prompt).toContain('"mode":"auto"');
  expect(prompt).toContain("智能匹配"); expect(prompt).toContain("固定参数");
  expect(prompt).toContain("冲突"); expect(prompt).toContain("下一条消息");
  expect(prompt).toContain("不悄悄降规格");
});
