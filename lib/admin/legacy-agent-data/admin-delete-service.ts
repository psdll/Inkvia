import "server-only";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { clearRuntimePrivateCalls } from './runtime-retention';

type Db = any;

export class AdminAgentDeleteError extends Error {
  constructor(public code: "NOT_FOUND" | "INVALID_INPUT", message: string) {
    super(message);
    this.name = "AdminAgentDeleteError";
  }
}

export async function hardDeleteAgentConversation(
  input: { userId: number; conversationId: number },
  dependencies: { db?: Db; now?: Date } = {},
) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0 || !Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
    throw new AdminAgentDeleteError("INVALID_INPUT", "Agent 对话删除参数无效");
  }
  const db = dependencies.db || prisma;
  const now = dependencies.now || new Date();
  return db.$transaction(async (client: Db) => {
    await client.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-conversation:${input.conversationId}`}, 0))::text AS lock_result
    `);
    const conversation = await client.agentConversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      select: { id: true, userId: true },
    });
    if (!conversation) throw new AdminAgentDeleteError("NOT_FOUND", "Agent 对话不存在");

    const links = await client.agentGenerationLink.findMany({
      where: { conversationId: input.conversationId },
      select: { generationId: true },
    });
    await client.agentRun.updateMany({
      where: { conversationId: input.conversationId, userId: input.userId },
      data: { status: "cancelled", cancelRequestedAt: now, finishedAt: now, leaseOwner: null, leaseUntil: null },
    });
    const deletedLinks = await client.agentGenerationLink.deleteMany({ where: { conversationId: input.conversationId } });
    await clearRuntimePrivateCalls(client, { conversationId: input.conversationId });
    const deletedEvents = await client.agentEvent.deleteMany({ where: { conversationId: input.conversationId } });
    const deletedMessages = await client.agentMessage.deleteMany({ where: { conversationId: input.conversationId, userId: input.userId } });
    const deletedRuns = await client.agentRun.deleteMany({ where: { conversationId: input.conversationId, userId: input.userId } });
    const deletedConversations = await client.agentConversation.deleteMany({ where: { id: input.conversationId, userId: input.userId } });
    return {
      userId: input.userId,
      conversationId: input.conversationId,
      deleted: {
        conversations: deletedConversations.count,
        messages: deletedMessages.count,
        runs: deletedRuns.count,
        events: deletedEvents.count,
        generationLinks: deletedLinks.count,
      },
      preservedGenerationIds: Array.from<number>(new Set<number>(links.map((link: any) => Number(link.generationId)))).sort((a, b) => a - b),
    };
  });
}
