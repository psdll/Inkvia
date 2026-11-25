import { Type, createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { runCreativeAgent } from "@/lib/creative-agent/runner";
import { buildCreativeSystemPrompt } from "@/lib/creative-agent/skills";
import { creativeSkillIntegrationV2 } from "@/lib/creative-agent/skill-packages";
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

async function capture(mode: "plain" | "selected" | "read" | "list" | "failed" | "history") {
  const document = { id: "system:3", revision: 1, content: "完整技能正文：只按用户指定范围交付" };
  const receipt = { kind: "skillOperator", state: mode === "failed" ? "failed" : "succeeded", result: mode === "list" ? { skills: [{ id: "system:3" }] } : document };
  const oldMessages = mode === "history" ? [{ role: "user", content: "旧任务", timestamp: 0 }, { role: "assistant", content: [{ type: "toolCall", id: "old", name: "skillOperator", arguments: { action: "read" } }], stopReason: "toolUse", timestamp: 1 }, { role: "toolResult", toolCallId: "old", toolName: "skillOperator", content: [{ type: "text", text: document.content }], isError: false, timestamp: 2 }] : [];
  const store = { assertFence: vi.fn(), getRun: vi.fn(async () => run), getRecoveryContext: vi.fn(async () => ""), getTranscript: vi.fn(async () => oldMessages), saveTranscript: vi.fn(), saveAssistant: vi.fn(), appendEvent: vi.fn(), waitForActions: vi.fn(), defer: vi.fn(), actionReceipts: vi.fn(async () => [receipt]), finish: vi.fn(), control: vi.fn() };
  const systems: string[] = [], users: string[] = [];
  const invokesTool = ["read", "list", "failed"].includes(mode);
  const current = { ...run, input: { ...run.input, text: mode === "selected" ? "/skill:system:3\n只写正文" : run.input.text } };
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

describe("current-run skill prompt profile", () => {
  it("keeps discovery and safety boundaries without unused integration or stage directory", async () => {
    const { systems } = await capture("plain");
    console.info("R11 no-skill system UTF-8 bytes", Buffer.byteLength(systems[0]));
    expect(systems[0]).not.toContain(creativeSkillIntegrationV2);
    expect(systems[0]).not.toContain("补充阶段方法目录");
    expect(systems[0]).not.toContain("A11只做");
    for (const rule of ["skillOperator", "creative_method", "revision", "files", "不能执行shell", "expectedHash", "未知执行结果不能再次提交", "该输出格式优先于任何默认开场", "技能已选、已读取、已应用是不同事实"]) expect(systems[0]).toContain(rule);
  });
  it("directs independent single-step generation to inline facts and existing plans to exact references", () => {
    const prompt = buildCreativeSystemPrompt(run);
    for (const rule of ["独立单步", "facts", "continuation", "无需先调用 generation_requirements 或 generation_plan", "actionId", "stepId", "多步或依赖", "不读取价格", "准确方案等待原审批"]) expect(prompt).toContain(rule);
  });
  it("keeps explicit requirements after validation failure and reports the actual confirmation", () => {
    const prompt = buildCreativeSystemPrompt(run);
    expect(prompt).toContain("需求校验失败时按错误修正来源或字段，不能省略用户明确要求后重试");
    expect(prompt).toContain("向用户描述的型号、参数和数量须与工具返回的准确方案一致");
  });
  it("retains full selected skill and host policies", async () => {
    const { systems, users } = await capture("selected");
    console.info("R11 selected system UTF-8 bytes", Buffer.byteLength(systems[0]));
    expect(systems[0]).toContain(creativeSkillIntegrationV2);
    expect(systems[0]).toContain("本轮所选技能的系统执行边界");
    expect(users[0]).toContain("完整技能正文：只按用户指定范围交付");
    expect(users[0]).toContain("当前宿主执行约束");
  });
  it("adds complete integration only after the current authorized read succeeds", async () => {
    const { systems, users } = await capture("read");
    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain(creativeSkillIntegrationV2);
    expect(systems[1]).toContain(creativeSkillIntegrationV2);
    expect(systems[1]).toContain("本轮所选技能的系统执行边界");
    expect(users[1]).toContain("完整技能正文：只按用户指定范围交付");
  });
  it.each(["list", "failed", "history"] as const)("does not promote %s into an applied skill", async mode => {
    const { systems } = await capture(mode);
    for (const system of systems) {
      expect(system).not.toContain(creativeSkillIntegrationV2);
      expect(system).not.toContain("本轮所选技能的系统执行边界");
    }
  });
});
