import { Type, createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { runCreativeAgent } from "@/lib/creative-agent/runner";
import { createCreativeTools } from "@/lib/creative-agent/tools";
import { buildCreativeSystemPrompt } from "@/lib/creative-agent/skills";
import { creativeSkillHostPolicy, creativeSkillHostPolicyV2, creativeSkillIntegrationDirect } from "@/lib/creative-agent/skill-packages";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";
import type { Run } from "@/lib/creative-agent/store-types";

vi.mock("@/lib/creative-agent/media-broker", () => ({ waitForCreativeAgentMedia: vi.fn() }));
vi.mock("@/lib/creative-agent/llm-broker", () => ({ createCreativeAgentModelStream: vi.fn() }));
vi.mock("@/lib/role-skills/repository", () => ({
  assertRoleSkillRevision: vi.fn(),
  readRoleSkillDocument: vi.fn(async () => ({ id: "system:3", name: "workflow", revision: 1, source: "system", primaryPath: "SKILL.md", files: ["SKILL.md"], content: "完整技能正文：只按用户指定范围交付" })),
  getSystemRoleSkillForUser: vi.fn(async () => ({ id: "system:3", name: "workflow", revision: 1, source: "system", content: "完整技能正文：只按用户指定范围交付" })),
  listRoleSkillsForUser: vi.fn(), getPersonalRoleSkill: vi.fn(), RoleSkillRepositoryError: class extends Error {},
}));
const model: Model<Api> = { id: "offline", name: "Offline", provider: "local", api: "openai-completions", baseUrl: "http://not-used.invalid", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const run: Run = { id: "r", sessionId: "s", canvasId: 1, actorUserId: 1, epoch: 1, status: "running", error: null, updatedAt: new Date(1000).toISOString(), createdAt: new Date(1000).toISOString(), workerId: "test", leaseExpiresAt: null, input: { actorUserId: 1, canvasId: 1, messageId: "m", text: "只写正文", matchingPolicyVersion: 2, baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } } };

async function capture(mode: "plain" | "selected" | "read" | "list" | "failed" | "history", direct = true) {
  const document = { id: "system:3", revision: 1, content: "完整技能正文：只按用户指定范围交付" };
  const receipt = { kind: "skillOperator", state: mode === "failed" ? "failed" : "succeeded", result: mode === "list" ? { skills: [{ id: "system:3" }] } : document };
  const oldMessages = mode === "history" ? [{ role: "user", content: "旧任务", timestamp: 0 }, { role: "assistant", content: [{ type: "toolCall", id: "old", name: "skillOperator", arguments: { action: "read" } }], stopReason: "toolUse", timestamp: 1 }, { role: "toolResult", toolCallId: "old", toolName: "skillOperator", content: [{ type: "text", text: document.content }], isError: false, timestamp: 2 }] : [];
  const store = { assertFence: vi.fn(), getRun: vi.fn(async () => run), getRecoveryContext: vi.fn(async () => ""), getTranscript: vi.fn(async () => oldMessages), saveTranscript: vi.fn(), saveAssistant: vi.fn(), appendEvent: vi.fn(), waitForActions: vi.fn(), defer: vi.fn(), actionReceipts: vi.fn(async () => [receipt]), finish: vi.fn(), control: vi.fn() };
  const systems: string[] = [], users: string[] = [];
  const invokesTool = ["read", "list", "failed"].includes(mode);
  const current = { ...run, input: { ...run.input, ...(direct ? { mediaAuthorizationVersion: 1 as const } : {}), text: mode === "selected" ? "/skill:system:3\n只写正文" : run.input.text } };
  await runCreativeAgent(current, {
    store: store as unknown as CreativeAgentStore, model,
    tools: [{ name: "skillOperator", label: "skill", description: "skill", parameters: Type.Object({ action: Type.String() }), execute: async () => {
      if (mode === "failed") throw new Error("read denied");
      return { content: [{ type: "text" as const, text: mode === "list" ? "目录" : document.content }], details: { result: receipt.result } };
    } }],
    stream: (_model, context) => {
      systems.push(context.systemPrompt ?? ""); users.push(JSON.stringify(context.messages));
      const first = systems.length === 1 && invokesTool;
      const message: AssistantMessage = { role: "assistant", content: first ? [{ type: "toolCall", id: "read", name: "skillOperator", arguments: { action: mode === "list" ? "list" : "read" } }] : [{ type: "text", text: "正文" }], api: model.api, provider: model.provider, model: model.id, stopReason: first ? "toolUse" : "stop", timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: first ? "toolUse" : "stop", message }); });
      return stream;
    },
  });
  return { systems, users };
}

describe("server-versioned direct media prompt policy", () => {
  it("keeps autonomous read host policy consistent with selected skills and legacy reads", () => {
    expect(creativeSkillHostPolicy()).toBe(creativeSkillHostPolicyV2);
    expect(creativeSkillHostPolicy(1)).toContain("明确要求生成或修改媒体时直接执行");
    expect(creativeSkillHostPolicy(1)).not.toContain("进入实际生成仍须确认准确方案");
  });
  it("does not reintroduce a mandatory separate fact extraction call through loaded skills", () => {
    expect(creativeSkillIntegrationDirect).not.toContain("使用 generation_requirements 校验");
    expect(creativeSkillIntegrationDirect).toContain("内联 facts 校验用户原文或回答来源");
  });
  it("directs explicit generation to execution without a redundant confirmation card", async () => {
    const { systems } = await capture("plain");
    console.info("R13 direct no-skill system UTF-8 bytes", Buffer.byteLength(systems[0]));
    expect(systems[0]).toContain("用户本轮明确要求生成或修改媒体时，固定型号和智能匹配都直接执行，不再展示媒体确认卡");
    expect(systems[0]).toContain("仅准备方案、提示词、讨论或只选型号不授权生成");
    expect(systems[0]).toContain("MEDIA_AUTHORIZATION_REQUIRED");
    expect(systems[0]).toContain("多产物、多步或依赖任务用 generation_plan");
    expect(systems[0]).toContain("facts"); expect(systems[0]).toContain("plan:{actionId,stepId}");
    expect(systems[0]).toContain("不读取价格"); expect(systems[0]).toContain("未知执行结果不能再次提交");
    expect(systems[0]).not.toContain("准确方案等待原审批");
    expect(systems[0]).not.toContain("生成前仍保留方案确认");
  });
  it("describes complete batches and only current facts, retaining legacy approvals", () => {
    const tools = (direct: boolean) => createCreativeTools({ ...run, input: { ...run.input, ...(direct ? { mediaAuthorizationVersion: 1 as const } : {}) } }, {} as CreativeAgentStore, vi.fn());
    for (const name of ["image_generate", "video_generate"]) {
      const current = tools(true).find(tool => tool.name === name)!;
      expect(current.description).toContain("多产物或多步先用完整plan覆盖全部数量");
      expect(current.description).not.toMatch(/准确审批|批准后提交/);
      expect(tools(false).find(tool => tool.name === name)!.description).toContain("批准后提交");
      expect(JSON.stringify(current.parameters)).toContain("已保存偏好不用重复填facts");
    }
  });
  it("keeps legacy system bytes and media approval policy", async () => {
    const { systems } = await capture("plain", false);
    expect(Buffer.byteLength(systems[0])).toBe(9823);
    expect(systems[0]).toContain("准确方案等待原审批");
  });
  it("selects matching host policy without modifying the full skill body", async () => {
    const { systems, users } = await capture("selected");
    console.info("R13 direct selected system UTF-8 bytes", Buffer.byteLength(systems[0]));
    expect(systems[0]).toContain("本轮所选技能的系统执行边界");
    expect(systems[0]).not.toContain("消耗算力批准");
    expect(users[0]).toContain("完整技能正文：只按用户指定范围交付");
    expect(users[0]).toContain("明确要求生成或修改媒体时直接执行");
    for (const text of [systems[0], users[0]]) {
      expect(text).not.toContain("进入实际生成仍须确认准确方案");
      expect(text).not.toContain("均在实际生成前确认具体生成方案");
      expect(text).not.toContain("生成始终沿用原审批");
    }
  });
  it("adds direct host integration after successful autonomous read", async () => {
    const { systems } = await capture("read");
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain("本轮所选技能的系统执行边界");
    expect(systems[1]).not.toContain("生成始终沿用原审批");
    expect(systems[1]).not.toContain("均在实际生成前确认具体生成方案");
  });
  it("keeps selected legacy host and system policies intact", async () => {
    const { systems, users } = await capture("selected", false);
    expect(Buffer.byteLength(systems[0])).toBe(16217);
    expect(systems[0]).toContain("均在实际生成前确认具体生成方案");
    expect(users[0]).toContain("进入实际生成仍须确认准确方案");
  });
});
