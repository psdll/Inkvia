import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  deleteAgentMemoryFile,
  writeAgentMemoryFile,
  type AgentMemoryFile,
} from "./memory-file";

type Db = any;

export const agentMemoryProfileArchiveSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
}).strict();

export type AgentMemoryProfileArchive = z.infer<typeof agentMemoryProfileArchiveSchema>;

export function buildAgentMemorySnapshot(
  userId: number,
  revision: number,
  memories: any[],
  now = new Date(),
): AgentMemoryFile {
  return {
    schemaVersion: 1,
    userId,
    revision,
    updatedAt: now.toISOString(),
    memories: memories.slice(0, 200).map((memory) => ({
      id: Number(memory.id),
      type: memory.type,
      key: memory.key,
      value: memory.value,
      confidence: Number(memory.confidence),
      version: Number(memory.version),
      sourceMessageId: memory.sourceMessageId ?? null,
      updatedAt: memory.updatedAt instanceof Date ? memory.updatedAt.toISOString() : String(memory.updatedAt),
    })),
  };
}

async function syncPreparedAgentMemoryFile(
  db: Db,
  userId: number,
  snapshot: AgentMemoryFile,
  writeFile: typeof writeAgentMemoryFile,
  now: Date,
) {
  return db.$transaction(async (client: Db) => {
    await client.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-memory:${userId}`}, 0))::text AS lock_result
    `);
    const claimed = await client.agentMemoryProfile.updateMany({
      where: { userId, revision: snapshot.revision, deletedAt: null },
      data: { fileSyncedAt: null, syncError: "syncing_file" },
    });
    if (claimed.count !== 1) return { state: "stale" as const };
    try {
      await writeFile(snapshot);
    } catch {
      await client.agentMemoryProfile.updateMany({
        where: { userId, revision: snapshot.revision, deletedAt: null },
        data: { fileSyncedAt: null, syncError: "write_failed" },
      });
      return { state: "write_failed" as const };
    }
    await client.agentMemoryProfile.updateMany({
      where: { userId, revision: snapshot.revision, deletedAt: null },
      data: { fileSyncedAt: now, syncError: null },
    });
    return { state: "synced" as const };
  });
}

export async function finalizeAgentMemoryDeletion(
  userId: number,
  revision: number,
  dependencies: { db?: Db; deleteFile?: typeof deleteAgentMemoryFile } = {},
) {
  const db = dependencies.db || prisma;
  const deleteFile = dependencies.deleteFile || deleteAgentMemoryFile;
  return db.$transaction(async (client: Db) => {
    await client.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-memory:${userId}`}, 0))::text AS lock_result
    `);
    const claimed = await client.agentMemoryProfile.updateMany({
      where: { userId, revision, deletedAt: { not: null } },
      data: { fileSyncedAt: null, syncError: "deleting_file" },
    });
    if (claimed.count !== 1) return { state: "stale" as const };
    try {
      await deleteFile(userId);
    } catch {
      await client.agentMemoryProfile.updateMany({
        where: { userId, revision, deletedAt: { not: null } },
        data: { fileSyncedAt: null, syncError: "delete_failed" },
      });
      return { state: "delete_failed" as const };
    }
    await client.agentMemoryProfile.updateMany({
      where: { userId, revision, deletedAt: { not: null } },
      data: { fileSyncedAt: null, syncError: null },
    });
    return { state: "deleted" as const };
  });
}

export async function rebuildAgentMemoryProfileAfterImport(
  userId: number,
  archivedProfile: AgentMemoryProfileArchive | null,
  dependencies: { db?: Db; writeFile?: typeof writeAgentMemoryFile; deleteFile?: typeof deleteAgentMemoryFile; now?: Date } = {},
) {
  const db = dependencies.db || prisma;
  const writeFile = dependencies.writeFile || writeAgentMemoryFile;
  const deleteFile = dependencies.deleteFile || deleteAgentMemoryFile;
  const now = dependencies.now || new Date();
  const prepared = await db.$transaction(async (client: Db) => {
    await client.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-memory:${userId}`}, 0))::text AS lock_result
    `);
    const existing = await client.agentMemoryProfile.findUnique({ where: { userId } });
    const revision = Math.max(Number(existing?.revision || 0), Number(archivedProfile?.revision || 0)) + 1;
    if (archivedProfile?.deletedAt) {
      await client.userMemory.deleteMany({ where: { userId } });
      await client.agentMemoryProfile.upsert({
        where: { userId },
        create: { userId, revision, deletedAt: new Date(archivedProfile.deletedAt), fileSyncedAt: null, syncError: null },
        update: { revision, deletedAt: new Date(archivedProfile.deletedAt), fileSyncedAt: null, syncError: null },
      });
      return { deleted: true as const, revision };
    }
    const memories = await client.userMemory.findMany({
      where: { userId, isActive: true },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    if (!memories.length && !archivedProfile && !existing) return null;
    await client.agentMemoryProfile.upsert({
      where: { userId },
      create: { userId, revision, deletedAt: null, fileSyncedAt: null, syncError: "pending_file_sync" },
      update: { revision, deletedAt: null, fileSyncedAt: null, syncError: "pending_file_sync" },
    });
    return { deleted: false as const, revision, snapshot: buildAgentMemorySnapshot(userId, revision, memories, now) };
  });
  if (!prepared) return { rebuilt: false as const, reason: "empty" as const };
  if (prepared.deleted) {
    const finalized = await finalizeAgentMemoryDeletion(userId, prepared.revision, { db, deleteFile });
    return finalized.state === "deleted"
      ? { rebuilt: true as const, deleted: true as const, revision: prepared.revision }
      : { rebuilt: false as const, deleted: true as const, revision: prepared.revision, reason: finalized.state };
  }
  const sync = await syncPreparedAgentMemoryFile(db, userId, prepared.snapshot, writeFile, now);
  if (sync.state === "synced") {
    return { rebuilt: true as const, deleted: false as const, revision: prepared.revision };
  }
  return { rebuilt: false as const, reason: sync.state === "stale" ? "profile_changed" as const : "write_failed" as const, revision: prepared.revision };
}

