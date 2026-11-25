import { describe, expect, it, vi } from "vitest";
import { rebuildAgentMemoryProfileAfterImport } from "@/lib/admin/legacy-agent-data/memory-profile-service";
import { importRuntimeRecords } from "@/lib/admin/legacy-agent-data/runtime-transfer";

function archiveDb() {
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    agentMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue({ revision: 2 }),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userMemory: {
      findMany: vi.fn().mockResolvedValue([{ id: 3, type: "style", key: "style", value: "historical", confidence: 0.9, version: 1, updatedAt: new Date(0) }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  db.$transaction = async (fn: (tx: any) => unknown) => fn(db);
  return db;
}

describe("historical Agent account archive compatibility", () => {
  it("rebuilds an imported memory file at a higher revision", async () => {
    const db = archiveDb();
    const writeFile = vi.fn();
    await expect(rebuildAgentMemoryProfileAfterImport(7, { schemaVersion: 1, userId: 9, revision: 4, deletedAt: null }, { db, writeFile }))
      .resolves.toMatchObject({ rebuilt: true, revision: 5 });
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, revision: 5, memories: [expect.objectContaining({ value: "historical" })] }));
  });

  it("preserves an imported deletion tombstone instead of reviving the memory", async () => {
    const db = archiveDb();
    const writeFile = vi.fn(), deleteFile = vi.fn();
    await expect(rebuildAgentMemoryProfileAfterImport(7, { schemaVersion: 1, userId: 9, revision: 4, deletedAt: new Date(0).toISOString() }, { db, writeFile, deleteFile }))
      .resolves.toMatchObject({ rebuilt: true, deleted: true, revision: 5 });
    expect(writeFile).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith(7);
  });

  it("rejects importing an executable run", async () => {
    const tx: any = { agentRun: { findFirst: vi.fn().mockResolvedValue({ status: "running" }) } };
    await expect(importRuntimeRecords(tx, [{ runId: 1, schemaVersion: 2, steps: [], artifacts: [] }], 7, new Map([[1, 10]]), new Map()))
      .rejects.toThrow("AGENT_ARCHIVE_RUN_EXECUTABLE");
    expect(tx.agentRun.findFirst).toHaveBeenCalledWith({ where: { id: 10, userId: 7, runtimeVersion: 2 } });
  });

  it("restores completed attempts as inert history with no approval or reservation", async () => {
    const tx: any = {
      agentRun: { findFirst: vi.fn().mockResolvedValue({ status: "completed" }), update: vi.fn() },
      agentStepExecution: { upsert: vi.fn().mockResolvedValue({ id: "step-new" }) },
      agentStepAttempt: { upsert: vi.fn().mockResolvedValue({ id: "attempt-new" }) },
    };
    const rows = [{ runId: 1, schemaVersion: 2, steps: [{ id: "step-old", stepKey: "cover", definition: {}, status: "completed", attempts: [{ id: "attempt-old", attemptNo: 1 }] }], artifacts: [] }];
    await expect(importRuntimeRecords(tx, rows, 7, new Map([[1, 10]]), new Map())).resolves.toBe(1);
    expect(tx.agentStepAttempt.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ state: "archived", inputSnapshot: [], submissionRefs: [], budgetRevision: 0 }) }));
    expect(tx.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentStage: "imported_history" }) }));
  });
});
