import { describe, expect, it, vi } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createCreativeTools, type ToolExecutionInput } from "@/lib/creative-agent/tools";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import { hash, HttpError, type Decision, type DecisionPrompt, type Run } from "@/lib/creative-agent/store-types";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
vi.mock("@/lib/creative-agent/skill-packages", () => ({ listCreativeSkills: vi.fn(), readCreativeSkill: vi.fn() }));

const run: Run = {
  id: "model-choice-run", sessionId: "session", actorUserId: 1, canvasId: 1, epoch: 2,
  status: "running", error: null, workerId: "worker", leaseExpiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  input: {
    actorUserId: 1, canvasId: 1, messageId: "m", text: "生成角色肖像", baseRevision: "1",
    preferences: {}, selection: { nodeIds: [], edgeIds: [], references: [] },
  },
};
const args = { model: "suggested", prompt: "角色肖像", references: [{ nodeId: "image", semanticHash: "a".repeat(64) }], params: { count: 1 } };
function harness(selected?: unknown) {
  const decisions = new Map<string, Decision>(), actions = new Map<string, any>();
  if (selected) decisions.set("combined-question", { id: "combined", runId: run.id, actionId: "combined-question", proposalHash: "combined-hash", state: "answered", answer: selected, title: "确认制作要求", question: "选择模型与范围", options: [], fields: [{ id: "imageModel", title: "图片模型", type: "select", required: true, options: [{ value: "chosen", label: "用户模型" }, { value: "suggested", label: "建议模型" }] }] });
  const store = {
    assertFence: vi.fn(async () => undefined), appendEvent: vi.fn(async () => undefined), defer: vi.fn(async () => true),
    getModelChoice: vi.fn(async (_runId: string, fieldId: string) => [...decisions.values()].reverse().find(d => d.state === "answered" && d.fields?.some(f => f.id === fieldId)) ?? null),
    getAction: vi.fn(async (id: string) => { if (!actions.has(id)) throw new HttpError(404, "action_not_found", "missing"); return actions.get(id); }),
    ask: vi.fn(async (_run: Run, id: string, prompt: DecisionPrompt) => {
      const prior = decisions.get(id);
      if (prior) { if (prior.proposalHash !== hash(prompt)) throw new HttpError(409, "decision_changed", "changed"); return prior; }
      const decision = { ...prompt, id, runId: run.id, actionId: id, proposalHash: hash(prompt), state: "pending" as const, answer: null }; decisions.set(id, decision); return decision;
    }),
    claimAction: vi.fn(async (input: any) => { const receipt = { ...input, id: input.actionId, state: "claimed", claimed: true }; actions.set(input.actionId, receipt); return receipt; }),
    completeAction: vi.fn(async (id: string, result: any) => { actions.set(id, { ...actions.get(id), ...result }); }),
  };
  const execute = vi.fn(async (input: ToolExecutionInput) => input.kind === "generation.models" ? { image: [{ id: "suggested", label: "建议模型" }, { id: "chosen", label: "用户模型" }, { id: "unsupported", label: "不支持参考图" }], video: [] } : { generationId: 42 });
  const prepare = vi.fn(async (input: ToolExecutionInput) => {
    if (!input.args.model) return { title: "选择模型", question: "请选择图片模型", options: [], fields: [{ id: "imageModel", title: "图片模型", type: "select" as const, required: true, options: [{ value: "suggested", label: "建议模型" }, { value: "chosen", label: "用户模型" }] }] };
    if (input.args.model === "unsupported") throw new CreativeAgentError("MEDIA_PARAMS_INVALID", "unsupported", 400);
    return { title: "确认生成", question: `模型 ${input.args.model}`, options: [{ value: "approve", label: "确认" }, { value: "cancel", label: "取消" }], binding: { kind: input.kind, argsHash: hash(input.args), units: 1 } };
  });
  const tool = (currentRun = run) => createCreativeTools(currentRun, store as unknown as CreativeAgentStore, execute, prepare).find(tool => tool.name === "image_generate")!;
  const answer = (decision: Decision, value: unknown) => { decision.state = "answered"; decision.answer = value; };
  return { tool, store, execute, prepare, decisions, actions, answer };
}
describe("durable media model choice", () => {
  it("uses fresh model and approval decisions after the original question is edited", async () => {
    const h = harness();
    await expect(h.tool().execute("first", args)).rejects.toMatchObject({ code: "run_deferred" });
    const oldChoice = [...h.decisions.values()][0];
    oldChoice.state = "cancelled";
    const revisedRun = { ...run, input: { ...run.input, revision: 1 } };
    await expect(h.tool(revisedRun).execute("first", args)).rejects.toMatchObject({ code: "run_deferred" });
    const choices = [...h.decisions.values()];
    expect(choices).toHaveLength(2);
    expect(choices[0].actionId).not.toBe(choices[1].actionId);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("returns revision feedback without dispatch, then requires approval for the revised plan", async () => {
    const h = harness({ values: { imageModel: "chosen" } });
    await expect(h.tool().execute("first", args)).rejects.toMatchObject({ code: "run_deferred" });
    const original = [...h.decisions.values()].find(d => d.binding)!;
    h.answer(original, { revision: "改成普通家庭真实客厅" });
    const result = await h.tool().execute("resume", args);
    expect(result.details).toMatchObject({ result: { cancelled: true, revisionRequested: true, revision: "改成普通家庭真实客厅", decision: { answer: expect.stringContaining("普通家庭真实客厅") } } });
    expect(h.execute).not.toHaveBeenCalled();
    await h.tool().execute("duplicate", args);
    expect(h.execute).not.toHaveBeenCalled();
    const revised = { ...args, prompt: "普通家庭真实客厅" };
    await expect(h.tool().execute("new-plan", revised)).rejects.toMatchObject({ code: "run_deferred" });
    const next = [...h.decisions.values()].find(d => d.binding && d.id !== original.id)!;
    expect(next.proposalHash).not.toBe(original.proposalHash);
    expect(h.execute).not.toHaveBeenCalled();
    h.answer(next, "approve");
    await h.tool().execute("approved", revised);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ prompt: revised.prompt }) }));
  });
  it("shows eligible live models before approval even when the assistant supplies a model", async () => {
    const h = harness();
    await expect(h.tool().execute("first", args)).rejects.toMatchObject({ code: "run_deferred" });
    const choice = [...h.decisions.values()][0];
    expect(choice.fields).toMatchObject([{ id: "imageModel", type: "select", required: true, options: [{ value: "suggested", label: "建议模型" }, { value: "chosen", label: "用户模型" }] }]);
    expect(choice.binding).toBeUndefined();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.store.claimAction).not.toHaveBeenCalled();
  });
  it("accepts omitted model and resolves the saved user choice into one approval and one dispatch across repeated resume", async () => {
    const h = harness();
    const { model: _model, ...omitted } = args;
    validateToolArguments(h.tool(), { type: "toolCall", id: "first", name: "image_generate", arguments: omitted });
    await expect(h.tool().execute("first", omitted)).rejects.toMatchObject({ code: "run_deferred" });
    h.answer([...h.decisions.values()][0], { values: { imageModel: "chosen" } });
    await expect(h.tool().execute("resume", omitted)).rejects.toMatchObject({ code: "run_deferred" });
    const approval = [...h.decisions.values()].find(d => d.binding)!;
    expect(approval.question).toContain("chosen");
    h.answer(approval, "approve");
    await h.tool().execute("resume-again", omitted);
    await h.tool().execute("duplicate", omitted);
    const dispatches = h.execute.mock.calls.filter(([input]) => input.kind === "image.generate");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0][0]).toMatchObject({ args: { model: "chosen" }, mediaApproval: { decisionId: approval.id, proposalHash: approval.proposalHash } });
    expect(h.decisions.size).toBe(2);
  });
  it("reuses a combined user_ask choice without another model selection", async () => {
    const h = harness({ values: { imageModel: "chosen" } });
    await expect(h.tool().execute("generate", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect(h.store.ask).toHaveBeenCalledTimes(1);
    expect(h.store.ask.mock.calls[0][2]).toMatchObject({ binding: { argsHash: hash({ ...args, model: "chosen" }) } });
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("records skipped selection without preparing approval or dispatching media, including replay", async () => {
    const h = harness({ skipped: true });
    const first = await h.tool().execute("generate", args);
    const repeat = await h.tool().execute("repeat", args);
    expect(first.details).toMatchObject({ result: { cancelled: true, skipped: true } });
    expect(repeat.details).toMatchObject({ result: { cancelled: true, skipped: true } });
    expect(h.store.ask).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("resumes a fallback skip without asking again or creating a media approval", async () => {
    const h = harness();
    await expect(h.tool().execute("generate", args)).rejects.toMatchObject({ code: "run_deferred" });
    h.answer([...h.decisions.values()][0], { skipped: true });
    const result = await h.tool().execute("skip", args);
    await h.tool().execute("duplicate", args);
    expect(result.details).toMatchObject({ result: { cancelled: true, skipped: true } });
    expect(h.store.ask).toHaveBeenCalledTimes(1); expect(h.execute).not.toHaveBeenCalled();
    expect([...h.decisions.values()].some(d => d.binding)).toBe(false);
  });
  it("cancels the saved model question without dispatching", async () => {
    const h = harness();
    await expect(h.tool().execute("generate", args)).rejects.toMatchObject({ code: "run_deferred" });
    [...h.decisions.values()][0].state = "cancelled";
    await expect(h.tool().execute("resume", args)).rejects.toMatchObject({ code: "decision_cancelled" });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.store.claimAction).not.toHaveBeenCalled();
  });
  it("revalidates the saved model against current capability before approval", async () => {
    const h = harness({ values: { imageModel: "chosen" } });
    h.prepare.mockRejectedValueOnce(new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "disabled", 400));
    await expect(h.tool().execute("generate", args)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
    expect(h.store.ask).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it("never treats an empty optional model response as selection", async () => {
    const h = harness({ values: {} });
    const d = [...h.decisions.values()][0]; d.fields![0].required = false;
    const output = await h.tool().execute("generate", args);
    expect(output.details).toMatchObject({ result: { cancelled: true } });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.store.ask).not.toHaveBeenCalled();
  });
  it("honors explicit input preference and rejects assistant mismatch", async () => {
    const h = harness(); const preferred = { ...run, input: { ...run.input, preferences: { imageModel: "chosen" } } };
    await expect(h.tool(preferred).execute("bad", args)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
    expect(h.store.ask).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
    await expect(h.tool(preferred).execute("good", { ...args, model: "chosen" })).rejects.toMatchObject({ code: "run_deferred" });
    expect(h.store.ask.mock.calls[0][2].binding).toBeDefined();
    expect(h.store.getModelChoice).not.toHaveBeenCalled();
  });
  it("requires a fresh bound approval when the saved model changes", async () => {
    const h = harness({ values: { imageModel: "chosen" } });
    await expect(h.tool().execute("generate", args)).rejects.toMatchObject({ code: "run_deferred" });
    const oldApproval = [...h.decisions.values()].find(d => d.binding)!;
    h.answer(oldApproval, "approve");
    h.answer(h.decisions.get("combined-question")!, { values: { imageModel: "suggested" } });
    await expect(h.tool().execute("changed", args)).rejects.toMatchObject({ code: "run_deferred" });
    const approvals = [...h.decisions.values()].filter(d => d.binding);
    expect(approvals).toHaveLength(2);
    expect(approvals[1].binding!.argsHash).not.toBe(oldApproval.binding!.argsHash);
    expect(approvals[1].state).toBe("pending"); expect(h.execute).not.toHaveBeenCalled();
  });
});

describe("structured media preference enforcement", () => {
  const preferredRun = (preferences: unknown) => ({ ...run, input: { ...run.input, preferences } } as Run);
  it("canonical auto overrides legacy fixed choice and goes straight to exact approval", async () => {
    const h = harness();
    const current = preferredRun({ imageModel: "chosen", image: { mode: "auto", params: { aspectRatio: "16:9", resolution: "2K" } } });
    await expect(h.tool(current).execute("auto", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect(h.store.getModelChoice).not.toHaveBeenCalled();
    expect([...h.decisions.values()]).toHaveLength(1);
    expect([...h.decisions.values()][0].binding).toBeDefined();
    expect(h.prepare).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ model: "suggested", params: { count: 1, aspectRatio: "16:9", resolution: "2K" } }) }));
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("auto without a chosen model gives an actionable error without asking the user for a model", async () => {
    const h = harness(); const { model: _model, ...omitted } = args;
    await expect(h.tool(preferredRun({ image: { mode: "auto" } })).execute("auto", omitted)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE", message: expect.stringContaining("generation_models") });
    expect(h.store.ask).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("rejects canonical fixed model mismatch before asking or dispatching", async () => {
    const h = harness();
    await expect(h.tool(preferredRun({ image: { mode: "explicit", model: "chosen" } })).execute("bad", args)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
    expect(h.store.ask).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it("overrides only fixed parameters before hashing and submits the same approved args once on replay", async () => {
    const h = harness();
    const preferences = { image: { mode: "explicit", model: "chosen", params: { aspectRatio: "16:9", quality: "high" } } };
    const current = preferredRun(preferences); const raw = { ...args, model: "chosen", params: { count: 2, aspectRatio: "1:1", quality: "low", resolution: "2K" } };
    const expected = { ...raw, params: { count: 2, aspectRatio: "16:9", quality: "high", resolution: "2K" } };
    await expect(h.tool(current).execute("first", raw)).rejects.toMatchObject({ code: "run_deferred" });
    const approval = [...h.decisions.values()][0];
    expect(approval.binding).toMatchObject({ argsHash: hash(expected) });
    expect(raw.params.aspectRatio).toBe("1:1");
    h.answer(approval, "approve");
    await h.tool(current).execute("resume", raw); await h.tool(current).execute("replay", raw);
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.execute.mock.calls[0][0].args).toEqual(expected);
    expect(h.decisions.size).toBe(1);
  });
  it("still rejects models/constraints that the broker cannot prepare in auto mode", async () => {
    const h = harness();
    h.prepare.mockRejectedValueOnce(new CreativeAgentError("MEDIA_PARAMS_INVALID", "unsupported", 400));
    await expect(h.tool(preferredRun({ image: { mode: "auto" } })).execute("bad", args)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
    expect(h.store.ask).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
});

describe("v2 tool policy", () => {
  const current = (extra = {}) => ({ ...run, input: { ...run.input, messageId: "m", text: "本次用 suggested，1:1", matchingPolicyVersion: 2 as const, ...extra } });
  it("empty first use prepares exact approval without asking for a model", async () => {
    const h = harness();
    await expect(h.tool(current()).execute("new", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect(h.store.getModelChoice).not.toHaveBeenCalled();
    expect([...h.decisions.values()]).toHaveLength(1);
    expect([...h.decisions.values()][0].binding).toBeDefined();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("uses effective per-turn overrides ahead of saved defaults", async () => {
    const h = harness();
    const r = current({ preferences: { image: { mode: "explicit", model: "chosen", params: { aspectRatio: "16:9" } } }, effectivePreferences: { image: { mode: "explicit", model: "suggested", params: { aspectRatio: "1:1" } }, video: { mode: "auto" } } });
    await expect(h.tool(r).execute("override", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect(h.prepare.mock.calls[0][0].args).toMatchObject({ model: "suggested", params: { aspectRatio: "1:1" } });
    expect(r.input.preferences?.image?.model).toBe("chosen");
  });
  it("filters mixed semantic questions and rejects the legacy question schema for new runs", async () => {
    const h = harness();
    Object.assign(h.store, { getSemanticQuestions: vi.fn(async () => []) });
    const question = createCreativeTools(current(), h.store as any, h.execute, h.prepare).find(t => t.name === "user_ask")!;
    const base = { title: "条件", question: "补充必要条件", fields: [{ id: "renamedEngine", title: "型号", type: "text", semantic: { purpose: "missing_input", requirement: "image.modelChoice", unresolvedId: "model", revision: 0 } }, { id: "product", title: "产品图", type: "text", semantic: { purpose: "missing_input", requirement: "references.product", unresolvedId: "product", revision: 0 } }] };
    await expect(question.execute("ask", base)).rejects.toMatchObject({ code: "run_deferred" });
    expect([...h.decisions.values()][0].fields?.map(f => f.id)).toEqual(["product"]);
    await expect(question.execute("legacy", { title: "条件", question: "型号？", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] })).rejects.toMatchObject({ code: "invalid_question" });
  });
  it("returns known preferences without showing a model-only question", async () => {
    const h = harness(); Object.assign(h.store, { getSemanticQuestions: vi.fn(async () => []) });
    const question = createCreativeTools(current(), h.store as any, h.execute, h.prepare).find(t => t.name === "user_ask")!;
    const result = await question.execute("ask", { title: "条件", question: "选哪个", fields: [{ id: "renamedEngine", title: "型号", type: "text", semantic: { purpose: "missing_input", requirement: "image.modelChoice", unresolvedId: "model", revision: 0 } }] });
    expect(result.details).toMatchObject({ result: { suppressed: true, effectivePreferences: { image: { mode: "auto" } } } });
    expect(h.store.ask).not.toHaveBeenCalled();
  });
});

it('v2 accepts omitted or assistant-suggested models and follows the server receipt without a model question', async () => {
 const h = harness();
 const current = { ...run, input: { ...run.input, matchingPolicyVersion: 2 as const, effectivePreferences: { image: { mode: 'auto' as const } } } };
 Object.assign(h.store, { getRun: async () => current, saveGenerationPlan: async (_run:any,id:string,plan:any) => { (current.input as any).generationPlans ??= {}; (current.input as any).generationPlans[id] ??= {id,plan,expiresAt:'2099-01-01T00:00:00.000Z'}; return (current.input as any).generationPlans[id]; } });
 h.prepare.mockImplementation(async (input: any) => {
  const request = { ...input.args, model: 'server-selected' };
  return { title: '确认生成', question: '实际模型', options: [{ value: 'approve', label: '确认' }], binding: { kind: input.kind, units: 1, argsHash: hash(request) }, media: { mediaType: 'image', model: { id: 'server-selected', label: 'server' }, prompt: request.prompt, params: request.params, units: 1, references: [], selectionReceipt: { id: 'receipt', request,mediaType:'image',requirementsRevision:0,output:{calls:1,minReturned:0,maxReturned:1} } } } as any;
 });
 const { model: _model, ...omitted } = args;
 await expect(h.tool(current).execute('new', omitted)).rejects.toMatchObject({ code: 'run_deferred' });
 const approval = [...h.decisions.values()][0]; h.answer(approval, 'approve');
 const done = await h.tool(current).execute('resume', omitted);
 expect(h.store.getModelChoice).not.toHaveBeenCalled(); expect(h.decisions.size).toBe(1);
 h.prepare.mockRejectedValue(new CreativeAgentError('MEDIA_MODEL_UNAVAILABLE', 'hidden after dispatch', 400));
 await expect(h.tool(current).execute('replay', omitted)).resolves.toMatchObject({ details: { result: { generationId: 42 } } });
 expect(h.prepare).toHaveBeenCalledTimes(2); expect(h.execute).toHaveBeenCalledTimes(1);
 expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ model: 'server-selected' }), matching: expect.objectContaining({ receipt: expect.objectContaining({ id: 'receipt' }) }) }));
});

it('offers generation_plan inline requirement facts in the ordinary v2 tool loop', () => {
 const h = harness(); const tools = createCreativeTools({ ...run, input: { ...run.input, matchingPolicyVersion: 2 } }, h.store as any, h.execute, h.prepare);
 const plan = tools.find(tool => tool.name === 'generation_plan'); expect(plan).toBeDefined();
 expect((plan!.parameters as any).properties.facts).toBeDefined();
 expect((plan!.parameters as any).properties.steps).toBeDefined();
});
