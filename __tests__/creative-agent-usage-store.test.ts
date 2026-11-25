import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
import { CreativeAgentStore } from "@/lib/creative-agent/store";

const message = { role: "assistant", model: "model", content: [{ type: "text", text: "private transcript" }], usage: { input: 80, output: 10, cacheRead: 20, cacheWrite: 0 }, creativeUsage: { reported: true, cacheReported: true, decodeMs: 1000 } };
describe("creative Agent persisted usage", () => {
  it("restores persisted turn completion times with the authorized session", async () => {
    const finished = new Date("2026-10-14T11:58:00Z");
    const query = vi.fn(async (sql: string) => sql.includes('FROM "CreativeAgentSession" s')
      ? [{ id: "s", title: "title", title_source: "auto", created_at: finished, updated_at: finished }]
      : sql.startsWith('SELECT id,updated_at FROM "CreativeAgentRun"') ? [{ id: "old", updated_at: finished }] : []);
    const tx = { $queryRawUnsafe: query, $executeRawUnsafe: vi.fn(async () => 0) };
    const store = new CreativeAgentStore({ $transaction: async (fn: any) => fn(tx) } as any);
    expect((await store.snapshot(1, 2, "s")).finishedAtByRun).toEqual({ old: finished.toISOString() });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('id IN (SELECT run_id FROM "CreativeAgentMessage" WHERE session_id=$1)'), "s", 1, 2);
  });
  it("publishes absolute totals in the same transaction as the transcript", async () => {
    const query = vi.fn(async () => [{ id: "r", session_id: "s", actor_user_id: 1, canvas_id: 2, status: "running", epoch: 1, lease_expires_at: new Date(Date.now() + 60000), created_at: new Date(), updated_at: new Date() }]);
    const execute = vi.fn(async (..._args: unknown[]) => 1);
    const tx = { $queryRawUnsafe: query, $executeRawUnsafe: execute };
    const transaction = vi.fn(async (fn: any) => fn(tx));
    const store = new CreativeAgentStore({ $transaction: transaction } as any);
    await store.saveTranscript("r", 1, [message]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toContain("SET transcript");
    const event = (execute.mock.calls as unknown[][]).find(args => String(args[0]).includes("CreativeAgentEvent"))!;
    expect(event[2]).toBe("usage.updated");
    expect(JSON.parse(String(event[3]))).toMatchObject({ usage: { inputTokens: 100, outputTokens: 10, cacheHitPercent: 20, tokensPerSecond: 10 } });
    expect(String(event[3])).not.toContain("private transcript");
  });
  it("recovers saved totals in an authorized session snapshot without returning the transcript", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM \"CreativeAgentSession\" s") ? [{ id: "s", title: "title", title_source: "auto", transcript: [message], created_at: new Date(), updated_at: new Date() }] : []);
    const tx = { $queryRawUnsafe: query, $executeRawUnsafe: vi.fn(async () => 0) };
    const store = new CreativeAgentStore({ $transaction: async (fn: any) => fn(tx) } as any);
    const snapshot = await store.snapshot(1, 2, "s");
    expect(snapshot.usage).toMatchObject({ inputTokens: 100, outputTokens: 10, tokensPerSecond: 10 });
    expect(JSON.stringify(snapshot)).not.toContain("private transcript");
    expect(query.mock.calls[0]?.[0]).toContain("s.actor_user_id=$1 AND s.canvas_id=$2 AND s.id=$3");
  });
});
