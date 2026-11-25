import { describe, expect, it, vi } from "vitest";
// 并发上限可配置（默认 6）；这里固定为 2 验证“有上限”的生命周期行为
process.env.CREATIVE_AGENT_WORKER_SLOTS = "2";
const harness = vi.hoisted(() => ({
  heartbeat: vi.fn(async () => true), upsert: vi.fn(async () => undefined), allowed: vi.fn(() => true), enabled: vi.fn(async () => undefined),
  claim: vi.fn(), recover: vi.fn(async () => 0), getRun: vi.fn(async () => ({ status: "completed" })), finish: vi.fn(async () => undefined), control: vi.fn(async () => undefined),
  runner: vi.fn(), resume: vi.fn(async () => false), createModel: vi.fn(async () => ({ model: {}, stream: vi.fn() })), tools: vi.fn(() => []),
}));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { upsert: harness.upsert } } }));
vi.mock("@/lib/maintenance", () => ({ backgroundJobsAllowed: harness.allowed, MaintenanceSubmissionError: class extends Error {} }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: harness.enabled }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { claimRun: harness.claim, recoverExpired: harness.recover, heartbeat: harness.heartbeat, getRun: harness.getRun, finish: harness.finish, control: harness.control, appendEvent: vi.fn(async () => undefined) } }));
vi.mock("@/lib/creative-agent/debug-store", () => ({ appendDebugEvent: vi.fn(async () => undefined), pruneDebugRecords: vi.fn(async () => undefined) }));
vi.mock("@/lib/creative-agent/media-delivery", () => ({ reconcileCreativeAgentMedia: vi.fn(async () => 0) }));
vi.mock("@/lib/creative-agent/runner", () => ({ runCreativeAgent: harness.runner, resumeCompletedCreativeAgentTurn: harness.resume }));
vi.mock("@/lib/creative-agent/llm-broker", () => ({ createCreativeAgentModelStream: harness.createModel }));
vi.mock("@/lib/creative-agent/tools", () => ({ createCreativeTools: harness.tools }));
vi.mock("@/lib/creative-agent/canvas-tools", () => ({ executeCreativeAgentTool: vi.fn() }));
import { runCreativeAgentWorkerTick } from "@/lib/creative-agent/worker";
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw new Error("condition timeout"); }
function job(id: string, epoch: number) { return { id, epoch, actorUserId: 1, canvasId: 1, sessionId: "session", input: {} }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe("creative Agent bounded worker lifecycle", () => {
  it("does not let an old epoch's finally delete a newly reclaimed job with the same run ID", async () => {
    const old = deferred(), newer = deferred(), other = deferred();
    harness.runner.mockImplementation(async (run: { id: string; epoch: number }) => { await (run.id === "same" ? run.epoch === 1 ? old.promise : newer.promise : other.promise); });
    harness.claim.mockResolvedValueOnce(job("same", 1)).mockResolvedValueOnce(null).mockResolvedValueOnce(job("same", 3)).mockResolvedValueOnce(job("other", 1)).mockResolvedValueOnce(job("must-not-fit", 1)).mockResolvedValue(null);
    await runCreativeAgentWorkerTick(); await until(() => harness.runner.mock.calls.length === 1);
    await runCreativeAgentWorkerTick(); await until(() => harness.runner.mock.calls.length === 2);
    old.resolve(); await tick(); await tick();
    const third = await runCreativeAgentWorkerTick();
    expect(third.claimed).toBe(1); expect(harness.claim).toHaveBeenCalledTimes(4);
    await until(() => harness.runner.mock.calls.length === 3);
    newer.resolve(); other.resolve(); await tick(); await tick();
  });
  it("does not initialize a chat model for a completed model turn that only needs media observation", async () => {
    harness.claim.mockReset().mockResolvedValueOnce(job("media-observation", 5)).mockResolvedValue(null);
    harness.resume.mockResolvedValue(true); harness.createModel.mockClear(); harness.runner.mockClear();
    const prior = harness.getRun.mock.calls.length;
    await runCreativeAgentWorkerTick(); await until(() => harness.getRun.mock.calls.length > prior); await tick();
    expect(harness.createModel).not.toHaveBeenCalled(); expect(harness.runner).not.toHaveBeenCalled();
  });
  it("reports heartbeat during maintenance without claiming new work", async () => {
    harness.allowed.mockReturnValue(false); harness.claim.mockClear(); harness.upsert.mockClear();
    expect((await runCreativeAgentWorkerTick()).claimed).toBe(0);
    expect(harness.upsert).toHaveBeenCalled(); expect(harness.claim).not.toHaveBeenCalled();
  });
});
