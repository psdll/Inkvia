import "server-only";
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createHash } from "node:crypto";
import { generationOutputPaths } from "@/lib/generation/output-paths";

function stableUuidV5(input: string) {
  const bytes = createHash("sha1").update(input).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deriveAgentStepRequestKey(runId: number, stepKey: string) {
  return stableUuidV5(`inkvia:agent-run:${runId}:step:${stepKey}`);
}

export async function exportRuntimeRecords(userId: number, db = prisma) {
  const runs = await db.agentRun.findMany({ where: { userId, runtimeVersion: 2 }, select: { id: true }, take: 10_000 });
  const runIds = runs.map(r => r.id);
  if (!runIds.length) return [];
  const [steps, artifacts, calls] = await Promise.all([
    db.agentStepExecution.findMany({ where: { runId: { in: runIds } }, include: { attempts: true }, orderBy: { createdAt: 'asc' } }),
    db.agentArtifact.findMany({ where: { runId: { in: runIds } }, orderBy: { outputSlot: 'asc' } }),
    db.agentCallRecord.findMany({ where: { runId: { in: runIds } }, select: { runId: true, purpose: true, state: true, usage: true, inputTokens: true, outputTokens: true, amount: true, currency: true, costState: true, startedAt: true, finishedAt: true }, orderBy: { startedAt: 'asc' } }),
  ]);
  return runs.map(run => ({ schemaVersion: 2, runId: run.id,
    steps: steps.filter(s => s.runId === run.id).map(s => ({ id: s.id, stepKey: s.stepKey, definition: s.definitionSnapshot, status: s.status, introducedRevision: s.introducedRevision, attempts: s.attempts.map(a => ({ id: a.id, attemptNo: a.attemptNo, state: a.state, inputSources: (Array.isArray(a.inputSnapshot) ? a.inputSnapshot : []).map((i: any) => ({ ref: i.ref, contentVersion: i.contentVersion, facts: i.facts })) })) })),
    artifacts: artifacts.filter(a => a.runId === run.id).map(a => ({ id: a.id, stepId: a.stepId, attemptId: a.attemptId, outputSlot: a.outputSlot, kind: a.kind, generationId: a.generationId, source: a.source, text: a.text, contentVersion: a.contentVersion, facts: a.facts, observation: a.observation, validationReport: a.validationReport })),
    calls: calls.filter(c => c.runId === run.id).map(c => ({ ...c, amount: c.amount?.toString() || null })),
  }));
}

/** An ordinary import is non-executable history. Fresh approval, provider keys and reservations are never restored. */
export async function importRuntimeRecords(tx: Prisma.TransactionClient, rows: any[], userId: number, runMap: Map<number, number>, generationMap: Map<number, number>) {
  if (!Array.isArray(rows) || rows.length > 10_000) throw new Error('AGENT_ARCHIVE_INVALID');
  let count = 0;
  for (const row of rows) {
    const runId = runMap.get(row.runId);
    if (!runId || row.schemaVersion !== 2 || !Array.isArray(row.steps) || row.steps.length > 30 || !Array.isArray(row.artifacts) || row.artifacts.length > 2400) throw new Error('AGENT_ARCHIVE_INVALID');
    const run = await tx.agentRun.findFirst({ where: { id: runId, userId, runtimeVersion: 2 } });
    if (!run || !['completed', 'failed', 'cancelled', 'success'].includes(run.status)) throw new Error('AGENT_ARCHIVE_RUN_EXECUTABLE');
    const stepMap = new Map<string, string>(), attemptMap = new Map<string, string>();
    for (const step of row.steps) {
      if (typeof step.stepKey !== 'string' || step.stepKey.length > 80 || !Array.isArray(step.attempts) || step.attempts.length > 4) throw new Error('AGENT_ARCHIVE_INVALID');
      const created = await tx.agentStepExecution.upsert({ where: { runId_stepKey: { runId, stepKey: step.stepKey } }, create: { runId, stepKey: step.stepKey, introducedRevision: Number(step.introducedRevision) || 1, definitionSnapshot: step.definition, status: step.status === 'completed' ? 'completed' : 'cancelled' }, update: {} });
      stepMap.set(step.id, created.id);
      for (const attempt of step.attempts) {
        if (!Number.isInteger(attempt.attemptNo) || attempt.attemptNo < 1 || attempt.attemptNo > 4) throw new Error('AGENT_ARCHIVE_INVALID');
        const createdAttempt = await tx.agentStepAttempt.upsert({ where: { stepId_attemptNo: { stepId: created.id, attemptNo: attempt.attemptNo } }, create: { stepId: created.id, attemptNo: attempt.attemptNo, requestKey: deriveAgentStepRequestKey(runId, `archived:${step.stepKey}:${attempt.attemptNo}`), state: 'archived', inputSnapshot: [], inputDigest: 'archived', submissionRefs: [], budgetRevision: 0 }, update: {} });
        attemptMap.set(attempt.id, createdAttempt.id);
      }
    }
    for (const artifact of row.artifacts) {
      const stepId = stepMap.get(artifact.stepId), attemptId = attemptMap.get(artifact.attemptId);
      if (!stepId || !attemptId || !Number.isInteger(artifact.outputSlot) || artifact.outputSlot < 0 || artifact.outputSlot > 2399 || !['text', 'image', 'video', 'audio'].includes(artifact.kind)) throw new Error('AGENT_ARCHIVE_INVALID');
      const generationId = artifact.generationId ? generationMap.get(artifact.generationId) : undefined;
      const generation = generationId ? await tx.generation.findFirst({ where: { id: generationId, authUserId: userId } }) : null;
      const storageRef = generation ? generationOutputPaths(generation)[artifact.source?.parentGenerationId && artifact.source.parentGenerationId !== artifact.source.generationId ? 0 : Number(artifact.source?.outputIndex) || 0] : undefined;
      await tx.agentArtifact.upsert({ where: { attemptId_outputSlot: { attemptId, outputSlot: artifact.outputSlot } }, create: { runId, stepId, attemptId, outputSlot: artifact.outputSlot, kind: artifact.kind, generationId: generation?.id, storageRef, text: typeof artifact.text === 'string' ? artifact.text.slice(0, 16000) : null, contentVersion: String(artifact.contentVersion || 'archived'), availability: 'unverified', facts: artifact.facts || Prisma.DbNull, observation: artifact.observation || Prisma.DbNull, validationReport: artifact.validationReport || Prisma.DbNull }, update: {} });
    }
    // Historical costs are display data in the archive, not new accounting operations.
    await tx.agentRun.update({ where: { id: runId }, data: { currentStage: 'imported_history', generationApproval: Prisma.DbNull, budgetPolicy: Prisma.DbNull, validationSummary: { state: 'not_checked', checks: [], archived: true, historicalCalls: (Array.isArray(row.calls) ? row.calls : []).slice(0, 100).map((c: any) => ({ purpose: String(c.purpose), state: String(c.state), inputTokens: c.inputTokens, outputTokens: c.outputTokens, amount: c.amount, currency: c.currency, costState: c.costState })) } } }); count++;
  }
  return count;
}
