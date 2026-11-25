import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ resolve: vi.fn(), fetch: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/maintenance", async original => ({ ...await original<typeof import("@/lib/maintenance")>(), assertDurableWorkAdmission: vi.fn() }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: io.resolve, creativeAgentSupportsVision: () => true }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: io.fetch }));
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: io.begin, finishLlmCost: io.finish }));
vi.mock("@/lib/creative-agent/debug-store", () => ({ appendDebugEvent: vi.fn(), pruneDebugRecords: vi.fn() }));
import prisma from "@/lib/prisma";
import { creativeAgentStore as store } from "@/lib/creative-agent/store";
import { createCreativeAgentModelStream } from "@/lib/creative-agent/llm-broker";
import { hash, type Run } from "@/lib/creative-agent/store-types";
const enabled = process.env.CREATIVE_AGENT_DB_TEST === "1";
const selected = { providerId: "fixture", modelId: "fixture-model" };
const route = { scenarioId: "agent.chat", ...selected, providerName: "fixture", protocol: "openai-chat", source: "configured", status: "ready", url: "http://not-used.invalid/chat", apiKey: "fixture", timeoutMs: 10000, egressDecision: { providerId: "fixture", mode: "direct" } };
let actorUserId: number, canvasId: number;
const releases: (() => void)[] = [];
const inFlight: Promise<unknown>[] = [];
const scope = (run: Run) => ({ actorUserId, canvasId, runId: run.id, epoch: run.epoch, options: run.input });
const context = (run: Run) => ({ systemPrompt: "revision fixture", messages: [{ role: "user" as const, content: run.input.text, timestamp: Date.parse(run.createdAt) }] });
const response = (text = "new answer") => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function started(sessionId?: string) {
  const queued = await store.enqueue({ actorUserId, canvasId, sessionId, messageId: randomUUID(), text: "旧要求", baseRevision: "0", selection: { nodeIds: [], edgeIds: [], references: [] }, model: selected });
  const run = await store.claimRun("revision-first", 60000); expect(run?.id).toBe(queued.run.id); return run!;
}
async function claim(run: Run) { const next = await store.claimRun("revision-next", 60000); expect(next?.id).toBe(run.id); return next!; }
function call(run: Run, systemPrompt = "revision fixture") { const work = (async () => { const model = await createCreativeAgentModelStream(scope(run)); return model.stream(model.model, { ...context(run), systemPrompt }).result(); })(); inFlight.push(work); return work; }
function edit(run: Run, text = "新要求", requestId = randomUUID()) { return { runId: run.id, messageId: run.input.messageId, requestId, expectedText: run.input.text, text }; }
async function stop(run: Run) { const current = await store.getRun(run.id); if (!["completed", "failed", "stopped"].includes(current.status)) await store.control(run.id, actorUserId, randomUUID(), "stop"); }

describe.skipIf(!enabled)("server message revision boundary (real PG, controlled provider only)", () => {
  beforeAll(async () => { actorUserId = (await prisma.user.create({ data: { username: "message-revision-" + randomUUID(), password: "fixture-only" } })).id; });
  beforeEach(async () => {
    vi.restoreAllMocks(); io.resolve.mockReset().mockResolvedValue({ status: "ready", route }); io.fetch.mockReset().mockImplementation(async () => response());
    io.begin.mockReset().mockImplementation(async (input, tx) => ({ ...await tx.usageLedger.create({ data: { userId: String(actorUserId), authUserId: actorUserId, module: "llm", source: "agent.chat", model: input.model, status: "pending", unitType: "token" } }), snapshot: {} }));
    io.finish.mockReset().mockResolvedValue(undefined);
    canvasId = (await prisma.canvas.create({ data: { authUserId: actorUserId, title: "revision fixture", data: { schemaVersion: 2, mode: "smart", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: false, gridSize: 20 } } } })).id;
  });
  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    await Promise.allSettled(inFlight.splice(0));
    for (const run of await prisma.creativeAgentRun.findMany({ where: { actorUserId }, select: { id: true } })) await stop(await store.getRun(run.id));
  });
  afterAll(async () => { vi.restoreAllMocks(); if (actorUserId) { await prisma.usageLedger.deleteMany({ where: { authUserId: actorUserId } }); await prisma.generation.deleteMany({ where: { authUserId: actorUserId } }); await prisma.user.delete({ where: { id: actorUserId } }); } await prisma.$disconnect(); });

  it.each(["claimed", "unknown"] as const)("allows one new dispatch after replacing an old %s main, retaining late usage", async state => {
    const old = await started(), reached = deferred<void>(), pending = deferred<Response>();
    releases.push(() => pending.resolve(response("cleanup")));
    io.fetch.mockImplementationOnce(() => { reached.resolve(); return pending.promise; });
    const oldCall = call(old); await reached.promise;
    const oldAction = await store.getAction((await store.actionReceipts(old.id))[0].id);
    if (state === "unknown") await store.completeAction(oldAction.id, { runId: old.id, epoch: old.epoch, state, result: { error: "uncertain after dispatch" } });
    const request = edit(old); const accepted = await store.reviseMessage(actorUserId, canvasId, request);
    expect((await store.getAction(oldAction.id)).state).toBe("unknown");
    let current = await store.getRun(old.id);
    current = await claim(current);
    expect((await call(current)).stopReason).toBe("stop");
    expect(current.input).toMatchObject({ text: request.text, revision: 1, revisionStartEpoch: old.epoch + 1 });
    expect(await store.reviseMessage(actorUserId, canvasId, request)).toEqual(accepted);
    expect((await store.getRun(old.id)).input.revision).toBe(1);
    await store.control(current.id, actorUserId, randomUUID(), "pause");
    await store.control(current.id, actorUserId, randomUUID(), "resume"); current = await claim(current);
    expect(current.input.revisionStartEpoch).toBe(old.epoch + 1);
    expect((await call(current, "host prompt changed")).stopReason).toBe("stop");
    expect(io.fetch).toHaveBeenCalledTimes(2); expect(io.begin).toHaveBeenCalledTimes(2);
    pending.resolve(response("old late answer")); expect((await oldCall).stopReason).toBe("error");
    const journal = await store.actionReceipts(old.id);
    expect(journal).toHaveLength(2); expect(journal.map(action => action.id)).toContain(oldAction.id);
    const oldReceipt = await store.getAction(oldAction.id);
    expect(oldReceipt).toMatchObject({ epoch: old.epoch, state: "unknown", inputHash: oldAction.inputHash, result: { creativeAttempt: { callId: oldAction.id, usage: { inputTokens: 11, outputTokens: 7 } } } });
    expect(journal.find(action => action.id !== oldAction.id)).toMatchObject({ state: "succeeded", result: { content: [{ type: "text", text: "new answer" }] } });
    expect(await prisma.usageLedger.count({ where: { authUserId: actorUserId, requestKey: { in: journal.map(action => action.id) } } })).toBe(2);
    const snapshot = await store.snapshot(actorUserId, canvasId, current.sessionId);
    expect(snapshot.usageScopes.allAttempts.main).toMatchObject({ calls: 2, reportedCalls: 2, unknownCalls: 1, usage: { inputTokens: 22, outputTokens: 14 } });
    await stop(current);
  });

  it("keeps same-revision unknown blocked after a new lease and system prompt", async () => {
    const old = await started(); await store.reviseMessage(actorUserId, canvasId, edit(old)); let current = await claim(old);
    io.fetch.mockRejectedValueOnce(new Error("response lost after dispatch")); expect((await call(current)).stopReason).toBe("error");
    await prisma.creativeAgentRun.update({ where: { id: current.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    await store.recoverExpired();
    await expect(store.control(current.id, actorUserId, randomUUID(), "resume")).rejects.toMatchObject({ code: "action_outcome_unknown" });
    // Simulate a separately issued worker lease without altering the persisted input version.
    await prisma.creativeAgentRun.update({ where: { id: current.id }, data: { status: "queued" } }); current = await claim(current);
    expect(current.input).toMatchObject({ revision: 1, revisionStartEpoch: old.epoch + 1 });
    expect((await call(current, "different host system")).stopReason).toBe("error"); expect(io.fetch).toHaveBeenCalledOnce();
    await stop(current);
  });

  it("resumes the edited revision when only the superseded revision has unknown work", async () => {
    const old = await started(); io.fetch.mockRejectedValueOnce(new Error("old response lost")); await call(old);
    await store.reviseMessage(actorUserId, canvasId, edit(old)); let current = await claim(old);
    await store.control(current.id, actorUserId, randomUUID(), "pause");
    await store.control(current.id, actorUserId, randomUUID(), "resume"); current = await claim(current);
    expect(current.input).toMatchObject({ revision: 1, revisionStartEpoch: old.epoch + 1 });
    expect((await call(current)).stopReason).toBe("stop"); expect(io.fetch).toHaveBeenCalledTimes(2); await stop(current);
  });

  it("does not trust a legacy revision number without a server epoch boundary", async () => {
    const run = await started(); io.fetch.mockRejectedValueOnce(new Error("dispatched response lost")); await call(run);
    await prisma.creativeAgentRun.update({ where: { id: run.id }, data: { input: { ...run.input, revision: 99 } as any, epoch: run.epoch + 2 } });
    const legacy = await store.getRun(run.id); expect((await call(legacy)).stopReason).toBe("error"); expect(io.fetch).toHaveBeenCalledOnce(); await stop(legacy);
  });

  it("accepts one concurrent expectedText winner, then a second edit, fencing every old mutation", async () => {
    const old = await started();
    await store.saveTranscript(old.id, old.epoch, [...context(old).messages, { role: "assistant", content: [{ type: "text", text: "old plan" }] }]);
    const requests = [edit(old, "胜出候选 A"), edit(old, "胜出候选 B")];
    const outcomes = await Promise.allSettled(requests.map(request => store.reviseMessage(actorUserId, canvasId, request)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "message_edit_conflict" } });
    const winner = await store.getRun(old.id); expect(winner.input.revision).toBe(1);
    await store.reviseMessage(actorUserId, canvasId, edit(winner, "最终新要求")); const newest = await claim(winner);
    expect(newest.input).toMatchObject({ text: "最终新要求", revision: 2, revisionStartEpoch: winner.epoch + 1 });
    expect(await store.getTranscript(old.sessionId)).toEqual([]);
    const currentContext = newest.input.conversationContext;
    for (const attempt of [
      () => store.claimAction({ ...scope(old), actionId: randomUUID(), kind: "canvas.read", inputHash: hash("old tool") }),
      () => store.saveAssistant(old.id, old.epoch, randomUUID(), "late assistant"),
      () => store.saveTranscript(old.id, old.epoch, context(old).messages),
      () => store.appendEvent(old.id, old.epoch, "tool.started", { actionId: "old", name: "image.generate" }),
      () => store.savePreparedReferences(old.id, old.epoch, { nodeIds: ["old"], edgeIds: [], references: [] }, "old"),
      () => store.recordRequirements(old, { facts: [], subject: { mode: "clear" } }),
    ]) await expect(attempt()).rejects.toMatchObject({ code: "stale_epoch" });
    await store.finish(old.id, old.epoch, "failed", "old finally failed");
    expect(await store.getRun(old.id)).toMatchObject({ epoch: newest.epoch, status: "running", error: null, input: { text: "最终新要求", revision: 2 } });
    expect((await store.getRun(old.id)).input.conversationContext).toEqual(currentContext);
    expect((await call(newest)).stopReason).toBe("stop"); expect(io.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(io.fetch.mock.calls[0][2].body); expect(JSON.stringify(body.messages)).toContain("最终新要求"); expect(JSON.stringify(body.messages)).not.toContain("old plan");
    await stop(newest);
  });

  it("keeps prior-run delivered media in its original receipt and retains the post-media edit gate", async () => {
    const previous = await started(), actionId = randomUUID();
    const generation = await prisma.generation.create({ data: { authUserId: actorUserId, canvasId, source: "agent", type: "image_edit", prompt: "fixture previous media", status: "success", model: "fixture-image" } });
    await store.claimAction({ ...scope(previous), actionId, kind: "image.generate", inputHash: hash("fixture media receipt") });
    await store.completeAction(actionId, { runId: previous.id, epoch: previous.epoch, state: "succeeded", result: { generationId: generation.id, status: "success" } });
    await store.publishMedia(previous, { generationId: generation.id, status: "success", mediaType: "image", model: "fixture-image", nodeIds: [], outputs: [{ url: "/uploads/fixture-existing.png" }] });
    await expect(store.reviseMessage(actorUserId, canvasId, edit(previous))).rejects.toMatchObject({ code: "message_edit_closed" });
    await store.finish(previous.id, previous.epoch, "completed");
    const old = await started(previous.sessionId); await store.reviseMessage(actorUserId, canvasId, edit(old)); const current = await claim(old);
    const snapshot = await store.snapshot(actorUserId, canvasId, old.sessionId);
    expect(snapshot.run).toMatchObject({ id: current.id, status: "running" });
    expect(snapshot.media).toEqual([expect.objectContaining({ generationId: generation.id, runId: previous.id, status: "success" })]);
    await store.assertMediaDelivery(previous, generation.id);
    await expect(store.assertMediaDelivery(current, generation.id)).rejects.toMatchObject({ code: "media_receipt_not_found" });
    expect((await call(current)).stopReason).toBe("stop"); expect(io.fetch).toHaveBeenCalledOnce();
    expect(await prisma.generation.count({ where: { authUserId: actorUserId } })).toBe(1); await stop(current);
  });

  it("fences the old request when edited after claim but before dispatch", async () => {
    const old = await started(), reached = deferred<void>(), release = deferred<void>();
    releases.push(() => release.resolve());
    const save = store.saveLlmAttempt.bind(store);
    vi.spyOn(store, "saveLlmAttempt").mockImplementation(async (scope, attempt) => {
      await save(scope, attempt);
      if (attempt.status === "prepared") { reached.resolve(); await release.promise; }
    });
    const oldCall = call(old); await reached.promise;
    const oldActionId = (await store.actionReceipts(old.id))[0].id;
    await store.reviseMessage(actorUserId, canvasId, edit(old)); const current = await claim(old);
    release.resolve(); expect((await oldCall).stopReason).toBe("error"); expect(io.fetch).not.toHaveBeenCalled();
    expect((await call(current)).stopReason).toBe("stop"); expect(io.fetch).toHaveBeenCalledOnce();
    const oldReceipt = await store.getAction(oldActionId);
    expect(oldReceipt).toMatchObject({ state: "unknown", result: { creativeAttempt: { status: "failed" } } });
    expect((oldReceipt.result as any).creativeAttempt.timing.dispatchedAt).toBeUndefined(); await stop(current);
  });
});
