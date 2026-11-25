import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
import { CreativeAgentStore } from "@/lib/creative-agent/store";
const input = { messageId: "message", text: "use product", selection: { nodeIds: [], edgeIds: [], references: [] }, baseRevision: "1" };
const row = { id: "run", session_id: "session", actor_user_id: 7, canvas_id: 17, status: "running", epoch: 1, lease_expires_at: new Date(Date.now() + 60000), created_at: new Date(), updated_at: new Date(), input };
const selection = { nodeIds: ["source"], edgeIds: [], references: [{ canvasId: 17, nodeId: "source", label: "product", kind: "image", semanticHash: "a".repeat(64) }] };
describe("prepared reference persistence and history scope", () => {
  it("persists sent attachment references while retaining original input for replay", async () => {
    const query = vi.fn(async () => [row]);
    const execute = vi.fn(async (..._args: unknown[]) => 1);
    const tx = { $queryRawUnsafe: query, $executeRawUnsafe: execute };
    const store = new CreativeAgentStore({ $transaction: async (fn: any) => fn(tx) } as any);
    const prepared = await store.savePreparedReferences("run", 1, selection, "2");
    const saved = JSON.parse(String(execute.mock.calls[0][2]));
    expect(saved.selection).toEqual(input.selection);
    expect(saved.preparedSelection).toEqual(selection);
    expect(prepared.input.selection).toEqual(selection);
    expect(execute.mock.calls[1]).toEqual([expect.stringContaining('AND run_id=$2 AND session_id=$4'), "message", "run", JSON.stringify(selection.references), "session"]);
  });
  it("reads historical references only from the same actor canvas and session", async () => {
    const query = vi.fn(async () => [{ id: "prior", text: "product", reference_data: selection.references }]);
    const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
    const context = await store.getReferenceHistory({ id: "run", sessionId: "session", actorUserId: 7, canvasId: 17, createdAt: "2026-10-16", input } as any);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3'), "session", 7, 17, "2026-10-16");
    expect(context).toContain('"nodeId":"source"');
    expect(context).toContain("不是本轮自动选择");
  });
  it("includes legacy sent attachments even when prior reference_data is empty", async () => {
    const query = vi.fn(async () => [{ attachments: [{ id: "legacy" }] }]);
    const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
    expect(typeof (store as any).getHistoricalAttachmentIds).toBe("function");
    expect(await (store as any).getHistoricalAttachmentIds({ sessionId: "session", actorUserId: 7, canvasId: 17, createdAt: "2026-10-16" })).toEqual(["legacy"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3'), "session", 7, 17, "2026-10-16");
  });
  it("proves the source attachment was sent under its owner canvas session", async () => {
    const query = vi.fn(async () => [{ id: "source-run" }]);
    const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
    expect(typeof (store as any).hasSentAttachment).toBe("function");
    expect(await (store as any).hasSentAttachment(7, 17, "source-session", "attachment")).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("r.input->'attachments' @> $4::jsonb"), "source-session", 7, 17, '[{"id":"attachment"}]');
  });
  it("rejects prepared-reference persistence from a stale epoch", async () => {
    const execute = vi.fn();
    const tx = { $queryRawUnsafe: vi.fn(async () => [row]), $executeRawUnsafe: execute };
    const store = new CreativeAgentStore({ $transaction: async (fn: any) => fn(tx) } as any);
    await expect(store.savePreparedReferences("run", 2, selection, "2")).rejects.toMatchObject({ code: "stale_epoch" });
    expect(execute).not.toHaveBeenCalled();
  });
});
