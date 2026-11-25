import "server-only";
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export async function clearRuntimePrivateCalls(tx: any, where: { conversationId?: number; userId?: number }) {
  if (!tx.agentCallRecord) return;
  const scope = where.userId !== undefined ? Prisma.sql`"userId" = ${where.userId}` : where.conversationId !== undefined ? Prisma.sql`"conversationId" = ${where.conversationId}` : null;
  if (!scope) throw new Error('AGENT_RETENTION_SCOPE_REQUIRED');
  // Match settlement's Run -> call lock order before clearing private payloads.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AgentRun" WHERE ${scope} ORDER BY "id" FOR UPDATE`);
  await tx.agentCallRecord.updateMany({ where: { run: where }, data: { result: Prisma.DbNull, inputDigest: null, stepId: null, attemptId: null } });
}

export async function deleteUserRuntimeRuns(userId: number, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AgentRun" WHERE "userId" = ${userId} ORDER BY "id" FOR UPDATE`);
    await clearRuntimePrivateCalls(tx, { userId });
    return tx.agentRun.deleteMany({ where: { userId } });
  });
}

