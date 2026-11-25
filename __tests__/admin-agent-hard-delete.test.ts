import { describe, expect, it, vi } from "vitest";
import { hardDeleteAgentConversation } from "@/lib/admin/legacy-agent-data/admin-delete-service";

describe("admin hard delete Agent conversation", () => {
  it("deletes only Agent-owned rows and preserves generations, ledgers and assets", async () => {
    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      agentConversation: { findFirst: vi.fn().mockResolvedValue({ id: 9, userId: 7 }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      agentRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      agentGenerationLink: { findMany: vi.fn().mockResolvedValue([{ generationId: 44 }, { generationId: 45 }]), deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      agentEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      agentMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
      generation: { deleteMany: vi.fn() },
      usageLedger: { deleteMany: vi.fn() },
    };
    const db = { $transaction: (work: any) => work(tx) };

    const result = await hardDeleteAgentConversation({ userId: 7, conversationId: 9 }, { db: db as any });

    expect(result.preservedGenerationIds).toEqual([44, 45]);
    expect(tx.generation.deleteMany).not.toHaveBeenCalled();
    expect(tx.usageLedger.deleteMany).not.toHaveBeenCalled();
    expect(tx.agentGenerationLink.deleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.agentConversation.deleteMany.mock.invocationCallOrder[0]);
  });
});
