import simpleSkillFixture from './fixtures/creative-agent-simple-skill.json';
import { readRoleSkillDocument } from '@/lib/role-skills/repository';
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type Model, type Api, type AssistantMessage } from "@earendil-works/pi-ai";
import { runCreativeAgent, resumeCompletedCreativeAgentTurn, repairPendingToolResults } from "@/lib/creative-agent/runner";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import type { Run } from "@/lib/creative-agent/store-types";
import { creativeAgentChatMessages } from "@/lib/creative-agent/llm-stream";
import { windowCreativeMessages } from "@/lib/creative-agent/context-window";
const completionMocks = vi.hoisted(() => ({ wait: vi.fn(), model: vi.fn(), skillRevision: vi.fn() }));
vi.mock("@/lib/creative-agent/media-broker", () => ({ waitForCreativeAgentMedia: completionMocks.wait }));
vi.mock("@/lib/creative-agent/llm-broker", () => ({ createCreativeAgentModelStream: completionMocks.model }));
vi.mock("@/lib/role-skills/repository", () => ({
  assertRoleSkillRevision: completionMocks.skillRevision,
  readRoleSkillDocument: vi.fn(async () => ({ id: "system:3", name: "workflow", revision: 1, source: "system", primaryPath: "SKILL.md", files: ["SKILL.md"], content: "SEEDANCE EPISODE DIRECTOR 完整主文件" })),
  listRoleSkillsForUser: vi.fn(), getPersonalRoleSkill: vi.fn(),
  getSystemRoleSkillForUser: vi.fn(async () => ({ id: "system:3", name: "workflow", revision: 1, source: "system", content: "SEEDANCE EPISODE DIRECTOR 完整主文件" })),
  RoleSkillRepositoryError: class extends Error {},
}));
const model: Model<Api> = { id: "injected", name: "Test only", provider: "local", api: "openai-completions", baseUrl: "http://not-used.invalid", reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const run: Run = { id: "r", sessionId: "s", canvasId: 1, actorUserId: 1, epoch: 1, status: "running", error: null, updatedAt: new Date(1000).toISOString(), workerId: "test-worker", leaseExpiresAt: new Date(Date.now()+60000).toISOString(), createdAt: new Date(1000).toISOString(), input: { actorUserId: 1, canvasId: 1, messageId: "m", text: "生成图片", baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } } };
function dependencies() {
  const store = { assertFence: vi.fn(), getRun: vi.fn(async () => run), getRecoveryContext: vi.fn(async () => ""), getTranscript: vi.fn(async () => []), saveTranscript: vi.fn(), saveAssistant: vi.fn(), appendEvent: vi.fn(), waitForActions: vi.fn(), defer: vi.fn(), actionReceipts: vi.fn(async () => [{ kind: "image.generate", state: "succeeded", result: { generationIds: [12, 12, 13] } }]), finish: vi.fn(), control: vi.fn() };
  const stream = vi.fn(() => { const output = createAssistantMessageEventStream(); const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "任务已提交，正在处理。" }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; queueMicrotask(() => { output.push({ type: "start", partial: message }); output.push({ type: "done", reason: "stop", message }); }); return output; });
  return { store, stream };
}
describe("creative Agent completion boundary with injected media observer", () => {
  it.each(["normal", "resume"])("advances persisted dependencies through the %s completion entrance",async entrance=>{
    const {store,stream}=dependencies();
    const current={...run,input:{...run.input,matchingPolicyVersion:2 as const}};
    const advancePlan=vi.fn(async()=>"dispatched" as const);
    const awaitMedia=async()=>({pendingGenerationIds:[],generations:[12,13].map(generationId=>({generationId,status:"success",mediaType:"image",outputs:[{url:"/out.png",nodeId:"n"}],nodeIds:["n"]}))});
    if(entrance==="normal") await runCreativeAgent(current,{store:store as unknown as CreativeAgentStore,model,stream,tools:[],awaitMedia,advancePlan});
    else {
      store.getTranscript.mockResolvedValue([{role:"user",timestamp:Date.parse(run.createdAt)},{role:"assistant",stopReason:"stop",content:[]}] as never[]);
      expect(await resumeCompletedCreativeAgentTurn(current,{store:store as unknown as CreativeAgentStore,awaitMedia,advancePlan})).toBe(true);
      expect(stream).not.toHaveBeenCalled();
    }
    expect(advancePlan).toHaveBeenCalledOnce();expect(store.defer).toHaveBeenCalledWith("r",1,"waiting_action");expect(store.finish).not.toHaveBeenCalled();
  });
  it("an observed output mismatch stops every remaining retry before any dispatch",async()=>{
    const {store,stream}=dependencies();
    store.actionReceipts.mockResolvedValue([{id:"a",kind:"image.generate",state:"succeeded",result:{generationIds:[12,13],mediaRequest:{args:{prompt:"p"}}}}] as any);
    const retryMedia=vi.fn(async()=>null);
    await expect(runCreativeAgent({...run,input:{...run.input,matchingPolicyVersion:2}},{store:store as unknown as CreativeAgentStore,model,stream,tools:[],retryMedia,awaitMedia:async()=>({pendingGenerationIds:[],generations:[{generationId:12,status:"success",mediaType:"image",nodeIds:["a","b"],outputMismatch:true,outputs:[{url:"/one.png"},{url:"/two.png"}]},{generationId:13,status:"failed",mediaType:"image",outputs:[],nodeIds:[]}]})})).rejects.toMatchObject({code:"OUTPUT_CONTRACT_MISMATCH"});
    expect(retryMedia).not.toHaveBeenCalled();expect(store.finish).toHaveBeenCalledWith("r",1,"failed",expect.stringContaining("全部"));
  });
  it("does not let an unavailable abandoned tool block a fresh continuation", async () => {
    const messages = [{ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "old-call", name: "old_tool", arguments: { incomplete: true } }] }] as any[];
    const repaired = await repairPendingToolResults(messages, [], undefined, false);
    expect(repaired.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "old-call", isError: true });
    expect(JSON.stringify(repaired.at(-1))).toContain("不得据此重复执行");
    await expect(repairPendingToolResults(messages, [])).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });
  });
  it.each(["继续上面的任务", "继续中断的任务"])("restores durable task context for %s without replaying successful tools", async text => {
    const { store, stream } = dependencies();
    const recovery = '中断任务恢复记录：原需求为第一集分镜；已回答：只写分镜；已创建节点 saved-node；接着写后半部分。';
    store.getRecoveryContext.mockResolvedValue(recovery);
    store.actionReceipts.mockResolvedValue([]);
    store.getTranscript.mockResolvedValue([
      { role: "user", content: "第一集分镜", timestamp: 0 },
      { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "created", name: "canvas_create", arguments: {} }] },
      { role: "toolResult", toolCallId: "created", toolName: "canvas_create", content: [{ type: "text", text: "先前读过的大量资料".repeat(30000) }] },
      { role: "assistant", stopReason: "error", content: [{ type: "text", text: "前半部分已保存，后半部分尚未完成" }] },
    ] as never[]);
    const execute = vi.fn();
    let sent: Record<string, unknown>[] = [];
    await runCreativeAgent({ ...run, input: { ...run.input, text } }, {
      store: store as unknown as CreativeAgentStore, model,
      tools: [{ name: "canvas_create", label: "create", description: "create", parameters: Type.Object({}), execute }],
      stream: (_model, context) => { sent = windowCreativeMessages(creativeAgentChatMessages(context)); return stream(); },
    });
    expect(store.getRecoveryContext).toHaveBeenCalledWith(expect.objectContaining({ sessionId: run.sessionId }));
    expect(sent.some(message => message.role === "system" && String(message.content).includes(recovery))).toBe(true);
    expect(sent.at(-1)).toMatchObject({ role: "user", content: text });
    expect(execute).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledOnce();
    expect(store.finish).toHaveBeenCalledWith(run.id, run.epoch, "completed");
  });
  it("finishes real media delivery without initializing a model for an automatic review", async () => {
    const { store } = dependencies();
    store.getTranscript.mockResolvedValue([{ role: "user", content: "生成图片", timestamp: Date.parse(run.createdAt) }, { role: "assistant", stopReason: "stop", content: [] }] as never[]);
    completionMocks.wait.mockResolvedValue({ pendingGenerationIds: [], generations: [12, 13].map(generationId => ({ generationId, status: "success", mediaType: "image", outputs: [{ url: "/out.png", nodeId: `node-${generationId}` }], nodeIds: [`node-${generationId}`] })) });
    completionMocks.model.mockClear();
    expect(await resumeCompletedCreativeAgentTurn(run, { store: store as unknown as CreativeAgentStore })).toBe(true);
    expect(completionMocks.wait).toHaveBeenCalled();
    expect(completionMocks.model).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledWith("r", 1, "completed");
    expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("2 项成功"));
  });
  it("saves a truthful mixed-result summary before reporting failed tasks", async () => {
    const { store, stream } = dependencies();
    const generations = [{ status: "success", mediaType: "image", outputs: [{ url: "/out.png", nodeId: "out" }], nodeIds: ["out"] }, { status: "failed", mediaType: "image", outputs: [], nodeIds: ["failed"], error: "生成服务超时" }];
    const awaitMedia = async () => { throw Object.assign(new CreativeAgentError("MEDIA_GENERATION_FAILED", "部分失败"), { generations }); };
    await expect(runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia })).rejects.toThrow("部分失败");
    expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("1 项成功，1 项失败"));
    expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("生成服务超时"));
  });
  it("continues planning after revision feedback even with another tool in the same batch", async () => {
    const { store } = dependencies();
    store.actionReceipts.mockResolvedValue([]);
    let turns = 0;
    const stream = vi.fn((_model, context) => {
      const output = createAssistantMessageEventStream();
      const first = turns++ === 0;
      if (!first) expect(JSON.stringify(context.messages)).toContain("改成真实客厅");
      const message: AssistantMessage = { role: "assistant", content: first ? [{ type: "toolCall", id: "revise", name: "image_generate", arguments: {} }, { type: "toolCall", id: "read", name: "generation_models", arguments: {} }] : [{ type: "text", text: "按修改意见重新制定方案。" }], api: model.api, provider: model.provider, model: model.id, stopReason: first ? "toolUse" : "stop", timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { output.push({ type: "start", partial: message }); output.push({ type: "done", reason: first ? "toolUse" : "stop", message }); });
      return output;
    });
    const tools = [{ name: "image_generate", label: "test", description: "test", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text" as const, text: "用户要求修改：改成真实客厅" }], details: { result: { cancelled: true, revisionRequested: true, revision: "改成真实客厅" } } }) }, { name: "generation_models", label: "test", description: "test", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text" as const, text: "可用模型" }], details: {} }) }];
    await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, expect.any(String), "按修改意见重新制定方案。", undefined);
  });
  it("sends the selected full skill in the user message and persists it without changing the visible request", async () => {
    const { store, stream } = dependencies();
    const selected = { ...run, input: { ...run.input, text: "/skill:system:3\n只写资产方案" } };
    let captured: any[] = [];
    await runCreativeAgent(selected, {
      store: store as unknown as CreativeAgentStore, model, tools: [],
      stream: (_model, context) => { captured = structuredClone(context.messages); return stream(); },
      awaitMedia: async () => ({ pendingGenerationIds: [] }),
    });
    const user = captured.find(message => message.role === "user");
    const content = typeof user.content === "string" ? user.content : user.content.map((part: any) => part.text ?? "").join("");
    expect(content).toContain('"skillId":"system:3"');
    expect(content).toContain("SEEDANCE EPISODE DIRECTOR");
    expect(content.endsWith("只写资产方案")).toBe(true);
    expect(selected.input.text).toBe("/skill:system:3\n只写资产方案");
    expect(JSON.stringify(store.saveTranscript.mock.calls)).toContain("SEEDANCE EPISODE DIRECTOR");
  });
  it("waits for existing generation receipts before completing without another model call", async () => {
    const { store, stream } = dependencies();
    const awaitMedia = vi.fn(async (_run, ids) => { expect(ids).toEqual([12, 13]); expect(store.waitForActions).toHaveBeenCalled(); expect(store.finish).not.toHaveBeenCalled(); return { pendingGenerationIds: [] }; });
    await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia });
    expect(awaitMedia).toHaveBeenCalledTimes(1); expect(stream).toHaveBeenCalledTimes(1); expect(store.finish).toHaveBeenCalledWith("r", 1, "completed");
  });
  it("hands a submitted generation batch to the worker without an extra chat call", async () => {
    const { store } = dependencies();
    const stream = vi.fn(() => {
      const output = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", content: [{ type: "toolCall", id: "submit", name: "image_generate", arguments: {} }], api: model.api, provider: model.provider, model: model.id, stopReason: "toolUse", timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { output.push({ type: "start", partial: message }); output.push({ type: "done", reason: "toolUse", message }); });
      return output;
    });
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "submitted" }], details: { result: { generationIds: [12] } } }));
    const awaitMedia = vi.fn(async () => ({ pendingGenerationIds: [12] }));
    await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [{ name: "image_generate", label: "test", description: "test", parameters: Type.Object({}), execute }], awaitMedia });
    expect(stream).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce();
    expect(awaitMedia).toHaveBeenCalledOnce(); expect(store.defer).toHaveBeenCalledWith("r", 1, "waiting_action");
    const saved = store.saveTranscript.mock.calls.at(-1)?.[2];
    store.getTranscript.mockResolvedValue(saved as never[]);
    expect(await resumeCompletedCreativeAgentTurn(run, { store: store as unknown as CreativeAgentStore, awaitMedia })).toBe(true);
    expect(stream).toHaveBeenCalledOnce();
  });
  it("reports failed media observation truthfully and retains the generated task receipt", async () => {
    const { store, stream } = dependencies();
    const awaitMedia = vi.fn(async () => { throw new CreativeAgentError("MEDIA_GENERATION_FAILED", "生成任务失败"); });
    await expect(runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia })).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED" });
    expect(store.finish).toHaveBeenCalledWith("r", 1, "failed", "生成任务失败");
  });
  it("releases its worker slot while media is still pending", async () => {
    const { store, stream } = dependencies();
    const awaitMedia = vi.fn(async () => ({ pendingGenerationIds: [13] }));
    await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia });
    expect(store.defer).toHaveBeenCalledWith("r", 1, "waiting_action"); expect(store.finish).not.toHaveBeenCalled();
  });
  it("resumes completed model work using only persisted media receipts without model initialization", async () => {
    const { store } = dependencies();
    store.getTranscript.mockResolvedValue([{ role: "user", content: "生成图片", timestamp: Date.parse(run.createdAt) }, { role: "assistant", stopReason: "stop", content: [] }] as never[]);
    const awaitMedia = vi.fn(async () => ({ pendingGenerationIds: [] }));
    expect(await resumeCompletedCreativeAgentTurn(run, { store: store as unknown as CreativeAgentStore, awaitMedia })).toBe(true);
    expect(awaitMedia).toHaveBeenCalledTimes(1); expect(store.finish).toHaveBeenCalledWith("r", 1, "completed");
  });
  it("does not skip a new message or a pending assistant tool call", async () => {
    const { store } = dependencies(); const awaitMedia = vi.fn();
    store.getTranscript.mockResolvedValue([{ role: "assistant", stopReason: "stop", content: [] }] as never[]);
    expect(await resumeCompletedCreativeAgentTurn(run, { store: store as unknown as CreativeAgentStore, awaitMedia })).toBe(false);
    store.getTranscript.mockResolvedValue([{ role: "user", timestamp: Date.parse(run.createdAt) }, { role: "assistant", stopReason: "toolUse", content: [] }] as never[]);
    expect(await resumeCompletedCreativeAgentTurn(run, { store: store as unknown as CreativeAgentStore, awaitMedia })).toBe(false);
    expect(awaitMedia).not.toHaveBeenCalled();
  });
});

describe("bounded media recovery after the chat turn", () => {
 const media = (id: number, status: string) => ({ generationId: id, status, mediaType: "image", outputs: status === "success" ? [{ url: "/out.png", nodeId: `n${id}` }] : [], nodeIds: [`n${id}`], ...(status === "failed" ? { error: "429 Too Many Requests" } : {}) });
 const original = { id: "original", kind: "image.generate", state: "succeeded", result: { generationIds: [12, 13], mediaRequest: { args: { model: "test", prompt: "x" }, approval: { decisionId: "decision", proposalHash: "hash" } } } };
 it("retries only the failed item and retains the successful output", async () => {
  const { store, stream } = dependencies(); store.actionReceipts.mockResolvedValue([original] as any);
  const retryMedia = vi.fn(async () => ({ ...media(14, "running"), retryOfGenerationId: 13, retryAttempt: 1, retryReason: "429 Too Many Requests" }));
  await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia: async () => ({ pendingGenerationIds: [], generations: [media(12, "success"), media(13, "failed")] }), retryMedia });
  expect(retryMedia).toHaveBeenCalledTimes(1);
  expect(retryMedia).toHaveBeenCalledWith(run, original, 13, undefined);
  expect(store.defer).toHaveBeenCalledWith("r", 1, "waiting_action");
  expect(store.finish).not.toHaveBeenCalled();
 });
 it("recovers an existing retry by observing it, without a second dispatch", async () => {
  const { store, stream } = dependencies();
  store.actionReceipts.mockResolvedValue([original, { id: "retry", kind: "image.generate", state: "succeeded", result: { generationIds: [14], retryOfGenerationId: 13, retryAttempt: 1, retryReason: "429 Too Many Requests" } }] as any);
  const retryMedia = vi.fn();
  const awaitMedia = vi.fn(async (_run, ids) => { expect(ids).toEqual([12, 14]); return { pendingGenerationIds: [], generations: [media(12, "success"), media(14, "success")] }; });
  await runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia, retryMedia });
  expect(retryMedia).not.toHaveBeenCalled();
  expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("自动补试 1 次后成功"));
  expect(store.finish).toHaveBeenCalledWith("r", 1, "completed");
 });
 it("does not treat a lost retry response as permission for a fresh submission", async () => {
  const { store, stream } = dependencies();
  store.actionReceipts.mockResolvedValue([original, { id: "retry", kind: "image.generate", state: "unknown", result: { retryOfGenerationId: 13, requestKeys: ["retry-key"] } }] as any);
  const retryMedia = vi.fn(); const awaitMedia = vi.fn();
  await expect(runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia, retryMedia })).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(retryMedia).not.toHaveBeenCalled(); expect(awaitMedia).not.toHaveBeenCalled();
 });
 it("stops after the bounded retry also fails", async () => {
  const { store, stream } = dependencies();
  store.actionReceipts.mockResolvedValue([original, { id: "retry", kind: "image.generate", state: "succeeded", result: { generationIds: [14], retryOfGenerationId: 13, retryAttempt: 1, retryReason: "429 Too Many Requests" } }] as any);
  const retryMedia = vi.fn();
  await expect(runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [], awaitMedia: async () => ({ pendingGenerationIds: [], generations: [media(12, "success"), media(14, "failed")] }), retryMedia })).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED" });
  expect(retryMedia).not.toHaveBeenCalled();
  expect(store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("1 项成功，1 项失败"));
 });
});

it("Task5 rejects a selected skill revoked after expansion before a new model dispatch", async () => {
  const { store, stream } = dependencies(); store.actionReceipts.mockResolvedValue([]);
  completionMocks.skillRevision.mockRejectedValueOnce(new Error("revoked"));
  await expect(runCreativeAgent({ ...run, input: { ...run.input, text: "/skill:system:3 只写文字方案" } }, { store: store as any, model, stream, tools: [] })).rejects.toThrow();
  expect(stream).not.toHaveBeenCalled();
});
it("Task5 refreshes the effective requirement snapshot and provides prepared project constraints", async () => {
  const { store, stream } = dependencies(); store.actionReceipts.mockResolvedValue([]);
  store.assertFence.mockResolvedValue({ ...run, input: { ...run.input, matchingPolicyVersion: 2, effectivePreferences: { image: { params: { aspectRatio: "9:16" } } } } } as never);
  let sent: any;
  await runCreativeAgent(run, { store: store as any, model, tools: [], readProjectContext: async () => ({ constraints: ["保留蓝色杯身"], artifacts: [], progress: {} }), stream: (m, context) => { sent = context; return stream(); } });
  expect(sent.systemPrompt).toContain("保留蓝色杯身");
  expect(sent.systemPrompt).toContain("9:16");
  expect(sent.systemPrompt).not.toContain("实质工作先project_read");
});

it('R21 assembles the selected skill and project memory as scoped reference, preserving body and current preferences',async()=>{
 const {store,stream}=dependencies();store.actionReceipts.mockResolvedValue([]);
 vi.mocked(readRoleSkillDocument).mockResolvedValueOnce({id:'personal:7',name:'家庭背景示例',revision:4,source:'personal',primaryPath:'SKILL.md',files:['SKILL.md'],content:simpleSkillFixture.body} as any);
 const current={...run,input:{...run.input,text:simpleSkillFixture.text,preferences:simpleSkillFixture.preferences as Run["input"]["preferences"],matchingPolicyVersion:2 as const,mediaAuthorizationVersion:1 as const}};let sent:any;
 await runCreativeAgent(current,{store:store as any,model,tools:[],readProjectContext:async()=>simpleSkillFixture.project,stream:(m,context)=>{sent=context;return stream();}});
 expect(sent.systemPrompt).toContain('历史项目参考快照');expect(sent.systemPrompt).toContain('仅在本轮明确相关或续作时');
 expect(sent.systemPrompt).toContain('本轮要求与当前偏好优先');expect(sent.systemPrompt).toContain('独立单步且无需引用');expect(sent.systemPrompt).toContain('简单单图只需 image.quantity，不把产物张数填为 generation.initialCalls');
 expect(sent.systemPrompt).toContain('不逐步播报空画布、历史搜索和未找到素材');
 expect(sent.systemPrompt).not.toContain('沿用项目已经确定的人物、风格、画幅和时长');
 expect(sent.systemPrompt).toContain(JSON.stringify(simpleSkillFixture.project));expect(sent.systemPrompt).toContain('gemini-3-pro-image');
 const user=sent.messages.find((message:any)=>message.role==='user');const text=typeof user.content==='string'?user.content:user.content.map((c:any)=>c.text??'').join('');
 expect(text).toContain(simpleSkillFixture.body);expect(text).toContain('用户要求：\n一张家庭背景图');
 expect(sent.systemPrompt).toContain('画面主体及其身份依据来自当前用户要求、当前有效主体引用和用户明确续用的会话内容');expect(stream).toHaveBeenCalledOnce();
});

it.each(['schema','unknown','executor','admission'])('R22 records only SDK bypass rejections once: %s',async scenario=>{
 const {store}=dependencies();store.actionReceipts.mockResolvedValue([]);store.appendEvent.mockResolvedValue(undefined);let turns=0;let blocked=false;store.assertFence.mockImplementation(async()=>{if(scenario==='admission' && turns===1 && !blocked){blocked=true;throw new CreativeAgentError('stale_epoch','租约失效');}});
 const stream=vi.fn(()=>{const output=createAssistantMessageEventStream();const first=turns++===0;const message:AssistantMessage={role:'assistant',content:first?[{type:'toolCall',id:'r22-call',name:scenario==='unknown'?'missing_tool':'image_generate',arguments:scenario==='schema'?{}:{prompt:'x'}}]:[{type:'text',text:'请调整参数'}],api:model.api,provider:model.provider,model:model.id,stopReason:first?'toolUse':'stop',timestamp:2000,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(()=>{output.push({type:'start',partial:message});output.push({type:'done',reason:first?'toolUse':'stop',message});});return output;});
 const execute=vi.fn(async()=>{throw new Error('executor failed');});
 await runCreativeAgent(run,{store:store as unknown as CreativeAgentStore,model,stream,tools:[{name:'image_generate',label:'生成图片',description:'fixture',parameters:Type.Object({prompt:Type.String()}),execute}]});
 const completed=store.appendEvent.mock.calls.filter(call=>call[2]==='tool.completed');expect(completed).toHaveLength(scenario==='executor'?0:1);
 if(scenario!=='executor'){expect(completed[0][3]).toMatchObject({toolCallId:'r22-call',status:'error',detail:{phase:scenario==='admission'?'admission':'preflight',dispatched:false,code:scenario==='schema'?'invalid_tool_arguments':scenario==='admission'?'stale_epoch':'TOOL_UNAVAILABLE'}});expect(execute).not.toHaveBeenCalled();}
});
it('R22 observes recovery schema rejection without executing or changing its thrown control result',async()=>{const rejected=vi.fn();const execute=vi.fn();const messages:any=[{role:'assistant',content:[{type:'toolCall',id:'recover-invalid',name:'image_generate',arguments:{}}]}];await expect(repairPendingToolResults(messages,[{name:'image_generate',label:'生成图片',description:'fixture',parameters:Type.Object({prompt:Type.String()}),execute}],undefined,true,rejected)).rejects.toThrow();expect(rejected).toHaveBeenCalledOnce();expect(execute).not.toHaveBeenCalled();});

it.each(['fresh','unknown','claimed','recorded'])('R22 recovery observes SDK rejection without overwriting %s receipt evidence',async state=>{const {store,stream}=dependencies();store.actionReceipts.mockResolvedValue(state!=='fresh'?[{kind:'image.generate',state:state==='recorded'?'failed':state,result:state==='recorded'?{mediaDispatch:{requestKeys:['already-reserved']}}:{}}] as any:[]);store.appendEvent.mockResolvedValue(undefined);store.getTranscript.mockResolvedValue([{role:'user',content:'生成图片',timestamp:Date.parse(run.createdAt)},{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'recover22',name:'image_generate',arguments:{}}]}] as never[]);const execute=vi.fn();await expect(runCreativeAgent(run,{store:store as unknown as CreativeAgentStore,model,stream,tools:[{name:'image_generate',label:'生成图片',description:'fixture',parameters:Type.Object({prompt:Type.String()}),execute}]})).rejects.toThrow();expect(stream).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();const events=store.appendEvent.mock.calls.filter(call=>call[2]==='tool.completed');expect(events).toHaveLength(1);expect(events[0][3]).toMatchObject({toolCallId:'recover22',detail:{phase:state==='recorded'?'validation':'preflight',code:'invalid_tool_arguments',...(state==='fresh'?{dispatched:false}:state==='recorded'?{}:{receiptState:'unknown'})}});if(state!=='fresh')expect((events[0][3] as any).detail).not.toHaveProperty('dispatched',false);});


it("R27 checkpoints each repaired result before a later pending tool and stops on write failure", async () => {
  const { store, stream } = dependencies();
  store.actionReceipts.mockResolvedValue([]);
  store.getTranscript.mockResolvedValue([
    { role: "user", content: run.input.text, timestamp: Date.parse(run.createdAt) },
    { role: "assistant", content: [
      { type: "toolCall", id: "original", name: "original", arguments: {} },
      { type: "toolCall", id: "replace", name: "replace", arguments: {} },
    ] },
  ] as never[]);
  store.saveTranscript.mockRejectedValueOnce(new Error("checkpoint unavailable"));
  const original = vi.fn(async () => ({ content: [{ type: "text" as const, text: "original durable result" }], details: { generationIds: [123] } }));
  const replace = vi.fn(async () => ({ content: [], details: {} }));
  await expect(runCreativeAgent(run, { store: store as unknown as CreativeAgentStore, model, stream, tools: [
    { name: "original", label: "original", description: "fixture", parameters: Type.Object({}), execute: original },
    { name: "replace", label: "replace", description: "fixture", parameters: Type.Object({}), execute: replace },
  ] })).rejects.toThrow("checkpoint unavailable");
  expect(original).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
});
