import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ saveAttempt: vi.fn(), resolve: vi.fn(), fetch: vi.fn(), begin: vi.fn(), finish: vi.fn(), claim: vi.fn(), complete: vi.fn(), fence: vi.fn(), receipts: vi.fn(), ledger: vi.fn(), enabled: vi.fn(), canvas: vi.fn(), admission: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { $transaction: (fn: any) => fn({ usageLedger: { update: mock.ledger } }) } }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: mock.resolve, creativeAgentSupportsVision: () => false }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: mock.fetch }));
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: mock.begin, finishLlmCost: mock.finish }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: mock.enabled, requireCreativeAgentCanvas: mock.canvas }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: mock.admission }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { saveLlmAttempt: mock.saveAttempt, assertFence: mock.fence, claimAction: mock.claim, completeAction: mock.complete, actionReceipts: mock.receipts } }));
import { createCreativeAgentModelStream } from "@/lib/creative-agent/llm-broker";
import { withCreativeDebug } from "@/lib/creative-agent/debug-trace";

const scope = { actorUserId: 1, canvasId: 2, runId: "run", epoch: 1, options: { model: { providerId: "fixture", modelId: "model" } } };
const context = { systemPrompt: "帮助用户创作", messages: [{ role: "user" as const, content: "写一个短片", timestamp: 1 }] };
const route = { scenarioId: "agent.chat", providerId: "fixture", providerName: "test", modelId: "model", protocol: "openai-chat", source: "configured", status: "ready", url: "http://localhost:1/v1/chat/completions", apiKey: "fixture-key-not-secret", timeoutMs: 1000, egressDecision: { providerId: "fixture", mode: "direct" } };
beforeEach(() => {
  vi.resetAllMocks(); mock.resolve.mockResolvedValue({ status: "ready", route });
  mock.fence.mockResolvedValue({ ...scope, sessionId: "session", input: { messageId: "message", revision: 0 } }); mock.claim.mockResolvedValue({ claimed: true }); mock.receipts.mockResolvedValue([]);
  mock.complete.mockResolvedValue(undefined); mock.saveAttempt.mockResolvedValue(undefined);
  mock.begin.mockResolvedValue({ id: 3, snapshot: {} }); mock.finish.mockResolvedValue(undefined);
  mock.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "剧本内容" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_tokens_details: { cached_tokens: 5 } } }));
});
async function call() { const { model, stream } = await createCreativeAgentModelStream(scope); return stream(model, context).result(); }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("creative Agent billed model dispatch", () => {
  it("rejects a missing selection before any provider request or billing", async () => {
    mock.resolve.mockResolvedValue({ status: "missing-binding" });
    await expect(createCreativeAgentModelStream({ ...scope, options: undefined })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(mock.resolve).toHaveBeenCalledWith(undefined);
    expect(mock.fetch).not.toHaveBeenCalled();
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it.each([
    ["bigmodel", "glm-5.3", "default", { thinking: { type: "enabled", clear_thinking: false }, tool_stream: true, max_tokens: 8192 }],
    ["bigmodel", "glm-5.3-flash", "max", { thinking: { type: "enabled", clear_thinking: false }, reasoning_effort: "max", tool_stream: true }],
    ["minimax", "MiniMax-M3", "default", { reasoning_split: true, max_completion_tokens: 8192 }],
    ["minimax", "MiniMax-M3", "adaptive", { thinking: { type: "adaptive" }, reasoning_split: true }],
    ["bailian", "qwen3.8-max", "high", { reasoning_effort: "xhigh" }],
    ["deepseek", "deepseek-v4-pro", "max", { thinking: { type: "enabled" }, reasoning_effort: "max" }],
    ["volcengine", "doubao-seed-evolving", "none", { thinking: { type: "disabled" } }],
  ] as const)("sends the selected thinking control through the real broker: %s", async (providerId, modelId, thinkingLevel, expected) => {
    mock.resolve.mockResolvedValue({ status: "ready", route: { ...route, providerId, modelId, egressDecision: { providerId, mode: "direct" } } });
    const { model, stream } = await createCreativeAgentModelStream({ ...scope, options: { model: { providerId, modelId }, thinkingLevel } });
    expect(mock.resolve).toHaveBeenCalledWith({ providerId, modelId });
    expect((await stream(model, context).result()).stopReason).toBe("stop");
    const body = JSON.parse(mock.fetch.mock.calls[0][2].body);
    expect(body).toMatchObject(expected);
    expect(body).not.toHaveProperty("thinking_budget");
    if (thinkingLevel === "none") expect(body).not.toHaveProperty("reasoning_effort");
  });
  it.each(["glm-5.3", "glm-5.3-flash"])("preserves %s tool reasoning and omits unsupported OpenAI fields", async modelId => {
    const modelSelection = { providerId: "bigmodel", modelId };
    mock.resolve.mockResolvedValue({ status: "ready", route: { ...route, ...modelSelection, egressDecision: { providerId: "bigmodel", mode: "direct" } } });
    mock.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, reasoning_content: "检查画布", tool_calls: [{ id: "call-read", type: "function", function: { name: "canvas_read", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
    const { model, stream } = await createCreativeAgentModelStream({ ...scope, options: { model: modelSelection } });
    const tools = [{ name: "canvas_read", description: "Read canvas", parameters: { type: "object", properties: {} } }] as any;
    const first = await stream(model, { ...context, tools }).result();
    expect(first.stopReason).toBe("toolUse");
    const second = await stream(model, { ...context, tools, messages: [...context.messages, JSON.parse(JSON.stringify(first)), { role: "toolResult", toolCallId: "call-read", toolName: "canvas_read", content: [{ type: "text", text: "画布为空" }], isError: false, timestamp: 2 }] }).result();
    expect(second.stopReason).toBe("stop");
    const body = JSON.parse(mock.fetch.mock.calls[1][2].body);
    expect(body).toMatchObject({ model: modelId, stream: true, tool_stream: true, thinking: { type: "enabled", clear_thinking: false }, max_tokens: 8192, tool_choice: "auto" });
    expect(body.messages[2]).toMatchObject({ role: "assistant", reasoning_content: "检查画布", tool_calls: [{ id: "call-read" }] });
    expect(body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-read", content: "画布为空" });
    for (const field of ["stream_options", "parallel_tool_calls", "response_format", "max_completion_tokens"]) expect(body).not.toHaveProperty(field);
  });
  it.each(["reasoning_details", "reasoning_content"] as const)("preserves MiniMax %s and tool results across billed rounds", async field => {
    const modelSelection = { providerId: "minimax", modelId: "MiniMax-M3" };
    mock.resolve.mockResolvedValue({ status: "ready", route: { ...route, ...modelSelection, url: "https://saved.example/v1/chat/completions", egressDecision: { providerId: "minimax", mode: "direct" } } });
    const reasoning = field === "reasoning_details" ? [{ type: "reasoning.text", text: "检查画布", signature: "retained" }] : "检查画布";
    mock.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, [field]: reasoning, tool_calls: [{ id: "call-read", type: "function", function: { name: "canvas_read", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
    const { model, stream } = await createCreativeAgentModelStream({ ...scope, options: { model: modelSelection, thinkingLevel: "default" } });
    const tools = [{ name: "canvas_read", description: "Read canvas", parameters: { type: "object", properties: {} } }] as any;
    const first = await stream(model, { ...context, tools }).result();
    expect(first.stopReason).toBe("toolUse");
    expect(mock.complete.mock.calls[0][1].result).toEqual(first);
    const restored = JSON.parse(JSON.stringify(first));
    const second = await stream(model, { ...context, tools, messages: [...context.messages, restored, { role: "toolResult", toolCallId: "call-read", toolName: "canvas_read", content: [{ type: "text", text: "画布为空" }], isError: false, timestamp: 2 }] }).result();
    expect(second.stopReason).toBe("stop");
    const request = mock.fetch.mock.calls[1];
    expect(request[0]).toEqual({ providerId: "minimax", mode: "direct" });
    expect(request[1]).toBe("https://saved.example/v1/chat/completions");
    expect(request[2].headers).toMatchObject({ Authorization: "Bearer fixture-key-not-secret" });
    const body = JSON.parse(request[2].body);
    expect(body).toMatchObject({ model: "MiniMax-M3", stream: true, reasoning_split: true, max_completion_tokens: 8192, stream_options: { include_usage: true }, tool_choice: "auto" });
    expect(body.messages[2]).toMatchObject({ role: "assistant", [field]: reasoning, tool_calls: [{ id: "call-read", function: { name: "canvas_read", arguments: "{}" } }] });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call-read", content: "画布为空" });
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("response_format");
    expect(mock.begin).toHaveBeenCalledTimes(2);
    expect(mock.begin.mock.calls[0][0]).toMatchObject({ provider: "minimax", model: "MiniMax-M3", source: "agent.chat" });
  });
  function timedStream() {
    vi.useFakeTimers();
    // Make native deadline signals deterministic too, so this reproduces the old total timeout.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    let source: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal;
    mock.fetch.mockImplementation(async (_egress, _url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        source = controller;
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      } }), { headers: { "content-type": "text/event-stream" } });
    });
    return {
      packet: (delta: object, finish_reason: string | null = null) => source.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`)),
      end: () => { source.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); source.close(); },
      aborted: () => signal.aborted,
    };
  }
  it("keeps an actively streaming response alive beyond the request timeout", async () => {
    const upstream = timedStream(), result = call();
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(700);
      expect(upstream.aborted()).toBe(false);
      upstream.packet(index === 0 ? { reasoning_content: "整理分镜" } : { content: "继续输出" });
      await vi.advanceTimersByTimeAsync(0);
    }
    upstream.packet({}, "stop"); upstream.end();
    expect((await result).stopReason).toBe("stop");
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a silent stream with a specific reason and preserves partial output", async () => {
    const upstream = timedStream(), result = call();
    await vi.advanceTimersByTimeAsync(0);
    upstream.packet({ content: "已整理前半部分" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await result).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("超时"), content: [{ type: "text", text: "已整理前半部分" }] });
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(mock.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "unknown", result: expect.objectContaining({ code: "MODEL_IDLE_TIMEOUT" }) }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("still aborts immediately when the user stops an active stream", async () => {
    timedStream();
    const controller = new AbortController();
    const { model, stream } = await createCreativeAgentModelStream(scope);
    const result = stream(model, context, { signal: controller.signal }).result();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ stopReason: "aborted", errorMessage: "任务已暂停或停止" });
    expect(mock.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("captures exactly the final sent body and response, without keys or a second dispatch", async () => {
    const records: any[] = [];
    await withCreativeDebug(scope, call, async record => { records.push(record); });
    const body = JSON.parse(mock.fetch.mock.calls[0][2].body);
    expect(records.find(record => record.type === "model.prepared").detail.body).toEqual(body);
    expect(records.find(record => record.type === "model.completed").detail.response.text).toBe("剧本内容");
    expect(JSON.stringify(records)).not.toContain(route.apiKey);
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    mock.fetch.mockClear(); mock.claim.mockResolvedValue({ claimed: false, state: "succeeded", result: { role: "assistant", content: [], stopReason: "stop" } });
    const reused: any[] = [];
    await withCreativeDebug(scope, call, async record => { reused.push(record); });
    expect(reused.some(record => record.type === "model.reused")).toBe(true);
    expect(reused.some(record => record.type === "model.dispatched")).toBe(false);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("continues a successful model call when diagnostics cannot be persisted", async () => {
    const result = await withCreativeDebug(scope, call, async () => { throw new Error("trace store unavailable"); });
    expect(result.stopReason).toBe("stop"); expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the existing route, egress and billing ledger once, preserving cached usage", async () => {
    const result = await call();
    expect(result.stopReason).toBe("stop");
    expect(result).toMatchObject({ creativeUsage: { reported: true, cacheReported: true } });
    expect(result.usage).toMatchObject({ input: 15, output: 10, cacheRead: 5 });
    expect(mock.fetch).toHaveBeenCalledWith(route.egressDecision, route.url, expect.objectContaining({ method: "POST" }));
    expect(mock.begin).toHaveBeenCalledTimes(1);
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ inputTokens: 20, cachedInputTokens: 5, outputTokens: 10 }), true);
    expect(mock.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "succeeded" }));
  });
  it("replays an existing model receipt without provider dispatch or duplicate billing", async () => {
    const saved = await call();
    mock.fetch.mockClear(); mock.begin.mockClear(); mock.finish.mockClear();
    mock.claim.mockResolvedValue({ claimed: false, state: "succeeded", result: saved });
    expect(await call()).toEqual(saved);
    expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.finish).not.toHaveBeenCalled();
  });
  it("marks omitted upstream usage as unavailable instead of measured zero", async () => {
    mock.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "回答" }, finish_reason: "stop" }] }));
    expect(await call()).toMatchObject({ creativeUsage: { reported: false, cacheReported: false } });
  });
  it("keeps a timed-out dispatched call unknown and never settles it as free", async () => {
    mock.fetch.mockRejectedValue(new Error("socket interrupted"));
    expect((await call()).stopReason).toBe("error");
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "unknown" }));
  });
  it("refuses unknown receipts rather than resubmitting", async () => {
    mock.claim.mockResolvedValue({ claimed: false, state: "unknown" });
    expect((await call()).stopReason).toBe("error"); expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it.each([408, 500, 502, 504])("keeps HTTP %s dispatch outcomes and costs unknown", async status => {
    mock.fetch.mockResolvedValue(new Response(null, { status }));
    expect((await call()).stopReason).toBe("error");
    expect(mock.finish).not.toHaveBeenCalled();
    expect(mock.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "unknown" }));
  });
  it("settles an explicit authorization rejection as failed", async () => {
    mock.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await call()).stopReason).toBe("error");
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), null, false);
    expect(mock.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "failed" }));
  });
  it("fails closed before dispatch when canvas access was revoked", async () => {
    mock.canvas.mockRejectedValue(new Error("revoked"));
    expect((await call()).stopReason).toBe("error"); expect(mock.claim).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
});

describe("Task5 dispatch visibility and durable metrics", () => {
  it("rechecks visibility between same-worker rounds and before billing", async () => {
    const { model, stream } = await createCreativeAgentModelStream(scope);
    await stream(model, context).result();
    mock.resolve.mockResolvedValue({ status: "model-disabled" });
    mock.claim.mockClear(); mock.fetch.mockClear(); mock.begin.mockClear();
    const result = await stream(model, { ...context, messages: [{ ...context.messages[0], content: "继续修改" }] }).result();
    expect(result.stopReason).toBe("error");
    expect(mock.begin).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("retains provider usage on an incomplete response with separate packet/content timestamps", async () => {
    mock.fetch.mockResolvedValue(new Response('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"reasoning_content":"plan"}}],"usage":{"prompt_tokens":30,"completion_tokens":20,"completion_tokens_details":{"reasoning_tokens":18}}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const result = await call();
    expect(result).toMatchObject({ creativeUsage: { reported: true, reasoningOutputTokens: 18 } });
    expect(mock.complete.mock.calls.at(-1)?.[1].result.creativeAttempt).toMatchObject({ status: "unknown", usage: { inputTokens: 30, outputTokens: 20, reasoningOutputTokens: 18 }, timing: { firstPacketMs: expect.any(Number), firstThinkingMs: expect.any(Number) } });
  });
});

it("Task5 rejects a late admin hide during metric persistence and replays completed receipts while hidden", async () => {
  const { model, stream } = await createCreativeAgentModelStream(scope);
  mock.saveAttempt.mockImplementationOnce(async () => { mock.resolve.mockResolvedValue({ status: "model-disabled" }); });
  expect((await stream(model, context).result()).stopReason).toBe("error");
  expect(mock.fetch).not.toHaveBeenCalled();
  mock.claim.mockResolvedValue({ claimed: false, state: "succeeded", result: { role: "assistant", content: [], stopReason: "stop" } });
  expect((await stream(model, context).result()).stopReason).toBe("stop");
  expect(mock.fetch).not.toHaveBeenCalled();
});
it("Task5 retains numeric usage from an explicit upstream rejection", async () => {
  // 429 先自动重试 3 次（retry-after 让测试里的等待只有 1 毫秒），仍被拒绝才算失败
  mock.fetch.mockImplementation(async () => Response.json({ error: "private upstream content", usage: { prompt_tokens: 12, completion_tokens: 3 } }, { status: 429, headers: { "retry-after": "0.001" } }));
  await call();
  expect(mock.fetch).toHaveBeenCalledTimes(4);
  expect(mock.complete.mock.calls.at(-1)?.[1].result.creativeAttempt).toMatchObject({ status: "failed", usage: { inputTokens: 12, outputTokens: 3 } });
  expect(JSON.stringify(mock.complete.mock.calls.at(-1)?.[1].result.creativeAttempt)).not.toContain("private upstream");
});

it("限流（429）后自动重发，成功就不让整轮失败", async () => {
  const success = mock.fetch.getMockImplementation();
  mock.fetch.mockImplementationOnce(async () => Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "0.001" } }));
  if (success) mock.fetch.mockImplementation(success);
  const message = await call();
  expect(message.stopReason).toBe("stop");
  expect(mock.fetch).toHaveBeenCalledTimes(2);
});

it("I4 fences a revision committed during the last asynchronous route preparation", async () => {
  let reads = 0;
  mock.resolve.mockImplementation(async () => { if (++reads === 3) mock.fence.mockRejectedValue(new Error("stale epoch")); return { status: "ready", route }; });
  expect((await call()).stopReason).toBe("error");
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(mock.saveAttempt.mock.calls.at(-1)?.[1].timing.dispatchedAt).toBeUndefined();
});
it("I5 a newly constructed stream can exactly replay a succeeded receipt while its model is hidden", async () => {
  const first = await call(); const actionId = mock.claim.mock.calls[0][0].actionId;
  mock.resolve.mockResolvedValue({ status: "model-disabled" });
  mock.receipts.mockResolvedValue([{ id: actionId, kind: "model.chat", state: "succeeded", result: first }]);
  mock.claim.mockImplementation(async ({ actionId: id }) => id === actionId ? { claimed: false, state: "succeeded", result: first } : { claimed: true });
  mock.fetch.mockClear(); mock.begin.mockClear();
  const fresh = await createCreativeAgentModelStream(scope);
  expect(await fresh.stream(fresh.model, context).result()).toEqual(first);
  expect(await fresh.stream(fresh.model, { ...context, systemPrompt: "new host code" }).result()).toEqual(first);
  expect((await fresh.stream(fresh.model, { ...context, messages: [{ ...context.messages[0], content: "different request" }] }).result()).stopReason).toBe("error");
  expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.begin).not.toHaveBeenCalled();
});
it("I4 rechecks cancellation after final asynchronous model preparation", async () => {
  const controller = new AbortController(); let reads = 0;
  mock.resolve.mockImplementation(async () => { if (++reads === 3) controller.abort(); return { status: "ready", route }; });
  const stream = await createCreativeAgentModelStream(scope);
  expect((await stream.stream(stream.model, context, { signal: controller.signal }).result()).stopReason).toBe("aborted");
  expect(mock.fetch).not.toHaveBeenCalled();
});

it('R11 binds host prompt and tool schema changes to the same durable frontier, retaining each body audit hash',async()=>{
 const args={...context,tools:[{name:'canvas_read',description:'R10 description',parameters:{type:'object',properties:{}}}] as any};
 mock.fetch.mockImplementation(async()=>Response.json({choices:[{message:{content:'answer'},finish_reason:'stop'}]}));
 const first=await createCreativeAgentModelStream(scope);await first.stream(first.model,args).result();
 const second=await createCreativeAgentModelStream({...scope,epoch:2});await second.stream(second.model,{...args,systemPrompt:'R11 replacement',tools:[{...args.tools[0],description:'R11 new description',parameters:{type:'object',properties:{scope:{type:'string'}}}}]}).result();
 expect(mock.claim.mock.calls[0][0].actionId).toBe(mock.claim.mock.calls[1][0].actionId);
 expect(mock.claim.mock.calls[0][0].inputHash).not.toBe(mock.claim.mock.calls[1][0].inputHash);
 expect(mock.claim.mock.calls[0][0].modelFrontier).toMatchObject({version:1});
});
it.each(['tool-result','tool-arguments','tool-pair','thinking-signature','encrypted-reasoning','user-marker','user-content','controls'] as const)('R11 distinguishes complete frontier %s changes',async change=>{
 mock.fetch.mockImplementation(async()=>Response.json({choices:[{message:{content:'answer'},finish_reason:'stop'}]}));
 const assistant:any={role:'assistant',content:[{type:'thinking',thinking:'plan',thinkingSignature:'sig-a'},{type:'toolCall',id:'call-1',name:'canvas_read',arguments:{id:'a'}}],api:'openai-completions',model:'model',provider:'fixture',stopReason:'toolUse'};
 const messages:any[]=[context.messages[0],assistant,{role:'toolResult',toolCallId:'call-1',toolName:'canvas_read',content:[{type:'text',text:'old'}],isError:false,timestamp:2}];
 const first=await createCreativeAgentModelStream(scope);await first.stream(first.model,{...context,messages}).result();
 const changed=structuredClone(messages);
 if(change==='tool-result')changed[2].content[0].text='new';
 if(change==='tool-arguments')changed[1].content[1].arguments.id='b';
 if(change==='tool-pair')changed[2].toolCallId='different-call';
 if(change==='encrypted-reasoning')changed[1].creativeEncryptedContent='different-encrypted';
 if(change==='user-content')changed[0].content='different-user';
 if(change==='thinking-signature')changed[1].content[0].thinkingSignature='sig-b';
 if(change==='user-marker')changed[0].timestamp=99;
 await first.stream(first.model,{...context,messages:changed},change==='controls'?{maxTokens:4096}:undefined).result();
 expect(mock.claim.mock.calls[0][0].actionId).not.toBe(mock.claim.mock.calls[1][0].actionId);
});
