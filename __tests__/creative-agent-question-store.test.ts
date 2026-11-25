import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
import { CreativeAgentStore } from "@/lib/creative-agent/store";
import type { Run } from "@/lib/creative-agent/store-types";

// Exercise store serialization, persisted answers and request deduplication without a business DB.
let row: Record<string, any> | undefined;
let events: Record<string, unknown>[];
let requests: Map<string, Record<string, unknown>>;
let runRow: Record<string, any>;
const db = {
  async $transaction(fn: (client: Record<string, unknown>) => unknown): Promise<unknown> { return fn(db); },
  async $queryRawUnsafe(sql: string, ...values: any[]) {
    if (sql.includes('FROM "CreativeAgentRun"')) return [runRow];
    if (sql.includes('FROM "CreativeAgentRequest"')) return requests.has(values[0]) ? [requests.get(values[0])] : [];
    if (sql.startsWith('INSERT INTO "CreativeAgentDecision"')) {
      const [id, run_id, action_id, proposal_hash, title, question, options, binding, fields] = values;
      row = { id, run_id, action_id, proposal_hash, title, question, options: JSON.parse(options), binding: JSON.parse(binding), fields: JSON.parse(fields), state: "pending", answer: null };
      return [row];
    }
    if (sql.includes('FROM "CreativeAgentDecision"')) return row ? [row] : [];
    throw new Error(`Unexpected read: ${sql}`);
  },
  async $executeRawUnsafe(sql: string, ...values: any[]) {
    if (sql.startsWith('INSERT INTO "CreativeAgentEvent"')) events.push({ type: values[1], ...JSON.parse(values[2]) });
    else if (sql.startsWith('UPDATE "CreativeAgentDecision"')) { row!.state = "answered"; row!.answer = JSON.parse(values[1]); }
    else if (sql.startsWith('INSERT INTO "CreativeAgentRequest"')) requests.set(values[0], { actor_user_id: values[1], input_hash: values[2], result: JSON.parse(values[3]) });
    else if (sql.startsWith('UPDATE "CreativeAgentRun"')) runRow.status = values[1] ?? "waiting_decision";
    else throw new Error(`Unexpected write: ${sql}`);
    return 1;
  },
};
const store = () => new CreativeAgentStore(db as unknown as PrismaClient);
const run = { id: "run", actorUserId: 7, canvasId: 2, epoch: 1 } as Run;
const prompt = { title: "生成范围", question: "先做哪些？", options: [], fields: [{ id: "scope", title: "范围", type: "radio" as const, required: true, options: [{ value: "people", label: "角色" }] }] };
beforeEach(() => { row = undefined; events = []; requests = new Map(); runRow = { id: "run", actor_user_id: 7, canvas_id: 2, epoch: 1, status: "running", lease_expires_at: new Date(Date.now() + 60000), worker_id: null, created_at: new Date(), updated_at: new Date() }; });

it("persists fields and answers across store recreation, then requeues a deferred run only once", async () => {
  const decision = await store().ask(run, "question-action", prompt);
  expect(events).toContainEqual(expect.objectContaining({ type: "decision.requested", fields: prompt.fields }));
  expect((await store().getDecision(decision.id)).fields).toEqual(prompt.fields);
  const requestId = randomUUID(), answer = { values: {}, notes: { scope: "角色已经在画布上了，只整理分镜" } };
  await store().answerDecision(decision.id, 7, requestId, decision.proposalHash, answer);
  expect((await store().getDecision(decision.id)).answer).toEqual(answer);
  expect(runRow.status).toBe("queued");
  const eventCount = events.length;
  await store().answerDecision(decision.id, 7, requestId, decision.proposalHash, answer);
  expect(events).toHaveLength(eventCount);
  await expect(store().answerDecision(decision.id, 7, requestId, decision.proposalHash, { skipped: true })).rejects.toMatchObject({ code: "request_id_conflict" });
});
it("validates against saved fields and keeps a rejected or foreign answer pending", async () => {
  const decision = await store().ask(run, "question-action", prompt);
  await expect(store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, { values: { scope: "all" } })).rejects.toMatchObject({ code: "invalid_answer" });
  await expect(store().answerDecision(decision.id, 8, randomUUID(), decision.proposalHash, { skipped: true })).rejects.toMatchObject({ code: "run_not_found" });
  expect(row!.state).toBe("pending");
  await store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, { skipped: true });
  expect(row!.answer).toEqual({ skipped: true });
});
it("does not accept form responses or skip as a paid approval", async () => {
  const decision = await store().ask(run, "media-action", { title: "确认生成", question: "生成1张？", options: [{ value: "approve", label: "确认生成" }, { value: "cancel", label: "取消" }], binding: { kind: "image.generate", argsHash: "args", units: 1 } });
  for (const answer of [{ skipped: true }, { values: { approval: "approve" } }, { values: {}, notes: { approval: "确认生成" } }]) {
    await expect(store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, answer)).rejects.toMatchObject({ code: "invalid_answer" });
  }
  expect(row!.state).toBe("pending");
  await store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, "approve");
  expect(row!.answer).toBe("approve");
});

it("persists media revision feedback once and invalidates the old approval", async () => {
  const decision = await store().ask(run, "media-action", { title: "确认生成", question: "生成1张？", options: [{ value: "approve", label: "确认生成" }, { value: "cancel", label: "取消" }], binding: { kind: "image.generate", argsHash: "args", units: 1 } });
  const answer = { revision: "改成普通家庭真实客厅，不要豪华酒店" }, requestId = randomUUID();
  await store().answerDecision(decision.id, 7, requestId, decision.proposalHash, answer);
  expect(row!.answer).toEqual(answer);
  expect(runRow.status).toBe("queued");
  const count = events.length;
  await store().answerDecision(decision.id, 7, requestId, decision.proposalHash, answer);
  expect(events).toHaveLength(count);
  await expect(store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, "approve")).rejects.toMatchObject({ code: "decision_stale" });
});
it("rejects empty, forged and non-media revisions without consuming the decision", async () => {
  const decision = await store().ask(run, "media-action", { title: "确认生成", question: "生成1张？", options: [{ value: "approve", label: "确认生成" }], binding: { kind: "image.generate", argsHash: "args", units: 1 } });
  for (const answer of [{ revision: "  " }, { revision: "x".repeat(4001) }, { revision: "改背景", approve: true }]) {
    await expect(store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, answer)).rejects.toMatchObject({ code: "invalid_answer" });
  }
  row!.binding.kind = "project.update";
  await expect(store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, { revision: "改背景" })).rejects.toMatchObject({ code: "invalid_answer" });
  expect(row!.state).toBe("pending");
});

it("persists a per-question ignore and allows ignoring a legacy question without approving a mutation", async () => {
  const decision = await store().ask(run, "question-action", prompt);
  const answer = { values: {}, skippedFields: ["scope"] };
  await store().answerDecision(decision.id, 7, randomUUID(), decision.proposalHash, answer);
  expect(row!.answer).toEqual(answer);
  row = undefined; runRow.status = "running";
  const legacy = await store().ask(run, "legacy-action", { title: "范围", question: "先做什么？", options: [{ value: "people", label: "角色" }, { value: "scene", label: "场景" }] });
  await store().answerDecision(legacy.id, 7, randomUUID(), legacy.proposalHash, { skipped: true });
  expect(row!.answer).toEqual({ skipped: true });
});
