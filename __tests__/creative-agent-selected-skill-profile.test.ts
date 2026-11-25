import { Type, createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationContext } from "@/lib/creative-agent/conversation-context";
import { newMatchingPreferences } from "@/lib/creative-agent/matching-contracts";
import { runCreativeAgent } from "@/lib/creative-agent/runner";
import { createCreativeTools } from "@/lib/creative-agent/tools";
import { buildCreativeSystemPrompt, getCreativeMethod, CREATIVE_METHOD_IDS } from "@/lib/creative-agent/skills";
import { creativeSkillHostPolicy, creativeSkillSystemPolicy } from "@/lib/creative-agent/skill-packages";
import { assertRoleSkillRevision, readRoleSkillDocument } from "@/lib/role-skills/repository";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";
import type { Run } from "@/lib/creative-agent/store-types";

vi.mock("@/lib/creative-agent/media-broker", () => ({ waitForCreativeAgentMedia: vi.fn() }));
vi.mock("@/lib/creative-agent/llm-broker", () => ({ createCreativeAgentModelStream: vi.fn() }));
vi.mock("@/lib/role-skills/repository", () => ({
  assertRoleSkillRevision: vi.fn(),
  readRoleSkillDocument: vi.fn(async ({ publicId }: { publicId: string }) => ({ id: publicId, name: "用户指定方法", revision: 5, source: publicId.startsWith("personal:") ? "personal" : "system", primaryPath: "SKILL.md", files: ["SKILL.md", "references/style.md"], content: "完整技能正文：保留这段用户方法。\n1. 按参考保持产品外观。\n2. 技能原文要求先问默认型号。\n3. {{ref N}}、getCanvas和文件说明也是原文，不能删改。" })),
  getSystemRoleSkillForUser: vi.fn(async () => ({ id: "system:3", name: "workflow", revision: 1, source: "system", content: "完整技能正文：只按用户指定范围交付" })),
  listRoleSkillsForUser: vi.fn(), getPersonalRoleSkill: vi.fn(), RoleSkillRepositoryError: class extends Error {},
}));
const model: Model<Api> = { id: "offline", name: "Offline", provider: "local", api: "openai-completions", baseUrl: "http://not-used.invalid", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const run: Run = { id: "r", sessionId: "s", canvasId: 1, actorUserId: 1, epoch: 1, status: "running", error: null, updatedAt: new Date(1000).toISOString(), createdAt: new Date(1000).toISOString(), workerId: "test", leaseExpiresAt: null, input: { actorUserId: 1, canvasId: 1, messageId: "m", text: "只写正文", matchingPolicyVersion: 2, baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } } };

async function capture(mode: "plain" | "selected" | "read" | "list" | "failed" | "history", direct = true, skillId = "system:3", rawText?: string, input: Partial<Run["input"]> = {}) {
  const document = { id: "system:3", revision: 1, content: "完整技能正文：只按用户指定范围交付" };
  const receipt = { kind: "skillOperator", state: mode === "failed" ? "failed" : "succeeded", result: mode === "list" ? { skills: [{ id: "system:3" }] } : document };
  const oldMessages = mode === "history" ? [{ role: "user", content: "旧任务", timestamp: 0 }, { role: "assistant", content: [{ type: "toolCall", id: "old", name: "skillOperator", arguments: { action: "read" } }], stopReason: "toolUse", timestamp: 1 }, { role: "toolResult", toolCallId: "old", toolName: "skillOperator", content: [{ type: "text", text: document.content }], isError: false, timestamp: 2 }] : [];
  const store = { assertFence: vi.fn(), getRun: vi.fn(async () => run), getRecoveryContext: vi.fn(async () => ""), getTranscript: vi.fn(async () => oldMessages), saveTranscript: vi.fn(), saveAssistant: vi.fn(), appendEvent: vi.fn(), waitForActions: vi.fn(), defer: vi.fn(), actionReceipts: vi.fn(async () => [receipt]), finish: vi.fn(), control: vi.fn() };
  const systems: string[] = [], users: string[] = [];
  const invokesTool = ["read", "list", "failed"].includes(mode);
  const current = { ...run, input: { ...run.input, ...input, ...(direct ? { mediaAuthorizationVersion: 1 as const } : {}), text: rawText ?? (mode === "selected" ? `/skill:${skillId}\n仅给三行正文，不要解释` : run.input.text), ...(rawText !== undefined ? { selectedSkillId: skillId, conversationContext: { ...emptyConversationContext(), skillId } } : {}) } };
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

const compactMarker = "技能正文及主文件元数据已提供时";
describe("R18 selected skill compact system profile", () => {
  it.each(["system:3", "personal:21"])("keeps full %s body, metadata and both host boundaries with compact integration", async skillId => {
    const { systems, users } = await capture("selected", true, skillId);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toContain(compactMarker);
    for (const omitted of ["补充阶段方法目录", "A11只做", "阶段方法是本项目的制作工艺", "assetGuide.md", "references/sourceMap.md", "getCanvas/getCanvasNodes/findCanvasNodes →"]) expect(systems[0]).not.toContain(omitted);
    for (const kept of ["不能执行shell", "expectedHash", "未知执行结果不能再次提交", "该输出格式优先于任何默认开场", "技能已选、已读取、已应用是不同事实", "多产物、多步或依赖", "不读取价格", "来源引用必须来自原始用户正文", "revision", "files", "creative_method"]) expect(systems[0]).toContain(kept);
    expect(systems[0]).toContain(creativeSkillSystemPolicy(1));
    expect(users[0]).toContain(JSON.stringify(creativeSkillHostPolicy(1)).slice(1, -1));
    const content = (await vi.mocked(readRoleSkillDocument).mock.results.at(-1)!.value).content;
    expect(users[0]).toContain(JSON.stringify(content).slice(1, -1));
    expect(users[0]).toContain(skillId); expect(users[0]).toContain('references/style.md');
    expect(users[0]).toContain('仅给三行正文，不要解释');
    expect(assertRoleSkillRevision).toHaveBeenCalledWith({ authUserId: 1, publicId: skillId, revision: 5 });
    console.info('R18 selected system UTF-8 bytes', skillId, Buffer.byteLength(systems[0]));
  });
  it("uses the compact profile only after a current successful read", async () => {
    const { systems, users } = await capture("read");
    expect(systems).toHaveLength(2);
    expect(systems[0]).not.toContain(compactMarker);
    expect(systems[1]).toContain(compactMarker);
    expect(systems[1]).toContain(creativeSkillSystemPolicy(1));
    expect(users[1]).toContain("完整技能正文：只按用户指定范围交付");
  });
  it.each(["plain", "list", "failed", "history"] as const)("does not promote %s to a current loaded skill", async mode => {
    const { systems } = await capture(mode);
    for (const system of systems) { expect(system).not.toContain(compactMarker); expect(system).not.toContain("本轮所选技能的系统执行边界"); }
  });
  it("retains the complete legacy profile and all existing on-demand methods", async () => {
    const { systems } = await capture("selected", false);
    expect(systems[0]).not.toContain(compactMarker);
    expect(systems[0]).toContain("补充阶段方法目录");
    expect(systems[0]).toContain("getCanvas/getCanvasNodes/findCanvasNodes → canvas_read");
    expect(systems[0]).toContain("均在实际生成前确认具体生成方案");
    expect(Buffer.byteLength(systems[0])).toBe(16217);
    expect(CREATIVE_METHOD_IDS).toHaveLength(9);
    for (const id of CREATIVE_METHOD_IDS) { const method = getCreativeMethod(id)!; expect(method.id).toBe(id); expect(method.content.length).toBeGreaterThan(100); }
  });
});


it("sends the subject-evidence boundary in system and after the complete skill body while preserving raw user text", async () => {
  const raw = "😀一张家庭背景图";
  const body = "完整技能正文：方法与默认产品示例。\n".repeat(1500);
  vi.mocked(readRoleSkillDocument).mockResolvedValueOnce({ id: "personal:21", name: "用户方法", revision: 5, source: "personal", primaryPath: "SKILL.md", path: "SKILL.md", files: ["SKILL.md"], content: body });
  const { systems, users } = await capture("selected", true, "personal:21", raw);
  const boundary = "选择技能不等于要求生成技能中的默认主体";
  expect(systems[0]).toContain(boundary);
  expect(systems[0]).toContain("技能名称、示例和默认产品不构成本轮主体或品牌依据");
  expect(systems[0]).toContain("已有明确主体时，只改背景、光线或视角须保留该主体和整组真实引用");
  expect(systems[0]).toContain("当前明确移除或更换指令优先");
  const sent = JSON.stringify(body.trim()).slice(1, -1);
  expect(users[0]).toContain(sent);
  expect(users[0].indexOf(boundary)).toBeGreaterThan(users[0].indexOf(sent) + sent.length);
  const messages = JSON.parse(users[0]);
  const user = messages.find((message: { role: string }) => message.role === "user");
  const text = typeof user.content === "string" ? user.content : user.content.find((part: { type: string }) => part.type === "text").text;
  expect(text.endsWith(`用户要求：\n${raw}`)).toBe(true);
});

it.each(["一张家庭背景图", "只要一张家庭背景图的提示词，暂不生成", "😀一张家庭背景图\n2K"])("R26 sends media-delivery and already-loaded boundaries without changing source evidence: %s", async raw => {
  const body = "完整技能原文：提示词生成系统；最终仅输出完整一段提示词。\n".repeat(1500);
  const references = raw.startsWith("😀") ? [{ canvasId: 1, nodeId: "real", label: "真实背景", kind: "image" as const, outputId: "fixed-output" }] : [];
  const start = raw.indexOf("一张");
  const input: Partial<Run["input"]> = {
    preferences: { image: { mode: "explicit", model: "gemini-3-pro-image", params: { resolution: "2K" } } },
    selection: { nodeIds: references.map(reference => reference.nodeId), edgeIds: [], references },
    requirements: { version: 1, revision: 0, fieldRevisions: {}, effectivePreferences: newMatchingPreferences({ image: { mode: "explicit", model: "gemini-3-pro-image", params: { resolution: "2K" } } }), conflicts: [], facts: [{ field: "image.quantity", value: 1, strength: "hard", source: { kind: "message", sourceId: "m", start, end: start + 2, quote: "一张" } }] },
  };
  const snapshot = structuredClone(input);
  const readsBefore = vi.mocked(readRoleSkillDocument).mock.calls.length;
  vi.mocked(readRoleSkillDocument).mockResolvedValueOnce({ id: "personal:21", name: "用户方法", revision: 5, source: "personal", primaryPath: "guide.md", path: "guide.md", files: ["guide.md", "references/style.md"], content: body });
  const { systems, users } = await capture("selected", true, "personal:21", raw, input);
  expect(systems).toHaveLength(1);
  expect(vi.mocked(readRoleSkillDocument).mock.calls.length - readsBefore).toBe(1);
  const messages = JSON.parse(users[0]);
  const user = messages.find((message: { role: string }) => message.role === "user");
  const text = typeof user.content === "string" ? user.content : user.content.find((part: { type: string }) => part.type === "text").text;
  for (const rule of ["本轮交付物由用户要求决定", "即使省略“生成”动词", "不能只返回提示词就结束", "只要提示词、方案、讨论、分析", "等待确认", "不构成媒体授权", "不得从技能默认产品推断未请求的后续用途或预留产品位置", "同一 skillId/revision 的 primaryPath 正文已完整加载于本轮"]) {
    expect(systems[0]).toContain(rule);
    expect(text.lastIndexOf(rule)).toBeGreaterThan(text.indexOf(body.trim()) + body.trim().length);
  }
  expect(text).toContain(body.trim());
  expect(text.endsWith(`用户要求：\n${raw}`)).toBe(true);
  expect(text).toContain('"primaryPath":"guide.md"');
  expect(input).toEqual(snapshot);
  expect(systems[0]).toContain(JSON.stringify(input.selection));
  expect(systems[0]).toContain(JSON.stringify(input.requirements));
  expect(systems[0]).toContain('"model":"gemini-3-pro-image"');
  expect(systems[0]).toContain('"resolution":"2K"');
  expect(assertRoleSkillRevision).toHaveBeenLastCalledWith({ authUserId: 1, publicId: "personal:21", revision: 5 });
});
