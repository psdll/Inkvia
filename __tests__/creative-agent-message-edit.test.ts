import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
import { CreativeAgentStore } from "@/lib/creative-agent/store";
import { hash } from "@/lib/creative-agent/store-types";

const date = new Date("2026-10-14T11:00:00Z");
const input = { messageId: "m", sessionId: "s", actorUserId: 7, canvasId: 2, text: "旧要求", baseRevision: "4", selection: { nodeIds: ["n"], edgeIds: [], references: [] }, attachments: [{ id: "attachment" }], model: { providerId: "p", modelId: "model" } };
function fixture({ editable = true, status = "running", previous }: { editable?: boolean; status?: string; previous?: unknown } = {}) {
  const row = { id: "r", session_id: "s", actor_user_id: 7, canvas_id: 2, status, epoch: 3, input, created_at: date, updated_at: date, lease_expires_at: new Date(Date.now() + 60000) };
  const transcript = [{ role: "user", timestamp: date.getTime() - 1000, content: "上一轮" }, { role: "user", timestamp: date.getTime(), content: "旧要求" }, { role: "assistant", content: "旧方案" }];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM "CreativeAgentRun" WHERE id=$1 FOR UPDATE')) return [row];
    if (sql.includes('FROM "CreativeAgentRequest"')) return previous ? [previous] : [];
    if (sql.includes('NOT EXISTS') && sql.includes('"CreativeAgentAction"')) return editable ? [{ id: "m" }] : [];
    if (sql.includes('SELECT transcript')) return [{ transcript }];
    if (sql.includes('UPDATE "CreativeAgentMessage"')) return [{ id: "m", run_id: "r", role: "user", text: "新要求", created_at: date, reference_data: [] }];
    return [];
  });
  const execute = vi.fn(async () => 1);
  const store = new CreativeAgentStore({ $transaction: async (fn: any) => fn({ $queryRawUnsafe: query, $executeRawUnsafe: execute }) } as any);
  return { store, query, execute };
}
const edit = { runId: "r", messageId: "m", requestId: "request", text: "新要求", expectedText: "旧要求" };
describe("latest message revision", () => {
  it("acknowledges a retried revision without restarting again even after execution advances", async () => {
    const result = { runId: "r", sessionId: "s" };
    const { store, execute } = fixture({ editable: false, status: "completed", previous: { actor_user_id: 7, input_hash: hash({ actorUserId: 7, canvasId: 2, ...edit }), result } });
    expect(await store.reviseMessage(7, 2, edit)).toEqual(result);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an old worker trying to pause the revised run", async () => {
    const { store, execute } = fixture();
    await expect(store.control("r", 7, "old-worker-pause", "pause", 2)).rejects.toMatchObject({ code: "stale_epoch" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("restarts preparation in the same run, fences stale workers and preserves references/options", async () => {
    const { store, execute } = fixture();
    await store.reviseMessage(7, 2, edit);
    const writes = execute.mock.calls as unknown as unknown[][];
    const reset = writes.find(call => String(call[0]).includes('UPDATE "CreativeAgentRun"'))!;
    expect(reset[0]).toContain("epoch=epoch+1");
    expect(reset[0]).toContain("status='queued'");
    expect(JSON.parse(String(reset[2]))).toMatchObject({ ...input, text: "新要求", revision: 1 });
    const history = writes.find(call => String(call[0]).includes('UPDATE "CreativeAgentSession"'))!;
    expect(JSON.parse(String(history[2]))).toEqual([{ role: "user", timestamp: date.getTime() - 1000, content: "上一轮" }]);
    expect(writes.some(call => String(call[0]).includes('UPDATE "CreativeAgentDecision"'))).toBe(true);
    expect(writes.some(call => call[2] === "message.revised")).toBe(true);
    expect(writes.some(call => String(call[0]).includes('INSERT INTO "CreativeAgentSession"'))).toBe(false);
  });
  it.each(["completed", "failed", "stopped", "waiting_action", "stopping"])("rejects editing after the run becomes %s", async status => {
    const { store, execute } = fixture({ status });
    await expect(store.reviseMessage(7, 2, edit)).rejects.toMatchObject({ code: "message_edit_closed" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects historical messages or a mutation claimed while the editor was open", async () => {
    const { store, execute } = fixture({ editable: false });
    await expect(store.reviseMessage(7, 2, edit)).rejects.toMatchObject({ code: "message_edit_closed" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not overwrite a concurrent revision", async () => {
    const { store, execute } = fixture();
    await expect(store.reviseMessage(7, 2, { ...edit, expectedText: "另一个版本" })).rejects.toMatchObject({ code: "message_edit_conflict" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("checks actor and canvas ownership before changing anything", async () => {
    const { store, execute } = fixture();
    await expect(store.reviseMessage(8, 2, edit)).rejects.toMatchObject({ status: 404 });
    await expect(store.reviseMessage(7, 3, edit)).rejects.toMatchObject({ status: 404 });
    expect(execute).not.toHaveBeenCalled();
  });
});
