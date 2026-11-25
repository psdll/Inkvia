import { describe, expect, it, vi } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createCreativeTools, creativeActionId } from "@/lib/creative-agent/tools";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import { hash, HttpError, type Run } from "@/lib/creative-agent/store-types";
import { CreativeAgentStore } from "@/lib/creative-agent/store";
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
const run = { id: "run", actorUserId: 1, canvasId: 1, epoch: 2, input: { preferences: {} } } as Run;

describe("creative Agent controlled tool boundary", () => {
  it("publishes offset and continuation provenance guidance on the actual shared tool schema", () => {
    const tools=createCreativeTools({...run,input:{...run.input,matchingPolicyVersion:2}},{} as CreativeAgentStore,vi.fn());
    for(const name of ['generation_requirements','generation_plan']){
      const tool=tools.find(item=>item.name===name)!;
      const source=(tool.parameters as any).properties.facts.items.properties.source;
      expect(source.description).toContain('唯一');expect(source.description).toContain('省略 start/end');expect(source.description).toContain('UTF-16');
      const args={facts:[{field:'intent',value:'prepare',strength:'hard',source:{kind:'message',sourceId:'m',quote:'只展示方案'}}],...(name==='generation_plan'?{steps:[{id:'s',role:'final',mediaType:'image',prompt:'creative brief'}]}:{})};
      expect(validateToolArguments(tool,{type:'toolCall',id:'source',name,arguments:args}).facts[0].source).toEqual(args.facts[0].source);
    }
    const requirements=tools.find(item=>item.name==='generation_requirements')!;
    expect(JSON.stringify(requirements.parameters)).toContain('image_generate');
    expect(requirements.description).toContain('不要把继承值另写为 facts');
  });

  it.each([
    ['intent','generate','蓝色马克杯商品主图'],
    ['image.quantity',1,'1'],['video.quantity',2,'2'],['video.params.duration',5,'5'],
    ['generation.retryCalls',0,'0'],['generation.totalOutputs',3,-1],
    ['video.params.generateAudio',false,'false'],['image.modelChoice',{mode:'auto'},'auto'],
    ['video.modelChoice',{mode:'explicit',model:'visible-model'},true],
    ['image.params.resolution','2K',2048],
  ])('publishes strict requirement value types without scalar coercion: %s', (field,value,invalid) => {
    const tools=createCreativeTools({...run,input:{...run.input,matchingPolicyVersion:2}},{} as CreativeAgentStore,vi.fn());
    for(const name of ['generation_requirements','generation_plan','image_generate','video_generate']){
      const tool=tools.find(item=>item.name===name)!;
      const args=(v:unknown)=>({facts:[{field,value:v,strength:'hard',source:{kind:'message',sourceId:'m',quote:'original'}}],...(['image_generate','video_generate'].includes(name)?{prompt:'brief',...(name==='video_generate'?{params:{inputMode:'text_to_video'}}:{})}:{}),...(name==='generation_plan'?{steps:[{id:'s',role:'final',mediaType:'image',prompt:'creative brief',dependsOn:[]}]}:{})});
      expect(validateToolArguments(tool,{type:'toolCall',id:'types',name,arguments:args(value)}).facts[0].value).toEqual(value);
      expect(()=>validateToolArguments(tool,{type:'toolCall',id:'types',name,arguments:args(invalid)})).toThrow();
      expect(JSON.stringify(tool.parameters)).toContain('背景颜色');
    }
  });
  it.each(['image_generate','video_generate'])('accepts inline trusted input and receipt-only references without weakening direct requirements: %s',name=>{
    const tool=createCreativeTools({...run,input:{...run.input,matchingPolicyVersion:2}},{} as CreativeAgentStore,vi.fn()).find(item=>item.name===name)!;
    const validate=(args:any)=>validateToolArguments(tool,{type:'toolCall',id:'inline',name,arguments:args});
    expect(validate({plan:{actionId:'plan',stepId:'step'}})).toEqual({plan:{actionId:'plan',stepId:'step'}});
    expect(()=>validate({})).toThrow();
    if(name==='video_generate')expect(()=>validate({prompt:'brief'})).toThrow();
    const args={prompt:'brief',...(name==='video_generate'?{params:{inputMode:'text_to_video'}}:{}),facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'m',quote:'一张'}}]};
    expect(validate(args).facts).toEqual(args.facts);
    expect(()=>validate({...args,facts:[{...args.facts[0],value:'1'}]})).toThrow();
    expect(()=>validate({...args,untrusted:'extra'})).toThrow();
  });

  it("prepares sent historical attachments through an idempotent tool and publishes their canvas mapping", async () => {
    const store = { assertFence: vi.fn(), appendEvent: vi.fn(), getAction: vi.fn(async () => { throw new HttpError(404, "action_not_found", "missing"); }),
      claimAction: vi.fn(async (input: any) => ({ ...input, claimed: true })), completeAction: vi.fn() };
    const execute = vi.fn(async () => ({ revision: "7", nodeIds: ["source"], references: [{ nodeId: "source" }] }));
    const tool = createCreativeTools(run, store as unknown as CreativeAgentStore, execute).find(tool => tool.name === "material_prepare")!;
    expect(tool).toBeDefined();
    const args = { attachmentIds: ["11111111-1111-4111-8111-111111111111"] };
    validateToolArguments(tool, { type: "toolCall", id: "prepare", name: tool.name, arguments: args });
    await tool.execute("prepare", args);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "material.prepare", args }));
    expect(store.appendEvent).toHaveBeenCalledWith(run.id, run.epoch, "canvas.committed", { revision: "7", nodeIds: ["source"] });
    expect(creativeActionId("r", "material.prepare", args, "first")).toBe(creativeActionId("r", "material.prepare", args, "second"));
  });
  it("resumes a per-question custom answer with its readable question summary without dispatching media", async () => {
    const fields = [{ id: "scope", title: "生成范围", type: "radio", required: true, options: [{ value: "people", label: "只做角色" }] }];
    const args = { title: "确认范围", question: "这次做哪些内容？", fields };
    const store = {
      assertFence: vi.fn(), appendEvent: vi.fn(),
      getAction: vi.fn(async () => { throw new HttpError(404, "action_not_found", "missing"); }),
      ask: vi.fn(async () => ({ ...args, options: [], id: "d", proposalHash: "hash", state: "answered", answer: { values: {}, notes: { scope: "角色已经在画布上了，只整理分镜" } } })),
    };
    const execute = vi.fn();
    const tool = createCreativeTools(run, store as unknown as CreativeAgentStore, execute).find(tool => tool.name === "user_ask")!;
    validateToolArguments(tool, { type: "toolCall", id: "q", name: tool.name, arguments: args });
    const output = await tool.execute("q", args);
    expect(output.details).toMatchObject({ result: { values: {}, notes: { scope: "角色已经在画布上了，只整理分镜" }, decision: { answer: "生成范围：角色已经在画布上了，只整理分镜", items: [{ question: "生成范围", answer: "角色已经在画布上了，只整理分镜" }] } } });
    expect(execute).not.toHaveBeenCalled();
  });
  it("keeps paid effects stable but lets polling observe fresh results", () => {
    for (const kind of ["image.generate", "video.generate", "canvas.create", "canvas.patch"]) expect(creativeActionId("r", kind, { a: 1 }, "a")).toBe(creativeActionId("r", kind, { a: 1 }, "b"));
    for (const kind of ["canvas.read", "generation.read", "generation.models", "creative.method"]) expect(creativeActionId("r", kind, { a: 1 }, "a")).not.toBe(creativeActionId("r", kind, { a: 1 }, "b"));
  });
  it("does not grant model arguments approval or arbitrary URL capabilities", () => {
    const tools = createCreativeTools(run, {} as CreativeAgentStore, vi.fn());
    const tool = tools.find(tool => tool.name === "image_generate")!;
    expect(() => validateToolArguments(tool, { type: "toolCall", id: "x", name: tool.name, arguments: { model: "model", prompt: "cat", mediaApproval: { decisionId: "fake" } } })).toThrow();
    expect(() => validateToolArguments(tool, { type: "toolCall", id: "x", name: tool.name, arguments: { model: "model", prompt: "cat", references: [{ nodeId: "n", url: "http://example.com/x.png" }] } })).toThrow();
    expect(tools.some(tool => /shell|bash|read_file|write_file/.test(tool.name))).toBe(false);
    const method = tools.find(tool => tool.name === "creative_method")!;
    expect(() => validateToolArguments(method, { type: "toolCall", id: "method", name: method.name, arguments: { methodId: "../../secrets" } })).toThrow();
  });
  it("publishes a canvas commit when a generation read attaches completed outputs", async () => {
    const store = {
      assertFence: vi.fn(), appendEvent: vi.fn(),
      getAction: vi.fn(async () => { throw new HttpError(404, "action_not_found", "missing"); }),
      claimAction: vi.fn(async (input: any) => ({ ...input, claimed: true })), completeAction: vi.fn(),
    };
    const execute = vi.fn(async () => ({ generationId: 10, status: "success", revision: "5", nodeIds: ["result"] }));
    const tool = createCreativeTools(run, store as unknown as CreativeAgentStore, execute).find(tool => tool.name === "generation_read")!;
    await tool.execute("poll", { generationId: 10 });
    expect(store.appendEvent).toHaveBeenCalledWith(run.id, run.epoch, "canvas.committed", { revision: "5", nodeIds: ["result"] });
  });
  it("preserves persisted dispatch evidence and observed generation IDs when an executor outcome is unknown", async () => {
    let receipt: any = null;
    const store = {
      assertFence: vi.fn(async () => run), appendEvent: vi.fn(async () => undefined), control: vi.fn(async () => undefined),
      getAction: vi.fn(async () => { if (!receipt) throw new HttpError(404, "action_not_found", "missing"); return receipt; }),
      ask: vi.fn(async () => ({ id: "decision", proposalHash: "proposal", state: "answered", answer: "approve", options: [{ value: "approve", label: "确认" }] })),
      claimAction: vi.fn(async (input: any) => { receipt = { ...input, id: input.actionId, state: "claimed", claimed: true, result: null }; return receipt; }),
      completeAction: vi.fn(async (_id: string, input: any) => { receipt = { ...receipt, ...input }; return receipt; }),
    };
    const execute = vi.fn(async () => { receipt.result = { mediaDispatch: { requestKeys: ["request-1", "request-2"], units: 2 } }; throw Object.assign(new CreativeAgentError("MEDIA_DISPATCH_UNKNOWN", "unknown"), { generationIds: [99], requestKeys: ["request-1", "request-2"] }); });
    const prepare = async () => ({ title: "生成", question: "确认？", options: [{ value: "approve", label: "确认" }], binding: { kind: "image.generate", argsHash: "args", units: 2 } });
    const preferredRun = { ...run, input: { ...run.input, preferences: { imageModel: "test" } } };
    const tool = createCreativeTools(preferredRun, store as unknown as CreativeAgentStore, execute, prepare).find(tool => tool.name === "image_generate")!;
    await expect(tool.execute("call", { model: "test", prompt: "cat" })).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
    expect(receipt).toMatchObject({ state: "unknown", result: { mediaDispatch: { units: 2 }, generationIds: [99], requestKeys: ["request-1", "request-2"] } });
    expect(store.control).toHaveBeenCalledWith("run", 1, expect.any(String), "pause", run.epoch);
    await expect(tool.execute("again", { model: "test", prompt: "cat" })).rejects.toMatchObject({ code: "action_not_replayable" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});


// Use the real store lookup over a query-only in-memory event transport.
function recoveryFixture(explicit: boolean, changed: boolean, legacy = false) {
  const source = (nodeId: string) => ({ nodeId, semanticHash: hash(nodeId), canvasId: 1, label: nodeId, kind: "image" });
  const a = source("source-a"), b = source("source-b");
  const wire = (ref: typeof a) => ({ nodeId: ref.nodeId, semanticHash: ref.semanticHash });
  const raw = { prompt: "original task", ...(explicit ? { references: [wire(a)] } : {}) };
  const effective = { prompt: "original task", references: [wire(a)] };
  const requestHash = hash({ args: effective, requirementsRevision: 0 });
  const actionId = creativeActionId("r", "image.generate", { matchingRequestHash: requestHash }, "same-call");
  const args = { ...effective, model: "visible-at-dispatch", params: { count: 1, quality: "" } };
  const current: any = { id: "r", sessionId: "s", actorUserId: 1, canvasId: 1, epoch: 2, input: { text: "第二张改用B", messageId: "m", matchingPolicyVersion: 2, selection: { references: [] }, preferences: {}, conversationContext: { version: 1, skillId: null, referenceAnchor: { runId: "r", messageId: "m", references: [changed ? b : a] }, latestRequestActionId: changed ? "later-action" : actionId } } };
  const original: any = { id: actionId, kind: "image.generate", runId: "r", actorUserId: 1, canvasId: 1, state: "succeeded", inputHash: hash(args), result: { generationIds: [123], matchingReplay: { requestHash, args } } };
  const starts: any[] = [{ actionId, toolCallId: "same-call", name: "image.generate", ...(legacy ? {} : { recovery: { revision: 0, rawArgsHash: hash(raw) } }) }];
  const query = vi.fn(async (_sql: string, _runId: string, kind: string, toolCallId: string) => starts.filter(start => start.name === kind && start.toolCallId === toolCallId).map(payload => ({ payload })));
  const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
  Object.assign(store, { assertFence: vi.fn(async () => current), appendEvent: vi.fn(async (_id, _epoch, type, payload) => { if (type === "tool.started") starts.push(payload); }), getAction: vi.fn(async (id: string) => { if (id !== actionId) throw new HttpError(404, "action_not_found", "missing"); return original; }) });
  const execute = vi.fn();
  const prepare = vi.fn(async (): Promise<any> => { throw new HttpError(400, "MEDIA_MODEL_UNAVAILABLE", "current catalog rejects new preparation"); });
  const tool = () => createCreativeTools(current, store, execute, prepare).find(t => t.name === "image_generate")!;
  return { a, b, raw, current, original, starts, query, store, execute, prepare, tool };
}

it.each([[false, false], [true, false], [false, true], [true, true]])("R27 exact call returns original receipt before subject defaults; explicit=%s changed=%s", async (explicit, changed) => {
  const f = recoveryFixture(explicit, changed);
  expect((await f.tool().execute("same-call", f.raw)).details).toMatchObject({ actionId: f.original.id, result: { generationIds: [123] } });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  expect(f.current.input.text).toBe("第二张改用B");
});

it.each(["unknown", "claimed", "failed"])("R27 exact %s receipt never falls through to new preparation", async state => {
  const f = recoveryFixture(false, true); f.original.state = state;
  await expect(f.tool().execute("same-call", f.raw)).rejects.toMatchObject({ code: state === "failed" ? "action_failed" : "action_not_replayable" });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});

it.each([false, true])("R27 legacy same-context replay remains compatible; explicit=%s", async explicit => {
  const f = recoveryFixture(explicit, false, true);
  expect((await f.tool().execute("same-call", f.raw)).details).toMatchObject({ result: { generationIds: [123] } });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});

it.each([false, true])("R27 legacy mixed context fails closed before new preparation; explicit=%s", async explicit => {
  const f = recoveryFixture(explicit, true, true);
  await expect(f.tool().execute("same-call", f.raw)).rejects.toMatchObject({ code: "media_recovery_unverified" });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});

it("R27 refuses mismatched raw identity or multiple durable action bindings instead of taking latest", async () => {
  const f = recoveryFixture(false, true);
  await expect(f.tool().execute("same-call", { ...f.raw, prompt: "different request" })).rejects.toMatchObject({ code: "media_recovery_unverified" });
  f.starts.push({ ...f.starts[0], actionId: "later-action" });
  await expect(f.tool().execute("same-call", f.raw)).rejects.toMatchObject({ code: "media_recovery_unverified" });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});

it("R27 a genuinely new call still enforces current sources and current model availability", async () => {
  const f = recoveryFixture(true, true);
  await expect(f.tool().execute("new-call", f.raw)).rejects.toMatchObject({ code: "SUBJECT_REFERENCE_CONFLICT" });
  expect(f.prepare).not.toHaveBeenCalled();
  await expect(f.tool().execute("new-call-omitted", { prompt: "new task" })).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
  expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ args: { prompt: "new task", references: [{ nodeId: "source-b", semanticHash: hash("source-b") }] } }));
  expect(f.execute).not.toHaveBeenCalled();
});


it.each([false, true])("R27 interrupted repair checkpoints A before grounded subject replacement, then recovers pending/new work; explicit=%s", async explicit => {
  const { repairPendingToolResults } = await import("@/lib/creative-agent/runner");
  const { validatedSubjectIntent } = await import("@/lib/creative-agent/conversation-context");
  const f = recoveryFixture(explicit, false);
  f.current.input.selection.references = [f.b]; // The grounded replace uses the newly selected source.
  const replacement = { mode: "replace", source: { kind: "message", sourceId: "m", quote: f.current.input.text } };
  const recordRequirements = vi.fn(async (_run: Run, raw: any) => {
    expect(validatedSubjectIntent(f.current, raw.subject)?.mode).toBe("replace");
    f.current.input.conversationContext.referenceAnchor.references = [f.b];
    return { version: 1, revision: 1, facts: [], conflicts: [], effectivePreferences: { image: { mode: "auto" }, video: { mode: "auto" } } };
  });
  Object.assign(f.store, { recordRequirements });
  const tools = () => createCreativeTools(f.current, f.store, f.execute, f.prepare);
  let durable: any[] = [{ role: "assistant", content: [
    { type: "toolCall", id: "same-call", name: "image_generate", arguments: f.raw },
    { type: "toolCall", id: "replace", name: "generation_requirements", arguments: { facts: [], subject: replacement } },
    { type: "toolCall", id: "new-work", name: "image_generate", arguments: { prompt: "new task" } },
  ] }];
  let writes = 0;
  const checkpoint = async (messages: any[]) => { if (++writes === 2) throw new Error("interrupted after durable subject replacement"); durable = structuredClone(messages); };
  await expect(repairPendingToolResults(durable, tools(), undefined, true, undefined, checkpoint)).rejects.toThrow("interrupted after durable subject replacement");
  expect(durable.filter(message => message.role === "toolResult").map(message => message.toolCallId)).toEqual(["same-call"]);
  expect(durable.at(-1).details).toMatchObject({ actionId: f.original.id, result: { generationIds: [123] } });
  expect(f.current.input.conversationContext.referenceAnchor.references).toEqual([f.b]);
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  const originalLookupCount = vi.mocked(f.store.getAction).mock.calls.filter(([id]) => id === f.original.id).length;
  await expect(repairPendingToolResults(durable, tools(), undefined, true, undefined, async messages => { durable = structuredClone(messages); })).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
  expect(vi.mocked(f.store.getAction).mock.calls.filter(([id]) => id === f.original.id)).toHaveLength(originalLookupCount);
  expect(durable.filter(message => message.role === "toolResult").map(message => message.toolCallId)).toEqual(["same-call", "replace"]);
  expect(recordRequirements).toHaveBeenCalledTimes(2);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.prepare).toHaveBeenCalledWith(expect.objectContaining({ args: { prompt: "new task", references: [{ nodeId: f.b.nodeId, semanticHash: f.b.semanticHash }] } }));
  expect((await f.tool().execute("same-call", f.raw)).details).toMatchObject({ actionId: f.original.id, result: { generationIds: [123] } });
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
});

it("R27 legacy provable replay writes the exact call binding for a later changed subject", async () => {
  const f = recoveryFixture(false, false, true);
  await f.tool().execute("same-call", f.raw);
  expect(f.starts.at(-1)).toMatchObject({ actionId: f.original.id, toolCallId: "same-call", recovery: { revision: 0, rawArgsHash: hash(f.raw) } });
  f.current.input.conversationContext.referenceAnchor.references = [f.b];
  expect((await f.tool().execute("same-call", f.raw)).details).toMatchObject({ result: { generationIds: [123] } });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});


it("R27 new work rejects changed source versions while the original exact receipt remains historical", async () => {
  const f = recoveryFixture(false, true);
  f.current.input.conversationContext.referenceAnchor.referenceVersions = [{ nodeId: f.b.nodeId, contentVersion: "accepted-original-version" }];
  f.prepare.mockResolvedValueOnce({ media: { selectionReceipt: { referenceVersions: [{ nodeId: f.b.nodeId, contentVersion: "changed-current-version" }], request: { prompt: "new task", references: [{ nodeId: f.b.nodeId, semanticHash: f.b.semanticHash }] } } } });
  await expect(f.tool().execute("new-version-call", { prompt: "new task" })).rejects.toMatchObject({ code: "REFERENCE_CHANGED" });
  expect((await f.tool().execute("same-call", f.raw)).details).toMatchObject({ result: { generationIds: [123] } });
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
});
