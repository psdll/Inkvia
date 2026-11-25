import { z } from "zod";

const agentEventTypeSchema = z.enum([
  "run_created",
  "activity_updated",
  "status_changed",
  "message_created",
  "clarification_required",
  "plan_created",
  "task_submitted",
  "task_progress",
  "task_completed",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "step_changed", "artifact_changed", "usage_changed", "validation_changed", "summary_changed",
]);

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

const bigintArchiveIdSchema = z.union([
  z.string().regex(/^[1-9]\d*$/),
  z.number().int().positive(),
]).transform((value, context) => {
  const text = String(value);
  try {
    if (BigInt(text) > MAX_POSTGRES_BIGINT) throw new Error("range");
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "BigInt 主键无效" });
    return z.NEVER;
  }
  return text;
});

const optionalDateSchema = z.string().datetime().nullable();

const agentEventArchiveSchema = z.object({
  id: bigintArchiveIdSchema,
  runId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  sequence: z.number().int().positive(),
  type: agentEventTypeSchema,
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
}).strict();

const agentGenerationLinkArchiveSchema = z.object({
  id: bigintArchiveIdSchema,
  runId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  messageId: z.number().int().positive().nullable(),
  generationId: z.number().int().positive(),
  taskType: z.enum(["image", "video"]),
  stepKey: z.string().trim().min(1).max(80),
  requestKey: z.string().uuid(),
  userDeletedAt: optionalDateSchema,
  purgeAfter: optionalDateSchema,
  createdAt: z.string().datetime(),
}).strict();

export type AgentEventArchiveRow = z.infer<typeof agentEventArchiveSchema>;
export type AgentGenerationLinkArchiveRow = z.infer<typeof agentGenerationLinkArchiveSchema>;

export function parseAgentEventArchiveRows(rows: unknown[]) {
  return z.array(agentEventArchiveSchema).max(200_000).parse(rows);
}

export function parseAgentGenerationLinkArchiveRows(rows: unknown[]) {
  return z.array(agentGenerationLinkArchiveSchema).max(100_000).parse(rows);
}

function requiredMapping(label: string, sourceId: number, mapping: Map<number, number>) {
  const target = mapping.get(sourceId);
  if (!target) throw new Error(`${label}=${sourceId} 缺少对应的父记录，无法完整导入`);
  return target;
}

export function remapAgentTransferRows(input: {
  events: AgentEventArchiveRow[];
  links: AgentGenerationLinkArchiveRow[];
  conversationIdMap: Map<number, number>;
  runIdMap: Map<number, number>;
  messageIdMap: Map<number, number>;
  generationIdMap: Map<number, number>;
  ownedGenerationIds: Set<number>;
}) {
  const events = input.events.map(({ id: _id, ...event }) => ({
    ...event,
    runId: requiredMapping("runId", event.runId, input.runIdMap),
    conversationId: requiredMapping("conversationId", event.conversationId, input.conversationIdMap),
    createdAt: new Date(event.createdAt),
  }));
  let skippedLinks = 0;
  const links = input.links.flatMap(({ id: _id, ...link }) => {
    const generationId = input.generationIdMap.get(link.generationId);
    if (!generationId || !input.ownedGenerationIds.has(generationId)) {
      skippedLinks += 1;
      return [];
    }
    return [{
      ...link,
      runId: requiredMapping("runId", link.runId, input.runIdMap),
      conversationId: requiredMapping("conversationId", link.conversationId, input.conversationIdMap),
      messageId: link.messageId == null
        ? null
        : requiredMapping("messageId", link.messageId, input.messageIdMap),
      generationId,
      userDeletedAt: link.userDeletedAt ? new Date(link.userDeletedAt) : null,
      purgeAfter: link.purgeAfter ? new Date(link.purgeAfter) : null,
      createdAt: new Date(link.createdAt),
    }];
  });
  return { events, links, skippedLinks };
}
