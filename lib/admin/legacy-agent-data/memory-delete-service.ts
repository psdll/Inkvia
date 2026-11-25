import "server-only";

import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { Logger } from "@/lib/logger";
import { deleteAgentMemoryFile } from "./memory-file";
import { finalizeAgentMemoryDeletion } from "./memory-profile-service";

type Db = any;

export class AgentMemoryFileDeleteError extends Error {
  readonly code = "AGENT_MEMORY_FILE_DELETE_FAILED";

  constructor(public readonly state: "delete_failed" | "stale") {
    super("AGENT_MEMORY_FILE_DELETE_FAILED");
    this.name = "AgentMemoryFileDeleteError";
  }
}

async function defaultAudit(input: Record<string, unknown>) {
  await Logger.userAction(
    "admin_delete_agent_memory",
    "管理员删除用户 .Agent 长期记忆",
    input,
    String(input.actor || "admin"),
  );
}

export async function deleteAgentMemoryForAdmin(
  userId: number,
  input: { actor: string },
  dependencies: {
    db?: Db;
    deleteFile?: typeof deleteAgentMemoryFile;
    audit?: typeof defaultAudit;
    now?: Date;
  } = {},
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("invalid Agent memory userId");
  const db = dependencies.db || prisma;
  const deleteFile = dependencies.deleteFile || deleteAgentMemoryFile;
  const audit = dependencies.audit || defaultAudit;
  const now = dependencies.now || new Date();
  const deleted = await db.$transaction(async (client: Db) => {
    await client.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-memory:${userId}`}, 0))::text AS lock_result
    `);
    const profile = await client.agentMemoryProfile.findUnique({ where: { userId } });
    const revision = Number(profile?.revision || 0) + 1;
    const rows = await client.userMemory.deleteMany({ where: { userId } });
    await client.agentMemoryProfile.upsert({
      where: { userId },
      create: { userId, revision, deletedAt: now, fileSyncedAt: null, syncError: null },
      update: { revision, deletedAt: now, fileSyncedAt: null, syncError: null },
    });
    return { deletedCount: rows.count, revision };
  });
  const finalized = await finalizeAgentMemoryDeletion(userId, deleted.revision, { db, deleteFile });
  if (finalized.state !== "deleted") {
    throw new AgentMemoryFileDeleteError(finalized.state);
  }
  await audit({
    actor: input.actor,
    userId,
    deletedCount: deleted.deletedCount,
    deletedAt: now.toISOString(),
  });
  return { userId, deletedCount: deleted.deletedCount, revision: deleted.revision, deletedAt: now };
}
