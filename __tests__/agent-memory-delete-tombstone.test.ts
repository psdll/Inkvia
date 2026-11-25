import { describe, expect, it, vi } from "vitest";

import { deleteAgentMemoryForAdmin } from "@/lib/admin/legacy-agent-data/memory-delete-service";
import {
  finalizeAgentMemoryDeletion,
} from "@/lib/admin/legacy-agent-data/memory-profile-service";

function transactionDb(input: { profile: any; sourceCreatedAt: Date; memories?: any[] }) {
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    agentMessage: { findFirst: vi.fn().mockResolvedValue({ id: 31, userId: 7, createdAt: input.sourceCreatedAt }) },
    agentMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue(input.profile),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userMemory: {
      findMany: vi.fn().mockResolvedValue(input.memories || []),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
  db.$transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(db));
  return db;
}

describe(".Agent deletion tombstone", () => {

  it("does not let an older deletion remove a newer memory file", async () => {
    const db = transactionDb({
      profile: { userId: 7, revision: 6, deletedAt: null },
      sourceCreatedAt: new Date("2026-08-30T12:01:00.000Z"),
    });
    db.agentMemoryProfile.updateMany.mockResolvedValueOnce({ count: 0 });
    const deleteFile = vi.fn().mockResolvedValue(undefined);

    await expect(finalizeAgentMemoryDeletion(7, 5, { db, deleteFile }))
      .resolves.toEqual({ state: "stale" });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("admin deletion permanently removes rows, writes a tombstone, and deletes only the file", async () => {
    const db = transactionDb({
      profile: { userId: 7, revision: 4, deletedAt: null },
      sourceCreatedAt: new Date(),
    });
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const audit = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await expect(deleteAgentMemoryForAdmin(7, { actor: "admin" }, { db, deleteFile, audit, now }))
      .resolves.toEqual({ userId: 7, deletedCount: 2, revision: 5, deletedAt: now });
    expect(db.userMemory.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(db.agentMemoryProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ revision: 5, deletedAt: now, fileSyncedAt: null }),
    }));
    expect(deleteFile).toHaveBeenCalledWith(7);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actor: "admin", userId: 7, deletedCount: 2 }));
  });

  it("does not report success when the physical .Agent file could not be deleted", async () => {
    const db = transactionDb({
      profile: { userId: 7, revision: 4, deletedAt: null },
      sourceCreatedAt: new Date(),
    });
    const deleteFile = vi.fn().mockRejectedValue(new Error("disk busy"));
    const audit = vi.fn();

    await expect(deleteAgentMemoryForAdmin(
      7,
      { actor: "admin" },
      { db, deleteFile, audit, now: new Date("2026-08-30T12:00:00.000Z") },
    )).rejects.toThrow("AGENT_MEMORY_FILE_DELETE_FAILED");
    expect(audit).not.toHaveBeenCalled();
    expect(db.agentMemoryProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncError: "delete_failed" }),
    }));
  });
});
